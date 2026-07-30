-- Wire the MonCash provider payout lifecycle into the existing generic
-- notification engine (private.notify_secure — see
-- 20260723090000_notifications_engine_and_gps_sharing.sql) instead of
-- hand-writing INSERT INTO notifications, matching the rule already
-- established there ("every NEW notification-emitting feature calls
-- notify_secure"). create_pending_payout_secure/
-- complete_pending_payout_secure/fail_pending_payout_secure are all new
-- this session, so unlike the ~15 pre-existing payout/dispute/refund call
-- sites (deliberately left alone as an already-audited pipeline), they
-- are squarely in scope.
--
-- All 3 signatures are unchanged, so CREATE OR REPLACE is enough — no
-- DROP needed (see initiate_payout_secure's own precedent for when DROP
-- actually is required: an argument list change, not a body-only edit).
-- log_payment_provider_error_secure gains one new trailing parameter
-- (_code), which per this project's own established rule DOES require
-- DROP FUNCTION first.

-- ---------------------------------------------------------------------------
-- 1) create_pending_payout_secure: now notifies the beneficiary that a
-- payment was *sent* to the provider (unconfirmed) — reversing the
-- earlier "no notification yet" choice on explicit request; it's coherent
-- now that a later fail_pending_payout_secure also notifies the same
-- beneficiary, so "a payment failed" always follows "a payment was sent"
-- rather than appearing out of nowhere.
CREATE OR REPLACE FUNCTION public.create_pending_payout_secure(
  _restaurant_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _method text DEFAULT NULL,
  _own_reference text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _provider_code text DEFAULT NULL
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_wallet public.wallets;
  v_receiver_number text;
  v_receiver_account text;
  v_beneficiary_user uuid;
  v_row public.payouts;
  v_provider_label text;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF (_restaurant_id IS NULL) = (_driver_id IS NULL) THEN
    RAISE EXCEPTION 'Specify exactly one beneficiary';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Montan envalid';
  END IF;
  IF _method IS NULL OR NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE code = _method AND is_active) THEN
    RAISE EXCEPTION 'Chwazi yon metòd peman valid';
  END IF;
  IF _provider_code IS NULL OR _provider_code = 'manual'
     OR NOT EXISTS (SELECT 1 FROM public.payment_providers WHERE code = _provider_code AND is_active) THEN
    RAISE EXCEPTION 'Pwovidè peman sa a pa disponib';
  END IF;
  IF _own_reference IS NULL OR length(btrim(_own_reference)) = 0 THEN
    RAISE EXCEPTION 'Referans obligatwa';
  END IF;
  IF NOT public.check_rate_limit_secure('initiate_payout', 30, 600) THEN
    RAISE EXCEPTION 'Twòp tantativ. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  IF _restaurant_id IS NOT NULL THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE restaurant_id = _restaurant_id FOR UPDATE;
  ELSE
    SELECT * INTO v_wallet FROM public.wallets WHERE driver_id = _driver_id FOR UPDATE;
  END IF;
  IF NOT FOUND OR v_wallet.available_balance < _amount THEN
    RAISE EXCEPTION 'Balans disponib la pa ase';
  END IF;

  IF _restaurant_id IS NOT NULL THEN
    SELECT owner_id INTO v_beneficiary_user FROM public.restaurants WHERE id = _restaurant_id;
    IF _method = 'moncash' THEN
      SELECT moncash_number, moncash_account_name INTO v_receiver_number, v_receiver_account
        FROM public.restaurant_payout_details WHERE restaurant_id = _restaurant_id;
    ELSE
      SELECT natcash_number, natcash_account_name INTO v_receiver_number, v_receiver_account
        FROM public.restaurant_payout_details WHERE restaurant_id = _restaurant_id;
    END IF;
  ELSE
    SELECT user_id INTO v_beneficiary_user FROM public.drivers WHERE id = _driver_id;
    IF _method = 'moncash' THEN
      SELECT moncash_number, moncash_account_name INTO v_receiver_number, v_receiver_account
        FROM public.drivers WHERE id = _driver_id;
    ELSE
      SELECT natcash_number, natcash_account_name INTO v_receiver_number, v_receiver_account
        FROM public.drivers WHERE id = _driver_id;
    END IF;
  END IF;
  IF v_receiver_number IS NULL THEN
    RAISE EXCEPTION 'Benefisyè a poko konfigire nimewo peman sa a';
  END IF;

  UPDATE public.wallets SET
    available_balance = available_balance - _amount,
    pending_balance = pending_balance + _amount,
    updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO public.payouts (
    restaurant_id, driver_id, wallet_id, amount, method, receiver_number, receiver_account_name,
    transaction_reference, status, admin_notes, paid_by, status_history, provider_code
  )
  VALUES (
    _restaurant_id, _driver_id, v_wallet.id, _amount, _method, v_receiver_number, v_receiver_account,
    btrim(_own_reference), 'pending', NULLIF(btrim(_notes), ''), v_user,
    jsonb_build_array(jsonb_build_object('to', 'pending', 'by', v_user, 'at', now())), _provider_code
  )
  RETURNING * INTO v_row;

  INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, pending_delta, payout_id, created_by, note)
  VALUES (v_wallet.id, 'payout_pending', -_amount, _amount, v_row.id, v_user, 'Peman mande bay pwovidè a');

  IF v_beneficiary_user IS NOT NULL THEN
    SELECT label INTO v_provider_label FROM public.payment_providers WHERE code = _provider_code;
    PERFORM private.notify_secure(
      ARRAY[v_beneficiary_user]::uuid[], 'payout_provider_sent', 'commission',
      'Yon peman ap pare',
      'N ap voye yon demann peman ' || _amount || ' HTG bay ' || COALESCE(v_provider_label, _provider_code)
        || '. N ap konfime ou lè li reyisi.',
      jsonb_build_object('payout_id', v_row.id, 'amount', _amount)
    );
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'payout.pending_created',
    jsonb_build_object('payout_id', v_row.id, 'amount', _amount, 'restaurant_id', _restaurant_id, 'driver_id', _driver_id, 'provider_code', _provider_code));

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) complete_pending_payout_secure: beneficiary notification now goes
-- through notify_secure (was a raw INSERT); adds the admin "succès"
-- notification to paid_by (the admin who initiated it), which didn't
-- exist before.
CREATE OR REPLACE FUNCTION public.complete_pending_payout_secure(
  _transaction_reference text,
  _provider_code text,
  _provider_transaction_id text DEFAULT NULL
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.payouts;
  v_beneficiary_user uuid;
  v_remaining numeric;
  v_link_amount numeric;
  v_commission record;
BEGIN
  SELECT * INTO v_row FROM public.payouts
    WHERE transaction_reference = _transaction_reference AND provider_code = _provider_code
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pa gen okenn peman an atant pou referans sa a';
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN v_row;
  END IF;

  UPDATE public.payouts SET
    status = 'paid',
    provider_transaction_id = COALESCE(_provider_transaction_id, provider_transaction_id),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'paid', 'via', 'webhook', 'at', now())
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.wallet_transactions (wallet_id, type, payout_id, created_by, note)
  VALUES (v_row.wallet_id, 'payout_provider_confirmed', v_row.id, NULL, 'Pwovidè konfime lajan an voye');

  IF v_row.restaurant_id IS NOT NULL THEN
    SELECT owner_id INTO v_beneficiary_user FROM public.restaurants WHERE id = v_row.restaurant_id;
  ELSE
    SELECT user_id INTO v_beneficiary_user FROM public.drivers WHERE id = v_row.driver_id;
  END IF;
  IF v_beneficiary_user IS NOT NULL THEN
    PERFORM private.notify_secure(
      ARRAY[v_beneficiary_user]::uuid[], 'payout_provider_confirmed', 'commission',
      'Ou resevwa yon peman',
      'Ou resevwa yon peman ' || v_row.amount || ' HTG. Tanpri konfime resepsyon an.',
      jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount)
    );
  END IF;

  PERFORM private.notify_secure(
    ARRAY[v_row.paid_by]::uuid[], 'payout_provider_admin_success', 'commission',
    'Peman pwovidè reyisi',
    'Peman ' || v_row.amount || ' HTG atravè ' || v_row.provider_code || ' konfime pa pwovidè a.',
    jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount)
  );

  -- Commission linking, deferred from creation time -- only a *confirmed*
  -- transfer should count as having paid down outstanding commissions.
  -- Same loop as initiate_payout_secure/20260722190000_payment_provider_prep.sql.
  v_remaining := v_row.amount;
  FOR v_commission IN
    SELECT cl.id, cl.net_amount - COALESCE(pc_sum.covered, 0) AS outstanding
    FROM public.commission_ledger cl
    LEFT JOIN LATERAL (
      SELECT sum(pc.covered_amount) AS covered
      FROM public.payout_commissions pc
      WHERE pc.commission_ledger_id = cl.id
    ) pc_sum ON true
    WHERE cl.entry_type = 'order_commission'
      AND cl.net_amount > 0
      AND COALESCE(pc_sum.covered, 0) < cl.net_amount
      AND ((v_row.restaurant_id IS NOT NULL AND cl.restaurant_id = v_row.restaurant_id)
        OR (v_row.driver_id IS NOT NULL AND cl.driver_id = v_row.driver_id))
    ORDER BY cl.created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_link_amount := LEAST(v_commission.outstanding, v_remaining);
    INSERT INTO public.payout_commissions (payout_id, commission_ledger_id, covered_amount)
    VALUES (v_row.id, v_commission.id, v_link_amount);
    v_remaining := v_remaining - v_link_amount;
  END LOOP;

  PERFORM private.log_audit_event(NULL, 'system', 'payout.provider_confirmed',
    jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount, 'provider_code', v_row.provider_code, 'provider_transaction_id', _provider_transaction_id));

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) fail_pending_payout_secure: admin notification now goes through
-- notify_secure (was a raw INSERT); adds the beneficiary "erreur"
-- notification, which didn't exist before — coherent now that the same
-- beneficiary was already told a payment was sent (see #1 above).
CREATE OR REPLACE FUNCTION public.fail_pending_payout_secure(
  _transaction_reference text,
  _provider_code text,
  _reason text DEFAULT NULL
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.payouts;
  v_beneficiary_user uuid;
BEGIN
  SELECT * INTO v_row FROM public.payouts
    WHERE transaction_reference = _transaction_reference AND provider_code = _provider_code
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pa gen okenn peman an atant pou referans sa a';
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN v_row;
  END IF;

  UPDATE public.payouts SET
    status = 'failed',
    admin_notes = COALESCE(NULLIF(btrim(_reason), ''), admin_notes),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'failed', 'via', 'webhook', 'at', now(), 'reason', _reason)
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  UPDATE public.wallets SET
    available_balance = available_balance + v_row.amount,
    pending_balance = pending_balance - v_row.amount,
    updated_at = now()
  WHERE id = v_row.wallet_id;

  INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, pending_delta, payout_id, created_by, note)
  VALUES (v_row.wallet_id, 'payout_provider_failed', v_row.amount, -v_row.amount, v_row.id, NULL, COALESCE(NULLIF(btrim(_reason), ''), 'Pwovidè echwe'));

  IF v_row.restaurant_id IS NOT NULL THEN
    SELECT owner_id INTO v_beneficiary_user FROM public.restaurants WHERE id = v_row.restaurant_id;
  ELSE
    SELECT user_id INTO v_beneficiary_user FROM public.drivers WHERE id = v_row.driver_id;
  END IF;
  IF v_beneficiary_user IS NOT NULL THEN
    PERFORM private.notify_secure(
      ARRAY[v_beneficiary_user]::uuid[], 'payout_provider_failed', 'commission',
      'Tantativ peman echwe',
      'Tantativ peman ' || v_row.amount || ' HTG nou te anonse a pa reyisi. Nou ap swiv ak ou pou rezoud sa.',
      jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount)
    );
  END IF;

  PERFORM private.notify_secure(
    ARRAY[v_row.paid_by]::uuid[], 'payout_provider_admin_error', 'commission',
    'Peman pwovidè echwe',
    'Yon tantativ peman ' || v_row.amount || ' HTG atravè ' || v_row.provider_code || ' echwe. Lajan an retounen nan balans disponib la.',
    jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount)
  );

  PERFORM private.log_audit_event(NULL, 'system', 'payout.provider_failed',
    jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount, 'provider_code', v_row.provider_code, 'reason', _reason));

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) log_payment_provider_error_secure: gains _code (e.g. 'timeout'), and
-- now actually notifies the calling admin via notify_secure instead of
-- only writing to audit_log — an admin previously had to go dig through
-- the audit log to ever see this; now they get a real notification,
-- distinguishing a genuine timeout from any other rejection.
DROP FUNCTION IF EXISTS public.log_payment_provider_error_secure(text, text, uuid, uuid, numeric, text);

