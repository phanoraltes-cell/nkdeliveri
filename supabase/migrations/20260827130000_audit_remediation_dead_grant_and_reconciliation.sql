-- Audit remediation (2026-08-27), items DB-001 + FIN-001.
--
-- DB-001: platform_payout_settings has had RLS enabled with ZERO CREATE
-- POLICY since its creation (20260708090000_admin_users_and_platform_
-- payout.sql), which means the `GRANT SELECT ... TO authenticated` from
-- that same migration has been dead/inert the whole time — RLS-enabled +
-- 0 policies denies every row to every non-owner role regardless of table
-- grants. Not a security hole (fails closed), and application code never
-- relied on it (src/routes/_authenticated/dashboard.admin.payout-settings.tsx
-- reads through get_platform_payout_public() instead) — purely a
-- misleading grant that could cost a future developer real debugging time
-- ("why does a direct SELECT return 0 rows despite this GRANT?"). Revoking
-- it changes nothing observable; it just makes `\dp platform_payout_
-- settings` in psql match reality.
REVOKE SELECT ON public.platform_payout_settings FROM authenticated;

BEGIN;

-- FIN-001: wallets.available_balance/lifetime_earnings are stored,
-- incrementally-updated running totals (commission_engine.sql's
-- trg_generate_commission_on_delivery / trg_reverse_commission_on_refund),
-- not a value derived fresh from commission_ledger on every read. Every
-- individual credit/debit pair verified symmetric and idempotent during
-- the audit, but nothing previously existed to catch a FUTURE regression
-- (a new entry_type added to commission_ledger without updating this
-- function, a manual SQL fix that touches one table and not the other,
-- etc.) — this is that safety net, not a fix to an already-detected drift.
--
-- Read-only by design: SELECTs and INSERTs into a discrepancy log, never
-- corrects a balance itself. A reconciliation job that "fixes" numbers
-- automatically is itself a way to silently paper over a real bug; a
-- human should look at wallet_discrepancies before any balance is
-- adjusted.
CREATE TABLE public.wallet_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE,
  stored_available_balance numeric(12,2) NOT NULL,
  ledger_derived_balance numeric(12,2) NOT NULL,
  difference numeric(12,2) NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  notes text
);

CREATE INDEX wallet_discrepancies_wallet_id_idx ON public.wallet_discrepancies(wallet_id);
CREATE INDEX wallet_discrepancies_unresolved_idx ON public.wallet_discrepancies(detected_at) WHERE NOT resolved;

ALTER TABLE public.wallet_discrepancies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.wallet_discrepancies FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.wallet_discrepancies TO service_role;

