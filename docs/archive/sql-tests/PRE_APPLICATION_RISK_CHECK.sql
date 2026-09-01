-- Verifikasyon done AVAN aplikasyon 20260821100000_restaurant_open_check_
-- order_creation.sql. OTO-PÒTAN (BEGIN...ROLLBACK) — kole li tèl li ye a
-- nan SQL Editor, kopye rezilta 3 REQUÈT yo, epi ROLLBACK anile tout bagay
-- (menm CREATE OR REPLACE tanporè is_restaurant_open() yo bezwen pou
-- Requèt 2 ak 3 yo — pa gen anyen ki rete aplike an pwodiksyon).

BEGIN;

-- ===========================================================================
-- Enstalasyon tanporè minim pou is_restaurant_open() ka egzekite (Requèt 2
-- ak 3 rele l) — menm kò ak 20260821100000, san trigger/backfill/RPC admin
-- (pa nesesè pou senp evalyasyon done ki deja egziste yo).
CREATE OR REPLACE FUNCTION private.opening_hours_grace_period()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '30 days' $$;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS opening_hours_grace_until timestamptz;

-- Sèlman pou Requèt 2/3 ka evalye "si migrasyon an te aplike KOUNYE A":
-- backfill tanporè (menm statman ak vrè migrasyon an) pou restoran vid yo
-- jwenn yon fenèt gras — san sa, Requèt 2 ta montre TOUT restoran vid kòm
-- "fèmen", ki ta bay yon fo pozitif (yo ta reyèlman louvri pandan 30 jou
-- gras la si migrasyon an te aplike pou vre).
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

  -- Jou absan (v_today_entry IS NULL) = louvri pa default — koreksyon
  -- apre twouve "Gou laky" (mardi→vandredi absan, kòmand reyèl kanmenm).
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

-- ===========================================================================
-- REQUÈT 1 — Konbyen restoran apwouve gen orè, konbyen pa genyen.
SELECT
  count(*) FILTER (WHERE opening_hours IS NULL OR opening_hours = '{}'::jsonb) AS san_ore,
  count(*) FILTER (WHERE opening_hours <> '{}'::jsonb)                          AS ak_ore,
  count(*)                                                                      AS total
FROM public.restaurants
WHERE status = 'approved';

-- ===========================================================================
-- REQUÈT 2 — Restoran ki ta konsidere FÈMEN KOUNYE A si migrasyon an te
-- aplike (apre backfill 30-jou gras la), pou enspekte a lè: èske yo
-- reyèlman fèmen kounye a, oswa èske orè yo antre mal?
SELECT id, name, opening_hours
FROM public.restaurants
WHERE status = 'approved'
  AND opening_hours <> '{}'::jsonb
  AND NOT public.is_restaurant_open(id, now())
ORDER BY name;

-- ===========================================================================
-- REQUÈT 3 — Mezi risk dirèk: pami kòmand ki fèt 30 dènye jou yo, konbyen
-- te fèt sou yon restoran ki gen orè konfigire, nan yon moman ki DEYÒ orè
-- (kounye a konfigire) sa yo? Se yon apwoksimasyon (orè yo ka te chanje
-- depi kòmand lan), men se yon mezi dirèk sa migrasyon an ta blokan si l
-- te deja aktif.
--
-- ⚠️ LIMIT ENPÒTAN — LI REZILTA SA A NAN LIMIYÈ REQUÈT 1 LA, PA ISOLE:
-- Requèt 3 la SÈLMAN ka mezire restoran ki gen orè ranpli (ak_ore nan
-- Requèt 1). Restoran ki gen '{}' (san_ore — dapre rapò enspeksyon an,
-- MAJORITE pak la) pa gen anyen pou konpare, donk yo sòti zewo pa
-- definisyon, pa paske yo san risk. Yon chif ba pou Requèt 3 vle di
-- "risk ba pou pòsyon pak ki deja konfigire a" — pa "risk ba pou tout
-- pak la". Vrè risk pak san_ore a pa pral parèt jiskaske fenèt gras 30
-- jou a ekspire epi yo oblije antre orè yo — souvan nan prese, ak erè.
--
-- Chif prè de zewo -> aplike san krent (pou pòsyon ak_ore a sèlman).
-- Chif elve -> swa orè yo mal antre, swa kliyan yo abitye kòmande deyò
--   orè afiche yo — nan de ka yo, bezwen envestige AVAN aplikasyon, paske
--   dezyèm ka a se yon pèt chif dafè, pa yon koreksyon bug.
SELECT r.id, r.name, count(*) AS kòmand_deyò_orè,
  min(o.created_at) AS pi_ansyen, max(o.created_at) AS pi_resan
FROM public.orders o
JOIN public.restaurants r ON r.id = o.restaurant_id
WHERE o.created_at > now() - interval '30 days'
  AND r.status = 'approved'
  AND r.opening_hours <> '{}'::jsonb
  AND NOT public.is_restaurant_open(r.id, o.created_at)
GROUP BY r.id, r.name
ORDER BY kòmand_deyò_orè DESC;

ROLLBACK;
