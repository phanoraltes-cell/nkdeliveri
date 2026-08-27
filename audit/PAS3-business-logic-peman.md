# PAS 3 — Business logic + Peman/Wallet

**Estati aksè**: analiz statik sèlman (migrasyon SQL + kòd aplikasyon). Pa gen aksè done reyèl pou konfime yon vrè "drift" finansye egziste kounye a — tout konklizyon sou entegrite done rete LIKELY.

## Flux "kreye yon kòmand" (`private.create_order_secure`, dènye vèsyon)

```
Input (restaurant_id, items[], adrès, telefòn, method, idempotency_key)
  ↓ Validasyon: itilizatè otantifye, rate-limit (8/600s), idempotency_key obligatwa,
    omwen 1 atik, adrès/telefòn non vid
  ↓ Otorizasyon: pa nesesè (nenpòt itilizatè otantifye ka kòmande)
  ↓ Règ biznis: restoran apwouve, restoran LOUVRI KOUNYE A (chèk NOUVO),
    chak pwodwi apatyen a restoran an, disponib, estòk sifizan
  ↓ Mitasyon DB: INSERT orders (ON CONFLICT idempotency_key → retounen ID
    egzistan, PA kreye yon doub), UPDATE stock_quantity (kondisyonèl,
    kous-san-danje), INSERT order_items, INSERT payments
  ↓ Efè segondè: okenn nan fonksyon sa a limenm (kalkil komisyon fèt PITA,
    sou LIVREZON, pa sou kreyasyon)
  ↓ Notifikasyon: pa nan fonksyon sa a
  ↓ Eta final: order.status = 'pending'
```

**Verifye**: PRI kalkile SÈVÈ-SIDE (`v_product.price` soti nan DB, jamè yon valè kliyan voye) — pwoteje kont manipilasyon pri kliyan. **CONFIRMED.**

## Kesyon santral: kliyan doub-klike sou "Kòmande"

**PWOTEJE, CONFIRMED.** `idempotency_key` obligatwa (UUID jenere kliyan-side yon sèl fwa pou soumisyon an), `ON CONFLICT (idempotency_key) DO UPDATE ... RETURNING (xmax=0)` — si se yon doub apèl ak menм kle a, fonksyon an retounen ID kòmand ki DEJA egziste a, san kreye yon dezyèm ranje ni doub-debi estòk.

## Machin eta — kòmisyon/wallet

```
Order kreye (status='pending')
  ↓ ... (preparing → ready → assigned → picked_up → delivered)
  ↓ TRIGGER trg_generate_commission_on_delivery
     (SÈLMAN lè NEW.status='delivered' AND OLD.status != 'delivered')
     → INSERT commission_ledger (entry_type='order_commission')
       [idanpotan: ON CONFLICT (order_id, restaurant_id) DO NOTHING]
     → UPDATE wallets SET available_balance += net_amount (INCREMENT, pa SET)
  ↓
  SI refund (admin approve → complete_refund_secure):
  ↓ order.status → 'refunded'
  ↓ TRIGGER trg_reverse_commission_on_refund
     (SÈLMAN lè NEW.status='refunded' AND OLD.status='delivered' — kidonk
      SÈLMAN si komisyon an te deja jenere; si order refund AVAN livrezon,
      pa gen komisyon pou ranvèse, kòrèk)
     → INSERT commission_ledger (entry_type='reversal', montan negatif)
       [idanpotan: ON CONFLICT (order_id, restaurant_id) WHERE entry_type='reversal' DO NOTHING]
     → UPDATE wallets SET available_balance -= net_amount (egzakteman menm
       montan an, senyen envès)
```

**Verifikasyon "double peman sou refund"**: **CONFIRMED PWOTEJE.** Premye lekti a te fè m sipoze `complete_refund_secure` pa t janm ranvèse komisyon restoran an (li pa touche `wallets`/`commission_ledger` limenm) — men verifikasyon apwofondi montre triger separe a (`trg_reverse_commission_on_refund`) fè travay sa a otomatikman, ak menм disiplin idanpotans ak montan senmetrik ak orijinal la.

## Matematik: Brit − Komisyon = Net

`v_commission := ROUND(NEW.subtotal * v_rate / 100, 2)` ; `v_net := NEW.subtotal - v_commission` — [20260722100100_commission_engine.sql:75-76](supabase/migrations/20260722100100_commission_engine.sql#L75). Aritmetik `numeric` egzat (pa float), `ROUND` kòrèk pou 2 desimal. **CONFIRMED kòrèk.**

## Idempotans webhook (deja verifye PAS 1, konfime ankò isit la nan kontèks biznis)

- Stripe/MonCash collect: `complete_collect_payment_secure` — UPDATE...WHERE status='pending' (yon replika ki rive apre yon desizyon deja pran afekte 0 ranje, san danje).
- MonCash disbursement: `UNIQUE(event_id)` nan `moncash_webhook_events` — dezyèm delivrans idantik la jwenn yon `23505` epi retounen 200 san re-trete.

## 🟡 Sèl gap reyèl jwenn: pa gen rekonsilyasyon kontinyèl

`wallets.available_balance` se yon valè **estoke**, ogmante/diminye enkremantalman (`+=`/`-=`), pa yon kalkil `SUM(commission_ledger.net_amount)` fè sou-demand. Konsepsyon aktyèl la trè swen (chak operasyon idanpotan, chak ranvèsman senmetrik, verifye pa lekti dirèk kòd), sa REDWI anpil chans yon "drift" rive — men **pa gen okenn filè sekirite** (RPC/cron rekonsilyasyon peryodik) ki ta detekte l si sa ta rive kanmenm (yon nouvo `entry_type` fiti ki bliye UPDATE wallets, yon operasyon SQL manyèl, elt.). Gade `FIN-001` (MEDIUM, LIKELY).

## Rezime severite PAS 3

- 🔴 0 CRITICAL
- 🟠 0 HIGH
- 🟡 **1 MEDIUM** (FIN-001)
- 🔵 0 LOW
- Kreyasyon kòmand, kalkil komisyon, ak ranvèsman refund — **tout CONFIRMED byen bati, idanpotan, ak pri/kalkil sèvè-side.**

## Limit pas sa a (onèt)

- Pa gen aksè done reyèl pou konfime/enfime yon drift finansye egziste JODI A — `FIN-001` se yon gap **estriktirèl** (absans yon kontwòl), pa yon prèv yon erè aktyèl.
- Pa gen tan pou trase machin eta konplè `dispute`/`komand_assistance` (2 lòt tab ki gen pwòp workflow, pa touche nan pas sa a).
- Checkout.tsx (697 liy, pi gwo fichye risk PAS 0) — flux SERVER (RPC) verifye an detay, men lojik CLIENT (UI/eta lokal React) pa revize liy-pa-liy.
- Plop (twazyèm founisè peman) rete "inert/pa konfigire" dapre kòmantè kòd yo menм — pa gen lojik reyèl pou odite la pou kounye a.

---

**Èske mwen kontinye ak PAS 4 (API + Storage + Fyabilite)?**
