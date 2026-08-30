-- PROMPT MODIFIKASYON (10 TACH) — Tach 1: pòtay louvri/fèmen manyèl pou
-- pwopriyetè restoran an, ak ekspirasyon otomatik pla apre 24 èdtan.
--
-- Objektif A (pòtay manyèl) ETANN `is_restaurant_open()` sou plas (CREATE OR
-- REPLACE, menm siyati) olye pou kreye yon dezyèm otorite — se egzakteman
-- pwen ekstansyon ke migrasyon 20260821100000 la te anonse davans (wè
-- kòmantè §2 nan fichye sa a): "pwochen migrasyon nan chantye a ap ETANN li
-- (pa ranplase l ak yon lòt fonksyon) pou ajoute toggle manyèl". Sa vle di
-- restaurants.$slug.tsx (bannyè "fèmen" + bouton kòmand dezaktive) ak
-- private.create_order_secure (rejè sèvè) benefisye de nouvo toggle a SAN
-- okenn chanjman kod nan de fichye sa yo — yo rele is_restaurant_open() deja.
--
-- SEKIRITE PWODIKSYON (backfill vs default) — de chwa diferan eksprè:
--   • restaurants.is_open: DEFAULT false (jan demand lan mande), MEN yon
--     UPDATE backfill kouri imedyatman apre pou mete TOUT restoran ki deja
--     egziste sou true. San sa, chak restoran k ap fonksyone kounye a ta
--     vin "fèmen" nan menm segond migrasyon an aplike — yon rejè kòmand
--     mas san pesonn pa mande sa. Menm filozofi ak
--     opening_hours_grace_until (20260821100000): yon kolòn ki kontwole
--     aksè a jodi a pa ka kòmanse nan yon eta ki kraze pak aktyèl la.
--   • products.published_at: rete NULL pou tout plat ki deja egziste (AUKENN
--     backfill) — sa vle di expires_at (ekri an menm tan ak li, wè §2/§5 pi
--     ba) rete NULL tou, donk okenn plat aktyèl pa janm ekspire. Sik
--     24-èdtan an se yon OPSYON pwopriyetè a chwazi (klike "Pibliye"), pa
--     yon migrasyon k ap efase tout meni yo san avètisman 24 èdtan apre yo
--     aplike script la.
--
-- Otorizasyon RPC — swiv presedan 20260709090000 (restaurant_staff_feature):
--   • publish_product_secure / publish_all_products_secure: ekri sou
--     `products`, menm nivo ak create/update/delete_product_secure — itilize
--     `private.is_restaurant_staff_or_manager` (anplwaye Meni gen dwa
--     pibliye plat, menm jan yo gen dwa kreye/modifye/efase yo).
--   • set_restaurant_open_secure: se yon paramèt operasyonèl nivo restoran
--     (analòg ak pwofil/orè ouvèti), pa yon zouti jesyon meni — itilize
--     `private.is_restaurant_manager` (pwopriyetè/admin sèlman), menm nivo
--     ak update_restaurant_hours_secure/update_restaurant_profile_secure.
--
-- Wrapped BEGIN...COMMIT (A11 — pwopriyetè a aplike fichye sa a manyèlman
-- nan SQL Editor Supabase, mwen (AI) pa janm egzekite l).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) restaurants.is_open — pòtay manyèl + backfill (wè nòt sekirite anwo).
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS is_open boolean NOT NULL DEFAULT false;

UPDATE public.restaurants SET is_open = true WHERE is_open = false;

