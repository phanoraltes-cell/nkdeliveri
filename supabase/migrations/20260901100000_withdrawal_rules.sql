-- PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE) — Tach 3D: règ
-- komisyon retrè KONFIGIRAB PA ADMIN, ranplase valè fiks (250 HTG
-- minimòm / 50 000 HTG chak 24è) Tach 3B te mete kòm plasholder eksplisit
-- (wè kòmantè 20260901080000_self_service_withdrawal_requests.sql).
--
-- POTE: sèlman sou DEMANN RETRÈ PWÒP-TÈT (request_withdrawal_secure,
-- Tach 3B) — PA sou peman admin-inisye yo (initiate_payout_secure/
-- create_pending_payout_secure), ki rete san chanjman: yon admin ki
-- deside voye yon peman pa "mande yon retrè", se yon aksyon diferan kote
-- MONTAN an se dwa admin, pa yon "montan mande" ki bezwen yon frè
-- kalkile. Chwa sa a delibere, pa yon ogliyon — elaji sijè a bay peman
-- admin ta chanje konpòtman etabli san okenn demand nan pwonp la.
--
-- VÈSYONE: chak liy `withdrawal_rules` se yon NOUVO VÈSYON pou yon wòl
-- (restoran/livrè), JANM modifye apre kreyasyon — jis INSERT, janm
-- UPDATE. Règ AKTIF pou yon moman bay se sa ki gen `effective_from` PI
-- RESAN ki poko rive nan fiti (<=). Yon retrè kenbe `withdrawal_rule_id`
-- (ak montan frè/nèt DEJA KALKILE) sou pwòp ranje l depi kreyasyon —
-- yon chanjman règ pita PA JANM afekte retrè ki deja fèt.
--
-- MODÈL FRÈ: kliyan mande yon montan BRIT (`amount`, deja egziste); frè
-- a (pousantaj + fiks, sof si anba sèy gratis la) sòti sou li; sa yo
-- REYÈLMAN voye/resevwa se `net_amount = amount - fee_amount`. Wallet la
-- rezève `amount` (brit) — frè a rete sou platfòm nan (li senpleman pa
-- fè pati sa ki voye bay benefisyè a).
--
-- "AVAILABILITY DELAY" — chwa senplifikasyon eksplisit: DELÈ SA A
-- aplike sou TRETMAN demann lan (konbyen tan apre `request_withdrawal_
-- secure` anvan yon tantativ pwovidè/manyèl ka kòmanse), PA sou laj
-- chak dola nan balans lan (ki ta mande swiv orijin chak kredi
-- endividyèlman — konplèks anpil pou benefis li bay kounye a). Si Altes
-- vle vèsyon "laj balans" pi ta, sa se yon chantye separe.

-- ---------------------------------------------------------------------------
-- 1) withdrawal_rules
CREATE TABLE IF NOT EXISTS public.withdrawal_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('restaurant', 'driver')),
  fee_percentage numeric(6,2) NOT NULL DEFAULT 0 CHECK (fee_percentage >= 0 AND fee_percentage <= 100),
  flat_fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (flat_fee >= 0),
  min_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  max_amount numeric(10,2) CHECK (max_amount IS NULL OR max_amount >= min_amount),
  daily_limit numeric(10,2) CHECK (daily_limit IS NULL OR daily_limit > 0),
  weekly_limit numeric(10,2) CHECK (weekly_limit IS NULL OR weekly_limit > 0),
  -- Yon retrè ki <= sèy sa a pa peye okenn frè (ni pousantaj ni fiks).
  -- NULL = pa gen sèy gratis, chak retrè peye dapre fee_percentage/flat_fee.
  free_threshold numeric(10,2) CHECK (free_threshold IS NULL OR free_threshold >= 0),
  availability_delay_hours int NOT NULL DEFAULT 0 CHECK (availability_delay_hours >= 0),
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
CREATE INDEX IF NOT EXISTS withdrawal_rules_role_effective_idx ON public.withdrawal_rules(role, effective_from DESC);

ALTER TABLE public.withdrawal_rules ENABLE ROW LEVEL SECURITY;
-- Li li se piblik-pou-konekte (menm posti ak payment_methods/
-- payment_providers) — se sèlman yon orè frè, pa done sansib, e
-- benefisyè a bezwen wè l pou apèsi "montan mande → frè → sa l ap
-- resevwa" anvan menm li soumèt yon demann.
CREATE POLICY "withdrawal_rules read" ON public.withdrawal_rules FOR SELECT TO authenticated
  USING (true);
