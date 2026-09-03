-- ENSIDAN LAJAN REYÈL — rechaj wallet 50 HTG (MonCash/PLOP) ki peye pou
-- vre men ki pa janm rive nan balans kliyan an. Migrasyon sa a korije
-- KÒZ RASIN nan epi bay yon zouti rekiperasyon odite.
--
-- KÒZ RASIN (chèn konplè, 4 pwoblèm ki konbine):
--   1) Pa gen okenn konfimasyon imedya pou rechaj wallet. Peman kòmand
--      yo gen yon poll kliyan-side (useCollectPaymentPoll, mekanis
--      PRENSIPAL la); rechaj wallet pa t janm genyen youn — sèl chemen
--      konfimasyon an se te cron an.
--   2) Cron an (vercel.json) kouri YON SÈL FWA CHAK JOU (15 3 * * *).
--   3) Nan MENM pas cron an, apre yon sèl tantativ rekonsilyasyon,
--      expire_stale_wallet_topups_secure(30) t ap make EKSPIRE tout
--      entansyon ki gen plis pase 30 MINIT — san li pa janm mande PLOP
--      si kliyan an te peye. Ak yon cron chak 24è, sa vle di
--      PRATIKMAN CHAK rechaj ki pa konfime nan yon sèl tantativ te
--      kondane a ekspire.
--   4) complete_wallet_topup_secure sèlman aji sou status='pending'.
--      Yon fwa yon entansyon make 'expired', OKENN chemen otomatik pa
--      ka janm kredite l ankò — lajan an peye, kliyan an pa janm wè l,
--      epi sistèm nan sispann eseye. San bri, san alèt.
--
-- SA MIGRASYON SA A FÈ:
--   A) Ekspirasyon vin SAN DANJE: defo pase de 30 minit a 1440 minit
--      (24è), donk yon cron jounalye pa ka janm antere yon peman menm
--      jou a. (Koòch TypeScript la tou sispann rele l apre yon sèl
--      tantativ — wè plop-wallet-topup-reconcile.server.ts.)
--   B) Nouvo admin_recover_wallet_topup_secure — kredite yon entansyon
--      PLOP konfime kòm peye, KÈLKESWA estati aktyèl li ('expired',
--      'failed', 'pending'). Se sa ki pral rekipere 50 HTG la.
--   C) Nouvo get_wallet_topups_admin_secure — admin ka WÈ rechaj wallet
--      yo (pa t gen okenn vizibilite admin ditou anvan sa; se yon rezon
--      kle poukisa pwoblèm nan pase inapèsi).

