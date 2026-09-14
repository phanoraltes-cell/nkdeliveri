-- ===========================================================================
-- ODIT — KONSTAT GRAV : vèsman ki bloke nan eta `disputed`
--
-- SA L CHÈCHE : konbyen vèsman ki kounye a nan eta `disputed`, ki moun ki
-- konsène, depi konbyen tan, epi konbyen lajan sa reprezante.
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
-- DE KOREKSYON SOU VÈSYON ANVAN YO
--
-- 1) `ERROR: 42703: column "beneficiary_type" does not exist` — mwen te
--    envante kolòn nan. `payouts` pa genyen l, ni `wallets` yon
--    `owner_type`: benefisyè a dedwi de kilès nan `restaurant_id` /
--    `driver_id` ki pa nil. Tout kolòn isit la verifye kont types.ts.
--
-- 2) Vèsyon anvan an te gen KAT rekèt separe. Editè SQL Supabase la montre
--    SÈLMAN dènye jeu rezilta a, donk twa premye yo te envizib — enkli sa
--    ki konte a. Kounye a tout bagay tounen nan YON SÈL ranje, yon sèl
--    kolòn JSON.
--
-- KIJAN POU LI REZILTA A : chèche `"bloke_kounye_a"`.
--   0        -> pwoblèm nan latan, nou ranje l anvan li rive
--   plis ke 0 -> gen moun bloke KOUNYE A; gade lis `vesman_bloke` la
-- ===========================================================================

SELECT jsonb_pretty(
  jsonb_build_object(

    -- Konbyen bloke kounye a — se chif la ki deside.
    'bloke_kounye_a',
    (SELECT count(*) FROM public.payouts WHERE status = 'disputed'),

    'montan_bloke',
    (SELECT coalesce(sum(amount), 0) FROM public.payouts WHERE status = 'disputed'),

    -- Foto global chak eta, pou kontèks.
    'pa_eta',
    (SELECT coalesce(jsonb_agg(x ORDER BY x->>'status'), '[]'::jsonb)
     FROM (
       SELECT jsonb_build_object(
                'status',      status,
                'kantite',     count(*),
                'montan_brit', coalesce(sum(amount), 0),
                'montan_net',  coalesce(sum(net_amount), 0)
              ) AS x
       FROM public.payouts
       GROUP BY status
     ) s),

    -- SA KI BLOKE YO. `disputed_at` egziste sou tab la, donk nou mezire
    -- depi lè LITIJ la kòmanse, pa depi `updated_at` (ki bouje pou lòt
    -- rezon). Non ak telefòn ladan l: si yon moun bloke, ou ka rele l.
    'vesman_bloke',
    (SELECT coalesce(jsonb_agg(x ORDER BY x->>'disputed_at'), '[]'::jsonb)
     FROM (
       SELECT jsonb_build_object(
                'id',            p.id,
                'benefisye_tip', CASE
                                   WHEN p.restaurant_id IS NOT NULL THEN 'restoran'
                                   WHEN p.driver_id     IS NOT NULL THEN 'livre'
                                   ELSE '(pa kle)'
                                 END,
                'benefisye',     coalesce(r.name,
                                          nullif(btrim(coalesce(d.first_name, '') || ' ' ||
                                                       coalesce(d.last_name, '')), ''),
                                          '(san non)'),
                'telefon',       d.phone,
                'montan',        p.amount,
                'montan_net',    p.net_amount,
                'rezon',         p.dispute_reason,
                'disputed_at',   p.disputed_at,
                'depi',          (now() - p.disputed_at)::text
              ) AS x
       FROM public.payouts p
       LEFT JOIN public.restaurants r ON r.id = p.restaurant_id
       LEFT JOIN public.drivers     d ON d.id = p.driver_id
       WHERE p.status = 'disputed'
     ) s),

    -- Bous ki gen lajan an atant. Yon vèsman bloke kenbe montan l isit la:
    -- ni peye, ni disponib.
    'bous_ak_pending',
    (SELECT coalesce(jsonb_agg(x ORDER BY (x->>'pending_balance')::numeric DESC), '[]'::jsonb)
     FROM (
       SELECT jsonb_build_object(
                'id',                w.id,
                'met_tip',           CASE
                                       WHEN w.restaurant_id IS NOT NULL THEN 'restoran'
                                       WHEN w.driver_id     IS NOT NULL THEN 'livre'
                                       WHEN w.user_id       IS NOT NULL THEN 'kliyan'
                                       ELSE '(pa kle)'
                                     END,
                'met',               coalesce(r.name,
                                              nullif(btrim(coalesce(d.first_name, '') || ' ' ||
                                                           coalesce(d.last_name, '')), ''),
                                              '(san non)'),
                'pending_balance',   w.pending_balance,
                'available_balance', w.available_balance,
                'paid_balance',      w.paid_balance
              ) AS x
       FROM public.wallets w
       LEFT JOIN public.restaurants r ON r.id = w.restaurant_id
       LEFT JOIN public.drivers     d ON d.id = w.driver_id
       WHERE w.pending_balance > 0
       LIMIT 50
     ) s),

    -- KONTWÒL KWAZE. Si sa a pi gwo ke 0, yon sòti egziste yon kote (yon
    -- patch SQL manyèl, pa egzanp) epi konstat grav la merite yon nuans.
    -- Mezire deja: 0.
    'deja_rezoud',
    (SELECT count(*) FROM public.payouts
     WHERE status = 'resolved' OR resolved_at IS NOT NULL)
  )
) AS rapo;
