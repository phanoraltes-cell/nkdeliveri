-- ===========================================================================
-- ODIT — KONSTAT GRAV : vèsman ki bloke nan eta `disputed`
--
-- SA L CHÈCHE : konbyen vèsman ki kounye a nan eta `disputed`, epi konbyen
-- lajan sa reprezante.
--
-- POUKISA LI IJAN : `dispute_payout_secure` rele nan
-- src/components/order/payout-confirm-section.tsx:82 — yon restoratè oswa
-- yon livrè ka konteste yon vèsman. Men SÈL kòd ki ekri `status='resolved'`
-- se `resolve_payout_dispute_secure`, epi OKENN kòd nan `src/` pa rele l.
-- Donk yon vèsman ki antre nan `disputed` pa gen okenn sòti — pa menm pou
-- yon admin. Pandan tan sa a montan an rete nan `pending_balance`: ni peye,
-- ni disponib.
--
-- ⚠ LEKTI SÈLMAN. Okenn ekriti.
--
-- KIJAN POU LI REZILTA A :
--   0 ranje  -> pwoblèm nan latan, nou ranje l anvan li rive
--   >0 ranje -> gen moun ki bloke KOUNYE A, ak montan an nan kolòn nan
-- ===========================================================================

-- 1) Foto global chak eta.
select status, count(*) as kantite, coalesce(sum(amount), 0) as montan_total
from public.payouts
group by status
order by kantite desc;

-- 2) Sa ki bloke yo, ak depi konbyen tan.
select id,
       beneficiary_type,
       amount,
       created_at,
       updated_at,
       now() - updated_at as depi_konbyen_tan
from public.payouts
where status = 'disputed'
order by updated_at;

-- 3) Enpak sou bous yo: lajan ki kenbe nan `pending_balance`.
select w.id, w.owner_type, w.pending_balance, w.available_balance, w.paid_balance
from public.wallets w
where w.pending_balance > 0
order by w.pending_balance desc
limit 50;
