-- Chantier livreurs/restoran — Étape 2, premye moso (priyorite D9): koreksyon
-- yon bug pwodiksyon aktyèl, endepandan de rès chantye a — jodi a, RYEN pa
-- verifye si yon restoran louvri lè yon kòmand kreye.
--
-- Sa a se PREMYE moso Seksyon 3 (òdinasyon konfime pa pwopriyetè a) —
-- pòtay/toggle manyèl, orè espesyal, ak kontra siyen yo poko egziste, yo ap
-- vini nan pwochen migrasyon nan menm chantye a, epi yo ap ETANN
-- `is_restaurant_open()` sou plas (CREATE OR REPLACE, menm siyati) — se sa
-- ki fè li se SÈL otorite a (Règ D8) olye pou chak apèl reyekri règ la pa
-- li menm.
--
-- REVISION (owner review) — peryòd gras BONE, pa yon eksepsyon pèmanan:
-- bug istorik `opening_hours = '{}'` la (tout restoran kreye anvan
-- 2026-08-09, sa vle di majorite pak aktyèl la) te ka trape pou toujou dèyè
-- yon règ "vid = toujou louvri" san limit. Kounye a: yon restoran ki gen
-- `opening_hours` vid jwenn yon FENÈT GRAS bòne
-- (`private.opening_hours_grace_period()`, KONSTANT NOMME — pa yon literal
-- pèdi nan kò fonksyon an), aplike depi (a) kreyasyon kont li si li fèk
-- enskri, oswa (b) aplikasyon migrasyon sa a si li te deja egziste. Apre
-- fenèt la ekspire, `opening_hours` vid vle di FÈMEN, pa louvri.
--
-- Longè: 30 jou (pa 14) — yon egzansyon deklare eksplisitman, pa yon chwa
-- ki kache: bannyè restoran an ("Ou poko antre orè ou...") ak konpteur
-- admin an (get_restaurants_missing_hours_admin, deja ekri pi ba) se travay
-- FRONTEND Seksyon 3/4, ki poko fèt. Si delè a te rete 14 jou, gen restoran
-- k ap etenn AVAN menm yo janm wè yon avètisman — "pesonn pa dwe koupe san
-- yo pa janm avèti" se yon règ ki pa negosyab. 30 jou bay ase tan pou
-- bannyè a ak rapèl yo (J-7/J-1, menm mekanis rattrapabl/idempotan ak
-- pèmi livrè yo — wè pwochen migrasyon nan chantye a) rive an premye. Yon
-- migrasyon apa ka resere l a 14 jou yon fwa bannyè a an sèvis.
--
-- Mekanis: yon TRIGGER (pa yon chan modifye nan plizyè RPC separe) kenbe
-- `restaurants.opening_hours_grace_until` otomatikman — sou CHAK INSERT
-- (donk `handle_new_user()` pa bezwen okenn chanjman, li deja ap kouri
-- INSERT la san l pa konnen anyen sou gras la) ak sou UPDATE OF
-- opening_hours (donk `update_restaurant_hours_secure()` pa bezwen okenn
-- chanjman non plis — depi yon restoran antre yon vrè orè, trigger la efase
-- fenèt gras la otomatikman). Yon sèl kote kenbe règ sa a, jan de otorite
-- inik yo (is_driver_eligible, is_restaurant_open) deja etabli.
--
-- IMPÒTAN sou backfill la (§1 pi ba): trigger a SÈLMAN aji sou INSERT/UPDATE
-- apati de kounye a — li pa janm touche liy ki DEJA egziste. Se poutèt sa
-- gen yon UPDATE separe (pa depann de trigger a ditou) ki kouri YON SÈL FWA,
-- imedyatman apre kreyasyon trigger a, sou TOUT liy ki gen opening_hours vid
-- kèlkeswa dat kreyasyon yo — sa ki garanti pak aktyèl la (tout restoran
-- kreye anvan 2026-08-09) resevwa menm fenèt 30-jou a, kalkile a MOMAN
-- aplikasyon migrasyon an, jamè li pa depann de yon evènman INSERT/UPDATE
-- ki pa janm rive pou yon restoran ki pa touche pwòp orè li.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_maintain_opening_hours_grace ON public.restaurants;
--   DROP FUNCTION IF EXISTS private.maintain_opening_hours_grace();
--   DROP FUNCTION IF EXISTS public.get_restaurants_missing_hours_admin();
--   DROP FUNCTION IF EXISTS public.is_restaurant_open(uuid, timestamptz);
--   ALTER TABLE public.restaurants DROP COLUMN IF EXISTS opening_hours_grace_until;
--   DROP FUNCTION IF EXISTS private.opening_hours_grace_period();
--   -- Re-aplike kò `private.create_order_secure` orijinal la verbatim,
--   -- soti nan 20260818100000_nkd011_order_idempotency.sql:80-232 (menm
--   -- siyati, CREATE OR REPLACE — pa gen DROP FUNCTION pou fè isit la).
--
-- Wrapped BEGIN...COMMIT (A11).
BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Konstant nomme — SÈL kote longè peryòd gras la ekri. Chanje li isit la
--    sèlman si peryòd la dwe chanje pou tout sistèm nan (egzanp: resere l a
--    14 jou nan yon migrasyon apa yon fwa bannyè restoran an an sèvis —
--    wè kòmantè anwo).
CREATE OR REPLACE FUNCTION private.opening_hours_grace_period()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '30 days' $$;

