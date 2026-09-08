-- ===========================================================================
-- TACH 1 — LOJIK WALLET OTOMATIK (desizyon an fèt SOU SÈVÈ A)
-- ===========================================================================
-- Anvan migrasyon sa a, se KLIYAN an ki te di `_method = 'wallet'`. Sèvè a
-- te verifye l (balans, posesyon, self-ordering), men li pa t janm DESIDE
-- l. Kounye a se sèvè a ki deside:
--
--   Si balans lan ase pou TOTAL LA REKALKILE SOU SÈVÈ A, se wallet ki peye,
--   kèlkeswa metòd ki nan rekèt la.
--
-- Sèl bagay kliyan an gen dwa eksprime se yon booleyen `_allow_wallet`
-- (bouton "Peye ak yon lòt metòd" la). Trikaj sou li PA bay anyen: mete l
-- `false` kite w ak yon kòmand ki PA peye (`payment_status = 'pending'` /
-- `'awaiting_proof'`), egzakteman menm jan ak yon kliyan ki chwazi kach
-- onètman. Pa gen okenn chemen kote valè chanje men san yon debi reyèl.
--
-- Sa ki PA nan tach sa a (eksplisitman): peman melanje (yon pati wallet +
-- yon pati lòt metòd). Se tout, oswa anyen.
--
-- ---------------------------------------------------------------------------
-- DANJE SIYATI (règ pwojè a): ajoute yon paramèt — menm yon paramèt final
-- ak DEFAULT — kreye yon NOUVO surcharge; `CREATE OR REPLACE` pa ta ranplase
-- ansyen an, li ta kite de vèsyon k ap viv ansanm. Se poutèt sa nou fè
-- DROP EKSPLISIT sou ansyen siyati 10-agiman an ANVAN nou kreye nouvo a,
-- epi nou re-emèt tout REVOKE/GRANT yo sou nouvo siyati a.
--
-- IDANPOTAN: nou DROP toude siyati yo (10 ak 11 agiman), donk migrasyon
-- sa a ka re-kouri san erè 42723.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) Yon switch admin pou wallet la.
--
-- POUKISA: jiskaprezan `wallet` se te SÈL metòd peman ki pa t nan
-- `payment_provider_settings` — pa gen okenn fason pou yon admin etenn li.
-- Sa te tolerab pandan kliyan an te oblije chwazi l li menm. Kounye a
-- wallet la debite OTOMATIKMAN, donk yon bug nan wallet la ta touche chak
-- kòmand san okenn moun pa ka rete l. Ranje sa a se frennen an.
--
-- `enabled = false` vle di: pa gen okenn oto-seleksyon, epi yon apèl
-- eksplisit `_method = 'wallet'` refize ak yon mesaj klè.
INSERT INTO public.payment_provider_settings (provider, visible, enabled, default_provider, maintenance_message)
SELECT 'wallet', true, true, false, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_provider_settings WHERE provider = 'wallet'
);

-- ---------------------------------------------------------------------------
-- 2) private.create_order_secure — nouvo paramèt final `_allow_wallet`.
--
-- Kò a se vèsyon 20260901090000 la EGZAKTEMAN, ak twa chanjman:
--   a) Yon blòk "DEZISYON PEMAN" ki kouri APRE `v_total` fin kalkile epi
--      AVAN estati peman an chwazi. Se li ki mete `v_effective_method`.
--   b) Tout sa ki te li `_method` apre pwen sa a li `v_effective_method`
--      kounye a — estati peman an, chèch `platform_payout_settings` la,
--      blòk debi wallet la, ak kolòn `payments.method` la.
--   c) Rezolisyon wallet la (posesyon + blokaj self-ordering) separe de
--      DESIZYON an: nou rezoud wallet la pou n konnen balans lan, epi se
--      apre nou deside si n ap sèvi avè l.
DROP FUNCTION IF EXISTS private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid);
DROP FUNCTION IF EXISTS private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid, boolean);

