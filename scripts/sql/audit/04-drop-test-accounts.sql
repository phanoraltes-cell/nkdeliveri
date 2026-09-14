-- ===========================================================================
-- EFASE KONT TÈS YO — defè 03-seed-test-accounts.sql
--
-- ⚠ SCRIPT SA A EFASE DONE. Li vize SÈLMAN sa ki make `qa+…@nkdeliveri.test`.
--   `.test` se yon TLD RFC 6761 rezève: li PA KA janm yon vrè domèn, donk
--   okenn vrè kliyan pa ka matche. Se sa ki fè drapo a san danje.
--
-- ⚠ KOURI L MENM JOU AK ODIT LA. Yon kont `super_admin` ki rete aktif apre
--   se yon pòt dèyè, pa yon rezidi.
--
-- ORD LA ENPÒTAN: pitit anvan paran. Yon `DELETE` sou `auth.users` dabò ta
-- swa echwe sou yon kle etranje, swa kaskade sou plis pase sa nou vle.
--
-- ETAP FINAL (pa nan SQL): apre script sa a, efase sis kont yo nan tablo
-- Supabase la — Authentication -> Users -> chèche "qa+" -> Delete. Se GoTrue
-- ki mèt `auth.users`; nou pa touche l isit la pou menm rezon 03 la pa kreye
-- ladan l.
-- ===========================================================================

BEGIN;

-- Kont QA yo, yon sèl fwa.
CREATE TEMP TABLE qa_users ON COMMIT DROP AS
SELECT u.id FROM auth.users u WHERE u.email LIKE 'qa+%@nkdeliveri.test';

-- Restoran QA yo (pa slug, pa pa pwopriyetè — konsa nou pa janm pran yon
-- vrè restoran yon kont QA ta rive posede pa erè).
CREATE TEMP TABLE qa_restaurants ON COMMIT DROP AS
SELECT r.id FROM public.restaurants r WHERE r.slug IN ('qa-restoran-a', 'qa-restoran-b');

-- Bous QA yo — kalkile ISIT LA, AVAN okenn efasman.
--
-- De rezon:
--   * `wallets` PA gen yon kolòn `owner_id` (premye vèsyon fichye sa a te
--     envante l). Mèt la dedwi de `user_id`, `restaurant_id` oswa
--     `driver_id`; nou pran toude twa, sinon bous yon restoran QA rete dèyè.
--   * Si nou te kalkile l apre `DELETE FROM public.drivers` pi ba a, ranje
--     livrè a pa ta la ankò epi bous li a ta rate — yon òfelen nou t ap kite
--     nan yon script ki fèt pou netwaye.
CREATE TEMP TABLE qa_wallets ON COMMIT DROP AS
SELECT w.id FROM public.wallets w
WHERE w.user_id IN (SELECT id FROM qa_users)
   OR w.restaurant_id IN (SELECT id FROM qa_restaurants)
   OR w.driver_id IN (
        SELECT d.id FROM public.drivers d WHERE d.user_id IN (SELECT id FROM qa_users)
      );

-- Gad: si yon kòmand reyèl mare ak yon restoran QA, SISPANN. Sa vle di yon
-- vrè kliyan te kòmande la, epi efase l ta detwi yon vrè kòmand.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
  FROM public.orders o
  WHERE o.restaurant_id IN (SELECT id FROM qa_restaurants)
    AND o.user_id NOT IN (SELECT id FROM qa_users);
  IF v_n > 0 THEN
    RAISE EXCEPTION
      'SISPANN: % kòmand ki PA soti nan yon kont QA mare ak yon restoran QA. Egzamine yo alamen anvan.', v_n;
  END IF;
END $$;

