-- Commission/Wallet/Manual Payout system (platform -> restaurant/driver),
-- distinct from the existing `payments` table (customer -> platform inbound
-- payments) which this does not touch. See plan doc for full context.
--
-- Ledger-first architecture: the Wallet is never the source of truth — it
-- is a denormalized summary. `commission_ledger` (why money was earned) and
-- `wallet_transactions` (every balance-affecting event) are the two
-- immutable, insert-only tables a wallet can always be rebuilt from via
-- recompute_wallet_secure() in 20260722100200_payout_rpcs.sql.

-- ---------------------------------------------------------------------------
-- payment_methods: config-driven payout rails, replacing a hardcoded enum —
-- adding a new method later (or a real MonCash/NatCash API integration) is
-- an INSERT, not a migration.
CREATE TABLE public.payment_methods (
  code text PRIMARY KEY,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.payment_methods (code, label, sort_order) VALUES
  ('moncash', 'MonCash', 1),
  ('natcash', 'NatCash', 2);

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_methods read" ON public.payment_methods FOR SELECT TO authenticated
  USING (true);
REVOKE ALL ON public.payment_methods FROM PUBLIC, anon;
GRANT SELECT ON public.payment_methods TO authenticated;

CREATE TYPE public.payout_status AS ENUM ('paid', 'confirmed', 'disputed', 'resolved');
CREATE TYPE public.commission_entry_type AS ENUM ('order_commission', 'monthly_fee', 'reversal');

-- ---------------------------------------------------------------------------
-- wallets: one row per restaurant OR per driver (never both), lazily created
-- by the commission engine on first credit. No historical backfill — a
-- wallet simply doesn't exist (reads as 0 client-side) until the first
-- post-launch delivered order for that beneficiary. Exactly 4 balance
-- columns, nothing else — this table is a denormalized summary, never
-- authoritative; total_orders/last_payment_date are computed at read time
-- from commission_ledger/payouts instead of duplicated here.
CREATE TABLE public.wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE,
  available_balance numeric(12,2) NOT NULL DEFAULT 0,
  pending_balance numeric(12,2) NOT NULL DEFAULT 0,
  paid_balance numeric(12,2) NOT NULL DEFAULT 0,
  lifetime_earnings numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wallets_one_beneficiary CHECK (
    (restaurant_id IS NOT NULL AND driver_id IS NULL) OR
    (restaurant_id IS NULL AND driver_id IS NOT NULL)
  ),
  CONSTRAINT wallets_restaurant_unique UNIQUE (restaurant_id),
  CONSTRAINT wallets_driver_unique UNIQUE (driver_id)
);

-- ---------------------------------------------------------------------------
-- commission_ledger: immutable record of WHY money was earned — one row per
-- (order, beneficiary, entry_type). Snapshots gross_amount/commission_rate/
-- commission_amount/net_amount at calculation time so a later change to a
-- restaurant's/driver's commission rate never retroactively alters
-- historical entries. period_month is only set for entry_type =
-- 'monthly_fee' (partial unique index below makes the monthly-charge RPC
-- idempotent per calendar month).
CREATE TABLE public.commission_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  entry_type public.commission_entry_type NOT NULL,
  gross_amount numeric(12,2) NOT NULL DEFAULT 0,
  commission_rate numeric(6,2),
  commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL,
  period_month date,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commission_ledger_one_beneficiary CHECK (
    (restaurant_id IS NOT NULL AND driver_id IS NULL) OR
    (restaurant_id IS NULL AND driver_id IS NOT NULL)
  )
);

CREATE INDEX commission_ledger_restaurant_id_idx ON public.commission_ledger(restaurant_id);
CREATE INDEX commission_ledger_driver_id_idx ON public.commission_ledger(driver_id);
CREATE INDEX commission_ledger_order_id_idx ON public.commission_ledger(order_id);
CREATE INDEX commission_ledger_created_at_idx ON public.commission_ledger(created_at);

