-- PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE) — Tach 1C, etap 2/2.
--
-- Ajoute wallet kòm yon metòd peman kòmand, apre 'wallet' te ajoute nan
-- ENUM payment_method nan 20260901020000 (migrasyon separe, obligatwa).
--
-- DESIZYON KONFIME PA ALTES: yon kòmand peye ak wallet KONTOUNE nèt etap
-- prèv/webhook — debi a se konfimasyon an, imedya ak sèten (li rive nan
-- MENM transaksyon SQL ak kreyasyon kòmand la, kidonk si youn echwe, toude
-- anile otomatikman pa ROLLBACK Postgres, san okenn kòd siplemantè).
--
-- Kò a idantik a dènye vèsyon k ap viv la
-- (20260829150000_restaurant_auto_promotions.sql:135-344) SÒF:
--   1) v_payment_status: 'wallet' → 'paid' dirèkteman (olye 'pending'),
--      paske pa gen anyen ki "annatant" apre yon debi wallet reyisi.
--   2) Nouvo blòk apre INSERT nan payments: debite wallet kliyan an nan
--      MENM tranzaksyon an, ak yon idempotency_key ki baze sou id kòmand
--      la — menm kòmand pa ka janm debite 2 fwa menm si fonksyon an ta
--      rele 2 fwa (pwoteje an plis pa idempotency_key kòmand la limenm,
--      deja verifye pi wo nan fonksyon an, v_was_inserted).
--   3) Balans ensifizan leve yon eksepsyon EGZATMAN kote sa ta rive —
--      Postgres anile tout tranzaksyon an otomatikman (kòmand, order_items,
--      dekont estòk, everything), respekte egzijans "si youn echwe, toude
--      anile" san lojik siplemantè.
--
-- Okenn chanjman nan lòd kalkil la (pri pla → pwomosyon → kòd promo → frè
-- livrezon → total) — sa rete idantik, wallet la sèlman deside KIJAN
-- v_total la peye, pa CHANJE valè li.
CREATE OR REPLACE FUNCTION private.create_order_secure(
  _restaurant_id uuid,
  _items jsonb,
  _delivery_address text,
  _contact_phone text,
  _delivery_notes text,
  _method public.payment_method,
  _wants_location_sharing boolean DEFAULT false,
  _idempotency_key uuid DEFAULT NULL,
  _promo_code text DEFAULT NULL
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

  -- Nouvo blòk (Tach 3): pwomosyon restoran, OTOMATIK — pa gen okenn
  -- paramèt kliyan, menm fonksyon egzat ak apesi checkout.tsx la (§3).
  SELECT * INTO v_restaurant_promo
    FROM public.compute_restaurant_promotion_discount(_restaurant_id, _items);
  IF v_restaurant_promo.promotion_id IS NOT NULL THEN
    v_promotion_id := v_restaurant_promo.promotion_id;
    v_promotion_discount_amount := v_restaurant_promo.discount_amount;
  END IF;
  v_subtotal_after_promotion := v_subtotal - v_promotion_discount_amount;

  -- Kòd pwomo (Tach 2) — aplike sou REZILTA APRE pwomosyon restoran an
  -- (lòd kalkil egzat Altes mande), pa sou v_subtotal orijinal la.
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

  -- TACH 1C — 'wallet' peye imedyatman (debi = konfimasyon), 'moncash'/
  -- 'natcash' rete 'awaiting_proof', tout lòt rete 'pending'.
  v_payment_status := CASE
    WHEN _method = 'wallet' THEN 'paid'::public.payment_status
    WHEN _method IN ('moncash', 'natcash') THEN 'awaiting_proof'::public.payment_status
    ELSE 'pending'::public.payment_status
  END;
  v_cash_status := CASE WHEN _method = 'kach' THEN 'pending'::public.cash_confirmation_status ELSE NULL END;

  IF _method IN ('moncash', 'natcash') THEN
    SELECT moncash_number, moncash_account_name, natcash_number, natcash_account_name
      INTO v_platform FROM public.platform_payout_settings WHERE id = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Platform payout settings not configured';
    END IF;
    IF _method = 'moncash' THEN
      v_receiver_number := v_platform.moncash_number;
      v_receiver_account := v_platform.moncash_account_name;
    ELSE
      v_receiver_number := v_platform.natcash_number;
      v_receiver_account := v_platform.natcash_account_name;
    END IF;
  END IF;

  INSERT INTO public.payments (order_id, method, status, amount, currency,
    receiver_type, receiver_restaurant_id, receiver_number, receiver_account_name, cash_confirmation_status)
  VALUES (v_order_id, _method, v_payment_status, v_total, 'HTG',
    'admin', NULL, v_receiver_number, v_receiver_account, v_cash_status);

  -- TACH 1C — debi wallet la, MENM tranzaksyon an ak kreyasyon kòmand la.
  -- Yon eksepsyon isit la anile TOUT bagay pi wo a (kòmand, order_items,
  -- dekont estòk) — Postgres ROLLBACK otomatik, san lojik anile
  -- siplemantè.
  IF _method = 'wallet' THEN
    SELECT id, available_balance INTO v_wallet_id, v_wallet_balance
      FROM public.wallets WHERE user_id = v_user FOR UPDATE;
    IF NOT FOUND OR v_wallet_balance < v_total THEN
      RAISE EXCEPTION 'Balans wallet ou pa ase pou peye kòmand sa a. Rechaje wallet ou anvan.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.wallets
       SET available_balance = available_balance - v_total, updated_at = now()
     WHERE id = v_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id, type, available_delta, note, idempotency_key
    ) VALUES (
      v_wallet_id, 'order_payment_debit', -v_total,
      'Peman kòmand ' || v_order_number,
      'order_payment:' || v_order_id
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    PERFORM private.log_audit_event(v_user, 'customer', 'wallet.order_payment_debit',
      jsonb_build_object('order_id', v_order_id, 'amount', v_total));
  END IF;

  RETURN v_order_id;
END;
$$;
-- No REVOKE/GRANT here — menm siyati, grants inchanje.
