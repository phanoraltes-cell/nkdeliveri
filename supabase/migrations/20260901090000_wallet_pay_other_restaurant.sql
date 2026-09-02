-- PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE) — Tach 3C: yon
-- restoran/livrè ka peye yon kòmand nan YON LÒT restoran ak pwòp balans
-- (disponib) wallet li a, tankou nenpòt kliyan — "depanse san retire".
--
-- DEZISYON KONFIME (BLOKE SELF-ORDERING, wè memwa pwojè a): yon wallet
-- restoran pa ka janm peye yon kòmand nan yon restoran ki gen MENM
-- owner_id ak restoran wallet la (pa sèlman menm restaurant_id egzat —
-- yon moun ki posede 2+ restoran pa ka wout balans A pou peye yon kòmand
-- nan B swa). Rezon: san blokaj sa a, yon restoran ka konvèti balans li
-- rezève pou retrè an "depans" pou pri sèlman komisyon platfòm lan,
-- evite tout limit/cooldown anti-fròd Tach 3B, epi enfle total_orders/
-- revni li — yon vrè risk kontabilite/blanchiman, pa yon detay UX.
-- Livrè pa gen menm bouk la (yo pa posede restoran), donk pa gen menm
-- blokaj pou yo — men si yon livrè ta ka livre pwòp kòmand pa li a se
-- yon kesyon SEPARE (asiyasyon livrezon, pa peman wallet), poko rezoud
-- isit la.
--
-- MEKANIS: yon itilizatè ka gen PLIZYÈ wallet li ka peye ak yo — pwòp
-- wallet kliyan li (Tach 1C), wallet nenpòt restoran li posede, wallet
-- livrè li (si li se yon livrè). get_my_payable_wallets_secure() retounen
-- yo tout ansanm ak yon drapo self_order_blocked kalkile SÈVÈ-side (pa
-- janm ekspoze okenn owner_id bay kliyan an), checkout.tsx pase
-- _wallet_id chwazi a bay create_order_secure.

-- ---------------------------------------------------------------------------
-- 1) payments.wallet_id — anrejistre EGZAKTEMAN ki wallet ki te debite,
-- pou update_order_status_secure ka ranbouse bon wallet la san li pa
-- bezwen re-devine l apati customer_id (ki toujou se moun ki te kòmande
-- a, kèlkeswa ki wallet li te itilize pou peye).
ALTER TABLE public.payments ADD COLUMN wallet_id uuid REFERENCES public.wallets(id);

