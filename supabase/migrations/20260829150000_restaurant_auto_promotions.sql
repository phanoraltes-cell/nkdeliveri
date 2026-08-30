-- PROMPT MODIFIKASYON (10 TACH) — Tach 3: pwomosyon restoran aplike
-- OTOMATIKMAN (meni antye oswa plat espesifik), san kliyan pa antre okenn
-- kòd.
--
-- ETANN `public.promotions` (deja egziste, 20260704120000/120500) — pa
-- kreye yon nouvo tab. Tab la se te DEJA yon zouti anons/push
-- notifikasyon pa restoran (`code` la pa t janm aplike okenn kote nan
-- kalkil pri a, konfime pa grep). Tach sa a ajoute mekanis APLIKASYON an,
-- san touche mekanis anons/push ki deja mache.
--
-- SEKIRITE FINANSYE (backfill) — pi enpòtan pase Tach 1/2: `promotions` ka
-- DEJA gen ranje AKTIF nan pwodiksyon, kreye pa restoran ki t ap panse yo
-- se sèlman yon bannyè maketing (jan sa te toujou fonksyone jiska
-- kounye a). Si migrasyon sa a te fè yo aplike otomatikman san avètisman,
-- CHAK kòmand k ap rive apre ta ka jwenn yon rabè restoran an pa janm
-- planifye — yon pèt lajan reyèl san konsantman. Poutèt sa: `auto_apply`
-- kolòn nouvo a se `DEFAULT false`, AUKENN backfill sou `true` (kontrè ak
-- Tach 1 kote backfill la te al nan direksyon "kenbe konpòtman aktyèl la"
-- — isit la, direksyon SAN DANJE a se rete `false`, paske ALimen yon rabè
-- se aksyon ki gen risk finansye a, pa etenn li). Okenn pwomosyon egzistan
-- pa janm aplike yon santim jiskaske restoran an (oswa admin) retounen
-- eksplisitman epi aktive "Aplike otomatikman nan pri a" nan fòm lan.
--
-- Wrapped BEGIN...COMMIT (A11 — Altes aplike fichye sa a manyèlman nan SQL
-- Editor Supabase, mwen (AI) pa janm egzekite l).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) promotions.scope / dish_ids / auto_apply.
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'menu' CHECK (scope IN ('menu', 'dish')),
  ADD COLUMN IF NOT EXISTS dish_ids uuid[],
  ADD COLUMN IF NOT EXISTS auto_apply boolean NOT NULL DEFAULT false;

-- Yon pwomosyon "dish" dwe site omwen yon plat — men yon pwomosyon "menu"
-- pa bezwen dish_ids ditou. Sa a pa afekte AUKENN ranje egzistan (yo tout
-- scope='menu' apre backfill default la, donk kondisyon OR a toujou vre).
-- DROP+ADD (pa "ADD CONSTRAINT IF NOT EXISTS" — sentaks sa a PA egziste
-- nan PostgreSQL, kontrèman ak "DROP CONSTRAINT IF EXISTS") pou fichye sa
-- a ka rete san danje si li ta re-aplike sou yon baz kote li te deja
-- pasyèlman aplike.
ALTER TABLE public.promotions DROP CONSTRAINT IF EXISTS promotions_dish_scope_check;
ALTER TABLE public.promotions
  ADD CONSTRAINT promotions_dish_scope_check
  CHECK (scope = 'menu' OR (dish_ids IS NOT NULL AND array_length(dish_ids, 1) > 0));