CREATE FUNCTION private.create_order_secure(
  _restaurant_id uuid,
  _items jsonb,
  _delivery_address text,
  _contact_phone text,
  _delivery_notes text,
  _method public.payment_method,
  _wants_location_sharing boolean DEFAULT false,
  _idempotency_key uuid DEFAULT NULL,
  _promo_code text DEFAULT NULL,
  _wallet_id uuid DEFAULT NULL,
  _allow_wallet boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order_id uuid;
  v_was_inserted boolean;
  v_order_number text;
  v_subtotal numeric(10,2) := 0;
  v_delivery_fee numeric(10,2) := 0;
  v_service_fee numeric(10,2) := 0;
  v_promotion_id uuid := NULL;
  v_promotion_discount_amount numeric(10,2) := 0;
  v_subtotal_after_promotion numeric(10,2) := 0;
  v_discount_amount numeric(10,2) := 0;
  v_applied_promo_code text := NULL;
  v_total numeric(10,2) := 0;
  v_restaurant record;
  v_platform record;
  v_restaurant_promo record;
  v_promo record;
  v_item jsonb;
  v_product record;
  v_qty int;
  v_line_total numeric(10,2);
  v_payment_status public.payment_status;
  v_cash_status public.cash_confirmation_status;
  v_receiver_number text;
  v_receiver_account text;
  v_wallet_id uuid;
  v_wallet_balance numeric(12,2);
  v_wallet public.wallets;
  v_wallet_owner uuid;
  v_order_restaurant_owner uuid;
  -- TACH 1
  v_effective_method public.payment_method;
  v_client_wants_wallet boolean;
  v_wallet_enabled boolean;
  v_wallet_blocked boolean := false;
  v_wallet_usable boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.check_rate_limit_secure('create_order', 8, 600) THEN
    RAISE EXCEPTION 'Twòp kòmand nan yon ti tan. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  IF _idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'Order must have at least one item';
  END IF;
  IF _delivery_address IS NULL OR length(btrim(_delivery_address)) = 0 THEN
    RAISE EXCEPTION 'Adrès livrezon nesesè pou n ka livre kòmand ou a.';
  END IF;
  IF _contact_phone IS NULL OR length(btrim(_contact_phone)) = 0 THEN
    RAISE EXCEPTION 'Nimewo telefòn ou nesesè pou n ka livre kòmand ou a.';
  END IF;

  SELECT id, name, status INTO v_restaurant
    FROM public.restaurants WHERE id = _restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  IF v_restaurant.status <> 'approved' THEN RAISE EXCEPTION 'Restoran an pa disponib kounye a.'; END IF;
  IF NOT public.is_restaurant_open(_restaurant_id, now()) THEN
    RAISE EXCEPTION 'Restoran an fèmen kounye a. Tanpri eseye pita.';
  END IF;

  SELECT fee_htg INTO v_delivery_fee
    FROM public.platform_delivery_zones WHERE is_default = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Konfigirasyon pri livrezon an pa jwenn — kontakte sipò.';
  END IF;

  v_order_number := 'NK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO public.orders (
    order_number, customer_id, restaurant_id, delivery_address, delivery_notes, contact_phone,
    subtotal, delivery_fee, service_fee, total, currency, status, wants_location_sharing, idempotency_key
  ) VALUES (
    v_order_number, v_user, _restaurant_id, _delivery_address, NULLIF(btrim(_delivery_notes), ''), _contact_phone,
    0, v_delivery_fee, 0, 0, 'HTG', 'pending', COALESCE(_wants_location_sharing, false), _idempotency_key
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = orders.updated_at
  RETURNING id, (xmax = 0) INTO v_order_id, v_was_inserted;

  IF NOT v_was_inserted THEN
    RETURN v_order_id;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
    SELECT id, name, price, restaurant_id, available, expires_at INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF v_product.restaurant_id <> _restaurant_id THEN
      RAISE EXCEPTION 'Product does not belong to this restaurant';
    END IF;
    IF NOT v_product.available THEN
      RAISE EXCEPTION 'Plat "%" pa disponib ankò. Tanpri retire l nan panye a.', v_product.name;
    END IF;
    IF v_product.expires_at IS NOT NULL AND v_product.expires_at <= now() THEN
      RAISE EXCEPTION 'Plat "%" pa disponib ankò (li ekspire). Tanpri retire l nan panye a.', v_product.name;
    END IF;

    UPDATE public.products
    SET stock_quantity = stock_quantity - v_qty
    WHERE id = v_product.id
      AND (stock_quantity IS NULL OR stock_quantity >= v_qty);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pa gen ase estòk pou "%" kounye a.', v_product.name;
    END IF;

    v_line_total := v_product.price * v_qty;
    v_subtotal := v_subtotal + v_line_total;

    INSERT INTO public.order_items (order_id, product_id, product_name, unit_price, quantity, line_total, notes)
    VALUES (v_order_id, v_product.id, v_product.name, v_product.price, v_qty, v_line_total,
            NULLIF(btrim(v_item->>'notes'), ''));
  END LOOP;

  -- Pwomosyon restoran, OTOMATIK (Tach 3) — inchanje.
  SELECT * INTO v_restaurant_promo
    FROM public.compute_restaurant_promotion_discount(_restaurant_id, _items);
  IF v_restaurant_promo.promotion_id IS NOT NULL THEN
    v_promotion_id := v_restaurant_promo.promotion_id;
    v_promotion_discount_amount := v_restaurant_promo.discount_amount;
  END IF;
  v_subtotal_after_promotion := v_subtotal - v_promotion_discount_amount;

  -- Kòd pwomo (Tach 2) — inchanje.
  IF _promo_code IS NOT NULL AND btrim(_promo_code) <> '' THEN
    SELECT * INTO v_promo FROM public.promo_codes
      WHERE upper(code) = upper(btrim(_promo_code))
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Kòd pwomo "%" pa egziste.', btrim(_promo_code);
    END IF;
    IF NOT v_promo.active THEN
      RAISE EXCEPTION 'Kòd pwomo sa a pa aktif ankò.';
    END IF;
    IF v_promo.starts_at IS NOT NULL AND v_promo.starts_at > now() THEN
      RAISE EXCEPTION 'Kòd pwomo sa a poko aktif.';
    END IF;
    IF v_promo.ends_at IS NOT NULL AND v_promo.ends_at < now() THEN
      RAISE EXCEPTION 'Kòd pwomo sa a ekspire.';
    END IF;
    IF v_promo.max_uses IS NOT NULL AND v_promo.uses_count >= v_promo.max_uses THEN
      RAISE EXCEPTION 'Kòd pwomo sa a fin itilize.';
    END IF;
    IF v_promo.min_order_amount IS NOT NULL AND v_subtotal_after_promotion < v_promo.min_order_amount THEN
      RAISE EXCEPTION 'Kòmand minimòm pou kòd sa a se % HTG.', v_promo.min_order_amount;
    END IF;

    v_discount_amount := CASE
      WHEN v_promo.discount_type = 'percentage' THEN round(v_subtotal_after_promotion * v_promo.discount_value / 100, 2)
      ELSE v_promo.discount_value
    END;
    v_discount_amount := LEAST(v_discount_amount, v_subtotal_after_promotion);
    v_applied_promo_code := v_promo.code;

    UPDATE public.promo_codes SET uses_count = uses_count + 1, updated_at = now() WHERE id = v_promo.id;
  END IF;

  v_total := v_subtotal_after_promotion - v_discount_amount + v_delivery_fee + v_service_fee;
  UPDATE public.orders SET
    subtotal = v_subtotal,
    service_fee = v_service_fee,
    promotion_id = v_promotion_id,
    promotion_discount_amount = v_promotion_discount_amount,
    discount_amount = v_discount_amount,
    promo_code = v_applied_promo_code,
    total = v_total
    WHERE id = v_order_id;

  -- =========================================================================
  -- TACH 1 — DEZISYON PEMAN AN. Se ISIT LA, ak `v_total` sèvè a fèk
  -- rekalkile a, jamè ak yon montan ki soti nan navigatè a.
  -- =========================================================================
  v_client_wants_wallet := (_method = 'wallet');
  v_effective_method := _method;

  -- Switch admin an (etap 1 pi wo). Si ranje a pa la (yon baz done ki poko
  -- resevwa migrasyon sa a nan yon anviwònman tès), nou pran `true` — sa
  -- kenbe konpòtman ki egziste deja a, li pa envante yon blokaj.
  SELECT enabled INTO v_wallet_enabled
    FROM public.payment_provider_settings WHERE provider = 'wallet';
  v_wallet_enabled := COALESCE(v_wallet_enabled, true);

  -- Rezoud wallet SIB la — sèlman si li ka sèvi a yon bagay. Si kliyan an
  -- eksplisitman refize wallet EPI li pa mande wallet, nou pa menm pran
  -- vewou a (mwens kontansyon sou ranje wallet la pou kòmand kach).
  IF COALESCE(_allow_wallet, true) OR v_client_wants_wallet THEN
    IF _wallet_id IS NOT NULL THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = _wallet_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet pa jwenn' USING ERRCODE = '42501';
      END IF;

      -- Posesyon: yon `_wallet_id` ki pa pou ou se yon siyal trikaj, li
      -- toujou yon erè — menm si nou t ap ka tonbe sou yon lòt metòd.
      IF v_wallet.user_id IS NOT NULL THEN
        IF v_wallet.user_id <> v_user THEN
          RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
        END IF;
      ELSIF v_wallet.restaurant_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.restaurants WHERE id = v_wallet.restaurant_id AND owner_id = v_user
        ) THEN
          RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
        END IF;
        -- DEZISYON self-ordering (wè memwa pwojè a): yon wallet restoran
        -- pa ka peye yon kòmand nan yon restoran ki gen menm owner_id.
        -- Isit la se yon DRAPO, pa yon eksepsyon: an mòd otomatik nou
        -- senpleman pa sèvi ak wallet la. Li vin yon eksepsyon pi ba
        -- SÈLMAN si kliyan an te mande wallet eksplisitman.
        SELECT owner_id INTO v_wallet_owner FROM public.restaurants WHERE id = v_wallet.restaurant_id;
        SELECT owner_id INTO v_order_restaurant_owner FROM public.restaurants WHERE id = _restaurant_id;
        v_wallet_blocked := (v_wallet_owner IS NOT NULL AND v_wallet_owner = v_order_restaurant_owner);
      ELSIF v_wallet.driver_id IS NOT NULL THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.drivers WHERE id = v_wallet.driver_id AND user_id = v_user
        ) THEN
          RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
        END IF;
      ELSE
        RAISE EXCEPTION 'Wallet envalid';
      END IF;

      v_wallet_id := v_wallet.id;
      v_wallet_balance := v_wallet.available_balance;
    ELSE
      -- Defo — wallet kliyan pwòp li. `NOT FOUND` isit la vle di kliyan an
      -- pa gen wallet ditou: v_wallet_id rete NULL, ka 3 nan espesifikasyon
      -- an (liy wallet la pa parèt menm).
      SELECT id, available_balance INTO v_wallet_id, v_wallet_balance
        FROM public.wallets WHERE user_id = v_user FOR UPDATE;
    END IF;
  END IF;

  v_wallet_usable := v_wallet_enabled
    AND v_wallet_id IS NOT NULL
    AND NOT v_wallet_blocked
    AND COALESCE(v_wallet_balance, 0) >= v_total;

  -- Refi PWÒP lè kliyan an mande wallet men li pa ka sèvi. Yon eksepsyon
  -- isit la anile TOUT bagay pi wo a (kòmand, order_items, dekont estòk,
  -- konte kòd pwomo) — ROLLBACK Postgres, san okenn lojik anile. Kòmand la
  -- pa janm egziste, donk panye a rete entak nan navigatè a.
  IF v_client_wants_wallet AND NOT v_wallet_usable THEN
    IF NOT v_wallet_enabled THEN
      RAISE EXCEPTION 'Peman ak wallet pa disponib kounye a. Tanpri chwazi yon lòt metòd.' USING ERRCODE = '42501';
    ELSIF v_wallet_id IS NULL THEN
      RAISE EXCEPTION 'Ou pa gen yon wallet ki ka peye kòmand sa a.' USING ERRCODE = '42501';
    ELSIF v_wallet_blocked THEN
      RAISE EXCEPTION 'Ou pa ka peye yon kòmand nan pwòp restoran ou ak balans ou.' USING ERRCODE = '42501';
    ELSE
      RAISE EXCEPTION 'Balans wallet ou pa ase pou peye kòmand sa a. Rechaje wallet ou anvan.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- SE ISIT LA SÈVÈ A DESIDE. Si balans lan ase epi kliyan an pa t
  -- eksplisitman chwazi yon lòt metòd, se wallet, KÈLKESWA `_method` ki te
  -- nan rekèt la (yon rekèt modifye ki di 'kach' ap peye ak wallet
  -- kanmenm). Si li pa ka sèvi, nou tonbe sou metòd ki nan rekèt la epi
  -- nou bliye wallet la nèt (v_wallet_id := NULL) pou `payments.wallet_id`
  -- pa janm montre yon wallet ki pa t debite — sa ta fè
  -- update_order_status_secure ranbouse yon wallet ki pa t janm peye.
  IF v_wallet_usable AND (COALESCE(_allow_wallet, true) OR v_client_wants_wallet) THEN
    v_effective_method := 'wallet'::public.payment_method;
  ELSE
    v_wallet_id := NULL;
  END IF;

  -- TACH 1C — 'wallet' peye imedyatman (debi = konfimasyon), 'moncash'/
  -- 'natcash' rete 'awaiting_proof', tout lòt rete 'pending'.
  -- ATANSYON: `v_effective_method`, PA `_method`.
  v_payment_status := CASE
    WHEN v_effective_method = 'wallet' THEN 'paid'::public.payment_status
    WHEN v_effective_method IN ('moncash', 'natcash') THEN 'awaiting_proof'::public.payment_status
    ELSE 'pending'::public.payment_status
  END;
  v_cash_status := CASE WHEN v_effective_method = 'kach' THEN 'pending'::public.cash_confirmation_status ELSE NULL END;

  IF v_effective_method IN ('moncash', 'natcash') THEN
    SELECT moncash_number, moncash_account_name, natcash_number, natcash_account_name
      INTO v_platform FROM public.platform_payout_settings WHERE id = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Platform payout settings not configured';
    END IF;
    IF v_effective_method = 'moncash' THEN
      v_receiver_number := v_platform.moncash_number;
      v_receiver_account := v_platform.moncash_account_name;
    ELSE
      v_receiver_number := v_platform.natcash_number;
      v_receiver_account := v_platform.natcash_account_name;
    END IF;
  END IF;

  -- Debi a. Wallet la deja rezoud EPI vewouye (FOR UPDATE) pi wo a, nan
  -- MENM tranzaksyon an ak kreyasyon kòmand la — pa gen okenn fenèt kote
  -- yon dezyèm kòmand ka depanse menm balans lan.
  IF v_effective_method = 'wallet' THEN
    UPDATE public.wallets
       SET available_balance = available_balance - v_total, updated_at = now()
     WHERE id = v_wallet_id;

    -- Gad doub-debi a se endèks inik la sou idempotency_key, pa yon
    -- verifikasyon lojik: menm kòmand la = menm kle a = yon sèl ranje.
    INSERT INTO public.wallet_transactions (
      wallet_id, type, available_delta, note, idempotency_key
    ) VALUES (
      v_wallet_id, 'order_payment_debit', -v_total,
      'Peman kòmand ' || v_order_number,
      'order_payment:' || v_order_id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    PERFORM private.log_audit_event(v_user, NULL, 'wallet.order_payment_debit',
      jsonb_build_object('order_id', v_order_id, 'amount', v_total, 'wallet_id', v_wallet_id,
        -- `::text` eksprè: `to_jsonb` sou yon enum mache, men yon kas
        -- eksplisit kite tras la li menm si enum `payment_method` la ta
        -- chanje pita.
        'requested_method', _method::text, 'auto_selected', NOT v_client_wants_wallet));
  END IF;

  INSERT INTO public.payments (order_id, method, status, amount, currency,
    receiver_type, receiver_restaurant_id, receiver_number, receiver_account_name, cash_confirmation_status, wallet_id)
  VALUES (v_order_id, v_effective_method, v_payment_status, v_total, 'HTG',
    'admin', NULL, v_receiver_number, v_receiver_account, v_cash_status, v_wallet_id);

  RETURN v_order_id;
END;
$$;

-- Menm REVOKE egzat ak tout vèsyon anvan yo — okenn GRANT eksplisit apre:
-- public.create_order_secure (SECURITY DEFINER, pi ba) rele l ak privilèj
-- pwopriyetè fonksyon an, pa privilèj sesyon kliyan an.
REVOKE ALL ON FUNCTION private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) public.create_order_secure — wrapper la, menm operasyon DROP+CREATE.
-- ANON-REVOKE: create_order_secure
-- (`ALTER DEFAULT PRIVILEGES` Supabase la bay `anon` EXECUTE sou CHAK nouvo
-- fonksyon piblik. `REVOKE ... FROM PUBLIC` PA retire yon grant dirèk bay
-- `anon` — li dwe nonmen eksplisitman, jan check E nan
-- scripts/check-money-authorization.mjs egzije l.)
DROP FUNCTION IF EXISTS public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid, boolean);

CREATE FUNCTION public.create_order_secure(
  _restaurant_id uuid,
  _items jsonb,
  _delivery_address text,
  _contact_phone text,
  _delivery_notes text,
  _method public.payment_method,
  _wants_location_sharing boolean DEFAULT false,
  _idempotency_key uuid DEFAULT NULL,
  _promo_code text DEFAULT NULL,
  _wallet_id uuid DEFAULT NULL,
  _allow_wallet boolean DEFAULT true
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.create_order_secure(
    _restaurant_id, _items, _delivery_address, _contact_phone, _delivery_notes,
    _method, _wants_location_sharing, _idempotency_key, _promo_code, _wallet_id, _allow_wallet
  );
$$;
REVOKE ALL ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid, boolean) TO authenticated;