-- ---------------------------------------------------------------------------
-- 2) get_my_payable_wallets_secure — tout wallet itilizatè aktyèl la ka
-- peye ak yo: wallet kliyan li (si li egziste), wallet nenpòt restoran li
-- posede (si gen youn ki deja kreye — kreyasyon paresè sou premye
-- kredi), wallet livrè li (si li se yon livrè).
CREATE FUNCTION public.get_my_payable_wallets_secure(_restaurant_id uuid DEFAULT NULL)
RETURNS TABLE (
  wallet_id uuid,
  kind text,
  label text,
  available_balance numeric,
  restaurant_id uuid,
  driver_id uuid,
  self_order_blocked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Wallet kliyan an: TOUJOU yon ranje (menm si li poko janm rechaje —
  -- LEFT JOIN sentetik, menm mekanis ak get_my_customer_wallet_secure).
  -- wallet_id rete NULL nan ka sa a, ki fè create_order_secure aji
  -- egzakteman jan l te toujou fè (defo sou wallet kliyan pwòp li).
  SELECT w.id, 'customer'::text, 'Wallet mwen'::text, COALESCE(w.available_balance, 0),
    NULL::uuid, NULL::uuid, false
  FROM (SELECT 1) AS dummy
  LEFT JOIN public.wallets w ON w.user_id = auth.uid()
  UNION ALL
  SELECT w.id, 'restaurant'::text, r.name, w.available_balance, r.id, NULL::uuid,
    (_restaurant_id IS NOT NULL
      AND r.owner_id = (SELECT r2.owner_id FROM public.restaurants r2 WHERE r2.id = _restaurant_id))
  FROM public.wallets w JOIN public.restaurants r ON r.id = w.restaurant_id
  WHERE r.owner_id = auth.uid()
  UNION ALL
  SELECT w.id, 'driver'::text, 'Wallet livrè mwen'::text, w.available_balance,
    NULL::uuid, d.id, false
  FROM public.wallets w JOIN public.drivers d ON d.id = w.driver_id
  WHERE d.user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_payable_wallets_secure(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_payable_wallets_secure(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) create_order_secure — nouvo paramèt final _wallet_id (DROP obligatwa,
-- nouvo agiman). Kò a idantik a dènye vèsyon k ap viv la
-- (20260901030000_wallet_checkout_payment.sql) SÒF blòk wallet la, ki:
--   a) Deplase PI BONÈ (anvan INSERT nan payments), pou wallet_id la ka
--      antre nan menm INSERT sa a.
--   b) Si _wallet_id bay: chèche wallet SA A pa id, verifye posesyon
--      (kliyan pwòp tèt li, OSWA pwopriyetè restoran an, OSWA livrè a),
--      epi si se yon wallet restoran, aplike blokaj self-ordering la.
--   c) Si _wallet_id NULL (defo — tout apèl Tach 1C ki egziste deja):
--      konpòtman idantik a anvan, wallet kliyan pwòp li (user_id=v_user).
DROP FUNCTION IF EXISTS private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text);

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
  _wallet_id uuid DEFAULT NULL
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

  -- TACH 3C — rezoud EPI debite wallet la ANVAN INSERT nan payments, pou
  -- wallet_id la (nouvo kolòn) ka antre nan menm INSERT sa a. Yon
  -- eksepsyon isit la anile TOUT bagay pi wo a (kòmand, order_items,
  -- dekont estòk) — Postgres ROLLBACK otomatik, san lojik anile
  -- siplemantè, egzakteman menm garanti ak vèsyon Tach 1C a.
  IF _method = 'wallet' THEN
    IF _wallet_id IS NOT NULL THEN
      SELECT * INTO v_wallet FROM public.wallets WHERE id = _wallet_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet pa jwenn' USING ERRCODE = '42501';
      END IF;

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
        SELECT owner_id INTO v_wallet_owner FROM public.restaurants WHERE id = v_wallet.restaurant_id;
        SELECT owner_id INTO v_order_restaurant_owner FROM public.restaurants WHERE id = _restaurant_id;
        IF v_wallet_owner IS NOT NULL AND v_wallet_owner = v_order_restaurant_owner THEN
          RAISE EXCEPTION 'Ou pa ka peye yon kòmand nan pwòp restoran ou ak balans ou.' USING ERRCODE = '42501';
        END IF;
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
      -- Defo — konpòtman Tach 1C egzat, wallet kliyan pwòp li.
      SELECT id, available_balance INTO v_wallet_id, v_wallet_balance
        FROM public.wallets WHERE user_id = v_user FOR UPDATE;
    END IF;

    IF v_wallet_id IS NULL OR v_wallet_balance < v_total THEN
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

    PERFORM private.log_audit_event(v_user, NULL, 'wallet.order_payment_debit',
      jsonb_build_object('order_id', v_order_id, 'amount', v_total, 'wallet_id', v_wallet_id));
  END IF;

  INSERT INTO public.payments (order_id, method, status, amount, currency,
    receiver_type, receiver_restaurant_id, receiver_number, receiver_account_name, cash_confirmation_status, wallet_id)
  VALUES (v_order_id, _method, v_payment_status, v_total, 'HTG',
    'admin', NULL, v_receiver_number, v_receiver_account, v_cash_status, v_wallet_id);

  RETURN v_order_id;
END;
$$;
-- Menm REVOKE egzat ak tout vèsyon anvan yo (20260829120000 elatriye) —
-- okenn GRANT eksplisit apre: public.create_order_secure (SECURITY
-- DEFINER, pi ba) rele l ak privilèj PWOPRIYETÈ fonksyon an, pa privilèj
-- sesyon kliyan an, donk pa gen bezwen okenn wòl ekstèn ka egzekite l
-- dirèkteman.
REVOKE ALL ON FUNCTION private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- public.create_order_secure — wrapper piblik la, menm operasyon DROP+
-- CREATE, senpleman ajoute _wallet_id epi pase l tou dwat bay
-- private.create_order_secure. checkout.tsx rele fonksyon SA A
-- (dirèkteman, pa private. la) — se poutèt sa li dwe genyen menm nouvo
-- paramèt la tou. SECURITY DEFINER (pa INVOKER) — menm jan ak vèsyon
-- 20260829120000 la egzakteman, se sa ki fè kliyan an ka rele l san li
-- pa bezwen okenn GRANT dirèk sou private.create_order_secure.
DROP FUNCTION IF EXISTS public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text);
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
  _wallet_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.create_order_secure(
    _restaurant_id, _items, _delivery_address, _contact_phone, _delivery_notes,
    _method, _wants_location_sharing, _idempotency_key, _promo_code, _wallet_id
  );
