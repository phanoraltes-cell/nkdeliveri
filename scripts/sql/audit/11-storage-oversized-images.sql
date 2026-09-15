-- ===========================================================================
-- ODIT A6 — IMAJ KI DEJA NAN STORAGE EPI KI TWÒ LOU
--
-- SA L CHÈCHE : chak objè nan Supabase Storage ki depase yon limit, ak pwa
-- total pa bikèt, pou nou konnen konbyen done ki deja la anvan nou deside
-- kisa pou fè.
--
-- POUKISA : mezire sou dakèy pwodiksyon an —
--   cover-…Plat fruit.jpeg  = 1 803 Ko, afiche nan yon kare 280x160
--   epi `compressImageFile` egziste nan depo a men li rele nan YON SÈL
--   chemen (media-uploader.tsx:217, anons admin). Tout lòt chemen upload
--   yo — kouvèti restoran, foto meni, avatar, logo patnè — pa konprese.
--
-- ⚠ LEKTI SÈLMAN. Okenn ekriti. Yon sèl ranje JSON, donk editè a montre
--   tout bagay (leson 02-payouts-disputed.sql).
--
-- LIMIT LA: 300 Ko pa defo, jan sa te mande. Chanje `v_limit_bytes` anba a
-- si ou vle yon lòt papòt.
--
-- ---------------------------------------------------------------------------
-- NÒT SOU `metadata`
--
-- Supabase Storage estoke tay la nan `storage.objects.metadata->>'size'`.
-- Rekèt la ekspoze yon echantiyon `metadata` brit tou: si kle a rele yon
-- lòt non nan vèsyon ou an, w ap wè l touswit olye w jwenn zewo partou.
-- ===========================================================================

WITH params AS (
  SELECT 300 * 1024 AS v_limit_bytes
),
objs AS (
  SELECT
    o.bucket_id,
    o.name,
    coalesce((o.metadata ->> 'size')::bigint, 0) AS size_bytes,
    o.metadata ->> 'mimetype' AS mimetype,
    o.created_at
  FROM storage.objects o
)
SELECT jsonb_pretty(
  jsonb_build_object(

    -- Kontwòl: si sa a vid oswa si `size` toujou 0, kle metadata a gen yon
    -- lòt non nan vèsyon ou an — gade `echantiyon_metadata` anba a.
    'total_objè',        (SELECT count(*) FROM objs),
    'total_pwa_Ko',      (SELECT round(coalesce(sum(size_bytes), 0) / 1024.0, 1) FROM objs),
    'limit_Ko',          (SELECT v_limit_bytes / 1024 FROM params),

    'echantiyon_metadata',
      (SELECT coalesce(jsonb_agg(m), '[]'::jsonb)
       FROM (SELECT o.metadata FROM storage.objects o LIMIT 2) m),

    -- Rezime pa bikèt: se sa ki di kote pwoblèm nan ye.
    'pa_bikèt',
      (SELECT coalesce(jsonb_agg(x ORDER BY (x ->> 'pwa_Ko')::numeric DESC), '[]'::jsonb)
       FROM (
         SELECT jsonb_build_object(
                  'bikèt',        bucket_id,
                  'objè',         count(*),
                  'pwa_Ko',       round(sum(size_bytes) / 1024.0, 1),
                  'depase_limit', count(*) FILTER (WHERE size_bytes > (SELECT v_limit_bytes FROM params)),
                  'pi_gwo_Ko',    round(max(size_bytes) / 1024.0, 1),
                  'mwayèn_Ko',    round(avg(size_bytes) / 1024.0, 1)
                ) AS x
         FROM objs
         GROUP BY bucket_id
       ) s),

    -- Konbyen n ap sove si nou trete sa ki depase limit la.
    'depase_limit_konte',
      (SELECT count(*) FROM objs, params WHERE size_bytes > v_limit_bytes),
    'depase_limit_pwa_Ko',
      (SELECT round(coalesce(sum(size_bytes), 0) / 1024.0, 1) FROM objs, params
       WHERE size_bytes > v_limit_bytes),

    -- Lis la, pi lou an premye. Limite a 100 pou sòti a rete lizib.
    'pi_lou_yo',
      (SELECT coalesce(jsonb_agg(x ORDER BY (x ->> 'pwa_Ko')::numeric DESC), '[]'::jsonb)
       FROM (
         SELECT jsonb_build_object(
                  'bikèt',   bucket_id,
                  'chemen',  name,
                  'pwa_Ko',  round(size_bytes / 1024.0, 1),
                  'tip',     mimetype,
                  'depi',    created_at::date
                ) AS x
         FROM objs, params
         WHERE size_bytes > v_limit_bytes
         ORDER BY size_bytes DESC
         LIMIT 100
       ) s)
  )
) AS rapo;

-- ===========================================================================
-- APRE OU KOURI L
--
-- Transfòmasyon imaj sou demann AKTIVE sou pwojè sa a — mwen teste l sou
-- vrè imaj 1,8 Mo a:
--
--   /storage/v1/object/public/…            -> 1 846 042 octè
--   /storage/v1/render/image/public/…      ->    12 778 octè
--       ?width=280&height=160&resize=cover&quality=70
--   menm bagay ak `Accept: image/webp`     ->    13 056 octè
--
-- Donk pou TOUT sa rekèt sa a jwenn, koreksyon an se yon chanjman URL —
-- okenn retelechajman, okenn migrasyon done, okenn pèt.
--
-- ⚠ MEN SA PA KOUVRI `public/kategori/*.webp` (2048x2048, jiska 758 Ko).
--   Sa yo se fichye estatik nan depo a, Vercel ki sèvi yo. Endpoint
--   transfòmasyon Supabase la pa touche yo — yo mande yon vrè
--   redimansyonman nan depo a.
-- ===========================================================================