-- Admin/super_admin can read + mark resolved (with a note) through normal
-- PostgREST access — same has_role() convention as every other admin-
-- gated policy in this project. No INSERT policy for authenticated: rows
-- are only ever written by check_wallet_reconciliation_secure() below,
-- itself SECURITY DEFINER, so a direct client INSERT was never the
-- intended path anyway.
CREATE POLICY "wallet_discrepancies admin read" ON public.wallet_discrepancies FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "wallet_discrepancies admin resolve" ON public.wallet_discrepancies FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Core check. Admin-only (this walks every wallet + every ledger row —
-- not something to expose to a plain authenticated caller even read-only,
-- since the aggregate itself reveals every restaurant/driver's ledger
-- history shape). Computes the ledger-derived balance the exact same way
-- FIN-001's own "tès ki regle deba a" query did during the audit: sum of
-- commission_ledger.net_amount (order_commission + reversal entries) for
-- that beneficiary, minus every payout that has actually left the
-- platform for it (payouts.status IN ('paid','confirmed') — 'disputed'/
-- 'resolved' payouts already happened from the wallet's perspective, same
-- as 'paid'; only a payout still in-flight or failed should NOT be
-- subtracted, and this table only ever holds completed payouts per
-- initiate_payout_secure's own INSERT — see payout_wallet_schema.sql).
CREATE OR REPLACE FUNCTION public.check_wallet_reconciliation_secure()
RETURNS TABLE (
  wallet_id uuid,
  restaurant_id uuid,
  driver_id uuid,
  stored_balance numeric,
  ledger_derived_balance numeric,
  difference numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH ledger_sum AS (
    SELECT
      cl.restaurant_id,
      cl.driver_id,
      SUM(cl.net_amount) AS total_net
    FROM public.commission_ledger cl
    WHERE cl.entry_type IN ('order_commission', 'reversal')
    GROUP BY cl.restaurant_id, cl.driver_id
  ),
  payout_sum AS (
    SELECT
      p.restaurant_id,
      p.driver_id,
      SUM(p.amount) AS total_paid
    FROM public.payouts p
    WHERE p.status IN ('paid', 'confirmed', 'disputed', 'resolved')
    GROUP BY p.restaurant_id, p.driver_id
  )
  SELECT
    w.id,
    w.restaurant_id,
    w.driver_id,
    w.available_balance,
    COALESCE(ls.total_net, 0) - COALESCE(ps.total_paid, 0) AS ledger_derived,
    w.available_balance - (COALESCE(ls.total_net, 0) - COALESCE(ps.total_paid, 0)) AS diff
  FROM public.wallets w
  LEFT JOIN ledger_sum ls
    ON ls.restaurant_id IS NOT DISTINCT FROM w.restaurant_id
   AND ls.driver_id IS NOT DISTINCT FROM w.driver_id
  LEFT JOIN payout_sum ps
    ON ps.restaurant_id IS NOT DISTINCT FROM w.restaurant_id
   AND ps.driver_id IS NOT DISTINCT FROM w.driver_id
  WHERE w.available_balance <> (COALESCE(ls.total_net, 0) - COALESCE(ps.total_paid, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.check_wallet_reconciliation_secure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_wallet_reconciliation_secure() TO authenticated;

-- Runs the check above and persists any discrepancy found — called by the
-- new /api/cron/wallet-reconciliation route (CRON_SECRET-protected, same
-- convention as the other two cron routes) via supabaseAdmin.rpc(), not
-- directly by an admin UI. Lives in `public` (not `private`) because
-- PostgREST/`.rpc()` only resolves unqualified function names against the
-- exposed `public` schema — same reason create_order_secure needs a
-- public wrapper around its private implementation elsewhere in this
-- project. SECURITY DEFINER + no auth.uid() check of its own: the
-- caller-facing authorization boundary is the cron route's CRON_SECRET
-- check, exactly like moncash-reconcile.server.ts/plop-reconcile.server.ts's
-- own RPCs — EXECUTE is granted to service_role only, never authenticated,
-- so this is never reachable from a browser session regardless.
CREATE OR REPLACE FUNCTION public.run_wallet_reconciliation_secure()
RETURNS TABLE (checked_count int, discrepancy_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_checked int := 0;
  v_discrepancies int := 0;
BEGIN
  FOR v_row IN
    WITH ledger_sum AS (
      SELECT cl.restaurant_id, cl.driver_id, SUM(cl.net_amount) AS total_net
      FROM public.commission_ledger cl
      WHERE cl.entry_type IN ('order_commission', 'reversal')
      GROUP BY cl.restaurant_id, cl.driver_id
    ),
    payout_sum AS (
      SELECT p.restaurant_id, p.driver_id, SUM(p.amount) AS total_paid
      FROM public.payouts p
      WHERE p.status IN ('paid', 'confirmed', 'disputed', 'resolved')
      GROUP BY p.restaurant_id, p.driver_id
    )
    SELECT
      w.id AS wallet_id, w.restaurant_id, w.driver_id, w.available_balance,
      COALESCE(ls.total_net, 0) - COALESCE(ps.total_paid, 0) AS ledger_derived
    FROM public.wallets w
    LEFT JOIN ledger_sum ls
      ON ls.restaurant_id IS NOT DISTINCT FROM w.restaurant_id
     AND ls.driver_id IS NOT DISTINCT FROM w.driver_id
    LEFT JOIN payout_sum ps
      ON ps.restaurant_id IS NOT DISTINCT FROM w.restaurant_id
     AND ps.driver_id IS NOT DISTINCT FROM w.driver_id
  LOOP
    v_checked := v_checked + 1;
    IF v_row.available_balance <> v_row.ledger_derived THEN
      v_discrepancies := v_discrepancies + 1;
      -- One open (unresolved) row per wallet — a daily cron shouldn't
      -- pile up a fresh duplicate every run for the same still-unfixed
      -- discrepancy.
      IF NOT EXISTS (
        SELECT 1 FROM public.wallet_discrepancies wd
        WHERE wd.wallet_id = v_row.wallet_id AND NOT wd.resolved
      ) THEN
        INSERT INTO public.wallet_discrepancies (
          wallet_id, restaurant_id, driver_id,
          stored_available_balance, ledger_derived_balance, difference
        ) VALUES (
          v_row.wallet_id, v_row.restaurant_id, v_row.driver_id,
          v_row.available_balance, v_row.ledger_derived,
          v_row.available_balance - v_row.ledger_derived
        );
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_checked, v_discrepancies;
END;
$$;

REVOKE ALL ON FUNCTION public.run_wallet_reconciliation_secure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_wallet_reconciliation_secure() TO service_role;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260827130000', 'audit_remediation_dead_grant_and_reconciliation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
