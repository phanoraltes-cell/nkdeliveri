-- Backfill Wizard, part 1: audit table + a 2-layer factoring of the
-- commission engine (pure calculation -> shared write function), so the
-- Backfill Wizard's execute RPC (next migration) and the existing
-- delivery trigger call the exact same code instead of duplicating the
-- restaurant/driver split formula and the ledger/wallet/audit writes.
--
-- Why a backfill tool is needed at all: the trigger only fires on a
-- status TRANSITION (`OLD.status IS DISTINCT FROM 'delivered' AND
-- NEW.status = 'delivered'`) — an order already sitting at 'delivered'
-- before this trigger existed can never re-fire it. That's the exact,
-- confirmed-in-production gap this migration and the next one close.
--
-- The trigger function itself becomes a one-line wrapper below (`CREATE
-- OR REPLACE FUNCTION private.generate_commission_on_delivery()`), same
-- 0-argument signature it always had — the `CREATE TRIGGER
-- trg_generate_commission_on_delivery` statement from
-- 20260722100100_commission_engine.sql is NOT re-run and NOT touched.

-- ---------------------------------------------------------------------------
-- 1) Audit table — one row per backfill execution run.
CREATE TABLE public.backfill_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_by uuid NOT NULL REFERENCES auth.users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  orders_scanned int NOT NULL DEFAULT 0,
  orders_migrated int NOT NULL DEFAULT 0,
  orders_already_migrated int NOT NULL DEFAULT 0,
  orders_skipped int NOT NULL DEFAULT 0,
  orders_failed int NOT NULL DEFAULT 0,
  error_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.backfill_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backfill_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.backfill_runs TO authenticated;

CREATE POLICY "backfill_runs admin read" ON public.backfill_runs
FOR SELECT TO authenticated
USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
-- No client INSERT/UPDATE policy — only execute_commission_backfill_secure
-- (SECURITY DEFINER, next migration) writes to this table.