-- ---------------------------------------------------------------------------
-- A) Ekspirasyon san danje. Menm siyati egzat — CREATE OR REPLACE san
-- danje. Sèl chanjman: defo a (30 -> 1440 minit) ak yon gad eksplisit
-- ki refize nenpòt valè twò kout, pou pèsonn pa ka rekreye bug la pa
-- aksidan nan yon apèl fiti.
CREATE OR REPLACE FUNCTION public.expire_stale_wallet_topups_secure(_older_than_minutes int DEFAULT 1440)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_minutes int := COALESCE(_older_than_minutes, 1440);
BEGIN
  -- GAD KRITIK: yon fenèt pi kout pase kadans cron an se egzakteman sa
  -- ki te fè yon peman reyèl vin 'expired' anvan yo te menm mande PLOP
  -- si li te peye. Pa janm desann anba 24è san yon konfimasyon PLOP
  -- pou chak ranje (sa se travay rekonsilyasyon an, pa travay isit la).
  IF v_minutes < 1440 THEN
    RAISE EXCEPTION 'Fenèt ekspirasyon twò kout (% minit) — minimòm 1440 (24è) pou pa antere yon peman reyèl', v_minutes
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.payment_intents
     SET status = 'expired', updated_at = now()
   WHERE status = 'pending'
     AND created_at < now() - make_interval(mins => v_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_stale_wallet_topups_secure(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_wallet_topups_secure(int) TO service_role;

-- ---------------------------------------------------------------------------
-- B) admin_recover_wallet_topup_secure — rekipere yon rechaj ki peye sou
-- bò PLOP men ki pa janm rive nan wallet la.
--
-- MODÈL KONFYANS: menm ak initiate-provider-payout — se koòch TypeScript
-- la (recover-wallet-topup.functions.ts) ki MANDE PLOP tout bon
-- (checkStatus) epi ki sèlman rele fonksyon sa a lè PLOP DI li peye.
-- Yon fonksyon SQL pa ka rele PLOP li menm.
--
-- IDANPOTANS: kontrèman ak complete_wallet_topup_secure (ki depann de
-- status='pending' kòm gad li), fonksyon sa a DWE ka aji sou yon ranje
-- ki deja 'expired'. Donk gad kont doub-kredi a se LEDGER la menm:
-- wallet_transactions.idempotency_key = 'topup:<intent_id>' (endèks inik
-- pasyèl ki deja egziste). Nou INSERT ANVAN, epi nou sèlman ogmante
-- balans lan si INSERT la reyèlman kreye yon ranje. Rele fonksyon an
-- 10 fwa = yon sèl kredi, garanti pa baz done a, pa pa lojik.
CREATE OR REPLACE FUNCTION public.admin_recover_wallet_topup_secure(
  _external_reference text,
  _provider_transaction_id text DEFAULT NULL,
  _raw_payload jsonb DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.payment_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payment_intents;
  v_wallet_id uuid;
  v_ledger_id uuid;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  -- STRICT: lajan reyèl k ap antre nan yon balans kliyan, sou desizyon
  -- yon admin — menm tier ak initiate_payout_secure.
  PERFORM private.require_admin_step_up_strict();

  SELECT * INTO v_row FROM public.payment_intents
   WHERE external_reference = _external_reference
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pa gen entansyon peman pou referans sa a' USING ERRCODE = 'P0002';
  END IF;

  -- Kreye wallet la si se premye fwa (menm patwon "lazy create").
  INSERT INTO public.wallets (user_id, available_balance, lifetime_earnings)
  VALUES (v_row.user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_row.user_id FOR UPDATE;

  -- Ledger AN PREMYE — se li ki gad idanpotans lan.
  INSERT INTO public.wallet_transactions (
    wallet_id, type, available_delta, note, idempotency_key, created_by
  ) VALUES (
    v_wallet_id, 'topup_credit', v_row.amount,
    'Rekiperasyon rechaj ' || v_row.payment_method || ' — ' || v_row.external_reference
      || COALESCE(' (' || NULLIF(btrim(_notes), '') || ')', ''),
    'topup:' || v_row.id,
    v_user
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    -- Deja kredite yon lòt kote (cron, poll, oswa yon rekiperasyon
    -- anvan) — pa gen 2yèm kredi. Nou senpleman asire estati a
    -- koresponn ak reyalite a epi nou retounen ranje a.
    UPDATE public.payment_intents SET
      status = 'succeeded',
      provider_transaction_id = COALESCE(_provider_transaction_id, provider_transaction_id),
      raw_payload = COALESCE(_raw_payload, raw_payload),
      confirmed_at = COALESCE(confirmed_at, now()),
      updated_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    PERFORM private.log_audit_event(v_user, 'admin', 'wallet_topup.recovery_noop',
      jsonb_build_object('intent_id', v_row.id, 'user_id', v_row.user_id,
        'amount', v_row.amount, 'reason', 'deja kredite — ledger idempotency_key egziste deja'));
    RETURN v_row;
  END IF;

  UPDATE public.wallets
     SET available_balance = available_balance + v_row.amount,
         updated_at = now()
   WHERE id = v_wallet_id;

  UPDATE public.payment_intents SET
    status = 'succeeded',
    provider_transaction_id = COALESCE(_provider_transaction_id, provider_transaction_id),
    raw_payload = COALESCE(_raw_payload, raw_payload),
    error = NULL,
    confirmed_at = COALESCE(confirmed_at, now()),
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'admin', 'wallet_topup.recovered',
    jsonb_build_object('intent_id', v_row.id, 'user_id', v_row.user_id, 'amount', v_row.amount,
      'previous_status', 'wè status_history nan odit anvan an', 'notes', _notes));

  PERFORM private.notify_secure(
    ARRAY[v_row.user_id],
    'wallet_topup_succeeded', 'payment', 'Wallet ou rechaje',
    'Rechaj ' || v_row.amount || ' HTG ou a konfime epi ajoute nan balans ou.',
    jsonb_build_object('intent_id', v_row.id)
  );

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_recover_wallet_topup_secure(text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recover_wallet_topup_secure(text, text, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- C) get_wallet_topups_admin_secure — vizibilite admin sou rechaj wallet
-- yo (pa t gen okenn anvan sa: ni yon paj, ni yon RPC — yon rechaj kwoke
-- te envizib nèt pou admin, ki se yon rezon kle poukisa ensidan sa a
-- pase san yo pa wè l).
CREATE OR REPLACE FUNCTION public.get_wallet_topups_admin_secure(
  _status text DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  customer_name text,
  amount numeric,
  payment_method text,
  status text,
  external_reference text,
  provider_transaction_id text,
  error text,
  created_at timestamptz,
  confirmed_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT pi.* FROM public.payment_intents pi
    WHERE (_status IS NULL OR pi.status = _status)
  )
  SELECT f.id, f.user_id,
    COALESCE(
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      'Kliyan'
    )::text,
    f.amount, f.payment_method, f.status, f.external_reference,
    f.provider_transaction_id, f.error, f.created_at, f.confirmed_at,
    (SELECT count(*) FROM filtered)
  FROM filtered f
  LEFT JOIN public.profiles p ON p.id = f.user_id
  ORDER BY f.created_at DESC
  LIMIT COALESCE(_limit, 50) OFFSET COALESCE(_offset, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.get_wallet_topups_admin_secure(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_wallet_topups_admin_secure(text, int, int) TO authenticated;