REVOKE ALL ON public.withdrawal_rules FROM PUBLIC, anon;
GRANT SELECT ON public.withdrawal_rules TO authenticated;

-- Seed: 2 vèsyon inisyal (yon pou chak wòl) ki REPWODWI EGZAKTEMAN valè
-- plasholder Tach 3B yo (250 HTG min, 50 000 HTG/24è, 0% frè) — okenn
-- chanjman konpòtman pou benefisyè ki deja gen demann anba ansyen kòd
-- la, jiskaske Altes deside yon vrè règ atravè admin UI a.
-- Gad re-kouri: si migrasyon an kouri 2 fwa, yon dezyèm seri seed ta
-- kreye 2 règ ak MENM effective_from pou menm wòl la — epi
-- "ORDER BY effective_from DESC LIMIT 1" ta vin anbigi (Postgres ta
-- chwazi youn arbitrèman). Sa ta vle di frè/limit yon retrè depann de
-- yon tiraj osò. Nou seed SÈLMAN si wòl la pa gen okenn règ ankò.
INSERT INTO public.withdrawal_rules (role, fee_percentage, flat_fee, min_amount, daily_limit, notes)
SELECT v.role, 0, 0, 250, 50000,
       'Vèsyon inisyal — reprodwi plasholder Tach 3B yo, poko yon vrè desizyon biznis.'
FROM (VALUES ('restaurant'), ('driver')) AS v(role)
WHERE NOT EXISTS (
  SELECT 1 FROM public.withdrawal_rules w WHERE w.role = v.role
);