CREATE FUNCTION public.log_payment_provider_error_secure(
  _provider_code text,
  _method text,
  _restaurant_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _error text DEFAULT NULL,
  _code text DEFAULT NULL
)
RETURNS void
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

  PERFORM private.log_audit_event(v_user, 'admin', 'payout.provider_attempt_failed',
    jsonb_build_object(
      'provider_code', _provider_code,
      'method', _method,
      'restaurant_id', _restaurant_id,
      'driver_id', _driver_id,
      'amount', _amount,
      'error', _error,
      'code', _code
    ));

  PERFORM private.notify_secure(
    ARRAY[v_user]::uuid[],
    CASE WHEN _code = 'timeout' THEN 'payout_provider_admin_timeout' ELSE 'payout_provider_admin_error' END,
    'commission',
    CASE WHEN _code = 'timeout' THEN 'Delè ekoule ak pwovidè a' ELSE 'Tantativ peman echwe' END,
    CASE
      WHEN _code = 'timeout' THEN
        'Pwovidè ' || _provider_code || ' la pa t reponn a tan pou yon tantativ peman'
          || COALESCE(' ' || _amount || ' HTG', '') || '.'
      ELSE
        COALESCE(_error, 'Yon tantativ peman atravè ' || _provider_code || ' echwe.')
    END,
    jsonb_build_object('provider_code', _provider_code, 'amount', _amount, 'error', _error, 'code', _code)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.log_payment_provider_error_secure(text, text, uuid, uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_payment_provider_error_secure(text, text, uuid, uuid, numeric, text, text) TO authenticated;
