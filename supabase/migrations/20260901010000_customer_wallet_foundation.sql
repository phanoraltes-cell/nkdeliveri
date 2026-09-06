-- PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE) — Tach 1, FONDASYON.
--
-- DESIZYON KONFIME PA ALTES: inifye ak sistèm `wallets`/`wallet_transactions`
-- ki egziste deja a (restoran/livrè), OLYE kreye yon dezyèm sistèm parallèl
-- an santim-antye. Konsekans dirèk (siyale davans, pa kache):
--   - Montan yo rete `numeric(12,2)` (desimal), PA santim-antye jan premye
--     vèsyon spesifikasyon an te mande — chwa inifikasyon an vle di
--     konsistans ak sa ki egziste deja a, pa yon dezyèm reprezantasyon.
--     HTG pa gen soudivizyon pi piti pase santim, kidonk numeric(12,2)
--     rete egzat pou kalkil lajan (menm garanti ak tout rès sistèm nan).
--   - Tab `wallets`/`wallet_transactions` yo ELAJI (kolòn tou nèf, CHECK
--     tou nèf), PA ranplase — okenn done restoran/livrè ki egziste deja
--     pa touche.
--
-- ENVANTÈ (verifye avan migrasyon sa a) : `wallets` te sipòte SÈLMAN
-- restaurant_id OSWA driver_id (CHECK 2 chemen). `wallet_transactions.type`
-- te limite a 6 valè ki gen rapò ak komisyon/dekèsman sèlman, san
-- `idempotency_key`. Pa gen okenn tab `payment_intents` ni RPC rechaj
-- wallet kliyan.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) wallets — ajoute `user_id` (kliyan), elaji CHECK la a 3 chemen.
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_user_unique UNIQUE (user_id);

ALTER TABLE public.wallets DROP CONSTRAINT wallets_one_beneficiary;
ALTER TABLE public.wallets ADD CONSTRAINT wallets_one_beneficiary CHECK (
  (restaurant_id IS NOT NULL)::int + (driver_id IS NOT NULL)::int + (user_id IS NOT NULL)::int = 1
);

-- Nouvo policy ADITIF (RLS "permissive" — plizyè policy sou menm kòmand
-- se yon OR, jamè ranplase youn ak lòt) — pa touche
-- "wallets read"/private.payout_beneficiary_visible ki egziste deja pou
-- restoran/livrè.
DROP POLICY IF EXISTS "wallets customer read" ON public.wallets;
CREATE POLICY "wallets customer read" ON public.wallets FOR SELECT TO authenticated
  USING (user_id IS NOT NULL AND user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2) wallet_transactions — nouvo tip pou mouvman kliyan yo, ak yon
--    `idempotency_key` toude fwa (Tach 1A mande sa eksplisitman: "Chak
--    operasyon gen yon idempotency_key inik"). Endèks pasyèl (WHERE NOT
--    NULL) pou pa antre an konfli ak 6000+ ranje ki egziste deja san yon
--    kle (kredi komisyon itilize pwòp idempotency pa yo, sou
--    commission_ledger, deja).
ALTER TABLE public.wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check CHECK (type IN (
  'commission_credit', 'commission_reversed',
  'payout_sent', 'payout_confirmed', 'payout_reversed',
  'wallet_recomputed',
  'topup_credit', 'order_payment_debit', 'order_refund_credit', 'wallet_adjustment'
));

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX wallet_transactions_idempotency_key_uniq
  ON public.wallet_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Nouvo policy aditif, menm rezon ak pi wo a — `private.wallet_owner_visible`
-- delegue bay `payout_beneficiary_visible(restaurant_id, driver_id)`, ki
-- pa ka janm matche yon wallet kliyan (tou de toujou NULL pou yon wallet
-- kliyan). Pa modifye fonksyon ki egziste deja a — li itilize pa lòt kote
-- tou, chanje l ta gen efè bò pa verifye.
DROP POLICY IF EXISTS "wallet_transactions customer read" ON public.wallet_transactions;
CREATE POLICY "wallet_transactions customer read" ON public.wallet_transactions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.wallets w WHERE w.id = wallet_transactions.wallet_id AND w.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 3) payment_intents — rechaj wallet kliyan (endepandan de yon kòmand,
--    kontrèman ak `payment_transactions` ki mande yon order_id/payment_id
--    deja egziste). Rezon separe: `payment_transactions` estriktirèlman
--    mare ak yon kòmand — pa ka itilize pou senp ranpli yon wallet san
--    kòmand.
CREATE TABLE public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'plop_api',
  payment_method text NOT NULL CHECK (payment_method IN ('moncash', 'natcash')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'HTG',
  external_reference text NOT NULL UNIQUE,
  provider_transaction_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
  error text,
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz
);
CREATE INDEX payment_intents_user_id_idx ON public.payment_intents(user_id);
CREATE INDEX payment_intents_status_created_at_idx ON public.payment_intents(status, created_at);

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_intents FROM PUBLIC, anon;
DROP POLICY IF EXISTS "payment_intents own read" ON public.payment_intents;
CREATE POLICY "payment_intents own read" ON public.payment_intents FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "payment_intents admin read" ON public.payment_intents;
CREATE POLICY "payment_intents admin read" ON public.payment_intents FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
GRANT SELECT ON public.payment_intents TO authenticated;
GRANT ALL ON public.payment_intents TO service_role;