-- ---------------------------------------------------------------------------
-- 2) create_withdrawal_rule_secure — admin sèlman, TOUJOU yon INSERT
-- (yon nouvo vèsyon), janm yon UPDATE — kenbe istorik la konplè pou
-- retrè ki deja fèt yo ka toujou site ki règ ki te aplike.
CREATE OR REPLACE FUNCTION public.create_withdrawal_rule_secure(
  _role text,
  _fee_percentage numeric,
  _flat_fee numeric,
  _min_amount numeric,
  _max_amount numeric DEFAULT NULL,
  _daily_limit numeric DEFAULT NULL,
  _weekly_limit numeric DEFAULT NULL,
  _free_threshold numeric DEFAULT NULL,
  _availability_delay_hours int DEFAULT 0,
  _effective_from timestamptz DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.withdrawal_rules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.withdrawal_rules;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  -- STRICT step-up (menm tier ak update_payment_provider_setting_secure/
  -- update_platform_payout_settings_secure, 20260811120000) — sa a se
  -- konfigirasyon sekirite peman global tou: yon sesyon vòlè ki chanje
  -- frè/limit yo san MFA fre ta pase inapèsi jiskaske pwochen retrè a.
  PERFORM private.require_admin_step_up_strict();
  IF _role NOT IN ('restaurant', 'driver') THEN
    RAISE EXCEPTION 'Wòl envalid — dwe restaurant oswa driver';
  END IF;
  IF _fee_percentage IS NULL OR _fee_percentage < 0 OR _fee_percentage > 100 THEN
    RAISE EXCEPTION 'Pousantaj frè envalid (0-100)';
  END IF;
  IF _flat_fee IS NULL OR _flat_fee < 0 THEN
    RAISE EXCEPTION 'Frè fiks envalid';
  END IF;
  IF _min_amount IS NULL OR _min_amount < 0 THEN
    RAISE EXCEPTION 'Montan minimòm envalid';
  END IF;
  IF _max_amount IS NOT NULL AND _max_amount < _min_amount THEN
    RAISE EXCEPTION 'Montan maksimòm dwe pi gwo pase minimòm nan';
  END IF;

  INSERT INTO public.withdrawal_rules (
    role, fee_percentage, flat_fee, min_amount, max_amount, daily_limit, weekly_limit,
    free_threshold, availability_delay_hours, effective_from, created_by, notes
  ) VALUES (
    _role, _fee_percentage, _flat_fee, _min_amount, _max_amount, _daily_limit, _weekly_limit,
    _free_threshold, COALESCE(_availability_delay_hours, 0), COALESCE(_effective_from, now()), v_user,
    NULLIF(btrim(_notes), '')
  ) RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'withdrawal_rule.created',
    jsonb_build_object('rule_id', v_row.id, 'role', _role, 'fee_percentage', _fee_percentage,
      'flat_fee', _flat_fee, 'min_amount', _min_amount, 'max_amount', _max_amount,
      'daily_limit', _daily_limit, 'weekly_limit', _weekly_limit, 'effective_from', v_row.effective_from));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_withdrawal_rule_secure(text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, int, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_withdrawal_rule_secure(text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, int, timestamptz, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) get_active_withdrawal_rule_secure — lekti piblik-pou-konekte (menm
-- jan ak SELECT policy a), sèvi kòm yon fonksyon pratik pou checkout/
-- withdrawal-request-section.tsx montre yon apèsi "montan → frè → nèt"
-- san yo pa gen pou yo repwodwi lojik "pi resan ki aktif la" nan React.
CREATE OR REPLACE FUNCTION public.get_active_withdrawal_rule_secure(_role text, _as_of timestamptz DEFAULT NULL)
RETURNS public.withdrawal_rules
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.withdrawal_rules
  WHERE role = _role AND effective_from <= COALESCE(_as_of, now())
  ORDER BY effective_from DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_active_withdrawal_rule_secure(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_withdrawal_rule_secure(text, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) payouts — nouvo kolòn pou anrejistre EGZAKTEMAN ki règ te aplike ak
-- rezilta kalkil li a, snapshote pou tout tan nan moman demann lan.
ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS withdrawal_rule_id uuid REFERENCES public.withdrawal_rules(id),
  ADD COLUMN IF NOT EXISTS fee_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric(10,2);
UPDATE public.payouts SET net_amount = amount WHERE net_amount IS NULL;
ALTER TABLE public.payouts ALTER COLUMN net_amount SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 5) request_withdrawal_secure — menm siyati, CREATE OR REPLACE san
-- danje. Chanjman: min_amount/daily_limit fiks yo ranplase pa yon lekti
-- withdrawal_rules (weekly_limit/max_amount/free_threshold/delè
-- disponibilite ajoute tou, okenn pa t egziste anvan); frè/montan nèt
-- kalkile epi anrejistre sou payouts.
CREATE OR REPLACE FUNCTION public.request_withdrawal_secure(
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
  v_weekly_total numeric;
  v_row public.payouts;
  v_reference text;
  v_role text;
  v_rule public.withdrawal_rules;
  v_fee_amount numeric(10,2);
  v_net_amount numeric(10,2);
BEGIN
  IF (_restaurant_id IS NULL) = (_driver_id IS NULL) THEN
    RAISE EXCEPTION 'Specify exactly one beneficiary';
  END IF;
  v_role := CASE WHEN _restaurant_id IS NOT NULL THEN 'restaurant' ELSE 'driver' END;

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

  SELECT * INTO v_rule FROM public.get_active_withdrawal_rule_secure(v_role);
  IF v_rule.id IS NULL THEN
    RAISE EXCEPTION 'Konfigirasyon règ retrè pa jwenn pou wòl sa a — kontakte sipò NK Deliveri';
  END IF;

  IF _amount < v_rule.min_amount THEN
    RAISE EXCEPTION 'Montan pi piti pou yon retrè se % HTG', v_rule.min_amount;
  END IF;
  IF v_rule.max_amount IS NOT NULL AND _amount > v_rule.max_amount THEN
    RAISE EXCEPTION 'Montan pi gwo pou yon sèl retrè se % HTG', v_rule.max_amount;
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

  IF v_rule.daily_limit IS NOT NULL THEN
    SELECT COALESCE(sum(amount), 0) INTO v_daily_total
    FROM public.payouts
    WHERE wallet_id = v_wallet.id AND status <> 'failed' AND created_at > now() - interval '24 hours';
    IF v_daily_total + _amount > v_rule.daily_limit THEN
      RAISE EXCEPTION 'Ou depase limit retrè chak jou a (% HTG) — eseye ankò pita', v_rule.daily_limit;
    END IF;
  END IF;
  IF v_rule.weekly_limit IS NOT NULL THEN
    SELECT COALESCE(sum(amount), 0) INTO v_weekly_total
    FROM public.payouts
    WHERE wallet_id = v_wallet.id AND status <> 'failed' AND created_at > now() - interval '7 days';
    IF v_weekly_total + _amount > v_rule.weekly_limit THEN
      RAISE EXCEPTION 'Ou depase limit retrè chak semèn nan (% HTG) — eseye ankò pita', v_rule.weekly_limit;
    END IF;
  END IF;

  -- Kalkil frè — yon retrè <= sèy gratis la (si genyen) peye zewo frè.
  IF v_rule.free_threshold IS NOT NULL AND _amount <= v_rule.free_threshold THEN
    v_fee_amount := 0;
  ELSE
    v_fee_amount := round(_amount * v_rule.fee_percentage / 100, 2) + v_rule.flat_fee;
  END IF;
  v_fee_amount := LEAST(v_fee_amount, _amount);
  v_net_amount := _amount - v_fee_amount;

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
    transaction_reference, status, requested_by, status_history, provider_code,
    withdrawal_rule_id, fee_amount, net_amount
  ) VALUES (
    _restaurant_id, _driver_id, v_wallet.id, _amount, _method, v_receiver_number, v_receiver_account,
    v_reference, 'requested', v_user,
    jsonb_build_array(jsonb_build_object('to', 'requested', 'by', v_user, 'at', now())), 'manual',
    v_rule.id, v_fee_amount, v_net_amount
  ) RETURNING * INTO v_row;

  INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, pending_delta, payout_id, created_by, note)
  VALUES (v_wallet.id, 'withdrawal_requested', -_amount, _amount, v_row.id, v_user, 'Benefisyè mande yon retrè');

  PERFORM private.log_audit_event(v_user, NULL, 'payout.requested',
    jsonb_build_object('payout_id', v_row.id, 'amount', _amount, 'fee_amount', v_fee_amount,
      'net_amount', v_net_amount, 'withdrawal_rule_id', v_rule.id,
      'restaurant_id', _restaurant_id, 'driver_id', _driver_id));

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT ur.user_id, 'withdrawal_requested', 'Nouvo demann retrè',
    'Yon benefisyè mande retire ' || _amount || ' HTG.',
    jsonb_build_object('payout_id', v_row.id)
  FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin');

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6) NÒT DELIBERE — "availability delay": pa aplike kòm yon nouvo gad
-- nan request_withdrawal_secure (li ta refize demann lan nèt, ki pa
-- sans — delè a dwe aplike sou TRETMAN an, pa sou KREYASYON demann lan).
-- Olye de sa, li aplike nan mark_requested_withdrawal_processing_secure
-- (chemen otomatik/admin "eseye kounye a") — yon demann pa ka kòmanse
-- trete jiskaske availability_delay_hours pase depi li kreye.
CREATE OR REPLACE FUNCTION public.mark_requested_withdrawal_processing_secure(
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
  v_rule public.withdrawal_rules;
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

  IF v_row.withdrawal_rule_id IS NOT NULL THEN
    SELECT * INTO v_rule FROM public.withdrawal_rules WHERE id = v_row.withdrawal_rule_id;
    IF v_rule.id IS NOT NULL AND v_row.created_at > now() - make_interval(hours => v_rule.availability_delay_hours) THEN
      RAISE EXCEPTION 'Demann sa a poko disponib pou tretman — tann jiska % è apre demann lan', v_rule.availability_delay_hours
        USING ERRCODE = '55000';
    END IF;
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

-- Menm gad delè disponibilite a, chemen MANYÈL admin an (sinon yon admin
-- ta ka kontounen delè a senpleman peye manyèlman olye eseye otomatik).
CREATE OR REPLACE FUNCTION public.admin_mark_requested_withdrawal_paid_secure(
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
  v_rule public.withdrawal_rules;
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

  IF v_row.withdrawal_rule_id IS NOT NULL THEN
    SELECT * INTO v_rule FROM public.withdrawal_rules WHERE id = v_row.withdrawal_rule_id;
    IF v_rule.id IS NOT NULL AND v_row.created_at > now() - make_interval(hours => v_rule.availability_delay_hours) THEN
      RAISE EXCEPTION 'Demann sa a poko disponib pou tretman — tann jiska % è apre demann lan', v_rule.availability_delay_hours
        USING ERRCODE = '55000';
    END IF;
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
      'Demann retrè ou pou ' || v_row.net_amount || ' HTG voye (' || v_row.amount || ' HTG mwens ' || v_row.fee_amount || ' HTG frè). Tanpri konfime resepsyon an.',
      jsonb_build_object('payout_id', v_row.id, 'amount', v_row.net_amount));
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'payout.manual_paid',
    jsonb_build_object('payout_id', v_row.id, 'amount', v_row.amount, 'net_amount', v_row.net_amount));

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
