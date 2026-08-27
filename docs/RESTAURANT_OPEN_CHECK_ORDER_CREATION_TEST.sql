-- Tès pou 20260821100000_restaurant_open_check_order_creation.sql.
-- REHEARSE-STYLE (BEGIN...ROLLBACK) — migrasyon an poko aplike an
-- pwodiksyon. Fichye sa a OTO-PÒTAN: kò migrasyon an kole verbatim andedan
-- menm transaksyon an, teste, epi ROLLBACK.
-- Règ A10: rezilta ekri nan yon tab tanporè + SELECT anvan ROLLBACK.
--
-- Not sou dat/lè: tès is_restaurant_open() itilize yon `_at` eksplisit (pa
-- `now()`) pou yo pa depann de ki jou/lè reyèl migrasyon an ap kouri.
-- 2026-01-05 se yon Lendi (verifye), 2026-01-06 se Madi, 2026-01-09 se
-- Vandredi, 2026-01-10 se Samdi, menm semèn nan.

BEGIN;

-- ===========================================================================
-- Kò migrasyon an (verbatim, san BEGIN/COMMIT/schema_migrations li).
CREATE OR REPLACE FUNCTION private.opening_hours_grace_period()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '30 days' $$;

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
    IF NEW.opening_hours_grace_until IS NULL THEN
      NEW.opening_hours_grace_until := now() + private.opening_hours_grace_period();
    END IF;
  ELSE
    NEW.opening_hours_grace_until := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintain_opening_hours_grace ON public.restaurants;
CREATE TRIGGER trg_maintain_opening_hours_grace
BEFORE INSERT OR UPDATE OF opening_hours ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION private.maintain_opening_hours_grace();

