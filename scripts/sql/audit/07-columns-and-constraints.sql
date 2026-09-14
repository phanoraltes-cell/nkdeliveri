-- ===========================================================================
-- ODIT A1/A4 (bò baz done) — KOLÒN AK KONTRENT
--
-- SA L CHÈCHE :
--   A) kolòn ki TOUJOU NIL sou tout ranje — swa mò, swa JANM ALIMANTE.
--      Dezyèm ka a se yon BUG, pa yon netwayaj: yon chan ki te sipoze gen
--      yon valè epi ki pa janm resevwa youn.
--   B) kolòn ki gen yon SÈL valè sou tout ranje (konstant) — menm kesyon.
--   C) kontrent CHECK ki gen yon lis `IN (...)` — pou konpare ak valè ki
--      egziste tout bon.
--   D) kolòn `numeric` ki gen yon valè `NaN` — yon montan lajan kase.
--
-- ⚠ LEKTI SÈLMAN. Okenn ekriti.
--
-- NÒT SOU (A) ak (B): rekèt la gen yon BOUCLE ki li chak tab. Sou yon baz
-- ki gwo sa ka pran tan. Li limite tèt li ak tab ki gen OMWEN 1 ranje, epi
-- li bay yon sèl liy pa kolòn ki konsène — pa yon dumping.
-- ===========================================================================

-- A + B) KOLÒN TOUJOU NIL OSWA KONSTANT
DO $$
DECLARE
  r record;
  v_total bigint;
  v_non_nil bigint;
  v_distinct bigint;
  v_valè text;
BEGIN
  RAISE NOTICE 'tab.kolòn | eta | valè inik | ranje';
  RAISE NOTICE '-----------------------------------------';
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN pg_class pc ON pc.relname = c.table_name
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
    WHERE c.table_schema = 'public' AND pc.relkind = 'r'
    ORDER BY c.table_name, c.ordinal_position
  LOOP
    EXECUTE format('SELECT count(*), count(%I), count(DISTINCT %I) FROM public.%I',
                   r.column_name, r.column_name, r.table_name)
      INTO v_total, v_non_nil, v_distinct;

    CONTINUE WHEN v_total = 0;                 -- tab vid: pa gen anyen pou di
    IF v_non_nil = 0 THEN
      RAISE NOTICE '% . %  | TOUJOU NIL | 0 | % ranje', r.table_name, r.column_name, v_total;
    ELSIF v_distinct = 1 AND v_total > 5 THEN
      EXECUTE format('SELECT DISTINCT %I::text FROM public.%I WHERE %I IS NOT NULL LIMIT 1',
                     r.column_name, r.table_name, r.column_name) INTO v_valè;
      RAISE NOTICE '% . %  | KONSTANT (%) | 1 | % ranje',
        r.table_name, r.column_name, left(coalesce(v_valè, ''), 30), v_total;
    END IF;
  END LOOP;
END $$;

-- C) KONTRENT CHECK AK YON LIS VALÈ
SELECT c.conrelid::regclass AS tab, c.conname AS kontrent,
       pg_get_constraintdef(c.oid) AS definisyon
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE c.contype = 'c' AND n.nspname = 'public'
  AND pg_get_constraintdef(c.oid) ILIKE '%ANY (ARRAY%'
ORDER BY 1, 2;

-- D) MONTAN `NaN` NAN KOLÒN numeric
--    `col <> 'NaN'::numeric` se tès la ki kòrèk: nan `numeric`, NaN EGAL
--    tèt li, donk `col = col` pa filtre l epi `col IS NOT NULL` non plis.
DO $$
DECLARE r record; v_n bigint;
BEGIN
  RAISE NOTICE 'kolòn numeric ki gen NaN:';
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN pg_class pc ON pc.relname = c.table_name
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
    WHERE c.table_schema = 'public' AND pc.relkind = 'r'
      AND c.data_type IN ('numeric', 'double precision', 'real')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I::text = ''NaN''',
                   r.table_name, r.column_name) INTO v_n;
    IF v_n > 0 THEN
      RAISE NOTICE '  ⚠ % . % -> % ranje ak NaN', r.table_name, r.column_name, v_n;
    END IF;
  END LOOP;
  RAISE NOTICE '  (pa gen lòt liy = okenn NaN, sa ki se rezilta nou vle a)';
END $$;