-- ---------------------------------------------------------------------------
-- 2) products.published_at / expires_at — ekspirasyon 24h opsyonèl, jamè
--    backfill (wè nòt sekirite anwo).
--
--    KOREKSYON (premye tantativ te echwe): expires_at te kòmanse kòm yon
--    kolòn GENERATED ALWAYS AS (published_at + interval '24 hours') STORED.
--    Postgres rejte sa ak erè 42P17 "generation expression is not
--    immutable" — operatè `timestamptz + interval` (fonksyon
--    `timestamptz_pl_interval`) make STABLE nan pg_proc, pa IMMUTABLE, paske
--    yon `interval` an jeneral ka gen jou/mwa ki depann de règ chanjman lè
--    (DST), menm si nan ka SPESIFIK nou an li se sèlman èdtan. Postgres pa
--    gade valè literal la, li gade siyati fonksyon an sèlman — donk okenn
--    kolòn GENERATED pa ka itilize operatè sa a sou yon `timestamptz`, menm
--    jan.
--
--    Solisyon: `expires_at` se yon kolòn NÒMAL (pa GENERATED), ekri
--    EKSPLISITMAN nan menm INSTRIKSYON UPDATE ak `published_at`, toulede
--    fwa, nan SÈL DE RPC ki gen dwa ekri yo (§5 pi ba,
--    publish_product_secure / publish_all_products_secure) — okenn lòt
--    chemen ekriti pa egziste pou de kolòn sa yo (menm jan
--    create/update_product_secure pa janm touche yo), donk konsistans lan
--    garanti pa disiplin "yon sèl ekriven", menm jan ak plizyè lòt chan
--    kalkile nan baz done sa a (egzanp: orders.status_history).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3) is_restaurant_open() — CREATE OR REPLACE sèlman (menm siyati, pa gen
--    DROP FUNCTION), kò a idantik a vèsyon 20260821100000 la, ajoute yon
--    sèl chèk (`is_open`) touswit apre chèk `status='approved'` la, menm
--    plas lojik ak menm estrikti "RETURN false" ke lòt chèk yo.
CREATE OR REPLACE FUNCTION public.is_restaurant_open(_restaurant_id uuid, _at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant record;
  v_local_ts timestamp;
  v_local_time time;
  v_dow int;
  v_day_keys text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
  v_today_key text;
  v_yesterday_key text;
  v_today_entry jsonb;
  v_yesterday_entry jsonb;
  v_open_t time;
  v_close_t time;
  v_is_open boolean := false;
BEGIN
  SELECT status, opening_hours, opening_hours_grace_until, is_open INTO v_restaurant
    FROM public.restaurants WHERE id = _restaurant_id;
  IF NOT FOUND OR v_restaurant.status <> 'approved' THEN
    RETURN false;
  END IF;

  -- Nouvo chèk (Tach 1, Objektif A) — pòtay manyèl pwopriyetè a. Yon
  -- restoran ki fèmen li menm rete fèmen kèlkeswa orè ouvèti li konfigire
  -- (li ka fèmen AVAN lè li ta dwe, men li pa ka FOSE louvri deyò lè li).
  IF NOT v_restaurant.is_open THEN
    RETURN false;
  END IF;

  -- Konpatibilite BÒNE: restoran ki pa konfigire okenn orè konsidere louvri
  -- SÈLMAN pandan fenèt gras li a. Tab verite egzak (`opening_hours` vle di
  -- KOALESE, '{}' oswa NULL trete menm jan):
  --
  --   opening_hours | grace_until | Rezilta
  --   --------------+-------------+---------------------------------------
  --   ranpli        | (pa gade)   | règ orè nòmal aplike (rès fonksyon an)
  --   vid           | nan fiti    | LOUVRI (fenèt gras aktif)
  --   vid           | nan pase    | FÈMEN (fenèt gras ekspire)
  --   vid           | NULL        | LOUVRI (filè sekirite) — pa ta dwe janm
  --                 |             | rive: backfill garanti chak restoran
  --                 |             | ki gen opening_hours vid jwenn yon
  --                 |             | grace_until reyèl.
  IF COALESCE(v_restaurant.opening_hours, '{}'::jsonb) = '{}'::jsonb THEN
    RETURN v_restaurant.opening_hours_grace_until IS NULL
        OR v_restaurant.opening_hours_grace_until > _at;
  END IF;

  -- Nòt: menm filozofi a aplike YON KRAN PI BA — pa nivo objè a antye,
  -- men pa nivo CHAK JOU. Yon jou espesifik ki ABSAN nan opening_hours
  -- (diferan de {"closed":true} eksplisit pou jou sa a) trete tou kòm
  -- "louvri" — wè Ka A pi ba a pou rezònman konplè.
  v_local_ts := _at AT TIME ZONE 'America/Port-au-Prince';
  v_local_time := v_local_ts::time;
  v_dow := EXTRACT(DOW FROM v_local_ts)::int;
  v_today_key := v_day_keys[v_dow + 1];
  v_yesterday_key := v_day_keys[((v_dow + 6) % 7) + 1];

  v_today_entry := v_restaurant.opening_hours -> v_today_key;
  v_yesterday_entry := v_restaurant.opening_hours -> v_yesterday_key;

  -- Ka A: sèvis jodi a — swa yon sèvis nòmal (menm jou a), swa kòmansman
  -- yon sèvis ki pral travèse minwi.
  IF v_today_entry IS NULL THEN
    v_is_open := true;
  ELSIF NOT COALESCE((v_today_entry ->> 'closed')::boolean, true) THEN
    v_open_t := NULLIF(v_today_entry ->> 'open', '')::time;
    v_close_t := NULLIF(v_today_entry ->> 'close', '')::time;
    IF v_open_t IS NOT NULL AND v_close_t IS NOT NULL THEN
      IF v_close_t > v_open_t THEN
        v_is_open := v_local_time >= v_open_t AND v_local_time < v_close_t;
      ELSE
        v_is_open := v_local_time >= v_open_t;
      END IF;
    END IF;
  END IF;

  -- Ka B: rès yon sèvis ki te kòmanse YÈ e ki travèse minwi.
  IF NOT v_is_open AND v_yesterday_entry IS NOT NULL
     AND NOT COALESCE((v_yesterday_entry ->> 'closed')::boolean, true) THEN
    v_open_t := NULLIF(v_yesterday_entry ->> 'open', '')::time;
    v_close_t := NULLIF(v_yesterday_entry ->> 'close', '')::time;
    IF v_open_t IS NOT NULL AND v_close_t IS NOT NULL AND v_close_t <= v_open_t THEN
      v_is_open := v_local_time < v_close_t;
    END IF;
  END IF;

  RETURN v_is_open;
END;
$$;
-- REVOKE/GRANT pa nesesè ankò — CREATE OR REPLACE prezève yo otomatikman
-- (deja anon+authenticated depi 20260821100000).

-- ---------------------------------------------------------------------------
-- 4) set_restaurant_open_secure — sèl chemen ekriti pou is_open (pwopriyetè
--    /admin, wè nòt otorizasyon anwo).
CREATE OR REPLACE FUNCTION public.set_restaurant_open_secure(_restaurant_id uuid, _is_open boolean)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.restaurants;
BEGIN
  IF NOT private.is_restaurant_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.restaurants SET is_open = _is_open, updated_at = now()
  WHERE id = _restaurant_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.set_restaurant_open_secure(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_restaurant_open_secure(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) publish_product_secure / publish_all_products_secure — sèl chemen
--    ekriti pou published_at ET expires_at (pwopriyetè/admin/anplwaye, wè
--    nòt otorizasyon anwo). De chan yo ekri ansanm, nan menm INSTRIKSYON
--    UPDATE — wè nòt koreksyon §2 pi wo pou poukisa expires_at pa yon
--    kolòn GENERATED.
CREATE OR REPLACE FUNCTION public.publish_product_secure(_product_id uuid)
RETURNS public.products
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.products;
BEGIN
  SELECT * INTO v_row FROM public.products WHERE id = _product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dish not found'; END IF;
  IF NOT private.is_restaurant_staff_or_manager(v_row.restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.products
  SET published_at = now(), expires_at = now() + interval '24 hours', updated_at = now()
  WHERE id = _product_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_product_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_product_secure(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.publish_all_products_secure(_restaurant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT private.is_restaurant_staff_or_manager(_restaurant_id) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.products
  SET published_at = now(), expires_at = now() + interval '24 hours', updated_at = now()
  WHERE restaurant_id = _restaurant_id
    AND archived_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_all_products_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_all_products_secure(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6) create_order_secure — CREATE OR REPLACE sèlman (menm siyati, pa gen
--    DROP FUNCTION), kò a idantik a vèsyon 20260821100000 la, ajoute yon
--    chèk ekspirasyon touswit apre chèk `available` la (menm mesaj estil
--    ak li: non plat la site, kliyan mande retire l nan panye a).
CREATE OR REPLACE FUNCTION private.create_order_secure(
  _restaurant_id uuid,
  _items jsonb,
  _delivery_address text,
  _contact_phone text,
  _delivery_notes text,
  _method public.payment_method,
  _wants_location_sharing boolean DEFAULT false,
  _idempotency_key uuid DEFAULT NULL
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
  v_total numeric(10,2) := 0;
  v_restaurant record;
  v_platform record;
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
    -- Nouvo chèk (Tach 1, Objektif B): pla ki pibliye pou 24h ekspire men
    -- ki poko re-pibliye. `available` (chèk anwo a) pa kouvri ka sa a —
    -- yon pwopriyetè ka kite `available=true` san li pa re-klike "Pibliye".
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

  v_total := v_subtotal + v_delivery_fee + v_service_fee;
  UPDATE public.orders SET subtotal = v_subtotal, service_fee = v_service_fee, total = v_total
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
-- No REVOKE/GRANT here — grants unchanged from prior migration (CREATE OR
-- REPLACE preserves them automatically).

-- ---------------------------------------------------------------------------
-- 7) list_restaurants_public — restaurants.index.tsx te fè yon
--    .from("restaurants").select() dirèk, san okenn nosyon "louvri kounye
--    a" (PostgREST pa ka triye pa yon fonksyon SQL abitrè). RPC sa a
--    prezève EGZAKTEMAN menm konpòtman aktyèl la (rechèch pa non, 2 tri:
--    rating DESC / prep_time ASC, paj + kantite total via
--    count(*) OVER()), ajoute SÈLMAN "louvri anvan fèmen" kòm tri
--    prensipal ak yon `is_open_now` pou UI a ka montre yon badj "Fèmen".
CREATE OR REPLACE FUNCTION public.list_restaurants_public(
  _search text DEFAULT NULL,
  _sort text DEFAULT 'rating',
  _limit int DEFAULT 24,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  cuisine text,
  logo_url text,
  cover_url text,
  rating numeric,
  avg_prep_time int,
  delivery_fee numeric,
  address text,
  is_open_now boolean,
  total_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- `total_count` egzprime an `integer` (pa `bigint`) espre: PostgREST
  -- serialize yon `bigint` Postgres kòm yon STRING JSON (pa yon nonm), yon
  -- pyèj byen konnen — sa ta fòse yon Number()/parseInt() kote lakay
  -- kliyan an chak fwa. Kantite total restoran apwouve pa ka janm rive nan
  -- limit yon `integer` (2^31), donk okenn danje pèt presizyon isit la.
  SELECT r.id, r.slug, r.name, r.cuisine, r.logo_url, r.cover_url, r.rating,
         r.avg_prep_time, r.delivery_fee, r.address, r.is_open_now,
         count(*) OVER()::integer AS total_count
  FROM (
    SELECT rr.*, public.is_restaurant_open(rr.id, now()) AS is_open_now
    FROM public.restaurants rr
    WHERE rr.status = 'approved'
      AND (_search IS NULL OR btrim(_search) = '' OR rr.name ILIKE '%' || btrim(_search) || '%')
  ) r
  ORDER BY
    r.is_open_now DESC,
    CASE WHEN _sort = 'prep_time' THEN r.avg_prep_time END ASC NULLS LAST,
    CASE WHEN _sort IS DISTINCT FROM 'prep_time' THEN r.rating END DESC NULLS LAST,
    r.id ASC
  LIMIT GREATEST(COALESCE(_limit, 24), 0)
  OFFSET GREATEST(COALESCE(_offset, 0), 0);
$$;
REVOKE ALL ON FUNCTION public.list_restaurants_public(text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_restaurants_public(text, text, int, int) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829090000', 'restaurant_manual_toggle_and_dish_expiry')
ON CONFLICT (version) DO NOTHING;

COMMIT;