-- 1) Sa ki depann de kòmand QA yo
DELETE FROM public.order_chat_reads      WHERE order_id IN (SELECT id FROM public.orders WHERE user_id IN (SELECT id FROM qa_users));
DELETE FROM public.order_chat_messages   WHERE order_id IN (SELECT id FROM public.orders WHERE user_id IN (SELECT id FROM qa_users));
DELETE FROM public.order_items           WHERE order_id IN (SELECT id FROM public.orders WHERE user_id IN (SELECT id FROM qa_users));
DELETE FROM public.deliveries            WHERE order_id IN (SELECT id FROM public.orders WHERE user_id IN (SELECT id FROM qa_users));
DELETE FROM public.payments              WHERE order_id IN (SELECT id FROM public.orders WHERE user_id IN (SELECT id FROM qa_users));
DELETE FROM public.orders                WHERE user_id IN (SELECT id FROM qa_users);

-- 2) BOUS YO — AVAN restoran ak livrè yo, epi lòd la pa abitrè.
--
--    `wallets.restaurant_id` ak `wallets.driver_id` gen ON DELETE CASCADE.
--    Donk efase yon restoran QA ta efase bous li OTOMATIKMAN. Sa ta parèt
--    pratik, men `payouts.wallet_id` gen yon kontrent SAN cascade
--    (20260722100000_payout_wallet_schema.sql:123 — `NOT NULL REFERENCES
--    public.wallets(id)`, san ON DELETE). Donk si yon bous QA gen yon sèl
--    vèsman, cascade la echwe epi TOUT script la tonbe.
--
--    Nou pa depann de okenn cascade: nou vide sa ki pwente sou bous la, epi
--    nou efase bous la nou menm, anvan nenpòt bagay ki ta ka deklanche yon
--    cascade sou li.
DELETE FROM public.wallet_transactions   WHERE wallet_id IN (SELECT id FROM qa_wallets);
DELETE FROM public.payouts               WHERE wallet_id IN (SELECT id FROM qa_wallets);
DELETE FROM public.wallets               WHERE id IN (SELECT id FROM qa_wallets);

-- 3) Meni restoran QA yo
DELETE FROM public.products              WHERE restaurant_id IN (SELECT id FROM qa_restaurants);
DELETE FROM public.menu_categories       WHERE restaurant_id IN (SELECT id FROM qa_restaurants);
DELETE FROM public.restaurant_employees  WHERE restaurant_id IN (SELECT id FROM qa_restaurants)
                                            OR user_id IN (SELECT id FROM qa_users);
DELETE FROM public.restaurants           WHERE id IN (SELECT id FROM qa_restaurants);

-- 4) Antite ki mare dirèkteman ak kont yo
DELETE FROM public.drivers               WHERE user_id IN (SELECT id FROM qa_users);
DELETE FROM public.favorites             WHERE user_id IN (SELECT id FROM qa_users);
DELETE FROM public.addresses             WHERE user_id IN (SELECT id FROM qa_users);
DELETE FROM public.notification_preferences WHERE user_id IN (SELECT id FROM qa_users);
DELETE FROM public.push_subscriptions    WHERE user_id IN (SELECT id FROM qa_users);
DELETE FROM public.notifications         WHERE user_id IN (SELECT id FROM qa_users);
DELETE FROM public.user_roles            WHERE user_id IN (SELECT id FROM qa_users);
DELETE FROM public.profiles              WHERE id IN (SELECT id FROM qa_users);

COMMIT;

-- ===========================================================================
-- KONTWÒL APRE — tout twa rekèt yo dwe bay 0.
-- ===========================================================================
SELECT count(*) AS wòl_ki_rete       FROM public.user_roles ur
  JOIN auth.users u ON u.id = ur.user_id WHERE u.email LIKE 'qa+%@nkdeliveri.test';

SELECT count(*) AS pwofil_ki_rete    FROM public.profiles p
  JOIN auth.users u ON u.id = p.id    WHERE u.email LIKE 'qa+%@nkdeliveri.test';

SELECT count(*) AS restoran_ki_rete  FROM public.restaurants
  WHERE slug IN ('qa-restoran-a', 'qa-restoran-b');

-- Apre sa: efase sis kont yo nan tablo Supabase la (wè antèt la).