-- ---------------------------------------------------------------------------
-- 4) create_wallet_topup_secure — menm apwòch ak create_collect_payment_secure
--    (20260731130000_moncash_collect_payments.sql) : rele APRE
--    plopProvider.initiatePayment() deja rele, jamè avan — chak apèl
--    (echwe oswa pandan) anrejistre isit la.
CREATE FUNCTION public.create_wallet_topup_secure(
  _amount numeric,
  _payment_method text,
  _external_reference text,
  _status text DEFAULT 'pending',
  _error text DEFAULT NULL,
  _provider_transaction_id text DEFAULT NULL
)
RETURNS public.payment_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payment_intents;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('pending', 'failed') THEN
    RAISE EXCEPTION 'Estati envalid';
  END IF;
  IF _payment_method NOT IN ('moncash', 'natcash') THEN
    RAISE EXCEPTION 'Metòd peman envalid';
  END IF;
  -- 20 HTG = minimòm dokimante PLOP pou Collect (docs/archive/plop/PLOP_PHASE0_AUDIT.md § 7).
  -- 100000 HTG = plafon anti-fwod rezonab pou yon sèl rechaj — pa gen
  -- egzijans espesifik nan pwomt la, chwa konsèvatif pou evite yon gwo
  -- lajan pèdi si yon bug ta pase anba radar validasyon kliyan an.
  IF _amount < 20 OR _amount > 100000 THEN
    RAISE EXCEPTION 'Montan dwe ant 20 ak 100,000 HTG';
  END IF;
  IF NOT public.check_rate_limit_secure('wallet_topup', 10, 600) THEN
    RAISE EXCEPTION 'Twòp tantativ rechaj. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  INSERT INTO public.payment_intents (
    user_id, payment_method, amount, external_reference, status, error, provider_transaction_id
  ) VALUES (
    v_user, _payment_method, _amount, _external_reference, _status, _error, _provider_transaction_id
  )
  RETURNING * INTO v_row;

  PERFORM private.log_audit_event(v_user, 'customer', 'wallet_topup.created',
    jsonb_build_object('id', v_row.id, 'amount', _amount, 'status', _status));

  IF _status = 'failed' THEN
    PERFORM private.notify_secure(
      ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'wallet_topup_admin_error', 'payment',
      'Tantativ rechaj wallet echwe',
      'Yon tantativ rechaj wallet ' || _amount || ' HTG echwe imedyatman: ' || COALESCE(_error, 'san detay') || '.',
      jsonb_build_object('intent_id', v_row.id, 'user_id', v_user)
    );
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_wallet_topup_secure(numeric, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_wallet_topup_secure(numeric, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) complete_wallet_topup_secure — service_role sèlman (webhook/rekonsilyasyon
--    cron), menm patwon idanpotan ak complete_collect_payment_secure (UPDATE
--    ... WHERE status='pending', yon replay sou yon entansyon deja deside
--    pa fè anyen 2 fwa).
CREATE FUNCTION public.complete_wallet_topup_secure(
  _external_reference text,
  _decision text,
  _provider_transaction_id text DEFAULT NULL,
  _error text DEFAULT NULL,
  _raw_payload jsonb DEFAULT NULL
)
RETURNS public.payment_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.payment_intents;
  v_wallet_id uuid;
BEGIN
  IF _decision NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'Desizyon envalid';
  END IF;

  UPDATE public.payment_intents SET
    status = _decision,
    provider_transaction_id = COALESCE(_provider_transaction_id, provider_transaction_id),
    error = _error,
    raw_payload = COALESCE(_raw_payload, raw_payload),
    confirmed_at = CASE WHEN _decision = 'succeeded' THEN now() ELSE confirmed_at END,
    updated_at = now()
  WHERE external_reference = _external_reference AND status = 'pending'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Menm rezonman ak complete_collect_payment_secure: yon referans ki pa
    -- egziste ditou se yon erè reyèl; yon referans ki deja deside se yon
    -- replay san danje (retounen menm rezilta a, pa gen 2yèm efè).
    SELECT * INTO v_row FROM public.payment_intents WHERE external_reference = _external_reference;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Pa gen entansyon peman pou referans sa a' USING ERRCODE = 'P0002';
    END IF;
    RETURN v_row;
  END IF;

  IF _decision = 'succeeded' THEN
    -- Kreye wallet kliyan an si se premye fwa (menm patwon "lazy create"
    -- ak wallet restoran/livrè yo nan private.generate_commission_for_order).
    INSERT INTO public.wallets (user_id, available_balance, lifetime_earnings)
    VALUES (v_row.user_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_row.user_id FOR UPDATE;

    UPDATE public.wallets
       SET available_balance = available_balance + v_row.amount,
           updated_at = now()
     WHERE id = v_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id, type, available_delta, note, idempotency_key
    ) VALUES (
      v_wallet_id, 'topup_credit', v_row.amount,
      'Rechaj ' || v_row.payment_method || ' — ' || v_row.external_reference,
      'topup:' || v_row.id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    PERFORM private.log_audit_event(NULL, 'system', 'wallet_topup.succeeded',
      jsonb_build_object('intent_id', v_row.id, 'user_id', v_row.user_id, 'amount', v_row.amount));

    PERFORM private.notify_secure(
      ARRAY[v_row.user_id],
      'wallet_topup_succeeded', 'payment', 'Wallet ou rechaje',
      'Ou rechaje wallet ou ak ' || v_row.amount || ' HTG.',
      jsonb_build_object('intent_id', v_row.id)
    );
  ELSE
    PERFORM private.log_audit_event(NULL, 'system', 'wallet_topup.failed',
      jsonb_build_object('intent_id', v_row.id, 'user_id', v_row.user_id, 'amount', v_row.amount));
    PERFORM private.notify_secure(
      ARRAY[v_row.user_id],
      'wallet_topup_failed', 'payment', 'Rechaj wallet echwe',
      'Rechaj ' || v_row.amount || ' HTG ou a echwe: ' || COALESCE(_error, 'san detay') || '.',
      jsonb_build_object('intent_id', v_row.id)
    );
  END IF;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_wallet_topup_secure(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_wallet_topup_secure(text, text, text, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) expire_stale_wallet_topups_secure — cron-callable (service_role),
--    menm lespri ak reconciliation PLOP ki egziste deja a pou payment_transactions.
CREATE FUNCTION public.expire_stale_wallet_topups_secure(_older_than_minutes int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.payment_intents
     SET status = 'expired', updated_at = now()
   WHERE status = 'pending'
     AND created_at < now() - make_interval(mins => _older_than_minutes);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_stale_wallet_topups_secure(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_wallet_topups_secure(int) TO service_role;

-- ---------------------------------------------------------------------------
-- 7) get_my_customer_wallet_secure — lekti sèlman, retounen yon ranje
--    "zewo" sentetik si kliyan an poko janm rechaje (pa gen bezwen kreye
--    yon ranje `wallets` sèlman paske yon moun gade paj la).
CREATE FUNCTION public.get_my_customer_wallet_secure()
RETURNS TABLE (available_balance numeric, lifetime_earnings numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(w.available_balance, 0), COALESCE(w.lifetime_earnings, 0)
  FROM (SELECT 1) AS dummy
  LEFT JOIN public.wallets w ON w.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_customer_wallet_secure() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_customer_wallet_secure() TO authenticated;

-- ---------------------------------------------------------------------------
-- 8) get_my_customer_wallet_history_secure — istorik paginable, filtre
--    opsyonèl pa peryòd (Tach 1D).
CREATE FUNCTION public.get_my_customer_wallet_history_secure(
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid, type text, available_delta numeric, note text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT wt.id, wt.type, wt.available_delta, wt.note, wt.created_at
  FROM public.wallet_transactions wt
  JOIN public.wallets w ON w.id = wt.wallet_id
  WHERE w.user_id = auth.uid()
    AND (_from IS NULL OR wt.created_at >= _from)
    AND (_to IS NULL OR wt.created_at <= _to)
  ORDER BY wt.created_at DESC
  LIMIT _limit OFFSET _offset;
$$;
REVOKE ALL ON FUNCTION public.get_my_customer_wallet_history_secure(int, int, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_customer_wallet_history_secure(int, int, timestamptz, timestamptz) TO authenticated;

COMMIT;
