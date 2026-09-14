-- ===========================================================================
-- ODIT — KONSTAT GRAV : vèsman ki bloke nan eta `disputed`
--
-- SA L CHÈCHE : konbyen vèsman ki kounye a nan eta `disputed`, ki moun ki
-- konsène, epi konbyen lajan sa reprezante.
--
-- POUKISA LI IJAN : `dispute_payout_secure` rele nan
-- src/components/order/payout-confirm-section.tsx:82 — yon restoratè oswa
-- yon livrè ka konteste yon vèsman. Men SÈL kòd ki ekri `status='resolved'`
-- se `resolve_payout_dispute_secure`, epi OKENN kòd nan `src/` pa rele l.
-- Donk yon vèsman ki antre nan `disputed` pa gen okenn sòti — pa menm pou
-- yon admin.
--
-- ⚠ LEKTI SÈLMAN. Okenn ekriti.
--
-- ---------------------------------------------------------------------------
-- KOREKSYON — premye vèsyon an te echwe
--
--   ERROR: 42703: column "beneficiary_type" does not exist
--
-- Mwen te envante kolòn nan. `payouts` PA gen yon kolòn `beneficiary_type`,
-- ni `wallets` yon kolòn `owner_type`: benefisyè a dedwi de kilès nan
-- `restaurant_id` / `driver_id` ki pa nil. Tout kolòn nan fichye sa a
-- verifye kont `src/integrations/supabase/types.ts` rejenere a.
--
-- KIJAN POU LI REZILTA A (rekèt 2) :
--   0 ranje  -> pwoblèm nan latan, nou ranje l anvan li rive
--   >0 ranje -> gen moun ki bloke KOUNYE A
-- ===========================================================================

-- 1) Foto global chak eta.
SELECT status,
       count(*)                     AS kantite,
       coalesce(sum(amount), 0)     AS montan_brit,
       coalesce(sum(net_amount), 0) AS montan_nèt
FROM public.payouts
GROUP BY status
ORDER BY kantite DESC;

-- 2) SA KI BLOKE YO — se rekèt la ki konte.
--    `disputed_at` egziste sou tab la, donk nou mezire depi lè LITIJ la
--    kòmanse, pa depi dènye `updated_at` (ki ka chanje pou lòt rezon).
SELECT p.id,
       CASE
         WHEN p.restaurant_id IS NOT NULL THEN 'restoran'
         WHEN p.driver_id     IS NOT NULL THEN 'livrè'
         ELSE '(pa klè)'
       END                                               AS benefisyè_tip,
       coalesce(r.name, btrim(d.first_name || ' ' || d.last_name), '(san non)') AS benefisyè,
       d.phone                                           AS telefòn_livrè,
       p.amount,
       p.net_amount,
       p.dispute_reason,
       p.disputed_at,
       now() - p.disputed_at                             AS depi_konbyen_tan,
       p.resolution,                                     -- dwe nil: pa gen sòti
       p.resolved_at                                     -- dwe nil tou
FROM public.payouts p
LEFT JOIN public.restaurants r ON r.id = p.restaurant_id
LEFT JOIN public.drivers     d ON d.id = p.driver_id
WHERE p.status = 'disputed'
ORDER BY p.disputed_at;

-- 3) ENPAK SOU BOUS YO — lajan ki kenbe nan `pending_balance`.
--    `wallets` pa gen `owner_type` non plis: menm dediksyon an.
SELECT w.id,
       CASE
         WHEN w.restaurant_id IS NOT NULL THEN 'restoran'
         WHEN w.driver_id     IS NOT NULL THEN 'livrè'
         WHEN w.user_id       IS NOT NULL THEN 'kliyan'
         ELSE '(pa klè)'
       END                                               AS mèt_tip,
       coalesce(r.name, btrim(d.first_name || ' ' || d.last_name), '(san non)') AS mèt,
       w.pending_balance,
       w.available_balance,
       w.paid_balance,
       w.lifetime_earnings
FROM public.wallets w
LEFT JOIN public.restaurants r ON r.id = w.restaurant_id
LEFT JOIN public.drivers     d ON d.id = w.driver_id
WHERE w.pending_balance > 0
ORDER BY w.pending_balance DESC
LIMIT 50;

-- 4) KONTWÒL KWAZE — eske gen yon vèsman ki DEJA rezoud?
--    Si sa a bay > 0 ranje, sa vle di yon sòti egziste yon kote (yon script
--    manyèl, yon patch SQL), epi konstat la merite yon nuans.
SELECT count(*) AS vèsman_deja_rezoud,
       min(resolved_at) AS premye,
       max(resolved_at) AS dènye
FROM public.payouts
WHERE status = 'resolved' OR resolved_at IS NOT NULL;