-- ---------------------------------------------------------------------------
-- 2) orders.promotion_id / promotion_discount_amount — SEPARE de
--    orders.promo_code/discount_amount (Tach 2, kòd kliyan antre alamen).
--    De mekanis yo koekziste nan menm kòmand lan (wè kalkil §4 pi ba) —
--    kenbe kolòn separe pou admin/sipò ka wè de kontribisyon yo apa.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS promotion_id uuid REFERENCES public.promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promotion_discount_amount numeric(10,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3) compute_restaurant_promotion_discount — menm pozisyon/konvansyon ak
--    `is_restaurant_open()`: yon SÈL fonksyon `public`, SECURITY DEFINER,
--    STABLE, itilize KÒM APESI dirèkteman pa checkout.tsx (kliyan wè rabè
--    a san okenn aksyon) EPI rele ANDEDAN `create_order_secure` (§4) pou
--    verite final la — yon sèl kote lojik la ekri, jamè de vèsyon ki ka
--    dezakò.
--
--    Si plizyè pwomosyon aktif matche (2 pwomosyon "menu" anmenm tan,
--    egzanp), SÈLMAN pi gwo rabè a chwazi — jamè yo pa "anpile" ansanm.
--    Sa anpeche yon restoran (volontèman oswa pa erè) kreye plizyè
--    pwomosyon ki, konbine, ta bay yon rabè absurd (menm 100%+).
CREATE OR REPLACE FUNCTION public.compute_restaurant_promotion_discount(_restaurant_id uuid, _items jsonb)
RETURNS TABLE (promotion_id uuid, title text, discount_amount numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo record;
  v_item jsonb;
  v_product_price numeric(10,2);
  v_qty int;
  v_eligible_subtotal numeric(10,2);
  v_candidate numeric(10,2);
  v_best_id uuid;
  v_best_title text;
  v_best_amount numeric(10,2) := 0;
BEGIN
  FOR v_promo IN
    SELECT * FROM public.promotions p
    WHERE p.restaurant_id = _restaurant_id
      AND p.active = true
      AND p.auto_apply = true
      AND (p.starts_at IS NULL OR p.starts_at <= now())
      AND (p.ends_at IS NULL OR p.ends_at >= now())
  LOOP
    v_eligible_subtotal := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
      IF v_promo.scope = 'dish' AND NOT ((v_item->>'product_id')::uuid = ANY(v_promo.dish_ids)) THEN
        CONTINUE;
      END IF;
      SELECT price INTO v_product_price FROM public.products WHERE id = (v_item->>'product_id')::uuid;
      IF NOT FOUND THEN CONTINUE; END IF;
      v_qty := COALESCE((v_item->>'quantity')::int, 0);
      v_eligible_subtotal := v_eligible_subtotal + (v_product_price * v_qty);
    END LOOP;

    IF v_eligible_subtotal <= 0 THEN CONTINUE; END IF;

    v_candidate := CASE
      WHEN v_promo.discount_type = 'percentage' THEN round(v_eligible_subtotal * v_promo.discount_value / 100, 2)
      ELSE LEAST(v_promo.discount_value, v_eligible_subtotal)
    END;

    IF v_candidate > v_best_amount THEN
      v_best_amount := v_candidate;
      v_best_id := v_promo.id;
      v_best_title := v_promo.title;
    END IF;
  END LOOP;

  IF v_best_id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT v_best_id, v_best_title, v_best_amount;
END;
$$;
REVOKE ALL ON FUNCTION public.compute_restaurant_promotion_discount(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_restaurant_promotion_discount(uuid, jsonb) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) create_order_secure — CREATE OR REPLACE sèlman (menm siyati ak apre
--    Tach 2 — pwomosyon restoran an OTOMATIK, pa gen okenn nouvo paramèt
--    kliyan bezwen voye). Lòd kalkil la, jan Altes presize l:
--      sou-total → rabè PWOMOSYON RESTORAN → rabè KÒD PWOMO → frè
--      livrezon → total. Chak etap aplike sou REZILTA etap anvan an (rabè
--      an SEKANS, pa toude kalkile sou menm sou-total orijinal la).
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

  v_payment_status := CASE WHEN _method IN ('moncash', 'natcash') THEN 'awaiting_proof'::public.payment_status
                           ELSE 'pending'::public.payment_status END;
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

  RETURN v_order_id;
END;
$$;
-- No REVOKE/GRANT here — menm siyati ak apre Tach 2, grants inchanje.

-- ---------------------------------------------------------------------------
-- 5) create_promotion_secure / update_promotion_secure — DROP+CREATE paske
--    siyati a chanje (3 nouvo paramèt trailing: _scope, _dish_ids,
--    _auto_apply), swiv menm konvansyon ak §4 pi ba nan migrasyon Tach 2.
--    delete_promotion_secure pa touche (siyati inchanje).
DROP FUNCTION IF EXISTS public.create_promotion_secure(uuid, text, text, text, numeric, text, timestamptz, timestamptz);
CREATE FUNCTION public.create_promotion_secure(
  _restaurant_id uuid, _title text, _description text, _discount_type text,
  _discount_value numeric, _code text, _starts_at timestamptz, _ends_at timestamptz,
  _scope text DEFAULT 'menu', _dish_ids uuid[] DEFAULT NULL, _auto_apply boolean DEFAULT false
)
RETURNS public.promotions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.promotions;
  v_restaurant_name text;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR length(btrim(_title)) = 0 THEN
    RAISE EXCEPTION 'Promotion title is required';
  END IF;
  IF _discount_type NOT IN ('percentage', 'fixed') THEN
    RAISE EXCEPTION 'Invalid discount type';
  END IF;
  IF _discount_value IS NULL OR _discount_value <= 0 THEN
    RAISE EXCEPTION 'Discount value must be greater than zero';
  END IF;
  IF _discount_type = 'percentage' AND _discount_value > 100 THEN
    RAISE EXCEPTION 'Percentage discount cannot exceed 100';
  END IF;
  IF _scope NOT IN ('menu', 'dish') THEN
    RAISE EXCEPTION 'Scope envalid.';
  END IF;
  IF _scope = 'dish' AND (_dish_ids IS NULL OR array_length(_dish_ids, 1) = 0) THEN
    RAISE EXCEPTION 'Chwazi omwen yon plat pou yon pwomosyon plat espesifik.';
  END IF;
  IF _scope = 'dish' AND EXISTS (
    SELECT 1 FROM unnest(_dish_ids) AS d(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = d.id AND p.restaurant_id = _restaurant_id)
  ) THEN
    RAISE EXCEPTION 'Yon oswa plizyè plat pa fè pati restoran sa a.';
  END IF;

  INSERT INTO public.promotions (
    restaurant_id, title, description, discount_type, discount_value, code, starts_at, ends_at,
    scope, dish_ids, auto_apply
  )
  VALUES (
    _restaurant_id, btrim(_title), _description, _discount_type, _discount_value, _code, _starts_at, _ends_at,
    _scope, CASE WHEN _scope = 'dish' THEN _dish_ids ELSE NULL END, COALESCE(_auto_apply, false)
  )
  RETURNING * INTO v_row;

  SELECT name INTO v_restaurant_name FROM public.restaurants WHERE id = _restaurant_id;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT f.user_id, 'new_promotion', 'Nouvo pwomosyon',
    COALESCE(v_restaurant_name, 'Yon restoran ou renmen') || ' gen yon nouvo pwomosyon: ' || btrim(_title) || '.',
    jsonb_build_object('restaurant_id', _restaurant_id, 'promotion_id', v_row.id)
  FROM public.favorites f
  WHERE f.restaurant_id = _restaurant_id;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_promotion_secure(uuid, text, text, text, numeric, text, timestamptz, timestamptz, text, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_promotion_secure(uuid, text, text, text, numeric, text, timestamptz, timestamptz, text, uuid[], boolean) TO authenticated;

DROP FUNCTION IF EXISTS public.update_promotion_secure(uuid, text, text, text, numeric, text, timestamptz, timestamptz, boolean);
CREATE FUNCTION public.update_promotion_secure(
  _promotion_id uuid, _title text, _description text, _discount_type text,
  _discount_value numeric, _code text, _starts_at timestamptz, _ends_at timestamptz, _active boolean,
  _scope text DEFAULT 'menu', _dish_ids uuid[] DEFAULT NULL, _auto_apply boolean DEFAULT false
)
RETURNS public.promotions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.promotions;
BEGIN
  SELECT * INTO v_row FROM public.promotions WHERE id = _promotion_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Promotion not found'; END IF;
  IF NOT private.is_restaurant_manager(v_row.restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _discount_type NOT IN ('percentage', 'fixed') THEN
    RAISE EXCEPTION 'Invalid discount type';
  END IF;
  IF _discount_value IS NULL OR _discount_value <= 0 THEN
    RAISE EXCEPTION 'Discount value must be greater than zero';
  END IF;
  IF _discount_type = 'percentage' AND _discount_value > 100 THEN
    RAISE EXCEPTION 'Percentage discount cannot exceed 100';
  END IF;
  IF _scope NOT IN ('menu', 'dish') THEN
    RAISE EXCEPTION 'Scope envalid.';
  END IF;
  IF _scope = 'dish' AND (_dish_ids IS NULL OR array_length(_dish_ids, 1) = 0) THEN
    RAISE EXCEPTION 'Chwazi omwen yon plat pou yon pwomosyon plat espesifik.';
  END IF;
  IF _scope = 'dish' AND EXISTS (
    SELECT 1 FROM unnest(_dish_ids) AS d(id)
    WHERE NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = d.id AND p.restaurant_id = v_row.restaurant_id)
  ) THEN
    RAISE EXCEPTION 'Yon oswa plizyè plat pa fè pati restoran sa a.';
  END IF;

  UPDATE public.promotions SET
    title = btrim(_title), description = _description, discount_type = _discount_type,
    discount_value = _discount_value, code = _code, starts_at = _starts_at, ends_at = _ends_at, active = _active,
    scope = _scope, dish_ids = CASE WHEN _scope = 'dish' THEN _dish_ids ELSE NULL END,
    auto_apply = COALESCE(_auto_apply, false)
  WHERE id = _promotion_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_promotion_secure(uuid, text, text, text, numeric, text, timestamptz, timestamptz, boolean, text, uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_promotion_secure(uuid, text, text, text, numeric, text, timestamptz, timestamptz, boolean, text, uuid[], boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829150000', 'restaurant_auto_promotions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