-- ---------------------------------------------------------------------------
-- 1) Kolòn + trigger ki kenbe fenèt gras la otomatikman.
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS opening_hours_grace_until timestamptz;

CREATE OR REPLACE FUNCTION private.maintain_opening_hours_grace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.opening_hours, '{}'::jsonb) = '{}'::jsonb THEN
    -- Rete san orè: bay yon fenèt gras si li poko janm genyen youn (pa
    -- pwolonje yon fenèt ki deja kòmanse — yon UPDATE ki pa touche
    -- opening_hours pa ta dwe deklannche trigger sa a menm jan, men gad la
    -- rete si yon jou gen yon lòt chemen ekriti).
    IF NEW.opening_hours_grace_until IS NULL THEN
      NEW.opening_hours_grace_until := now() + private.opening_hours_grace_period();
    END IF;
  ELSE
    -- Genyen vrè orè kounye a: fenèt gras la pa nesesè ankò.
    NEW.opening_hours_grace_until := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintain_opening_hours_grace ON public.restaurants;
CREATE TRIGGER trg_maintain_opening_hours_grace
BEFORE INSERT OR UPDATE OF opening_hours ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION private.maintain_opening_hours_grace();

-- Backfill yon sèl fwa pou restoran ki deja egziste (trigger la sèlman aji
-- sou INSERT/UPDATE apati de kounye a) — chak grenn jwenn menm fenèt 30 jou
-- a, kalkile a MOMAN aplikasyon migrasyon sa a, jamè li pa glise pi lwen
-- chak fwa fonksyon an rele.
UPDATE public.restaurants
SET opening_hours_grace_until = now() + private.opening_hours_grace_period()
WHERE COALESCE(opening_hours, '{}'::jsonb) = '{}'::jsonb
  AND opening_hours_grace_until IS NULL;