UPDATE public.restaurants
SET opening_hours_grace_until = now() + private.opening_hours_grace_period()
WHERE COALESCE(opening_hours, '{}'::jsonb) = '{}'::jsonb
  AND opening_hours_grace_until IS NULL;

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

  IF COALESCE(v_restaurant.opening_hours, '{}'::jsonb) = '{}'::jsonb THEN
    RETURN v_restaurant.opening_hours_grace_until IS NULL
        OR v_restaurant.opening_hours_grace_until > _at;
  END IF;

  v_local_ts := _at AT TIME ZONE 'America/Port-au-Prince';
  v_local_time := v_local_ts::time;
  v_dow := EXTRACT(DOW FROM v_local_ts)::int;
  v_today_key := v_day_keys[v_dow + 1];
  v_yesterday_key := v_day_keys[((v_dow + 6) % 7) + 1];

  v_today_entry := v_restaurant.opening_hours -> v_today_key;
  v_yesterday_entry := v_restaurant.opening_hours -> v_yesterday_key;

  -- Kle jou a ABSAN nèt (diferan de {"closed":true} eksplisit) = louvri pa
  -- default — wè migrasyon an pou rezònman konplè (twouve "Gou laky").
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
    SELECT id, name, price, restaurant_id, available INTO v_product
      FROM public.products WHERE id = (v_item->>'product_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Product not found'; END IF;
    IF v_product.restaurant_id <> _restaurant_id THEN
      RAISE EXCEPTION 'Product does not belong to this restaurant';
    END IF;
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

-- ===========================================================================
-- Tès yo.
CREATE TEMP TABLE test_results (tes text PRIMARY KEY, rezilta text, detay text);

DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_resto_normal uuid;
  v_resto_overnight uuid;
  v_resto_pending uuid;
  v_resto_grace uuid;
  v_resto_grace_expired uuid;
  v_resto_allclosed uuid;
  v_resto_hours_set uuid;
  v_resto_preexisting uuid;
  v_resto_partial_week uuid;
  v_product_grace uuid;
  v_product_unavail uuid;
  v_order_id uuid;
  v_caught boolean;
  v_errmsg text;
  v_grace_until timestamptz;
  v_count int;
  v_missing_count int;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_owner, 'openchk-owner@example.com', 'x', now(), '{}', '{}'),
    (v_customer, 'openchk-customer@example.com', 'x', now(), '{}', '{}'),
    (v_admin, 'openchk-admin@example.com', 'x', now(), '{}', '{}');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');

  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee, opening_hours)
  VALUES (gen_random_uuid(), v_owner, 'openchk-normal', 'Openchk Normal', 'approved', 0,
    '{"mon": {"open":"10:00","close":"22:00","closed":false}}'::jsonb)
  RETURNING id INTO v_resto_normal;
  -- 'sat' prezan eksprè (menm orè "travèse minwi" ak 'fri') pou T9-T11 pa
  -- gaye ak nouvo règ "jou absan = louvri" a (§T20-T21 pi ba a teste règ
  -- sa a apa, san konfonn li ak lojik travèse-minwi a).
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee, opening_hours)
  VALUES (gen_random_uuid(), v_owner, 'openchk-overnight', 'Openchk Overnight', 'approved', 0,
    ('{"fri": {"open":"18:00","close":"02:00","closed":false},' ||
     ' "sat": {"open":"18:00","close":"02:00","closed":false}}')::jsonb)
  RETURNING id INTO v_resto_overnight;
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee, opening_hours)
  VALUES (gen_random_uuid(), v_owner, 'openchk-pending', 'Openchk Pending', 'pending', 0,
    '{"mon": {"open":"00:00","close":"23:59","closed":false}}'::jsonb)
  RETURNING id INTO v_resto_pending;
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee, opening_hours)
  VALUES (gen_random_uuid(), v_owner, 'openchk-allclosed', 'Openchk All Closed', 'approved', 0,
    ('{"sun":{"closed":true},"mon":{"closed":true},"tue":{"closed":true},"wed":{"closed":true},' ||
     '"thu":{"closed":true},"fri":{"closed":true},"sat":{"closed":true}}')::jsonb)
  RETURNING id INTO v_resto_allclosed;
  -- Pa presize opening_hours -> defoli '{}' -> trigger la dwe bay yon
  -- fenèt gras otomatikman sou INSERT.
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (gen_random_uuid(), v_owner, 'openchk-grace', 'Openchk Grace', 'approved', 0)
  RETURNING id INTO v_resto_grace;
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (gen_random_uuid(), v_owner, 'openchk-grace-expired', 'Openchk Grace Expired', 'approved', 0)
  RETURNING id INTO v_resto_grace_expired;
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (gen_random_uuid(), v_owner, 'openchk-hours-set', 'Openchk Hours Set', 'approved', 0)
  RETURNING id INTO v_resto_hours_set;

  -- Rekonstitisyon egzat done "Gou laky" (restoran ki motive koreksyon
  -- "jou absan" la) — lendi ranpli, samdi/dimanch eksplisitman closed:true,
  -- mardi→vandredi ABSAN nèt. Sèvi pou T20-T21.
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee, opening_hours)
  VALUES (gen_random_uuid(), v_owner, 'openchk-partial-week', 'Openchk Partial Week', 'approved', 0,
    ('{"mon":{"open":"08:00","close":"16:00","closed":false},' ||
     ' "sat":{"open":"10:00","close":"22:00","closed":true},' ||
     ' "sun":{"open":"10:00","close":"22:00","closed":true}}')::jsonb)
  RETURNING id INTO v_resto_partial_week;

  INSERT INTO public.products (id, restaurant_id, name, price, available)
  VALUES (gen_random_uuid(), v_resto_grace, 'Plat tès disponib', 100, true) RETURNING id INTO v_product_grace;
  INSERT INTO public.products (id, restaurant_id, name, price, available)
  VALUES (gen_random_uuid(), v_resto_grace, 'Plat tès pa disponib', 100, false) RETURNING id INTO v_product_unavail;

  -- T1 — trigger la bay yon fenèt gras otomatikman sou INSERT (~30 jou).
  SELECT opening_hours_grace_until INTO v_grace_until FROM public.restaurants WHERE id = v_resto_grace;
  INSERT INTO test_results VALUES ('T1',
    CASE WHEN v_grace_until IS NOT NULL AND v_grace_until > now() + interval '29 days'
           AND v_grace_until < now() + interval '31 days'
         THEN 'PASS' ELSE 'FAIL' END,
    'grace_until otomatik sou insert = ' || COALESCE(v_grace_until::text, 'NULL'));

  -- T2 — pandan fenèt gras la aktif, restoran an louvri kèlkeswa lè a.
  INSERT INTO test_results VALUES ('T2',
    CASE WHEN public.is_restaurant_open(v_resto_grace, '2026-01-05 03:00:00-05'::timestamptz) THEN 'PASS' ELSE 'FAIL' END,
    'opening_hours vid + fenèt gras aktif = louvri');

  -- T3 — apre fenèt gras la ekspire (UPDATE ki pa touche opening_hours, pa
  -- deklannche trigger la ankò), restoran an fèmen.
  UPDATE public.restaurants SET opening_hours_grace_until = now() - interval '1 day' WHERE id = v_resto_grace_expired;
  INSERT INTO test_results VALUES ('T3',
    CASE WHEN NOT public.is_restaurant_open(v_resto_grace_expired, now()) THEN 'PASS' ELSE 'FAIL' END,
    'opening_hours vid + fenèt gras ekspire = fèmen');

  -- T4 — lè yon restoran antre yon VRE orè, trigger la efase fenèt gras la
  -- otomatikman (UPDATE OF opening_hours).
  UPDATE public.restaurants
  SET opening_hours = '{"mon":{"open":"09:00","close":"21:00","closed":false}}'::jsonb
  WHERE id = v_resto_hours_set;
  SELECT opening_hours_grace_until INTO v_grace_until FROM public.restaurants WHERE id = v_resto_hours_set;
  INSERT INTO test_results VALUES ('T4',
    CASE WHEN v_grace_until IS NULL THEN 'PASS' ELSE 'FAIL' END,
    'grace_until efase apre vrè orè antre: ' || COALESCE(v_grace_until::text, 'NULL'));

  -- T5 — filè sekirite: opening_hours vid + grace_until FÒSE NULL (ka ki pa
  -- ta dwe rive nan lavi reyèl, backfill la anpeche l) toujou LOUVRI, pa
  -- fèmen — tab verite a, dènye liy.
  UPDATE public.restaurants SET opening_hours_grace_until = NULL WHERE id = v_resto_grace_expired;
  INSERT INTO test_results VALUES ('T5',
    CASE WHEN public.is_restaurant_open(v_resto_grace_expired, now()) THEN 'PASS' ELSE 'FAIL' END,
    'opening_hours vid + grace_until NULL (filè sekirite) = louvri, pa fèmen');
  -- Remete l nan eta "ekspire" (pa NULL) apre tès la — T19 pi ba a verifye
  -- pa gen okenn restoran REYÈL ki rete ak grace_until NULL apre backfill
  -- la; NULL isit la se yon eta n te fòse eksprè pou T5, pa yon done reyèl.
  UPDATE public.restaurants SET opening_hours_grace_until = now() - interval '1 day' WHERE id = v_resto_grace_expired;

  -- T6 — restoran "prezistan" (senile yon restoran ki te la anvan
  -- migrasyon an, opening_hours vid, okenn grace_until). Nòt enpòtan: dèske
  -- trigger la deja egziste pou tout dire DO block sa a, yon senp INSERT
  -- pa ka pwodwi eta "grace_until = NULL" pou lontan — trigger a ap mete l
  -- otomatikman menm jan ak T1. Pou vreman teste backfill la (pa trigger
  -- a), nou fòse tounen NULL ak yon UPDATE ki PA touche opening_hours
  -- (donk pa deklannche trigger a, ki sèlman koute UPDATE OF opening_hours),
  -- epi aplike EGZAKTEMAN menm statman backfill migrasyon an itilize (§1)
  -- separeman, pou konfime li kouvri ka sa a si li rive.
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (gen_random_uuid(), v_owner, 'openchk-preexisting', 'Openchk Preexisting', 'approved', 0)
  RETURNING id INTO v_resto_preexisting;
  UPDATE public.restaurants SET opening_hours_grace_until = NULL WHERE id = v_resto_preexisting;
  UPDATE public.restaurants
  SET opening_hours_grace_until = now() + private.opening_hours_grace_period()
  WHERE COALESCE(opening_hours,'{}'::jsonb) = '{}'::jsonb AND opening_hours_grace_until IS NULL;
  INSERT INTO test_results VALUES ('T6a',
    CASE WHEN public.is_restaurant_open(v_resto_preexisting, now()) THEN 'PASS' ELSE 'FAIL' END,
    'restoran prezistan, jis apre backfill = louvri');
  INSERT INTO test_results VALUES ('T6b',
    CASE WHEN NOT public.is_restaurant_open(v_resto_preexisting, now() + interval '31 days') THEN 'PASS' ELSE 'FAIL' END,
    'restoran prezistan, 31 jou apre backfill = fèmen');

  -- T7 — Lendi 20:00 (nan 10:00-22:00) = louvri.
  INSERT INTO test_results VALUES ('T7',
    CASE WHEN public.is_restaurant_open(v_resto_normal, '2026-01-05 20:00:00-05'::timestamptz) THEN 'PASS' ELSE 'FAIL' END,
    'lendi 20:00 nan 10:00-22:00 = louvri');

  -- T8 — Lendi 23:00 (deyò 10:00-22:00) = fèmen. Egzakteman bug pwodiksyon
  -- an te korije a.
  INSERT INTO test_results VALUES ('T8',
    CASE WHEN NOT public.is_restaurant_open(v_resto_normal, '2026-01-05 23:00:00-05'::timestamptz) THEN 'PASS' ELSE 'FAIL' END,
    'lendi 23:00 deyò 10:00-22:00 = fèmen');

  -- T9 — sèvis ki travèse minwi: Vandredi 20:00 (fèk kòmanse) = louvri.
  INSERT INTO test_results VALUES ('T9',
    CASE WHEN public.is_restaurant_open(v_resto_overnight, '2026-01-09 20:00:00-05'::timestamptz) THEN 'PASS' ELSE 'FAIL' END,
    'vandredi 20:00 (sèvis 18:00-02:00 fèk kòmanse) = louvri');

  -- T10 — sèvis ki travèse minwi: Samdi 01:00 (rès sèvis vandredi a) = louvri.
  INSERT INTO test_results VALUES ('T10',
    CASE WHEN public.is_restaurant_open(v_resto_overnight, '2026-01-10 01:00:00-05'::timestamptz) THEN 'PASS' ELSE 'FAIL' END,
    'samdi 01:00 (rès sèvis vandredi) = louvri');

  -- T11 — sèvis ki travèse minwi: Samdi 03:00 (apre 02:00) = fèmen.
  INSERT INTO test_results VALUES ('T11',
    CASE WHEN NOT public.is_restaurant_open(v_resto_overnight, '2026-01-10 03:00:00-05'::timestamptz) THEN 'PASS' ELSE 'FAIL' END,
    'samdi 03:00 (apre 02:00) = fèmen');

  -- T12 — restoran 'pending' toujou fèmen kèlkeswa orè li.
  INSERT INTO test_results VALUES ('T12',
    CASE WHEN NOT public.is_restaurant_open(v_resto_pending, '2026-01-05 12:00:00-05'::timestamptz) THEN 'PASS' ELSE 'FAIL' END,
    'restoran pending toujou fèmen kèlkeswa orè li');

  -- T13 — entegrasyon reyèl: create_order_secure rejte lè restoran an
  -- fèmen (tout 7 jou fèmen eksplisitman).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.create_order_secure(
      v_resto_allclosed,
      jsonb_build_array(jsonb_build_object('product_id', v_product_grace, 'quantity', 1)),
      'Adrès tès', '50900000001', NULL, 'kach', false, gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T13',
    CASE WHEN v_caught AND v_errmsg = 'Restoran an fèmen kounye a. Tanpri eseye pita.' THEN 'PASS' ELSE 'FAIL' END,
    'mesaj: ' || COALESCE(v_errmsg, 'okenn'));

  -- T13b — mesaj pou restoran ki pa apwouve, kounye a an kreyòl (te an
  -- anglè, NKD-004 backlog #56, tradwi nan menm chanjman sa a).
  DECLARE
    v_product_pending uuid;
  BEGIN
    INSERT INTO public.products (id, restaurant_id, name, price, available)
    VALUES (gen_random_uuid(), v_resto_pending, 'Plat pending', 100, true) RETURNING id INTO v_product_pending;
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
    v_caught := false;
    BEGIN
      PERFORM public.create_order_secure(
        v_resto_pending,
        jsonb_build_array(jsonb_build_object('product_id', v_product_pending, 'quantity', 1)),
        'Adrès tès', '50900000001', NULL, 'kach', false, gen_random_uuid()
      );
    EXCEPTION WHEN OTHERS THEN
      v_caught := true;
      GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
    END;
    RESET ROLE;
    INSERT INTO test_results VALUES ('T13b',
      CASE WHEN v_caught AND v_errmsg = 'Restoran an pa disponib kounye a.' THEN 'PASS' ELSE 'FAIL' END,
      'mesaj: ' || COALESCE(v_errmsg, 'okenn'));
  END;

  -- T14 — entegrasyon reyèl: create_order_secure reyisi pou yon restoran ki
  -- nan fenèt gras li (opening_hours vid, jamè touche) — pa gen regresyon
  -- sou chemen kòmand nòmal la.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_order_id := public.create_order_secure(
    v_resto_grace,
    jsonb_build_array(jsonb_build_object('product_id', v_product_grace, 'quantity', 2)),
    'Adrès tès', '50900000001', NULL, 'kach', false, gen_random_uuid()
  );
  RESET ROLE;
  INSERT INTO test_results VALUES ('T14',
    CASE WHEN v_order_id IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'kòmand kreye avèk siksè (restoran nan fenèt gras): ' || (v_order_id IS NOT NULL)::text);

  -- T15 — mesaj kreyòl klè lè yon plat vin pa disponib.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.create_order_secure(
      v_resto_grace,
      jsonb_build_array(jsonb_build_object('product_id', v_product_unavail, 'quantity', 1)),
      'Adrès tès', '50900000001', NULL, 'kach', false, gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T15',
    CASE WHEN v_caught AND v_errmsg = 'Plat "Plat tès pa disponib" pa disponib ankò. Tanpri retire l nan panye a.'
         THEN 'PASS' ELSE 'FAIL' END,
    'mesaj: ' || COALESCE(v_errmsg, 'okenn'));

  -- T16 — RPC get_restaurants_missing_hours_admin: non-admin rejte.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM * FROM public.get_restaurants_missing_hours_admin();
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T16', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END,
    'non-admin rejte: ' || v_caught::text);

  -- T17 — admin wè v_resto_grace_expired (grace_until fòse NULL nan T5)
  -- nan lis la ak grace_expired = true.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_missing_count FROM public.get_restaurants_missing_hours_admin()
    WHERE id = v_resto_grace_expired AND grace_expired = true;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T17',
    CASE WHEN v_missing_count = 1 THEN 'PASS' ELSE 'FAIL' END,
    'admin wè restoran ak fenèt gras ekspire (oswa NULL): ' || v_missing_count::text);

  -- T18 — admin wè v_resto_grace (fenèt aktif) kòm PA ekspire.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_missing_count FROM public.get_restaurants_missing_hours_admin()
    WHERE id = v_resto_grace AND grace_expired = false;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T18',
    CASE WHEN v_missing_count = 1 THEN 'PASS' ELSE 'FAIL' END,
    'admin wè restoran ak fenèt gras aktif kòm pa ekspire: ' || v_missing_count::text);

  -- T19 — backfill: pa gen okenn restoran apwouve (done reyèl pwodiksyon
  -- enkli, tès sa a li done reyèl, li pa kreye anyen) ki gen opening_hours
  -- vid san yon opening_hours_grace_until.
  SELECT count(*) INTO v_count FROM public.restaurants
    WHERE status = 'approved' AND COALESCE(opening_hours,'{}'::jsonb) = '{}'::jsonb
      AND opening_hours_grace_until IS NULL;
  INSERT INTO test_results VALUES ('T19',
    CASE WHEN v_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    'restoran san fenèt gras apre backfill (dwe 0): ' || v_count::text);

  -- T20 — koreksyon "jou absan": Madi (2026-01-06, kle 'tue' ABSAN nèt nan
  -- opening_hours "Gou laky") = LOUVRI, kèlkeswa lè. Sa a se egzakteman
  -- senaryo ki te pral bloke 4 jou sou 7 pou yon restoran ki reyèlman
  -- aktif si koreksyon an pa t fèt.
  INSERT INTO test_results VALUES ('T20',
    CASE WHEN public.is_restaurant_open(v_resto_partial_week, '2026-01-06 03:00:00-05'::timestamptz) THEN 'PASS' ELSE 'FAIL' END,
    'madi (kle absan) 03:00 = louvri (règ "jou absan")');

  -- T21 — kontwòl: yon jou PREZAN ak closed:true eksplisit (samdi) rete
  -- FÈMEN menm si li nan fenèt 10:00-22:00 li a — règ "jou absan" pa
  -- efase yon fèmti eksplisit.
  INSERT INTO test_results VALUES ('T21',
    CASE WHEN NOT public.is_restaurant_open(v_resto_partial_week, '2026-01-10 14:00:00-05'::timestamptz) THEN 'PASS' ELSE 'FAIL' END,
    'samdi (closed:true eksplisit) 14:00 = fèmen (pa efase pa règ "jou absan")');

  -- (Pa gen tès entegrasyon create_order_secure ki depann de jou reyèl la
  -- pou senaryo sa a: create_order_secure rele is_restaurant_open() ak
  -- now() an dur, pa yon _at enjektab — yon tès konsa ta pase oswa echwe
  -- selon vrè jou lasemèn kap egzekite tès la, pa yon rezon fyab. T13 ak
  -- T14 deja pwouve fisèl la (create_order_secure → is_restaurant_open())
  -- byen kablaje nan tou de sans; T20/T21 pwouve branch "jou absan" a
  -- espesifikman, san depann de lè yo egzekite tès yo.)
END;
$$;

SELECT * FROM test_results ORDER BY tes;

ROLLBACK;
