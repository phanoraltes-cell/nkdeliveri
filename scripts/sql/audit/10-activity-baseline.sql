-- ===========================================================================
-- ODIT — LIY BAZ AKTIVITE
--
-- SA L CHÈCHE : konbyen ranje reyèl ki genyen nan chak tab ki konte, pou
-- kalibre RÈS odit la.
--
-- POUKISA : 02-payouts-disputed.sql te bay `pa_eta: []`. Yon `GROUP BY
-- status` ki pa bay okenn ranje vle di tab `payouts` la VID NÈT — okenn
-- vèsman, okenn eta, jamè. Epi `bous_ak_pending: []` vle di okenn bous pa
-- gen yon santim an atant.
--
-- Sa chanje jan pou li tout rès la. Yon defo sou yon chemen lajan ki pa
-- janm kouri se yon RISK (li pral mòde premye fwa a), pa yon pwoblèm k ap
-- fè mal kounye a. Mwen pa vle klase yon bagay « grav » si li pa ka blese
-- pèsonn ankò, ni klase l « ba » si lajan ap deplase tout bon.
--
-- ⚠ LEKTI SÈLMAN. Okenn ekriti. Yon sèl ranje, yon sèl kolòn JSON — donk
--   editè a ap montre tout bagay.
-- ===========================================================================

SELECT jsonb_pretty(
  jsonb_build_object(
    -- Fondasyon an
    'restoran_total',      (SELECT count(*) FROM public.restaurants),
    'restoran_approuve',   (SELECT count(*) FROM public.restaurants WHERE status = 'approved'),
    'livre_total',         (SELECT count(*) FROM public.drivers),
    'pwofil',              (SELECT count(*) FROM public.profiles),
    'pwodwi',              (SELECT count(*) FROM public.products),

    -- Eske moun kòmande tout bon?
    'komand_total',        (SELECT count(*) FROM public.orders),
    'komand_pa_eta',
      (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
       FROM (SELECT status::text AS status, count(*) AS n FROM public.orders GROUP BY status) s),
    'premye_komand',       (SELECT min(created_at) FROM public.orders),
    'denye_komand',        (SELECT max(created_at) FROM public.orders),

    -- Eske lajan deplase?
    'peman_total',         (SELECT count(*) FROM public.payments),
    'peman_peye',          (SELECT count(*) FROM public.payments WHERE status = 'paid'),
    'livrezon_total',      (SELECT count(*) FROM public.deliveries),
    'livrezon_delivered',  (SELECT count(*) FROM public.deliveries WHERE status = 'delivered'),

    -- Chèn komisyon -> bous -> vèsman
    'commission_ledger',   (SELECT count(*) FROM public.commission_ledger),
    'bous_total',          (SELECT count(*) FROM public.wallets),
    'bous_ak_solde',       (SELECT count(*) FROM public.wallets
                            WHERE available_balance > 0 OR pending_balance > 0 OR paid_balance > 0),
    'somme_available',     (SELECT coalesce(sum(available_balance), 0) FROM public.wallets),
    'somme_pending',       (SELECT coalesce(sum(pending_balance), 0) FROM public.wallets),
    'somme_paid',          (SELECT coalesce(sum(paid_balance), 0) FROM public.wallets),
    'wallet_transactions', (SELECT count(*) FROM public.wallet_transactions),
    'vesman_total',        (SELECT count(*) FROM public.payouts),

    -- Lòt chemen ki gen defo nan odit la
    'litij',               (SELECT count(*) FROM public.disputes),
    'ranbousman',          (SELECT count(*) FROM public.refunds),
    'anons',               (SELECT count(*) FROM public.sponsored_placements),
    'anons_evenman',       (SELECT count(*) FROM public.sponsored_placement_events)
  )
) AS liy_baz;
