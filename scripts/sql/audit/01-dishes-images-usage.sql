-- ===========================================================================
-- ODIT A1 — PWEN 4 : eske imaj `/dishes/*.webp` yo toujou sèvi?
--
-- SA L CHÈCHE : konbyen ranje nan `public.products` ki gen yon `image_url`
-- ki pwente sou yon fichye nan `public/dishes/`. Migrasyon
-- 20260703190000_8f6835af-….sql te mete valè sa yo; okenn kòd pa site yo,
-- donk referans lan pase SÈLMAN pa baz done a.
--
-- Ajan an pa t ka reponn poukont li: RLS anon an montre 3 pwodwi sèlman.
--
-- ⚠ LEKTI SÈLMAN. Okenn INSERT, UPDATE, DELETE, okenn DDL. Ou ka kouri l
--   nenpòt kilè, menm sou pwodiksyon, san okenn efè.
--
-- KIJAN POU LI REZILTA A :
--   sou_dishes = 0  -> imaj yo mò tout bon, nou ka efase 8 fichye yo (461 Ko)
--   sou_dishes > 0  -> yo VIVAN, nou kite yo epi nou pa touche prekach la
-- ===========================================================================

-- ⚠ FICHYE SA A GEN PLIZYÈ REKÈT.
--
--   Editè SQL Supabase la montre SÈLMAN dènye jeu rezilta a. Si ou kole
--   tout fichye a yon sèl kou, ou pral wè dènye rekèt la epi rès la ap
--   envizib — san okenn mesaj pou di w sa.
--
--   KOURI CHAK REKÈT YON PA YON (chak blòk ki fini ak `;`), epi kole chak
--   rezilta apa. Sinon voye yo nan yon sèl `jsonb_build_object` jan
--   02-payouts-disputed.sql fè a.


-- 1) Konte a — se sa ki deside.
select
  count(*)                                                   as total_pwodwi,
  count(*) filter (where image_url like '/dishes/%')          as sou_dishes,
  count(*) filter (where image_url is null)                   as san_imaj,
  count(*) filter (where image_url is not null
                     and image_url not like '/dishes/%')      as lot_imaj
from public.products;

-- 2) Si `sou_dishes` > 0, ki sa yo ye egzakteman.
select p.id, p.name, p.image_url, p.available, r.name as restoran, r.status as estati_restoran
from public.products p
left join public.restaurants r on r.id = p.restaurant_id
where p.image_url like '/dishes/%'
order by r.name, p.name;

-- 3) Menm kesyon an sou restoran yo (logo/cover ka pwente la tou).
select count(*) filter (where logo_url like '/dishes/%')  as logo_sou_dishes,
       count(*) filter (where cover_url like '/dishes/%') as cover_sou_dishes
from public.restaurants;
