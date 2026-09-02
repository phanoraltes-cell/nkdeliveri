-- PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE) — Tach 3B: DEMANN
-- RETRÈ PWÒP TÈT pou restoran/livrè, ranplase modèl "sèlman admin ka
-- inisye yon peman" (initiate_payout_secure/create_pending_payout_secure,
-- toude admin-only) ak yon vrè demann benefisyè-inisye.
--
-- FONKSYONMAN: yon restoran (pwopriyetè, pa staff — menm règ ki deja
-- egziste pou wè done peman, private.payout_beneficiary_visible) oswa yon
-- livrè ka mande retire lajan nan pwòp balans disponib yo, san yo pa
-- tann yon admin dekouvri yo dwe lajan. Balans lan RESÈVE imedyatman
-- (available -> pending), egzakteman menm mekanis ak flux admin ki
-- deja egziste a — men rezève a rive lè BENEFISYÈ a mande a, pa lè yon
-- admin aji.
--
-- SIKÈL ESTATI (dapre pwonp la): requested -> processing -> paid|failed.
-- 'processing' pa yon nouvo valè — li REYITILIZE estati 'pending' ki
-- deja egziste (ak tout enfrastrikti conciliation/webhook li deja gen
-- pou PLOP, 20260730100000_moncash_webhook_payout_lifecycle.sql), paske
-- semantik la idantik: "lajan rezève, tantativ founisè an kou". Sa vle di
-- complete_pending_payout_secure/fail_pending_payout_secure ak cron
-- rekonsilyasyon an (moncash-reconcile.server.ts) DEJA konplètman pare
-- pou fini yon demann pwòp-tèt san okenn lòt chanjman — sèl `fail_
-- pending_payout_secure` mande yon ti korije pi ba a (paid_by ka NULL
-- pou yon demann pwòp-tèt, kòz yon erè "not null violation" jodi a si
-- li pa korije).
--
-- OTOMATIK vs MANYÈL: si `payment_providers.is_active` fo pou
-- moncash_api/natcash_api (jan sa ye kounye a — Tach 3A poko aktive san
-- yon vrè tès), mark_requested_withdrawal_processing_secure refize ale
-- pi lwen pase 'requested', demann lan rete la pou yon admin trete
-- MANYÈLMAN (admin_mark_requested_withdrawal_paid_secure, nouvo). Lè
-- Altes aktive PLOP Retrè pou vre, MENM kòd la mache otomatikman san
-- lòt chanjman — estrikti a deja pare, jan pwonp la mande.
--
-- LIMIT/MINIMOM: 250 HTG minimòm ak 50 000 HTG/24è pa balans se VALÈ
-- FIKS TEMPORÈ (placeholder) — Tach 3D ranplase yo ak yon tablo règ
-- konfigirab pa admin, ak dat efektif. Pa yon chwa final.
--
-- ANTI-FRÒD (Tach 3B, tou de nan pwonp orijinal la "SEKIRITE AK
-- ANTI-FRÒD"): chanjman nimewo peman jis anvan yon demann retrè se
-- egzakteman siy yon sesyon konpwomèt k ap eseye detounen lajan — yon
-- nouvo kolòn `payout_account_updated_at` swiv chak chanjman REYÈL (pa
-- chak sovgad — yon sovgad ki pa chanje nimewo a pa reset delè a), ak
-- yon peryòd atant 24è apre nenpòt chanjman anvan pwochen demann retrè
-- ka fèt.

-- ---------------------------------------------------------------------------
-- 1) payouts: nouvo estati 'requested', paid_by vin nullable (yon
-- demann pwòp-tèt pa gen okenn admin ki "peye" li nan moman kreyasyon
-- an), ak yon nouvo kolòn requested_by (imyab, kenbe distenk de paid_by
-- ki ka chanje pita lè yon admin egzekite l manyèlman).
ALTER TABLE public.payouts DROP CONSTRAINT payouts_status_check;
ALTER TABLE public.payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('requested', 'pending', 'paid', 'confirmed', 'disputed', 'resolved', 'failed'));

ALTER TABLE public.payouts ALTER COLUMN paid_by DROP NOT NULL;
ALTER TABLE public.payouts ADD COLUMN requested_by uuid REFERENCES auth.users(id);

