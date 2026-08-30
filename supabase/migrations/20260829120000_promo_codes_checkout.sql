-- PROMPT MODIFIKASYON (10 TACH) — Tach 2: chan kòd pwomo nan checkout.
--
-- Diferans ak `public.promotions` (deja egziste, 20260704120000): tab sa a
-- se yon zouti ANONS/maketing pou CHAK restoran (bannyè + push notifikasyon,
-- wè send-promotion-push.functions.ts) — li gen yon chan `code` opsyonèl
-- men li pa JANM verifye ni aplike nan kalkil pri a okenn kote (konfime pa
-- grep sou create_order_secure ak tout kòd afichaj pri). `promo_codes`
-- (nouvo, tab sa a) se yon SISTÈM DIFERAN: kòd platfòm-antye, jere pa
-- ADMIN sèlman, kliyan antre yo alamen nan checkout, VERIFYE AK APLIKE
-- server-side nan create_order_secure. Tach 3 (pwomosyon otomatik restoran)
-- ap ETANN `promotions` pi ta — pa gen okenn chevochman ak tab sa a.
--
-- SEKIRITE PRI (Règ 4 nan pwomt la): AUKENN kalkil rabè pa fèt kote kliyan
-- an. checkout.tsx ka rele `validate_promo_code_secure` pou yon APESI
-- (montre "-100 HTG" anvan menm kliyan konfime), men se yon fonksyon
-- READ-ONLY (STABLE, pa ekri anyen) — se sèlman yon TEXT (`_promo_code`) ki
-- rive nan `create_order_secure`, ki refè TOUT kalkil la (validite, dat,
-- kantite maksimòm, kòmand minimòm, montan rabè) yon dezyèm fwa, tou sèl,
-- avan li ekri okenn total nan `orders`. Yon kliyan ki modifye rezilta
-- apesi a nan navigatè a pa ka chanje anyen — sèvè a pa janm fè konfyans
-- nan yon montan rabè ki soti kote kliyan an.
--
-- Wrapped BEGIN...COMMIT (A11 — Altes aplike fichye sa a manyèlman nan SQL
-- Editor Supabase, mwen (AI) pa janm egzekite l).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tab promo_codes — jere pa admin sèlman, AUKENN grant dirèk anon/
--    authenticated (menm jan ak plizyè lòt tab sansib nan baz done sa a,
--    egzanp restaurant_employees) — tout aksè pase pa RPC SECURITY DEFINER
--    anba a (validate pou kliyan, CRUD pou admin). Sa anpeche nenpòt moun
--    "browse" tout kòd platfòm yo dirèkteman.
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value numeric(10,2) NOT NULL CHECK (discount_value > 0),
  min_order_amount numeric(10,2) CHECK (min_order_amount IS NULL OR min_order_amount >= 0),
  max_uses int CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count int NOT NULL DEFAULT 0,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CHECK (discount_type <> 'percentage' OR discount_value <= 100)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_code_unique ON public.promo_codes (upper(code));

DROP TRIGGER IF EXISTS trg_promo_codes_upd ON public.promo_codes;
CREATE TRIGGER trg_promo_codes_upd BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.promo_codes TO service_role;
-- Pa gen GRANT SELECT/INSERT/UPDATE/DELETE pou anon/authenticated espre —
-- pa gen okenn règ RLS ki bezwen ekri: san grant, PostgREST pa ka menm rive
-- nan tab la. RPC SECURITY DEFINER anba yo kouri kòm pwopriyetè fonksyon an
-- (bypass RLS), menm mekanis ak is_restaurant_open/create_order_secure.