$$;
REVOKE ALL ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) update_order_status_secure — menm siyati, CREATE OR REPLACE san
-- danje. Sèl chanjman: ranbousman an li kounye a wallet_id DIREKTEMAN
-- sou ranje payments la (fyab pou nenpòt kalite wallet — kliyan, restoran,
-- livrè), ak yon fallback sou ansyen konpòtman an (user_id=customer_id)
-- pou ranje ki te kreye AVAN kolòn payments.wallet_id egziste.
CREATE OR REPLACE FUNCTION private.update_order_status_secure(_order_id uuid, _new_status public.order_status)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_old_status public.order_status;
  v_is_admin boolean;
  v_is_restaurant_owner boolean;
  v_is_assigned_driver boolean;
  v_is_customer boolean;
  v_allowed boolean := false;
  v_status_label text;
  v_wallet_payment public.payments;
  v_refund_wallet_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  v_old_status := v_order.status;

  v_is_admin := private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin');
  v_is_restaurant_owner := EXISTS (
    SELECT 1 FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id = v_user
  ) OR EXISTS (
    SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = v_order.restaurant_id AND e.user_id = v_user
  );
  v_is_assigned_driver := EXISTS (
    SELECT 1 FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
    WHERE d.order_id = v_order.id AND dr.user_id = v_user
  );
  v_is_customer := v_order.customer_id = v_user;

  IF NOT (v_is_admin OR v_is_restaurant_owner OR v_is_assigned_driver OR v_is_customer) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_is_admin THEN
    v_allowed := true;
  ELSIF v_is_customer THEN
    IF NOT public.check_rate_limit_secure('cancel_order_customer', 5, 3600) THEN
      RAISE EXCEPTION 'Twòp demann anilasyon. Tanpri eseye ankò pita.' USING ERRCODE = '42901';
    END IF;
    v_allowed := _new_status = 'cancelled' AND v_order.status IN ('pending', 'confirmed');
  ELSIF v_is_restaurant_owner THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('pending','confirmed'), ('confirmed','preparing'), ('preparing','ready'),
      ('pending','cancelled'), ('confirmed','cancelled'), ('preparing','cancelled'), ('ready','cancelled')
    );
    IF v_allowed AND v_order.status = 'pending' AND _new_status = 'confirmed' THEN
      IF EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.order_id = v_order.id
          AND p.method IN ('moncash', 'natcash')
          AND p.status <> 'paid'
          AND NOT EXISTS (SELECT 1 FROM public.payment_transactions pt WHERE pt.payment_id = p.id)
      ) THEN
        RAISE EXCEPTION 'Peman an poko verifye. Tann yon admin konfime prèv peman an anvan w konfime kòmand la.' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.order_id = v_order.id
          AND p.method IN ('moncash', 'natcash')
          AND p.status <> 'paid'
          AND EXISTS (SELECT 1 FROM public.payment_transactions pt WHERE pt.payment_id = p.id)
      ) THEN
        RAISE EXCEPTION 'Peman otomatik la poko konfime. N ap tann konfimasyon sistèm peman an anvan kòmand lan ka konfime — pa gen okenn aksyon admin ki nesesè.' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF v_is_assigned_driver THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('ready','assigned'), ('assigned','picked_up'), ('picked_up','delivered')
    );
  END IF;

  IF NOT v_allowed THEN
    IF v_is_customer THEN
      RAISE EXCEPTION 'Ou pa ka anile kòmand sa a ankò — restoran an deja kòmanse prepare l.';
    END IF;
    RAISE EXCEPTION 'Illegal status transition: % -> %', v_order.status, _new_status;
  END IF;

  UPDATE public.orders
     SET status = _new_status,
         status_history = status_history || jsonb_build_object(
           'from', v_order.status, 'to', _new_status,
           'by', v_user, 'at', now()
         ),
         updated_at = now()
   WHERE id = _order_id
   RETURNING * INTO v_order;

  IF v_is_admin THEN
    PERFORM private.log_audit_event(v_user, 'admin', 'order.status_changed_by_admin',
      jsonb_build_object(
        'order_id', v_order.id, 'order_number', v_order.order_number,
        'from', v_old_status, 'to', _new_status
      ));
  END IF;

  IF _new_status IN ('cancelled', 'refunded') AND v_old_status NOT IN ('cancelled', 'refunded', 'delivery_failed') THEN
    UPDATE public.products p
    SET stock_quantity = p.stock_quantity + oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id AND oi.product_id = p.id AND p.stock_quantity IS NOT NULL;
  END IF;

  -- TACH 1C/3C — ranbousman wallet, DELIBEREMAN san eskli 'delivery_failed'
  -- (kontrèman ak gad estòk la pi wo a): lajan an dwe retounen kèlkeswa
  -- si manje a te deja fèt, se 2 keksyon separe.
  IF _new_status IN ('cancelled', 'refunded') AND v_old_status NOT IN ('cancelled', 'refunded') THEN
    SELECT * INTO v_wallet_payment FROM public.payments
      WHERE order_id = v_order.id AND method = 'wallet' AND status = 'paid'
      FOR UPDATE;
    IF FOUND THEN
      -- TACH 3C — sèvi ak wallet_id anrejistre DIREKTEMAN sou payments la
      -- lè li egziste (kapab yon wallet restoran/livrè, pa sèlman kliyan).
      -- Fallback sou ansyen lojik la (user_id=customer_id) sèlman pou
      -- ranje ki te kreye AVAN kolòn sa a egziste (Tach 1C, jodi rive
      -- Tach 3C) — kòmand sa yo toujou te peye ak wallet KLIYAN an paske
      -- se sèl chemen ki te egziste lè yo te kreye.
      v_refund_wallet_id := v_wallet_payment.wallet_id;
      IF v_refund_wallet_id IS NULL THEN
        SELECT id INTO v_refund_wallet_id FROM public.wallets WHERE user_id = v_order.customer_id;
      END IF;

      IF v_refund_wallet_id IS NOT NULL THEN
        UPDATE public.wallets
           SET available_balance = available_balance + v_wallet_payment.amount, updated_at = now()
         WHERE id = v_refund_wallet_id;

        INSERT INTO public.wallet_transactions (
          wallet_id, type, available_delta, note, idempotency_key
        ) VALUES (
          v_refund_wallet_id, 'order_refund_credit', v_wallet_payment.amount,
          'Ranbousman kòmand ' || v_order.order_number,
          'order_refund:' || v_order.id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;

        UPDATE public.payments SET status = 'refunded', updated_at = now() WHERE id = v_wallet_payment.id;

        PERFORM private.log_audit_event(v_user,
          CASE WHEN v_is_admin THEN 'admin' WHEN v_is_restaurant_owner THEN 'restaurant'
               WHEN v_is_assigned_driver THEN 'driver' ELSE 'customer' END,
          'wallet.order_refund_credit',
          jsonb_build_object('order_id', v_order.id, 'amount', v_wallet_payment.amount, 'wallet_id', v_refund_wallet_id));
      END IF;
    END IF;
  END IF;

  IF _new_status IN ('cancelled', 'delivered') THEN
    DELETE FROM public.customer_delivery_locations
    WHERE delivery_id IN (SELECT id FROM public.deliveries WHERE order_id = v_order.id);
  END IF;

  IF v_is_customer AND _new_status = 'cancelled' THEN
    PERFORM private.log_audit_event(v_user, 'customer', 'order.cancelled_by_customer',
      jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number));
    PERFORM private.notify_secure(
      ARRAY(
        SELECT r.owner_id FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id IS NOT NULL
        UNION
        SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')
      ),
      'order_cancelled_by_customer', 'order', 'Kliyan anile yon kòmand',
      'Kliyan an anile kòmand ' || v_order.order_number || ' anvan preparasyon kòmanse.',
      jsonb_build_object('order_id', v_order.id)
    );
  ELSIF _new_status = 'cancelled' AND v_old_status = 'delivery_failed' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, data)
    VALUES (
      v_order.customer_id, 'order_status_changed', 'order', 'Kòmand ou a anile',
      'Kòmand ' || v_order.order_number || ' anile — manje a pa disponib ankò. ' ||
      CASE WHEN v_wallet_payment.id IS NOT NULL
        THEN 'Lajan an retounen nan wallet ou.'
        ELSE 'Pa gen ranbousman, jan sa te make lè n te siyale pwoblèm livrezon an.'
      END,
      jsonb_build_object('order_id', v_order.id, 'status', _new_status)
    );
  ELSIF _new_status IN ('confirmed', 'preparing', 'ready', 'cancelled') THEN
    v_status_label := CASE _new_status
      WHEN 'confirmed' THEN 'konfime'
      WHEN 'preparing' THEN 'ap prepare'
      WHEN 'ready' THEN 'prè pou livrezon'
      WHEN 'cancelled' THEN 'anile'
    END;
    INSERT INTO public.notifications (user_id, type, category, title, body, data)
    VALUES (
      v_order.customer_id, 'order_status_changed', 'order', 'Kòmand ou a ' || v_status_label,
      'Kòmand ' || v_order.order_number || ' kounye a ' || v_status_label || '.',
      jsonb_build_object('order_id', v_order.id, 'status', _new_status)
    );
  END IF;

  RETURN v_order;
END;
$function$;