-- Pwoteje complete_pending_payout_secure/fail_pending_payout_secure kont
-- de ranje k ap konfonn (yo chèche pa transaction_reference+provider_code
-- sèlman) — pa gen okenn kontrent inik jodi a, yon twou ki te deja la
-- anvan Tach 3B men vin pi enpòtan kounye a paske yon dezyèm chemen
-- (demann pwòp-tèt) kounye a ekri nan menm kolòn yo. 'manual' eskli
-- paske referans manyèl yo pa garanti inik istorikman.
--
-- NÒT POU ALTES: si migrasyon sa a echwe la a espesyalman (yon erè
-- "could not create unique index" ki site 'moncash_api' oswa
-- 'natcash_api'), sa vle di gen deja plizyè payout ki pataje menm
-- (transaction_reference, provider_code) — enkyetan an tèt li, tanpri
-- envestige done sa yo AVAN ou eseye aplike ankò (pa janm senpleman
-- efase kontrent lan pou pase pwoblèm nan).
CREATE UNIQUE INDEX IF NOT EXISTS payouts_transaction_reference_provider_uniq
  ON public.payouts(transaction_reference, provider_code)
  WHERE provider_code <> 'manual';

-- ---------------------------------------------------------------------------
-- 2) wallet_transactions: 4 nouvo tip pou vokabilè ledger pwòp-tèt la
-- rete distenk de vèsyon admin-inisye a (payout_sent/payout_pending),
-- menm jan 20260730100000 te fè pou payout_pending vs payout_sent.
ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    'commission_credit', 'commission_reversed',
    'payout_sent', 'payout_confirmed', 'payout_reversed',
    'payout_pending', 'payout_provider_confirmed', 'payout_provider_failed',
    'withdrawal_requested', 'withdrawal_processing', 'withdrawal_manual_paid', 'withdrawal_cancelled',
    'wallet_recomputed'
  ));

-- ---------------------------------------------------------------------------
-- 3) Swiv dat/lè yon nimewo peman CHANJE reyèlman (pa chak sovgad) —
-- itilize pou peryòd atant anti-fròd la nan request_withdrawal_secure.
ALTER TABLE public.restaurant_payout_details ADD COLUMN payout_account_updated_at timestamptz;
ALTER TABLE public.drivers ADD COLUMN payout_account_updated_at timestamptz;

-- Menm siyati egzat ak vèsyon aktyèl la (20260718160000) — CREATE OR
-- REPLACE san danje, pa yon nouvo overload.
CREATE OR REPLACE FUNCTION public.update_restaurant_payout_secure(
  _restaurant_id uuid, _moncash_number text, _moncash_account_name text,
  _natcash_number text, _natcash_account_name text
)
RETURNS public.restaurant_payout_details
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.restaurant_payout_details;
  v_existing public.restaurant_payout_details;
  v_numbers_changed boolean;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.restaurant_payout_details WHERE restaurant_id = _restaurant_id;
  v_numbers_changed := v_existing.restaurant_id IS NOT NULL AND (
    COALESCE(v_existing.moncash_number, '') <> COALESCE(_moncash_number, '')
    OR COALESCE(v_existing.natcash_number, '') <> COALESCE(_natcash_number, '')
  );

  INSERT INTO public.restaurant_payout_details (
    restaurant_id, moncash_number, moncash_account_name, natcash_number, natcash_account_name
  ) VALUES (_restaurant_id, _moncash_number, _moncash_account_name, _natcash_number, _natcash_account_name)
  ON CONFLICT (restaurant_id) DO UPDATE SET
    moncash_number = excluded.moncash_number,
    moncash_account_name = excluded.moncash_account_name,
    natcash_number = excluded.natcash_number,
    natcash_account_name = excluded.natcash_account_name,
    payout_account_updated_at = CASE WHEN v_numbers_changed
      THEN now() ELSE public.restaurant_payout_details.payout_account_updated_at END
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Menm siyati egzat ak vèsyon aktyèl la (20260712120000).
CREATE OR REPLACE FUNCTION public.update_driver_payout_secure(
  _driver_id uuid,
  _moncash_number text,
  _moncash_account_name text,
  _natcash_number text,
  _natcash_account_name text,
  _payout_frequency text
)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.drivers;
  v_old public.drivers;
  v_numbers_changed boolean;