-- Idempotency guards — a completed order (or its refund reversal, or a
-- restaurant's flat monthly fee) can never generate more than one ledger
-- entry of the same kind per beneficiary/period. This is what makes "never
-- generate commission twice" a real database-level guarantee.
CREATE UNIQUE INDEX commission_ledger_order_restaurant_commission_uniq
  ON public.commission_ledger(order_id, restaurant_id)
  WHERE entry_type = 'order_commission' AND restaurant_id IS NOT NULL;
CREATE UNIQUE INDEX commission_ledger_order_driver_commission_uniq
  ON public.commission_ledger(order_id, driver_id)
  WHERE entry_type = 'order_commission' AND driver_id IS NOT NULL;
CREATE UNIQUE INDEX commission_ledger_order_restaurant_reversal_uniq
  ON public.commission_ledger(order_id, restaurant_id)
  WHERE entry_type = 'reversal' AND restaurant_id IS NOT NULL;
CREATE UNIQUE INDEX commission_ledger_order_driver_reversal_uniq
  ON public.commission_ledger(order_id, driver_id)
  WHERE entry_type = 'reversal' AND driver_id IS NOT NULL;
CREATE UNIQUE INDEX commission_ledger_monthly_fee_period_uniq
  ON public.commission_ledger(restaurant_id, period_month)
  WHERE entry_type = 'monthly_fee';

-- ---------------------------------------------------------------------------
-- payouts: full, permanent history of every manual payment the admin sends
-- to a restaurant/driver. Never deletable (no DELETE grant, no delete RPC —
-- same posture as refunds/disputes). `method` references payment_methods
-- (not an enum) so adding a rail later needs no schema change.
CREATE TABLE public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text NOT NULL REFERENCES public.payment_methods(code),
  receiver_number text NOT NULL,
  receiver_account_name text,
  transaction_reference text NOT NULL,
  proof_url text,
  status public.payout_status NOT NULL DEFAULT 'paid',
  resolution text CHECK (resolution IN ('confirmed', 'reversed')),
  dispute_reason text,
  admin_notes text,
  paid_by uuid NOT NULL REFERENCES auth.users(id),
  confirmed_at timestamptz,
  disputed_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  resolved_at timestamptz,
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_one_beneficiary CHECK (
    (restaurant_id IS NOT NULL AND driver_id IS NULL) OR
    (restaurant_id IS NULL AND driver_id IS NOT NULL)
  )
);

CREATE INDEX payouts_restaurant_id_idx ON public.payouts(restaurant_id);
CREATE INDEX payouts_driver_id_idx ON public.payouts(driver_id);
CREATE INDEX payouts_wallet_id_idx ON public.payouts(wallet_id);
CREATE INDEX payouts_status_idx ON public.payouts(status);
CREATE INDEX payouts_created_at_idx ON public.payouts(created_at DESC);

-- ---------------------------------------------------------------------------
-- wallet_transactions: the actual general ledger of balance movements —
-- this, not the wallets table, is what recompute_wallet_secure() sums to
-- rebuild a wallet from scratch. Every row records a delta on each of the
-- 4 balance fields; summing all rows for a wallet_id always equals its
-- current balances by construction. Only events that actually move money
-- get a row here (e.g. "disputed" does not — the amount stays frozen in
-- pending_balance until resolved — that status-only event is recorded in
-- audit_log instead).
CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'commission_credit', 'commission_reversed',
    'payout_sent', 'payout_confirmed', 'payout_reversed',
    'wallet_recomputed'
  )),
  available_delta numeric(12,2) NOT NULL DEFAULT 0,
  pending_delta numeric(12,2) NOT NULL DEFAULT 0,
  paid_delta numeric(12,2) NOT NULL DEFAULT 0,
  lifetime_delta numeric(12,2) NOT NULL DEFAULT 0,
  commission_ledger_id uuid REFERENCES public.commission_ledger(id) ON DELETE SET NULL,
  payout_id uuid REFERENCES public.payouts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_transactions_wallet_id_idx ON public.wallet_transactions(wallet_id);
CREATE INDEX wallet_transactions_created_at_idx ON public.wallet_transactions(created_at);