-- ---------------------------------------------------------------------------
-- 2) Pure calculation, no writes. Identical formula to the trigger's
-- current inline logic (restaurant: per_order rate vs monthly passthrough,
-- default type 'per_order'/rate 10 when unconfigured; driver: percentage
-- of the delivery fee, skipped entirely if no driver was ever assigned).
-- Used by the trigger wrapper below AND by the Backfill Wizard's
-- scan/preview RPCs (next migration) — one formula, everywhere.
CREATE FUNCTION private.compute_order_commission_preview(_order_id uuid)
RETURNS TABLE (
  restaurant_id uuid,
  restaurant_commission_rate numeric,
  restaurant_commission_amount numeric,
  restaurant_net_amount numeric,
  driver_id uuid,
  driver_commission_rate numeric,
  driver_fee numeric,
  driver_commission_amount numeric,
  driver_net_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_type text;
  v_rate numeric;
  v_commission numeric;
  v_net numeric;
  v_driver_id uuid;
  v_driver_rate numeric;
  v_fee numeric;
  v_driver_commission numeric;
  v_driver_net numeric;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT commission_type, commission_rate INTO v_type, v_rate
  FROM public.restaurant_payout_details WHERE restaurant_id = v_order.restaurant_id;
  v_type := COALESCE(v_type, 'per_order');
  v_rate := COALESCE(v_rate, 10);

  IF v_type = 'monthly' THEN
    v_commission := 0;
    v_net := v_order.subtotal;
    v_rate := NULL;
  ELSE
    v_commission := ROUND(v_order.subtotal * v_rate / 100, 2);
    v_net := v_order.subtotal - v_commission;
  END IF;

  SELECT dr.id, dr.commission_rate, d.fee INTO v_driver_id, v_driver_rate, v_fee
  FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
  WHERE d.order_id = v_order.id AND d.driver_id IS NOT NULL;

  IF FOUND THEN
    v_driver_net := ROUND(v_fee * v_driver_rate / 100, 2);
    v_driver_commission := v_fee - v_driver_net;
  END IF;

  RETURN QUERY SELECT
    v_order.restaurant_id, v_rate, v_commission, v_net,
    v_driver_id, v_driver_rate, v_fee, v_driver_commission, v_driver_net;
END;
$$;
REVOKE ALL ON FUNCTION private.compute_order_commission_preview(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Shared write function: calls the calculation above, then performs the
-- exact 4 writes the trigger has always done (commission_ledger via the
-- same idempotent ON CONFLICT DO NOTHING, wallets, wallet_transactions,
-- audit_log) for whichever beneficiaries apply. Safe to call more than
-- once for the same order — each beneficiary side is independently
-- idempotent via the pre-existing partial unique indexes, so a partially
-- migrated order (e.g. restaurant side already done, driver side not) is
-- completed correctly rather than double-credited.
-- `_actor_id` is NULL for the trigger (no human actor) and the calling
-- admin's uid for a backfill run — commission_ledger.created_by and
-- wallet_transactions.created_by already existed for exactly this kind of
-- traceability, no new column needed. `_source` only affects the note text.
CREATE FUNCTION private.generate_commission_for_order(_order_id uuid, _actor_id uuid, _source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
  v_calc record;
  v_ledger_id uuid;
  v_wallet_id uuid;
  v_note_suffix text;
  v_role text;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_note_suffix := CASE WHEN _source = 'backfill' THEN ' (backfill istorik)' ELSE '' END;
  v_role := CASE WHEN _source = 'backfill' THEN 'admin' ELSE NULL END;

  SELECT * INTO v_calc FROM private.compute_order_commission_preview(_order_id);

  -- Restaurant side
  INSERT INTO public.commission_ledger (restaurant_id, order_id, entry_type, gross_amount, commission_rate, commission_amount, net_amount, created_by)
  VALUES (v_order.restaurant_id, v_order.id, 'order_commission', v_order.subtotal, v_calc.restaurant_commission_rate, v_calc.restaurant_commission_amount, v_calc.restaurant_net_amount, _actor_id)
  ON CONFLICT (order_id, restaurant_id) WHERE entry_type = 'order_commission' AND restaurant_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NOT NULL THEN
    INSERT INTO public.wallets (restaurant_id, available_balance, lifetime_earnings)
    VALUES (v_order.restaurant_id, v_calc.restaurant_net_amount, v_calc.restaurant_net_amount)
    ON CONFLICT (restaurant_id) DO UPDATE SET
      available_balance = wallets.available_balance + v_calc.restaurant_net_amount,
      lifetime_earnings = wallets.lifetime_earnings + v_calc.restaurant_net_amount,
      updated_at = now()
    RETURNING id INTO v_wallet_id;

    INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, created_by, note)
    VALUES (v_wallet_id, 'commission_credit', v_calc.restaurant_net_amount, v_calc.restaurant_net_amount, v_ledger_id, _actor_id, 'Commission sou kòmand ' || v_order.order_number || v_note_suffix);

    PERFORM private.log_audit_event(_actor_id, v_role, 'commission.created',
      jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', v_order.id, 'restaurant_id', v_order.restaurant_id, 'net_amount', v_calc.restaurant_net_amount, 'source', _source));
    PERFORM private.log_audit_event(_actor_id, v_role, 'wallet.credited',
      jsonb_build_object('wallet_id', v_wallet_id, 'restaurant_id', v_order.restaurant_id, 'amount', v_calc.restaurant_net_amount, 'source', _source));
  END IF;

  -- Driver side (skipped entirely if no assigned driver on this order)
  IF v_calc.driver_id IS NOT NULL THEN
    v_ledger_id := NULL;

    INSERT INTO public.commission_ledger (driver_id, order_id, entry_type, gross_amount, commission_rate, commission_amount, net_amount, created_by)
    VALUES (v_calc.driver_id, v_order.id, 'order_commission', v_calc.driver_fee, v_calc.driver_commission_rate, v_calc.driver_commission_amount, v_calc.driver_net_amount, _actor_id)
    ON CONFLICT (order_id, driver_id) WHERE entry_type = 'order_commission' AND driver_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      INSERT INTO public.wallets (driver_id, available_balance, lifetime_earnings)
      VALUES (v_calc.driver_id, v_calc.driver_net_amount, v_calc.driver_net_amount)
      ON CONFLICT (driver_id) DO UPDATE SET
        available_balance = wallets.available_balance + v_calc.driver_net_amount,
        lifetime_earnings = wallets.lifetime_earnings + v_calc.driver_net_amount,
        updated_at = now()
      RETURNING id INTO v_wallet_id;

      INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, created_by, note)
      VALUES (v_wallet_id, 'commission_credit', v_calc.driver_net_amount, v_calc.driver_net_amount, v_ledger_id, _actor_id, 'Komisyon sou kòmand ' || v_order.order_number || v_note_suffix);

      PERFORM private.log_audit_event(_actor_id, v_role, 'commission.created',
        jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', v_order.id, 'driver_id', v_calc.driver_id, 'net_amount', v_calc.driver_net_amount, 'source', _source));
      PERFORM private.log_audit_event(_actor_id, v_role, 'wallet.credited',
        jsonb_build_object('wallet_id', v_wallet_id, 'driver_id', v_calc.driver_id, 'amount', v_calc.driver_net_amount, 'source', _source));
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.generate_commission_for_order(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) The trigger function is reduced to a one-line delegation. Same
-- 0-argument trigger-function signature as before (structurally the only
-- signature a trigger function can have), so this CREATE OR REPLACE is
-- safe and requires no DROP. The CREATE TRIGGER statement itself is not
-- re-run here — it already exists from 20260722100100_commission_engine.sql
-- and keeps pointing at this same function name.
CREATE OR REPLACE FUNCTION private.generate_commission_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.generate_commission_for_order(NEW.id, NULL, 'trigger');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.generate_commission_on_delivery() FROM PUBLIC, anon, authenticated;
