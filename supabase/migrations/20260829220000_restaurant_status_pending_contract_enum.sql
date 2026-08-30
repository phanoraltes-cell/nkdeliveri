-- PROMPT MODIFIKASYON (10 TACH) — Tach 7 (pati 1/2): nouvo valè
-- `pending_contract` pou public.restaurant_status.
--
-- SPLIT NAN 2 FICHYE ESPRE (menm jan ak 20260817110000_nkd016_delivery_
-- failed_enum_values.sql, ki egziste deja nan pwojè sa a pou EGZAKTEMAN
-- menm rezon): Postgres entèdi itilize yon nouvo valè enum (nan yon
-- INSERT/UPDATE/konparezon, oswa nan kò yon fonksyon ki EGZEKITE
-- imedyatman) nan MENM tranzaksyon ki te ajoute l la ak ALTER TYPE ... ADD
-- VALUE. Pati 2 (20260829220500_restaurant_contract_esignature.sql)
-- itilize valè sa a nan kò plizyè fonksyon — fichye sa a dwe aplike
-- (COMMITE) DABÒ, apre sa Pati 2.
--
-- ROLLBACK: Postgres pa sipòte DROP VALUE sou yon enum. Si sa dwe janm
-- ranvèse: 1) konfime zewo ranje referanse 'pending_contract'
-- (SELECT count(*) FROM restaurants WHERE status = 'pending_contract' —
-- dwe 0), 2) rekreye tip la san nouvo valè a anba yon non tanporè,
-- 3) ALTER TABLE restaurants ALTER COLUMN status TYPE <tanporè> USING
-- status::text::<tanporè>, 4) DROP ansyen tip la, chanje non tanporè a pou
-- pran plas li. Pa script isit la — yon operasyon ra, manyèl, verifye ak
-- done, jamè kouri aveg.
--
-- Wrapped BEGIN...COMMIT (A11 — Altes aplike fichye sa a manyèlman nan SQL
-- Editor Supabase, mwen (AI) pa janm egzekite l). Sekirite: `ADD VALUE`
-- san danje anndan yon tranzaksyon eksplisit depi Postgres 12 — sèl bagay
-- ki entèdi se ITILIZE valè a nan MENM tranzaksyon an, sa fichye sa a pa
-- fè ditou (A11 INSERT la pa touche `restaurant_status` menm jan).
BEGIN;

ALTER TYPE public.restaurant_status ADD VALUE IF NOT EXISTS 'pending_contract';

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260829220000', 'restaurant_status_pending_contract_enum')
ON CONFLICT (version) DO NOTHING;

COMMIT;
