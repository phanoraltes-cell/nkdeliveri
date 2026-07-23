-- Commission engine: computes and permanently stores the restaurant/driver/
-- platform split exactly once per delivered order, and reverses it exactly
-- once if that order is later refunded. Every balance-affecting step is
-- mirrored into wallet_transactions (the true ledger recompute_wallet_secure
-- sums from) and logged into audit_log (Commission créée / Wallet crédité).
--
-- Hook point: a new AFTER UPDATE trigger directly on public.orders, keyed on
-- the row's actual status value change — NOT a change inside
-- private.update_order_status_secure. Verified by reading
-- 20260708120000_pin_delivery_sensitive_columns.sql: orders.status can
-- become 'delivered' through TWO independent paths —
-- update_order_status_secure, and private.protect_delivery_status_transition
-- (the BEFORE UPDATE trigger on deliveries), which contains its own direct
-- `UPDATE public.orders SET status = 'delivered' ...` mirroring delivery
-- progress. A driver completing a delivery goes through the second path and
-- never touches update_order_status_secure. A trigger on orders itself is
-- the only hook point that fires for both, and is 100% additive — zero
-- lines touched in either existing function.

-- Restaurant side, base = orders.subtotal (the restaurant's own food revenue
-- — not orders.total, which also bundles delivery_fee/service_fee that were
-- never the restaurant's money).
--   commission_type = 'per_order' -> commission_amount = ROUND(subtotal * rate/100, 2)
--                                     net_amount (credited) = subtotal - commission_amount
--   commission_type = 'monthly'   -> commission_amount = 0, net_amount = subtotal
--                                     (100% passthrough per order; the flat
--                                     fee is billed separately, once a
--                                     month, via charge_restaurant_monthly_fee_secure)
--   missing restaurant_payout_details row -> defaults type 'per_order', rate 10
--   (identical defaults to get_restaurant_revenue_summary, so this never
--   silently diverges from what a restaurant already sees quoted there)
--
-- Driver side, base = deliveries.fee for this order:
--   net_amount (credited to driver) = ROUND(fee * drivers.commission_rate/100, 2)
--   commission_amount (platform's cut) = fee - net_amount
--   Skipped entirely if the order has no deliveries row with driver_id set
--   (e.g. an admin force-completes an order with no driver ever assigned) —
--   there is no driver to pay, so no ledger row, no wallet touched. Every
--   driver still at the default commission_rate = 100 nets the full fee,
--   i.e. zero behavior change from today.
--
-- Idempotency: the partial unique indexes on commission_ledger + ON CONFLICT
-- DO NOTHING make this safe even if this trigger somehow fired twice for the
-- same order — no double-credit is possible at the database level, not just
-- by app-level discipline.
CREATE OR REPLACE FUNCTION private.generate_commission_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_rate numeric;
  v_commission numeric;
  v_net numeric;
  v_ledger_id uuid;
  v_wallet_id uuid;
  v_driver_id uuid;
  v_driver_rate numeric;
  v_fee numeric;
  v_driver_commission numeric;
  v_driver_net numeric;
BEGIN
  -- Restaurant side
  SELECT commission_type, commission_rate INTO v_type, v_rate
  FROM public.restaurant_payout_details WHERE restaurant_id = NEW.restaurant_id;
  v_type := COALESCE(v_type, 'per_order');
  v_rate := COALESCE(v_rate, 10);

  IF v_type = 'monthly' THEN
    v_commission := 0;
    v_net := NEW.subtotal;
    v_rate := NULL;
  ELSE
    v_commission := ROUND(NEW.subtotal * v_rate / 100, 2);
    v_net := NEW.subtotal - v_commission;
  END IF;

  INSERT INTO public.commission_ledger (restaurant_id, order_id, entry_type, gross_amount, commission_rate, commission_amount, net_amount)
  VALUES (NEW.restaurant_id, NEW.id, 'order_commission', NEW.subtotal, v_rate, v_commission, v_net)
  ON CONFLICT (order_id, restaurant_id) WHERE entry_type = 'order_commission' AND restaurant_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NOT NULL THEN
    INSERT INTO public.wallets (restaurant_id, available_balance, lifetime_earnings)
    VALUES (NEW.restaurant_id, v_net, v_net)
    ON CONFLICT (restaurant_id) DO UPDATE SET
      available_balance = wallets.available_balance + v_net,
      lifetime_earnings = wallets.lifetime_earnings + v_net,
      updated_at = now()
    RETURNING id INTO v_wallet_id;

    INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, note)
    VALUES (v_wallet_id, 'commission_credit', v_net, v_net, v_ledger_id, 'Commission sou kòmand ' || NEW.order_number);

    PERFORM private.log_audit_event(NULL, NULL, 'commission.created',
      jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', NEW.id, 'restaurant_id', NEW.restaurant_id, 'net_amount', v_net));
    PERFORM private.log_audit_event(NULL, NULL, 'wallet.credited',
      jsonb_build_object('wallet_id', v_wallet_id, 'restaurant_id', NEW.restaurant_id, 'amount', v_net));
  END IF;

  -- Driver side (skipped entirely if no assigned driver on this order)
  SELECT dr.id, dr.commission_rate, d.fee INTO v_driver_id, v_driver_rate, v_fee
  FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
  WHERE d.order_id = NEW.id AND d.driver_id IS NOT NULL;

  IF FOUND THEN
    v_driver_net := ROUND(v_fee * v_driver_rate / 100, 2);
    v_driver_commission := v_fee - v_driver_net;

    INSERT INTO public.commission_ledger (driver_id, order_id, entry_type, gross_amount, commission_rate, commission_amount, net_amount)
    VALUES (v_driver_id, NEW.id, 'order_commission', v_fee, v_driver_rate, v_driver_commission, v_driver_net)
    ON CONFLICT (order_id, driver_id) WHERE entry_type = 'order_commission' AND driver_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      INSERT INTO public.wallets (driver_id, available_balance, lifetime_earnings)
      VALUES (v_driver_id, v_driver_net, v_driver_net)
      ON CONFLICT (driver_id) DO UPDATE SET
        available_balance = wallets.available_balance + v_driver_net,
        lifetime_earnings = wallets.lifetime_earnings + v_driver_net,
        updated_at = now()
      RETURNING id INTO v_wallet_id;

      INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, note)
      VALUES (v_wallet_id, 'commission_credit', v_driver_net, v_driver_net, v_ledger_id, 'Komisyon sou kòmand ' || NEW.order_number);

      PERFORM private.log_audit_event(NULL, NULL, 'commission.created',
        jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', NEW.id, 'driver_id', v_driver_id, 'net_amount', v_driver_net));
      PERFORM private.log_audit_event(NULL, NULL, 'wallet.credited',
        jsonb_build_object('wallet_id', v_wallet_id, 'driver_id', v_driver_id, 'amount', v_driver_net));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.generate_commission_on_delivery() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_generate_commission_on_delivery
AFTER UPDATE ON public.orders
FOR EACH ROW WHEN (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered')
EXECUTE FUNCTION private.generate_commission_on_delivery();

-- ---------------------------------------------------------------------------
-- Refund clawback — not in the original phase list, but required for
-- financial correctness: complete_refund_secure can flip an already-
-- delivered (already-commissioned) order to 'refunded'. Without this, a
-- restaurant/driver would silently keep commission already earned on money
-- that came back to the customer. Always inserts an offsetting reversal
-- entry and lets available_balance go negative if the funds were already
-- paid out — that negative balance is the intentional signal that the
-- beneficiary now owes the platform back, visible on their wallet and the
-- admin dashboard. There is no silent claw-back of money already sent.
CREATE OR REPLACE FUNCTION private.reverse_commission_on_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry record;
  v_ledger_id uuid;
  v_wallet_id uuid;
BEGIN
  FOR v_entry IN
    SELECT * FROM public.commission_ledger
    WHERE order_id = NEW.id AND entry_type = 'order_commission'
  LOOP
    v_ledger_id := NULL;

    IF v_entry.restaurant_id IS NOT NULL THEN
      INSERT INTO public.commission_ledger (restaurant_id, order_id, entry_type, gross_amount, commission_amount, net_amount, notes)
      VALUES (v_entry.restaurant_id, NEW.id, 'reversal', v_entry.gross_amount, -v_entry.commission_amount, -v_entry.net_amount, 'Refund reversal')
      ON CONFLICT (order_id, restaurant_id) WHERE entry_type = 'reversal' AND restaurant_id IS NOT NULL
      DO NOTHING
      RETURNING id INTO v_ledger_id;

      CONTINUE WHEN v_ledger_id IS NULL;

      UPDATE public.wallets SET
        available_balance = available_balance - v_entry.net_amount,
        lifetime_earnings = lifetime_earnings - v_entry.net_amount,
        updated_at = now()
      WHERE restaurant_id = v_entry.restaurant_id
      RETURNING id INTO v_wallet_id;

      INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, note)
      VALUES (v_wallet_id, 'commission_reversed', -v_entry.net_amount, -v_entry.net_amount, v_ledger_id, 'Ranvèse sou kòmand ' || NEW.order_number);

      PERFORM private.log_audit_event(NULL, NULL, 'commission.reversed',
        jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', NEW.id, 'restaurant_id', v_entry.restaurant_id, 'amount', v_entry.net_amount));
      PERFORM private.log_audit_event(NULL, NULL, 'wallet.credited',
        jsonb_build_object('wallet_id', v_wallet_id, 'restaurant_id', v_entry.restaurant_id, 'amount', -v_entry.net_amount));

      INSERT INTO public.notifications (user_id, type, title, body, data)
      SELECT r.owner_id, 'commission_reversed', 'Komisyon ranvèse',
        'Yon ranbousman anile komisyon ou te fè sou kòmand ' || NEW.order_number || '.',
        jsonb_build_object('order_id', NEW.id, 'amount', v_entry.net_amount)
      FROM public.restaurants r WHERE r.id = v_entry.restaurant_id AND r.owner_id IS NOT NULL;
    ELSE
      INSERT INTO public.commission_ledger (driver_id, order_id, entry_type, gross_amount, commission_amount, net_amount, notes)
      VALUES (v_entry.driver_id, NEW.id, 'reversal', v_entry.gross_amount, -v_entry.commission_amount, -v_entry.net_amount, 'Refund reversal')
      ON CONFLICT (order_id, driver_id) WHERE entry_type = 'reversal' AND driver_id IS NOT NULL
      DO NOTHING
      RETURNING id INTO v_ledger_id;

      CONTINUE WHEN v_ledger_id IS NULL;

      UPDATE public.wallets SET
        available_balance = available_balance - v_entry.net_amount,
        lifetime_earnings = lifetime_earnings - v_entry.net_amount,
        updated_at = now()
      WHERE driver_id = v_entry.driver_id
      RETURNING id INTO v_wallet_id;

      INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, note)
      VALUES (v_wallet_id, 'commission_reversed', -v_entry.net_amount, -v_entry.net_amount, v_ledger_id, 'Ranvèse sou kòmand ' || NEW.order_number);

      PERFORM private.log_audit_event(NULL, NULL, 'commission.reversed',
        jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', NEW.id, 'driver_id', v_entry.driver_id, 'amount', v_entry.net_amount));
      PERFORM private.log_audit_event(NULL, NULL, 'wallet.credited',
        jsonb_build_object('wallet_id', v_wallet_id, 'driver_id', v_entry.driver_id, 'amount', -v_entry.net_amount));

      INSERT INTO public.notifications (user_id, type, title, body, data)
      SELECT dr.user_id, 'commission_reversed', 'Komisyon ranvèse',
        'Yon ranbousman anile komisyon ou te fè sou kòmand ' || NEW.order_number || '.',
        jsonb_build_object('order_id', NEW.id, 'amount', v_entry.net_amount)
      FROM public.drivers dr WHERE dr.id = v_entry.driver_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.reverse_commission_on_refund() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_reverse_commission_on_refund
AFTER UPDATE ON public.orders
FOR EACH ROW WHEN (NEW.status = 'refunded' AND OLD.status = 'delivered')
EXECUTE FUNCTION private.reverse_commission_on_refund();
