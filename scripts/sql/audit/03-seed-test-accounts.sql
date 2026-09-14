-- ===========================================================================
-- KONT TÈS POU MATRIS WÒL × WOUT LA (odit A2)
--
-- ⚠⚠ LI AVÈTISMAN AN NAN FEN FICHYE A ANVAN OU KOURI SA SOU PWODIKSYON.
--     Mwen PA rekòmande kreye yon kont `super_admin` sou baz pwodiksyon an.
--
-- ---------------------------------------------------------------------------
-- POUKISA SCRIPT SA A PA KREYE KONT YO LI MENM
--
-- Ou te mande yon script ki kreye yon kont pa wòl. Mwen pa ka fè sa an SQL
-- pi, epi eseye a ta yon move sèvis:
--
--   `auth.users` se yon tab GoTrue jere. Pou kreye yon itilizatè ki KA
--   KONEKTE tout bon, ou bezwen: yon modpas hash ak menm algoritm GoTrue
--   sèvi a, yon ranje ki koresponn nan `auth.identities`, epi plizyè chan
--   entèn ki chanje ant vèsyon GoTrue. Yon INSERT dirèk ki sanble mache jodi
--   a ka bay yon kont ki pa ka konekte, oswa kase nan pwochen mizajou
--   Supabase. Se yon zòn kote « sa mache sou machin mwen » koute chè.
--
-- Donk travay la separe an de:
--
--   ETAP 1 — OU (Altes), nan tablo bò Supabase la:
--     Authentication -> Users -> "Add user" -> "Create new user"
--     Kreye SIS kont, ak « Auto Confirm User » aktive:
--
--       qa+customer@nkdeliveri.test
--       qa+restaurant-owner@nkdeliveri.test
--       qa+restaurant-staff@nkdeliveri.test
--       qa+driver@nkdeliveri.test
--       qa+admin@nkdeliveri.test
--       qa+superadmin@nkdeliveri.test          <- wè avètisman an
--
--     Modpas: yon modpas long epi o aza pou CHAK (pa menm youn pou tout).
--     PA JANM mete yo nan yon fichye depo a. Voye yo ban mwen nan chat la
--     sèlman, epi chanje yo apre odit la.
--
--     `.test` se yon TLD RFC 6761 rezève: li PA KA janm yon vrè domèn, donk
--     okenn nan kont sa yo pa ka resevwa yon imèl ni matche yon vrè kliyan.
--     Se sa ki sèvi kòm drapo a — pa yon kolòn anplis nan skema a.
--
--   ETAP 2 — script sa a: li bay chak kont wòl li ak antite li posede.
--
-- ⚠ Script sa a MODIFYE done (li ekri nan `user_roles`, `profiles`,
--   `restaurants`, `drivers`, `restaurant_employees`). Se sèl script nan
--   dosye sa a ki ekri. Tout lòt yo se lekti sèlman.
--
-- ===========================================================================

BEGIN;

-- Gad: si youn nan kont yo pa egziste, sispann NÈT olye nou kreye yon eta
-- mwatye fèt ki pi difisil pou netwaye pase pa gen anyen.
DO $$
DECLARE
  v_manke text;
BEGIN
  SELECT string_agg(e, ', ') INTO v_manke
  FROM unnest(ARRAY[
    'qa+customer@nkdeliveri.test',
    'qa+restaurant-owner@nkdeliveri.test',
    'qa+restaurant-staff@nkdeliveri.test',
    'qa+driver@nkdeliveri.test',
    'qa+admin@nkdeliveri.test',
    'qa+superadmin@nkdeliveri.test'
  ]) e
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.email = e);

  IF v_manke IS NOT NULL THEN
    RAISE EXCEPTION 'Kont sa yo poko kreye nan tablo Supabase la: %. Fè ETAP 1 anvan.', v_manke;
  END IF;
END $$;

-- Ti asistan lokal: imèl -> uuid.
CREATE TEMP TABLE qa_users ON COMMIT DROP AS
SELECT u.id, u.email
FROM auth.users u
WHERE u.email LIKE 'qa+%@nkdeliveri.test';

-- --------------------------------------------------------------------------
-- 1) Wòl yo
-- --------------------------------------------------------------------------
INSERT INTO public.user_roles (user_id, role)
SELECT q.id,
       (CASE q.email
          WHEN 'qa+customer@nkdeliveri.test'         THEN 'customer'
          WHEN 'qa+restaurant-owner@nkdeliveri.test' THEN 'restaurant_owner'
          WHEN 'qa+restaurant-staff@nkdeliveri.test' THEN 'restaurant_staff'
          WHEN 'qa+driver@nkdeliveri.test'           THEN 'driver'
          WHEN 'qa+admin@nkdeliveri.test'            THEN 'admin'
          WHEN 'qa+superadmin@nkdeliveri.test'       THEN 'super_admin'
        END)::public.app_role