-- ---------------------------------------------------------------------------
-- 2) is_restaurant_open() — sèl otorite pou "èske restoran sa a louvri kounye
--    a". Vèsyon sa a verifye status='approved' + fenèt gras + opening_hours —
--    pwochen migrasyon nan chantye a ap ETANN li (pa ranplase l ak yon lòt
--    fonksyon) pou ajoute toggle manyèl, orè espesyal, ak kontra siyen.
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
  SELECT status, opening_hours, opening_hours_grace_until INTO v_restaurant
    FROM public.restaurants WHERE id = _restaurant_id;
  IF NOT FOUND OR v_restaurant.status <> 'approved' THEN
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
  --                 |             | rive: backfill anba a garanti chak
  --                 |             | restoran ki gen opening_hours vid jwenn
  --                 |             | yon grace_until reyèl, e trigger la
  --                 |             | (§1) kenbe l konsa apre sa. Si ka sa a
  --                 |             | rive kanmenm (yon bug ki poko dekouvri
  --                 |             | yon lòt kote, egzanp), pi bon yon
  --                 |             | restoran rete louvri pa erè pase l koupe
  --                 |             | san rezon — men sa PA dwe pase san yo
  --                 |             | pa wè l: private.run_driver_compliance_
  --                 |             | daily_secure() (pwochen migrasyon)
  --                 |             | balaye pou ka sa a chak jou e ekri yon
  --                 |             | antre 'hours_grace_anomaly_detected'
  --                 |             | nan audit_log si li jwenn nenpòt. Pa
  --                 |             | ekri nan audit_log DIREKTEMAN isit la:
  --                 |             | fonksyon sa a rele pou CHAK verifikasyon
  --                 |             | louvèti (chak paj plat, chak kòmand) —
  --                 |             | yon ekriti la ta ka spam log la anpil
  --                 |             | fwa pou menm restoran an, e ta kraze
  --                 |             | mak STABLE fonksyon an pou yon branch ki
  --                 |             | pa ta dwe janm egzekite.
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
  --
  -- v_today_entry IS NULL (kle jou a ABSAN nèt nan objè a) PA menm bagay
  -- ak {"closed":true} EKSPLISIT. Yon kle absan vle di pwopriyetè a pa
  -- janm ranpli/touche jou sa a nan HoursPicker la (yon edisyon pasyèl
  -- nan pikè a anrejistre sèlman sougwoup jou li touche yo, pa tout 7 jou
  -- yo) — se yon TWOU nan done, pa yon deklarasyon "nou fèmen". Menm
  -- filozofi ak objè vid la pi wo (§ tab verite): san prèv pozitif ke
  -- restoran an fèmen, pa bloke. Sèl yon `closed:true` EKSPLISIT (oswa
  -- yon antre ki pa kouvri lè kounye a) fèmen restoran an.
  --
  -- Twouve reyèl ki motive koreksyon sa a (verifye avan aplikasyon,
  -- rezilta Requête 2/3): restoran "Gou laky" te gen sèlman lendi +
  -- samdi/dimanch (eksplisitman closed:true) ranpli nan opening_hours,
  -- ak madi→vandredi ABSAN nèt — men li te gen kòmand kliyan REYÈL
  -- pandan jou "absan" sa yo (13-19 out 2026). San koreksyon sa a,
  -- migrasyon an ta bloke 4 jou sou 7 pou yon restoran ki reyèlman
  -- aktif, jou li deja resevwa kòmand ladan yo.
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
REVOKE ALL ON FUNCTION public.is_restaurant_open(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_restaurant_open(uuid, timestamptz) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Vizibilite admin — konbyen restoran poko gen orè + lis yo, avèk
--    eta fenèt gras yo (pou relanse yo anvan yo pèdi kòmand san yo pa
--    konprann poukisa).
CREATE OR REPLACE FUNCTION public.get_restaurants_missing_hours_admin()
RETURNS TABLE (
  id uuid, name text, slug text, status public.restaurant_status,
  opening_hours_grace_until timestamptz, grace_expired boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT r.id, r.name, r.slug, r.status, r.opening_hours_grace_until,
      (r.opening_hours_grace_until IS NULL OR r.opening_hours_grace_until <= now())
    FROM public.restaurants r
    WHERE COALESCE(r.opening_hours, '{}'::jsonb) = '{}'::jsonb
    ORDER BY r.opening_hours_grace_until NULLS FIRST;
END;
$$;
REVOKE ALL ON FUNCTION public.get_restaurants_missing_hours_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurants_missing_hours_admin() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) create_order_secure — CREATE OR REPLACE sèlman (menm siyati, pa gen
--    DROP FUNCTION pou fè): ajoute yon chèk ouvèti apre chèk status='approved'
--    la (menm plas lojik la), epi klarifye mesaj "pa disponib" la an kreyòl
--    ak non plat la site (demand eksplisit: "ka ki pi frekan an pwodiksyon").
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
  -- Mesaj sa a te an anglè depi orijin li (docs/archive/phases/NKD-004_RAISE_MESSAGES_BACKLOG.md
  -- #56) — tradwi isit la paske nou deja nan fonksyon an pou lòt rezon, pa
  -- yon nouvo travay sou backlog la an antye.
  IF v_restaurant.status <> 'approved' THEN RAISE EXCEPTION 'Restoran an pa disponib kounye a.'; END IF;
  -- Nouvo chèk (fix bug pwodiksyon): pa kite yon kòmand kreye si restoran an
  -- pa louvri kounye a, menm si li apwouve.
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
    SELECT id, name, price, restaurant_id, available INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF v_product.restaurant_id <> _restaurant_id THEN
      RAISE EXCEPTION 'Product does not belong to this restaurant';
    END IF;
    -- Mesaj klarifye (demand eksplisit, ka ki pi frekan an pwodiksyon: yon
    -- plat vin pa disponib pandan kliyan an ap ranpli fòm lan).
    IF NOT v_product.available THEN
      RAISE EXCEPTION 'Plat "%" pa disponib ankò. Tanpri retire l nan panye a.', v_product.name;
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
-- No REVOKE/GRANT here — grants on private.create_order_secure are
-- unchanged from the prior migration (CREATE OR REPLACE preserves them
-- automatically); public.create_order_secure (thin wrapper) is also
-- completely unchanged by this migration, not touched.

-- ---------------------------------------------------------------------------
-- 5) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821100000', 'restaurant_open_check_order_creation')
ON CONFLICT (version) DO NOTHING;

COMMIT;