-- ---------------------------------------------------------------------------
-- 2) orders.promo_code / orders.discount_amount — istorik: ki kòd (si genyen)
--    ak ki montan rabè te aplike sou KÒMAND SA A espesifikman, menm si kòd
--    la modifye/efase apre. Backfill natirèl: NULL / 0 pou tout kòmand
--    ki deja egziste (yo pa t janm gen okenn kòd pwomo).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS promo_code text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 3) validate_promo_code_secure — APESI read-only (STABLE, pa ekri anyen,
--    pa enkremante uses_count). Kliyan ka rele l plizyè fwa (chanje panye,
--    eseye yon lòt kòd) san okenn efè segondè. Sèl `create_order_secure`
--    (§5 pi ba) fè verifikasyon KI KONTE (ak enkremantasyon reyèl).
CREATE OR REPLACE FUNCTION public.validate_promo_code_secure(_code text, _subtotal numeric)
RETURNS TABLE (valid boolean, discount_amount numeric, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo record;
  v_discount numeric(10,2);
BEGIN
  IF _code IS NULL OR btrim(_code) = '' THEN
    RETURN QUERY SELECT false, 0::numeric(10,2), 'Antre yon kòd pwomo.'::text;
    RETURN;
  END IF;

  SELECT * INTO v_promo FROM public.promo_codes WHERE upper(code) = upper(btrim(_code));
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0::numeric(10,2), 'Kòd pwomo sa a pa egziste.'::text;
    RETURN;
  END IF;
  IF NOT v_promo.active THEN
    RETURN QUERY SELECT false, 0::numeric(10,2), 'Kòd pwomo sa a pa aktif ankò.'::text;
    RETURN;
  END IF;
  IF v_promo.starts_at IS NOT NULL AND v_promo.starts_at > now() THEN
    RETURN QUERY SELECT false, 0::numeric(10,2), 'Kòd pwomo sa a poko aktif.'::text;
    RETURN;
  END IF;
  IF v_promo.ends_at IS NOT NULL AND v_promo.ends_at < now() THEN
    RETURN QUERY SELECT false, 0::numeric(10,2), 'Kòd pwomo sa a ekspire.'::text;
    RETURN;
  END IF;
  IF v_promo.max_uses IS NOT NULL AND v_promo.uses_count >= v_promo.max_uses THEN
    RETURN QUERY SELECT false, 0::numeric(10,2), 'Kòd pwomo sa a fin itilize.'::text;
    RETURN;
  END IF;
  IF v_promo.min_order_amount IS NOT NULL AND COALESCE(_subtotal, 0) < v_promo.min_order_amount THEN
    RETURN QUERY SELECT false, 0::numeric(10,2),
      format('Kòmand minimòm pou kòd sa a se %s HTG.', v_promo.min_order_amount)::text;
    RETURN;
  END IF;

  v_discount := CASE
    WHEN v_promo.discount_type = 'percentage' THEN round(COALESCE(_subtotal, 0) * v_promo.discount_value / 100, 2)
    ELSE v_promo.discount_value
  END;
  v_discount := LEAST(v_discount, COALESCE(_subtotal, 0));
  RETURN QUERY SELECT true, v_discount, 'Kòd pwomo aplike!'::text;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_promo_code_secure(text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_promo_code_secure(text, numeric) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) CRUD admin — list/create/update/delete. `code` pa modifyab apre
--    kreyasyon (update pa aksepte l espre): yon kòd deja distribye pa dwe
--    chanje anba pye kliyan ki gen li deja — efase + rekreye si yon VRÈ
--    nouvo kòd nesesè.
CREATE OR REPLACE FUNCTION public.list_promo_codes_admin()
RETURNS SETOF public.promo_codes
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.promo_codes ORDER BY created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.list_promo_codes_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_promo_codes_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_promo_code_secure(
  _code text,
  _discount_type text,
  _discount_value numeric,
  _min_order_amount numeric DEFAULT NULL,
  _max_uses int DEFAULT NULL,
  _starts_at timestamptz DEFAULT NULL,
  _ends_at timestamptz DEFAULT NULL
)
RETURNS public.promo_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.promo_codes;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _code IS NULL OR length(btrim(_code)) = 0 THEN
    RAISE EXCEPTION 'Kòd pwomo a obligatwa.';
  END IF;
  IF _discount_type NOT IN ('percentage', 'fixed') THEN
    RAISE EXCEPTION 'Tip rabè envalid.';
  END IF;
  IF _discount_value IS NULL OR _discount_value <= 0 THEN
    RAISE EXCEPTION 'Valè rabè a dwe pi gran pase 0.';
  END IF;
  IF _discount_type = 'percentage' AND _discount_value > 100 THEN
    RAISE EXCEPTION 'Rabè an pousantaj pa ka depase 100%%.';
  END IF;

  INSERT INTO public.promo_codes (
    code, discount_type, discount_value, min_order_amount, max_uses, starts_at, ends_at, created_by
  ) VALUES (
    upper(btrim(_code)), _discount_type, _discount_value, _min_order_amount, _max_uses, _starts_at, _ends_at, auth.uid()
  )
  RETURNING * INTO v_row;
  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Kòd pwomo "%" deja egziste.', upper(btrim(_code));
END;
$$;
REVOKE ALL ON FUNCTION public.create_promo_code_secure(text, text, numeric, numeric, int, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_promo_code_secure(text, text, numeric, numeric, int, timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_promo_code_secure(
  _id uuid,
  _discount_type text,
  _discount_value numeric,
  _min_order_amount numeric,
  _max_uses int,
  _starts_at timestamptz,
  _ends_at timestamptz,
  _active boolean
)
RETURNS public.promo_codes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.promo_codes;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _discount_type NOT IN ('percentage', 'fixed') THEN
    RAISE EXCEPTION 'Tip rabè envalid.';
  END IF;
  IF _discount_value IS NULL OR _discount_value <= 0 THEN
    RAISE EXCEPTION 'Valè rabè a dwe pi gran pase 0.';
  END IF;
  IF _discount_type = 'percentage' AND _discount_value > 100 THEN
    RAISE EXCEPTION 'Rabè an pousantaj pa ka depase 100%%.';
  END IF;

  UPDATE public.promo_codes SET
    discount_type = _discount_type,
    discount_value = _discount_value,
    min_order_amount = _min_order_amount,
    max_uses = _max_uses,
    starts_at = _starts_at,
    ends_at = _ends_at,
    active = _active,
    updated_at = now()
  WHERE id = _id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Kòd pwomo pa jwenn'; END IF;
  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_promo_code_secure(uuid, text, numeric, numeric, int, timestamptz, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_promo_code_secure(uuid, text, numeric, numeric, int, timestamptz, timestamptz, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_promo_code_secure(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.promo_codes WHERE id = _id;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_promo_code_secure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_promo_code_secure(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) create_order_secure — DIFAN de Tach 1 (ki te sèlman CREATE OR REPLACE,
--    menm siyati): isit la siyati a REYÈLMAN chanje (`_promo_code text
--    DEFAULT NULL` ajoute kòm DÈNYE paramèt), donk konvansyon pwojè a
--    (`scripts/check-migration-hazards.mjs`, ki egziste espre paske sa te
--    kraze pwodiksyon yon fwa deja) aplike: DROP FUNCTION ansyen siyati a
--    AVAN CREATE — san sa, Postgres ta senpleman AJOUTE yon dezyèm
--    fonksyon "overload" bò kote ansyen an, san erè, san avèti pesonn.
--    `private.create_order_secure` GENYEN yon wrapper piblik
--    (`public.create_order_secure`, §6 pi ba) ke checkout.tsx rele
--    dirèkteman — toude fonksyon yo bezwen menm operasyon DROP+CREATE.
--    Verifikasyon/aplikasyon rabè a fèt apre bouk atik yo (v_subtotal fin
--    kalkile), avan `v_total` kalkile, epi APRE chèk idempotency a (yon
--    replay pa dwe janm re-enkremante uses_count yon dezyèm fwa pou menm
--    kòmand lan — menm règ ak chèk stock/expiration ki deja la).
DROP FUNCTION IF EXISTS private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid);
CREATE FUNCTION private.create_order_secure(
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
  v_discount_amount numeric(10,2) := 0;
  v_applied_promo_code text := NULL;
  v_total numeric(10,2) := 0;
  v_restaurant record;
  v_platform record;
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

  -- Nouvo blòk (Tach 2): kòd pwomo — refè ANTYE server-side, menm si
  -- checkout.tsx te deja montre yon apesi via validate_promo_code_secure.
  -- `FOR UPDATE` bloke ranje kòd la pou tout dire tranzaksyon an, ki
  -- anpeche de kòmand SEMIltane pou menm kòd rive toude "pase" chèk
  -- max_uses la epi toude enkremante — dezyèm nan ta jwenn ranje a bloke
  -- jiskaske premye a fini (COMMIT/ROLLBACK), lè sa a uses_count deja
  -- ajou pou li rewè.
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
    IF v_promo.min_order_amount IS NOT NULL AND v_subtotal < v_promo.min_order_amount THEN
      RAISE EXCEPTION 'Kòmand minimòm pou kòd sa a se % HTG.', v_promo.min_order_amount;
    END IF;

    v_discount_amount := CASE
      WHEN v_promo.discount_type = 'percentage' THEN round(v_subtotal * v_promo.discount_value / 100, 2)
      ELSE v_promo.discount_value
    END;
    v_discount_amount := LEAST(v_discount_amount, v_subtotal);
    v_applied_promo_code := v_promo.code;

    UPDATE public.promo_codes SET uses_count = uses_count + 1, updated_at = now() WHERE id = v_promo.id;
  END IF;

  v_total := v_subtotal - v_discount_amount + v_delivery_fee + v_service_fee;
  UPDATE public.orders SET
    subtotal = v_subtotal,
    service_fee = v_service_fee,
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
-- Menm REVOKE egzat ak tout vèsyon anvan yo (20260703080425 elatriye) —
-- okenn GRANT eksplisit apre: `public.create_order_secure` (SECURITY
-- DEFINER, §6 pi ba) rele l ak privilèj PWOPRIYETÈ fonksyon an, pa privilèj
-- sesyon kliyan an, donk pa gen bezwen okenn wòl ekstèn ka egzekite l
-- dirèkteman.
REVOKE ALL ON FUNCTION private.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) public.create_order_secure — wrapper piblik la, menm operasyon
--    DROP+CREATE, senpleman ajoute `_promo_code` epi pase l tou dwat bay
--    `private.create_order_secure`. checkout.tsx rele fonksyon SA A
--    (dirèkteman, pa `private.` la) — se poutèt sa li dwe genyen menm
--    nouvo paramèt la tou.
DROP FUNCTION IF EXISTS public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid);
CREATE FUNCTION public.create_order_secure(
  _restaurant_id uuid, _items jsonb, _delivery_address text, _contact_phone text,
  _delivery_notes text, _method public.payment_method, _wants_location_sharing boolean DEFAULT false,
  _idempotency_key uuid DEFAULT NULL, _promo_code text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.create_order_secure(
    _restaurant_id, _items, _delivery_address, _contact_phone, _delivery_notes, _method,
    _wants_location_sharing, _idempotency_key, _promo_code
  );
$$;
REVOKE ALL ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_secure(uuid, jsonb, text, text, text, public.payment_method, boolean, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829120000', 'promo_codes_checkout')
ON CONFLICT (version) DO NOTHING;

COMMIT;