FROM qa_users q
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------------------
-- 2) Pwofil yo — non klèman make, okenn done reyèl
-- --------------------------------------------------------------------------
-- `profiles` gen `first_name` / `last_name`, PA yon `full_name` — verifye
-- kont types.ts rejenere a (premye vèsyon fichye sa a te envante kolòn nan).
INSERT INTO public.profiles (id, first_name, last_name)
SELECT q.id, 'QA', split_part(split_part(q.email, '+', 2), '@', 1)
FROM qa_users q
ON CONFLICT (id) DO UPDATE
  SET first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name;

-- --------------------------------------------------------------------------
-- 3) DE restoran tès — youn pou pwopriyetè QA a, youn ki pou YON LÒT
--    pwopriyetè QA. Dezyèm lan se sa ki enpòtan: san yon dezyèm restoran,
--    nou pa ka teste kesyon an ki konte vre — « eske restoratè A ka wè
--    kòmand restoran B? »
-- --------------------------------------------------------------------------
INSERT INTO public.restaurants (owner_id, name, slug, status, address)
SELECT q.id, 'QA Restoran A', 'qa-restoran-a', 'approved'::public.restaurant_status, 'QA — pa yon vrè adrès'
FROM qa_users q WHERE q.email = 'qa+restaurant-owner@nkdeliveri.test'
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.restaurants (owner_id, name, slug, status, address)
SELECT q.id, 'QA Restoran B', 'qa-restoran-b', 'approved'::public.restaurant_status, 'QA — pa yon vrè adrès'
FROM qa_users q WHERE q.email = 'qa+superadmin@nkdeliveri.test'
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------------------------
-- 4) Anplwaye restoran — `restaurant_staff` mare ak Restoran A SÈLMAN
-- --------------------------------------------------------------------------
INSERT INTO public.restaurant_employees (restaurant_id, user_id)
SELECT r.id, q.id
FROM public.restaurants r, qa_users q
WHERE r.slug = 'qa-restoran-a' AND q.email = 'qa+restaurant-staff@nkdeliveri.test'
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------------------
-- 5) Livrè tès
-- --------------------------------------------------------------------------
INSERT INTO public.drivers (user_id, status)
SELECT q.id, 'approved'::public.driver_status
FROM qa_users q WHERE q.email = 'qa+driver@nkdeliveri.test'
ON CONFLICT DO NOTHING;

COMMIT;

-- Kontwòl apre: sis liy, yon wòl chak.
SELECT u.email, ur.role
FROM auth.users u
JOIN public.user_roles ur ON ur.user_id = u.id
WHERE u.email LIKE 'qa+%@nkdeliveri.test'
ORDER BY u.email;

-- ===========================================================================
-- AVÈTISMAN — RISK SA A POTE SOU YON BAZ PWODIKSYON
--
-- 1) YON KONT `super_admin` SOU PWODIKSYON SE YON PÒT DÈYÈ. Se pwen ki pi
--    grav la. Yon kont ak yon modpas ki sikile nan yon chat, ki rete aktif
--    apre odit la, ki gen tout dwa yo — se egzakteman jan yon platfòm pèdi.
--    Si modpas la fèb oswa li fuite, moun nan posede tout bagay.
--
-- 2) DONE TÈS POLUE VRÈ CHIF YO. Restoran QA yo ap parèt nan lis piblik la
--    (yo `approved`), nan sitemap la, nan KPI admin yo, epi nan
--    `commission_ledger` si yon kòmand tès pase. Chif finansye w yo vin fo.
--
-- 3) SITEMAP AK GOOGLE. `qa-restoran-a` ak `qa-restoran-b` pral antre nan
--    /sitemap.xml otomatikman (li jenere depi tab `restaurants` la), donk
--    Google ka endekse de restoran ki pa egziste.
--
-- ---------------------------------------------------------------------------
-- SA MWEN REKÒMANDE OLYE
--
--   A) PI BON — yon dezyèm pwojè Supabase (staging) ak yon dump skema
--      sèlman. Zewo done reyèl, zewo risk sou pwodiksyon, epi ou ka teste
--      `super_admin` alèz. Se sèl apwòch ki elimine risk 1, 2 ak 3.
--
--   B) SI SE PWODIKSYON KANMENM — kreye SÈLMAN kat wòl ki ba yo:
--      `customer`, `restaurant_owner`, `restaurant_staff`, `driver`.
--      Se la vrè kesyon an ye: « eske A ka wè done B? » Pou `admin` ak
--      `super_admin`, mwen ka odite gad yo an lekti (règleman RLS plis gad
--      `private.has_role` nan chak fonksyon SECURITY DEFINER) san yon sesyon
--      admin. Sa kouvri majorite matris la san louvri pòt dèyè a.
--      Nan ka sa a: kouri script sa a SAN de liy `qa+superadmin` yo, epi
--      mete Restoran B sou `qa+customer` olye.
--
--   C) SI `super_admin` OBLIGATWA — kreye l, teste, EFASE L menm jou a
--      (04-drop-test-accounts.sql), ak yon modpas o aza long, epi konfime
--      efasman an ak rekèt kontwòl la.
--
-- Nan tout ka: mete `qa-restoran-a` ak `qa-restoran-b` sou `status =
-- 'pending'` olye `'approved'` si ou pa bezwen yo vizib piblikman —
-- sa retire risk 3 la nèt.
-- ===========================================================================
