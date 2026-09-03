-- SWIT ENSIDAN 50 HTG — chemen "verifye pa yon moun" pou yon rechaj ke
-- API PLOP la PA KA konfime.
--
-- SITIYASYON REYÈL: Altes wè peman an nan pwòp dashbòd PLOP la, men
-- /api/paiement-verify pa retounen trans_status='ok' pou referans nou an
-- (li reponn 'no' oswa yon bagay ki pa dokimante). Nan ka sa a,
-- admin_recover_wallet_topup_secure REFIZE kredite — sa kòrèk: li pa
-- janm kredite san konfimasyon founisè a.
--
-- Men si nou kanpe la, lajan reyèl kliyan an rete bloke pou tout tan.
-- Donk fonksyon sa a bay yon DEZYÈM chemen, ki separe espre:
--   * admin_recover_wallet_topup_secure = PLOP konfime (otomatik, san
--     jistifikasyon, tras odit 'wallet_topup.recovered').
--   * admin_force_credit_wallet_topup_secure (isit la) = yon MOUN
--     verifye (dashbòd PLOP, SMS MonCash kliyan an, elt.), ak yon
--     JISTIFIKASYON EKRI OBLIGATWA, tras odit apa
--     ('wallet_topup.force_credited') pou yon odit finansye ka toujou
--     separe sa yon machin konfime ak sa yon moun deside.
--
-- MENM GAD DOUB-KREDI: ledger la (idempotency_key 'topup:<intent_id>',
-- endèks inik). Nou INSERT anvan; nou sèlman ogmante balans lan si
-- INSERT la reyèlman kreye yon ranje. Rele l 10 fwa = yon sèl kredi.
CREATE OR REPLACE FUNCTION public.admin_force_credit_wallet_topup_secure(
  _external_reference text,
  _justification text,
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
  v_wallet_id uuid;
  v_ledger_id uuid;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_admin_step_up_strict();

  IF _justification IS NULL OR length(btrim(_justification)) < 10 THEN
    RAISE EXCEPTION 'Jistifikasyon obligatwa (omwen 10 karaktè) — di ki jan ou verifye peman an';
  END IF;

  SELECT * INTO v_row FROM public.payment_intents
   WHERE external_reference = _external_reference
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pa gen entansyon peman pou referans sa a' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.wallets (user_id, available_balance, lifetime_earnings)
  VALUES (v_row.user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_row.user_id FOR UPDATE;

  INSERT INTO public.wallet_transactions (
    wallet_id, type, available_delta, note, idempotency_key, created_by
  ) VALUES (
    v_wallet_id, 'topup_credit', v_row.amount,
    'Kredi manyèl (verifye pa admin) — ' || v_row.external_reference || ' — ' || btrim(_justification),
    'topup:' || v_row.id,
    v_user
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    PERFORM private.log_audit_event(v_user, 'admin', 'wallet_topup.force_credit_noop',
      jsonb_build_object('intent_id', v_row.id, 'user_id', v_row.user_id, 'amount', v_row.amount,
        'reason', 'deja kredite — ledger idempotency_key egziste deja'));
    RETURN v_row;
  END IF;

  UPDATE public.wallets
     SET available_balance = available_balance + v_row.amount,
         updated_at = now()
   WHERE id = v_wallet_id;

  UPDATE public.payment_intents SET
    status = 'succeeded',
    provider_transaction_id = COALESCE(_provider_transaction_id, provider_transaction_id),
    error = NULL,
    confirmed_at = COALESCE(confirmed_at, now()),
    updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Tras odit MAKE KLÈMAN kòm yon desizyon imen, pa yon konfimasyon
  -- founisè — se distenksyon sa a ki enpòtan pou yon odit finansye.
  PERFORM private.log_audit_event(v_user, 'admin', 'wallet_topup.force_credited',
    jsonb_build_object('intent_id', v_row.id, 'user_id', v_row.user_id, 'amount', v_row.amount,
      'justification', btrim(_justification),
      'provider_transaction_id', _provider_transaction_id,
      'warning', 'kredi san konfimasyon API founisè a'));

  PERFORM private.notify_secure(
    ARRAY[v_row.user_id],
    'wallet_topup_succeeded', 'payment', 'Wallet ou rechaje',
    'Rechaj ' || v_row.amount || ' HTG ou a konfime epi ajoute nan balans ou.',
    jsonb_build_object('intent_id', v_row.id)
  );

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_force_credit_wallet_topup_secure(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_credit_wallet_topup_secure(text, text, text) TO authenticated;