BEGIN
  SELECT * INTO v_old FROM public.drivers WHERE id = _driver_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _payout_frequency NOT IN ('daily', 'monthly') THEN
    RAISE EXCEPTION 'Invalid payout frequency';
  END IF;

  v_numbers_changed :=
    COALESCE(v_old.moncash_number, '') <> COALESCE(_moncash_number, '')
    OR COALESCE(v_old.natcash_number, '') <> COALESCE(_natcash_number, '');

  UPDATE public.drivers SET
    moncash_number = _moncash_number,
    moncash_account_name = _moncash_account_name,
    natcash_number = _natcash_number,
    natcash_account_name = _natcash_account_name,
    payout_frequency = _payout_frequency,
    payout_account_updated_at = CASE WHEN v_numbers_changed
      THEN now() ELSE payout_account_updated_at END
  WHERE id = _driver_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) request_withdrawal_secure — benefisyè a (pwopriyetè restoran, pa
-- staff; oswa livrè pwòp tèt li) mande yon retrè. Rezève lajan an
-- imedyatman, kreye yon ranje 'requested'. Pa fè okenn apèl rezo (yon
-- fonksyon SECURITY DEFINER Postgres pa ka) — se koòch TypeScript la
-- (request-withdrawal.functions.ts) ki rele sa a AVAN li eseye yon
-- tantativ PLOP otomatik.
CREATE FUNCTION public.request_withdrawal_secure(
  _restaurant_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _method text DEFAULT NULL
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
  v_account_updated_at timestamptz;
  v_beneficiary_status text;
  v_daily_total numeric;
  v_row public.payouts;
  v_reference text;
BEGIN
  IF (_restaurant_id IS NULL) = (_driver_id IS NULL) THEN
    RAISE EXCEPTION 'Specify exactly one beneficiary';
  END IF;

  IF _restaurant_id IS NOT NULL THEN
    IF NOT private.is_restaurant_manager(_restaurant_id) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT (
    EXISTS (SELECT 1 FROM public.drivers WHERE id = _driver_id AND user_id = v_user)
    OR private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Montan envalid';
  END IF;
  -- Placeholder Tach 3D (wè kòmantè anwo a).
  IF _amount < 250 THEN
    RAISE EXCEPTION 'Montan pi piti pou yon retrè se 250 HTG';
  END IF;
  IF _method IS NULL OR NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE code = _method AND is_active) THEN
    RAISE EXCEPTION 'Chwazi yon metòd peman valid';
  END IF;
  IF NOT public.check_rate_limit_secure('request_withdrawal', 5, 3600) THEN
    RAISE EXCEPTION 'Twòp demann. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  IF _restaurant_id IS NOT NULL THEN
    SELECT status INTO v_beneficiary_status FROM public.restaurants WHERE id = _restaurant_id;
    IF _method = 'moncash' THEN
      SELECT moncash_number, moncash_account_name, payout_account_updated_at
        INTO v_receiver_number, v_receiver_account, v_account_updated_at
        FROM public.restaurant_payout_details WHERE restaurant_id = _restaurant_id;
    ELSE
      SELECT natcash_number, natcash_account_name, payout_account_updated_at
        INTO v_receiver_number, v_receiver_account, v_account_updated_at
        FROM public.restaurant_payout_details WHERE restaurant_id = _restaurant_id;
    END IF;
    SELECT * INTO v_wallet FROM public.wallets WHERE restaurant_id = _restaurant_id FOR UPDATE;
  ELSE
    SELECT status INTO v_beneficiary_status FROM public.drivers WHERE id = _driver_id;
    IF _method = 'moncash' THEN
      SELECT moncash_number, moncash_account_name, payout_account_updated_at
        INTO v_receiver_number, v_receiver_account, v_account_updated_at
        FROM public.drivers WHERE id = _driver_id;
    ELSE
      SELECT natcash_number, natcash_account_name, payout_account_updated_at
        INTO v_receiver_number, v_receiver_account, v_account_updated_at
        FROM public.drivers WHERE id = _driver_id;
    END IF;
    SELECT * INTO v_wallet FROM public.wallets WHERE driver_id = _driver_id FOR UPDATE;
  END IF;

  IF v_beneficiary_status = 'suspended' THEN
    RAISE EXCEPTION 'Kont ou sispann — kontakte sipò NK Deliveri pou plis enfòmasyon';
  END IF;
  IF v_receiver_number IS NULL THEN
    RAISE EXCEPTION 'Konfigire yon nimewo peman pou metòd sa a anvan ou mande yon retrè';
  END IF;
  -- Anti-fròd: yon chanjman nimewo peman ki fenk fèt se egzakteman
  -- siyati yon sesyon konpwomèt k ap eseye detounen lajan.
  IF v_account_updated_at IS NOT NULL AND v_account_updated_at > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'Ou chanje nimewo peman ou dènyèman — tanpri tann 24 è (pou rezon sekirite) anvan ou mande yon retrè';
  END IF;
  IF v_wallet.id IS NULL OR v_wallet.available_balance < _amount THEN
    RAISE EXCEPTION 'Balans disponib la pa ase';
  END IF;

  -- Placeholder Tach 3D — limit chak jou (24è woulan) pa balans.
  SELECT COALESCE(sum(amount), 0) INTO v_daily_total
  FROM public.payouts
  WHERE wallet_id = v_wallet.id AND status <> 'failed' AND created_at > now() - interval '24 hours';
  IF v_daily_total + _amount > 50000 THEN
    RAISE EXCEPTION 'Ou depase limit retrè chak jou a (50 000 HTG) — eseye ankò pita';
  END IF;

  UPDATE public.wallets SET
    available_balance = available_balance - _amount,
    pending_balance = pending_balance + _amount,
    updated_at = now()
  WHERE id = v_wallet.id;

  -- Referans plasholder — sèlman satisfè NOT NULL/inikite jiskaske yon
  -- tantativ pwovidè reyèl ekri sou li (mark_requested_withdrawal_
  -- processing_secure) oswa yon admin ekri pwòp referans manyèl li.
  v_reference := 'WDR-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

  INSERT INTO public.payouts (
    restaurant_id, driver_id, wallet_id, amount, method, receiver_number, receiver_account_name,
    transaction_reference, status, requested_by, status_history, provider_code
  ) VALUES (
    _restaurant_id, _driver_id, v_wallet.id, _amount, _method, v_receiver_number, v_receiver_account,
    v_reference, 'requested', v_user,
    jsonb_build_array(jsonb_build_object('to', 'requested', 'by', v_user, 'at', now())), 'manual'
  ) RETURNING * INTO v_row;

  INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, pending_delta, payout_id, created_by, note)
  VALUES (v_wallet.id, 'withdrawal_requested', -_amount, _amount, v_row.id, v_user, 'Benefisyè mande yon retrè');

  PERFORM private.log_audit_event(v_user, NULL, 'payout.requested',
    jsonb_build_object('payout_id', v_row.id, 'amount', _amount, 'restaurant_id', _restaurant_id, 'driver_id', _driver_id));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT ur.user_id, 'withdrawal_requested', 'Nouvo demann retrè',
    'Yon benefisyè mande retire ' || _amount || ' HTG.',
    jsonb_build_object('payout_id', v_row.id)
  FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin');

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.request_withdrawal_secure(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal_secure(uuid, uuid, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) mark_requested_withdrawal_processing_secure — transisyon 'requested'
-- -> 'pending' jis anvan koòch TypeScript la rele pwovidè a. Pa fè okenn
-- mouvman balans (deja rezève depi request_withdrawal_secure) — sèlman
-- estanpe referans/pwovidè reyèl la pou complete_pending_payout_secure/
-- fail_pending_payout_secure/cron rekonsilyasyon an ka jwenn li apre.
-- Otorize: benefisyè a li menm (pou yon vrè "otomatik pwòp tèt") oswa
-- yon admin (pou l re-eseye yon demann k ap tann).
CREATE FUNCTION public.mark_requested_withdrawal_processing_secure(
  _payout_id uuid,
  _provider_code text,
  _own_reference text
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.payouts;
BEGIN
  SELECT * INTO v_row FROM public.payouts WHERE id = _payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;
  IF NOT private.payout_beneficiary_visible(v_row.restaurant_id, v_row.driver_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'requested' THEN
    RAISE EXCEPTION 'Demann sa a pa nan atant tretman';
  END IF;
  IF _provider_code IS NULL OR _provider_code = 'manual'
     OR NOT EXISTS (SELECT 1 FROM public.payment_providers WHERE code = _provider_code AND is_active) THEN
    RAISE EXCEPTION 'Pwovidè peman sa a pa disponib';
  END IF;
  IF _own_reference IS NULL OR length(btrim(_own_reference)) = 0 THEN
    RAISE EXCEPTION 'Referans obligatwa';
  END IF;

  UPDATE public.payouts SET
    status = 'pending',
    provider_code = _provider_code,
    transaction_reference = btrim(_own_reference),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'pending', 'via', 'provider_attempt', 'by', auth.uid(), 'at', now())
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.wallet_transactions (wallet_id, type, payout_id, created_by, note)
  VALUES (v_row.wallet_id, 'withdrawal_processing', v_row.id, auth.uid(), 'Tantativ peman otomatik kòmanse');

  PERFORM private.log_audit_event(auth.uid(), NULL, 'payout.processing_started',
    jsonb_build_object('payout_id', v_row.id, 'provider_code', _provider_code));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_requested_withdrawal_processing_secure(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_requested_withdrawal_processing_secure(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) admin_mark_requested_withdrawal_paid_secure — chemen MANYÈL: admin
-- konfime li voye lajan an nan telefòn li pou yon demann ki rete
-- 'requested' (PLOP pa disponib/aktive, oswa yon tantativ otomatik echwe
-- e beneficyè a/admin prefere fè l manyèlman). Pa touche balans (deja
-- rezève). STRICT step-up, menm jan ak initiate_payout_secure — se menm
-- risk (lajan reyèl kite platfòm nan).
CREATE FUNCTION public.admin_mark_requested_withdrawal_paid_secure(
  _payout_id uuid,
  _transaction_reference text,
  _proof_url text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payouts;
  v_beneficiary_user uuid;
  v_remaining numeric;
  v_link_amount numeric;
  v_commission record;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_admin_step_up_strict();

  IF _transaction_reference IS NULL OR length(btrim(_transaction_reference)) = 0 THEN
    RAISE EXCEPTION 'Referans tranzaksyon obligatwa';
  END IF;

  SELECT * INTO v_row FROM public.payouts WHERE id = _payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;
  IF v_row.status <> 'requested' THEN
    RAISE EXCEPTION 'Demann sa a pa nan atant tretman manyèl (li deja % oswa poko yon demann pwòp-tèt)', v_row.status;
  END IF;

  UPDATE public.payouts SET
    status = 'paid',
    transaction_reference = btrim(_transaction_reference),
    proof_url = COALESCE(_proof_url, proof_url),
    admin_notes = COALESCE(NULLIF(btrim(_notes), ''), admin_notes),
    paid_by = v_user,
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'paid', 'via', 'manual', 'by', v_user, 'at', now())
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO public.wallet_transactions (wallet_id, type, payout_id, created_by, note)
  VALUES (v_row.wallet_id, 'withdrawal_manual_paid', v_row.id, v_user, 'Admin konfime li voye lajan an manyèlman');

  IF v_row.restaurant_id IS NOT NULL THEN
    SELECT owner_id INTO v_beneficiary_user FROM public.restaurants WHERE id = v_row.restaurant_id;
  ELSE
    SELECT user_id INTO v_beneficiary_user FROM public.drivers WHERE id = v_row.driver_id;
  END IF;
  IF v_beneficiary_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (v_beneficiary_user, 'payout_paid', 'Ou resevwa yon peman',
      'Demann retrè ou pou ' || v_row.amount || ' HTG voye. Tanpri konfime resepsyon an.',
      jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount));
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'payout.manual_paid',
    jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount));

  -- Menm bouk koneksyon komisyon ak initiate_payout_secure.
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

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_mark_requested_withdrawal_paid_secure(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_requested_withdrawal_paid_secure(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) cancel_requested_withdrawal_secure — benefisyè a anile pwòp demann
-- pa yo AVAN nenpòt tretman kòmanse, lajan an retounen disponib.
CREATE FUNCTION public.cancel_requested_withdrawal_secure(_payout_id uuid, _reason text DEFAULT NULL)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payouts;
BEGIN
  SELECT * INTO v_row FROM public.payouts WHERE id = _payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;
  IF NOT private.payout_beneficiary_visible(v_row.restaurant_id, v_row.driver_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'requested' THEN
    RAISE EXCEPTION 'Ou ka sèlman anile yon demann ki poko trete';
  END IF;

  UPDATE public.payouts SET
    status = 'failed',
    admin_notes = COALESCE(NULLIF(btrim(_reason), ''), 'Anile pa benefisyè a'),
    updated_at = now(),
    status_history = status_history || jsonb_build_object('to', 'failed', 'reason', 'cancelled_by_beneficiary', 'by', v_user, 'at', now())
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  UPDATE public.wallets SET
    available_balance = available_balance + v_row.amount,
    pending_balance = pending_balance - v_row.amount,
    updated_at = now()
  WHERE id = v_row.wallet_id;

  INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, pending_delta, payout_id, created_by, note)
  VALUES (v_row.wallet_id, 'withdrawal_cancelled', v_row.amount, -v_row.amount, v_row.id, v_user, 'Benefisyè anile demann lan');

  PERFORM private.log_audit_event(v_user, NULL, 'payout.cancelled_by_beneficiary', jsonb_build_object('payout_id', v_row.id));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_requested_withdrawal_secure(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_requested_withdrawal_secure(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) BUG REYÈL kaptire anvan l janm rive nan pwodiksyon: fail_pending_
-- payout_secure te sipoze `paid_by` toujou gen yon valè (vre pou chemen
-- admin-inisye a, initiate-provider-payout.functions.ts) pou l notifye
-- "admin ki inisye a". Yon demann pwòp-tèt ki rive nan 'pending' epi
-- echwe kote pwovidè a gen `paid_by IS NULL` (pa gen okenn admin) —
-- INSERT la nan `notifications.user_id` (NOT NULL) ta leve yon erè
-- "not null violation" epi FÈ TOUT FONKSYON AN FÈ ROLLBACK, ANNIL
-- LIBERASYON BALANS LAN TOU. Korije: lè paid_by IS NULL, notifye
-- BENEFISYÈ a (li menm ki mande retrè a) olye yon admin ki pa egziste.
-- Rès fonksyon an (rechèch, verifikasyon estati, liberasyon balans,
-- wallet_transactions, log) idantik jan l te ye.
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

  -- Release the reservation -- the money never actually left the wallet
  -- (create_pending_payout_secure/request_withdrawal_secure only moved
  -- it available -> pending), so it goes straight back to
  -- available_balance, never through paid_balance.
  UPDATE public.wallets SET
    available_balance = available_balance + v_row.amount,
    pending_balance = pending_balance - v_row.amount,
    updated_at = now()
  WHERE id = v_row.wallet_id;

  INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, pending_delta, payout_id, created_by, note)
  VALUES (v_row.wallet_id, 'payout_provider_failed', v_row.amount, -v_row.amount, v_row.id, NULL, COALESCE(NULLIF(btrim(_reason), ''), 'Pwovidè echwe'));

  IF v_row.paid_by IS NOT NULL THEN
    -- Chemen admin-inisye a (initiate-provider-payout.functions.ts) —
    -- notifye admin ki inisye tantativ la, jan sa te toujou fèt.
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (v_row.paid_by, 'payout_provider_failed', 'Peman pwovidè echwe',
      'Yon tantativ peman ' || v_row.amount || ' HTG atravè ' || v_row.provider_code || ' echwe. Lajan an retounen nan balans disponib la.',
      jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount));
  ELSE
    -- Chemen demann pwòp-tèt la (Tach 3B) — pa gen admin ki inisye,
    -- notifye benefisyè a li menm olye enkete `notifications.user_id`
    -- ak NULL (ki ta vyole NOT NULL e fè tout fonksyon an fè rollback).
    IF v_row.restaurant_id IS NOT NULL THEN
      SELECT owner_id INTO v_beneficiary_user FROM public.restaurants WHERE id = v_row.restaurant_id;
    ELSE
      SELECT user_id INTO v_beneficiary_user FROM public.drivers WHERE id = v_row.driver_id;
    END IF;
    IF v_beneficiary_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (v_beneficiary_user, 'withdrawal_failed', 'Demann retrè echwe',
        'Tantativ retire ' || v_row.amount || ' HTG echwe. Lajan an retounen nan balans disponib ou — ou ka mande yon nouvo retrè.',
        jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount));
    END IF;
  END IF;

  PERFORM private.log_audit_event(NULL, 'system', 'payout.provider_failed',
    jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount, 'provider_code', v_row.provider_code, 'reason', _reason));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.fail_pending_payout_secure(text, text, text) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.fail_pending_payout_secure(text, text, text) TO service_role;