-- ---------------------------------------------------------------------------
-- audit_log: generic, admin/super_admin-read-only financial action log.
-- Nothing like this exists elsewhere in the app (every other table's
-- auditability is a status_history JSONB column on the row itself) — this
-- is the first one, scoped to financial actions per the spec. Written only
-- via private.log_audit_event(), called from inside other SECURITY DEFINER
-- RPC bodies/triggers — never granted to authenticated directly, same
-- posture as private.rate_limit_hits.
CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role text,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_id_idx ON public.audit_log(user_id);
CREATE INDEX audit_log_action_idx ON public.audit_log(action);
CREATE INDEX audit_log_created_at_idx ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log admin read" ON public.audit_log FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
REVOKE ALL ON public.audit_log FROM PUBLIC, anon;
GRANT SELECT ON public.audit_log TO authenticated;

CREATE OR REPLACE FUNCTION private.log_audit_event(_user_id uuid, _role text, _action text, _metadata jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.audit_log(user_id, role, action, metadata) VALUES (_user_id, _role, _action, _metadata);
$$;
REVOKE ALL ON FUNCTION private.log_audit_event(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared visibility helpers — admin, or the restaurant owner (already
-- excludes restaurant_staff, matching this project's existing owner-only
-- rule for payout/commission data), or the driver themself. Wrapped in
-- SECURITY DEFINER functions to avoid RLS recursion (same pattern as
-- private.order_visible_to_driver).
CREATE OR REPLACE FUNCTION private.payout_beneficiary_visible(_restaurant_id uuid, _driver_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')
    OR (_restaurant_id IS NOT NULL AND private.is_restaurant_manager(_restaurant_id))
    OR (_driver_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.drivers d WHERE d.id = _driver_id AND d.user_id = auth.uid()));
$$;
REVOKE ALL ON FUNCTION private.payout_beneficiary_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.payout_beneficiary_visible(uuid, uuid) TO authenticated;

-- wallet_transactions/commission_ledger rows don't carry auth.uid()-visible
-- ownership directly on every row shape uniformly enough to reuse the above
-- without a join — this helper resolves a wallet_id to its beneficiary and
-- delegates, so the policy on wallet_transactions never has to look inside
-- wallets' own RLS (which would risk recursion).
CREATE OR REPLACE FUNCTION private.wallet_owner_visible(_wallet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.payout_beneficiary_visible(w.restaurant_id, w.driver_id)
  FROM public.wallets w WHERE w.id = _wallet_id;
$$;
REVOKE ALL ON FUNCTION private.wallet_owner_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.wallet_owner_visible(uuid) TO authenticated;

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallets read" ON public.wallets FOR SELECT TO authenticated
  USING (private.payout_beneficiary_visible(restaurant_id, driver_id));
CREATE POLICY "commission_ledger read" ON public.commission_ledger FOR SELECT TO authenticated
  USING (private.payout_beneficiary_visible(restaurant_id, driver_id));
CREATE POLICY "payouts read" ON public.payouts FOR SELECT TO authenticated
  USING (private.payout_beneficiary_visible(restaurant_id, driver_id));
CREATE POLICY "wallet_transactions read" ON public.wallet_transactions FOR SELECT TO authenticated
  USING (private.wallet_owner_visible(wallet_id));

-- Mutation lockdown: every write goes through a SECURITY DEFINER RPC (see
-- 20260722100200_payout_rpcs.sql) — matches the established convention for
-- every money/status table in this project.
REVOKE ALL ON public.wallets FROM PUBLIC, anon;
REVOKE ALL ON public.commission_ledger FROM PUBLIC, anon;
REVOKE ALL ON public.payouts FROM PUBLIC, anon;
REVOKE ALL ON public.wallet_transactions FROM PUBLIC, anon;
GRANT SELECT ON public.wallets TO authenticated;
GRANT SELECT ON public.commission_ledger TO authenticated;
GRANT SELECT ON public.payouts TO authenticated;
GRANT SELECT ON public.wallet_transactions TO authenticated;

-- Realtime, matching refunds/disputes — a beneficiary's "My Payments" page
-- can live-update when a payout is paid/confirmed/disputed/resolved.
ALTER TABLE public.payouts REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payouts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payouts;
  END IF;
END $$;
