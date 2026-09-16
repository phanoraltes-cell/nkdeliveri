-- ===========================================================================
-- ODIT — ESKE ASISTAN AI ADMIN NAN PARE SOU BAZ LA?
--
-- SA L CHÈCHE : tout sa migrasyon 20260830160000_admin_ai_assistant.sql
-- kreye a, plis RPC limit la wout la depann de li. Yon sèl repons pou tout.
--
-- POUKISA : kòd la konplè depi lontan (src/routes/api.admin.ai.ts,
-- src/lib/ai/claude.ts, paj /dashboard/admin/ai). Sèl bagay ki kenbe l
-- fèmen se varyab ANTHROPIC_API_KEY la. Anvan ou depanse yon sèl kredi,
-- tcheke ke bò baz la pa gen anyen ki manke — yon tab ki manke pa ta bay
-- yon erè klè, li ta jis fè jounal la echwe an silans
-- (api.admin.ai.ts:117 `console.warn`, li pa lage erè a).
--
-- ⚠ LEKTI SÈLMAN. Okenn ekriti.
--
-- KIJAN POU LI REZILTA A : chèche `"tout_pare"`.
--   true   -> bò baz la okay, rete varyab anviwònman an sèlman
--   false  -> gade ki liy ki `false` nan detay yo
-- ===========================================================================

WITH tab AS (
  SELECT
    to_jsonb(array_agg(t.relname ORDER BY t.relname)) AS jwenn,
    count(*) FILTER (WHERE t.relrowsecurity) AS ak_rls,
    count(*) AS total
  FROM pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relkind = 'r'
    AND t.relname IN ('ai_usage_log', 'ai_summary_cache')
),
fonk AS (
  SELECT
    to_jsonb(array_agg(p.proname ORDER BY p.proname)) AS jwenn,
    count(*) AS total
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_admin_ai_traffic_stats_secure',
      'get_admin_priorities_secure',
      -- Wout la rele sa a pou plafon apèl pa jou a (AI_MAX_CALLS_PER_DAY).
      -- Si li manke, chak apèl echwe anvan li rive kot Claude.
      'check_rate_limit_secure'
    )
),
-- Kolòn yo, paske `insert` nan api.admin.ai.ts:107 nonmen yo youn pa youn.
-- Yon kolòn ki manke = jounal la echwe an silans, epi nou pèdi tras depans.
kolon AS (
  SELECT to_jsonb(array_agg(a.attname ORDER BY a.attname)) AS jwenn, count(*) AS total
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'ai_usage_log'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname IN (
      'admin_id', 'feature', 'model', 'input_tokens', 'output_tokens', 'status', 'error'
    )
),
-- Eske gen admin ki ka itilize l ditou? Yon panèl ki mache pou pèsòn se
-- yon panèl ki pa mache.
wol AS (
  SELECT count(*) AS kantite
  FROM public.user_roles
  WHERE role IN ('admin', 'super_admin')
),
-- Eske gen deja konsomasyon anrejistre? Si wi, li te deja mache yon lè —
-- sa chanje dyagnostik la nèt.
istwa AS (
  SELECT
    count(*) AS apel_total,
    count(*) FILTER (WHERE status = 'error') AS apel_erè,
    max(created_at) AS dènye_apèl,
    coalesce(sum(input_tokens), 0) AS token_antre,
    coalesce(sum(output_tokens), 0) AS token_soti
  FROM public.ai_usage_log
)
SELECT jsonb_pretty(jsonb_build_object(
  'tout_pare',
      (SELECT total FROM tab) = 2
  AND (SELECT ak_rls FROM tab) = 2
  AND (SELECT total FROM fonk) = 3
  AND (SELECT total FROM kolon) = 7
  AND (SELECT kantite FROM wol) > 0,

  'tab', jsonb_build_object(
    'jwenn', (SELECT jwenn FROM tab),
    'sou_2', (SELECT total FROM tab),
    'ak_rls_aktive', (SELECT ak_rls FROM tab)
  ),
  'fonksyon', jsonb_build_object(
    'jwenn', (SELECT jwenn FROM fonk),
    'sou_3', (SELECT total FROM fonk)
  ),
  'kolon_ai_usage_log', jsonb_build_object(
    'jwenn', (SELECT jwenn FROM kolon),
    'sou_7', (SELECT total FROM kolon)
  ),
  'admin_ki_ka_sèvi_l', (SELECT kantite FROM wol),
  'konsomasyon_deja', jsonb_build_object(
    'apèl_total', (SELECT apel_total FROM istwa),
    'apèl_erè', (SELECT apel_erè FROM istwa),
    'dènye_apèl', (SELECT dènye_apèl FROM istwa),
    'token_antre', (SELECT token_antre FROM istwa),
    'token_soti', (SELECT token_soti FROM istwa)
  )
)) AS rezilta;
