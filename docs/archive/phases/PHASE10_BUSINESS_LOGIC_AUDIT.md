# FAZ 10 — BUSINESS LOGIC

**Dat** : 2026-08-16
**Metòd** : lekti kòd sous + migrasyon + rapò egzistan. Règ Seksyon A `docs/PROTOKOL_FAZ3_A_FAZ11.md` aplike (A1-A9). **Atansyon A5 respekte strikteman** — chak gap dokimante isit la se yon konstatasyon, pa yon koreksyon.

---

## 0. Anti-doublon (Règ A3)

`docs/GLOBAL_AUDIT_360_2026-08-13.md` deja gen kontni sibstansyèl : `order_status` enum **VERIFIED live** (§285), sistèm wallet/commission/FIFO deja dekri kòm "le mieux construit du projet" ak lekti konplè fonksyon (§303). **Site, pa reprodwi mezi/lekti sa yo.**

---

## 1. "Konfimasyon final" flux peman — rezoud (Faz 0 `PA VERIFYE`)

**Pa gen yon SÈL fonksyon "konfimasyon final" inifye** — gen **4 fonksyon separe**, chak espesifik a yon chemen, tout konvèje sou `payments.status = 'paid'` :

| Chemen | Fonksyon "final" | Deklanche pa |
|---|---|---|
| MonCash/NatCash manyèl | `review_manual_payment_secure` | Admin, apre revizyon prèv |
| MonCash/NatCash otomatik (PLOP/Collect) | `complete_collect_payment_secure` | Webhook founisè a |
| Stripe | webhook Stripe (`api.webhooks.stripe.collect.ts`) | Webhook Stripe |
| Kach | `confirm_cash_payment_secure` | Doub konfimasyon kliyan+livrè |

**Konklizyon** : fragmantasyon sa a se yon chwa achitekti kòrèk (chak chemen gen pwòp reyalite operasyonèl li), pa yon gap — tout 4 yo deja verifye endividyèlman pandan sesyon sa a (Faz 1, Faz 5). **Pa gen okenn ka kote yon peman ta ka rete "pandan tout tan" san yon chemen pou l vin `paid` oswa `failed`.**

---

## 2. 4 chemen peman + rekonsilyasyon

**KONFIME** : 2 cron rekonsilyasyon egziste — `api.cron.moncash-reconcile.ts`, `api.cron.plop-reconcile.ts` (Vercel Cron, deja site Faz 7). Stripe pa gen yon cron rekonsilyasyon separe — repoze sou webhook Stripe a sèlman (`checkout.session.completed`/`checkout.session.expired`, deja verifye Faz 1). Kach pa mande rekonsilyasyon (konfimasyon dirèk 2 pati, pa gen founisè ekstèn).

**PA VERIFYE** : si yon webhook Stripe echwe silansye (san yon cron backup tankou MonCash/PLOP genyen), èske gen yon lòt mekanis ki detekte l ? **Gap potansyèl, mande desizyon metye** (Règ A5) — dokimante, pa korije.

---

## 3. Estati kòmand — 9 estati, tranzisyon

**KONFIME** (`order_status` enum live, Faz 2/360 audit) : `pending, confirmed, preparing, ready, assigned, picked_up, delivered, cancelled, refunded`.

**Tab tranzisyon konplè** (lekti dirèk `update_order_status_secure`, deja li plizyè fwa sesyon sa a) :

| Wòl | Tranzisyon valid |
|---|---|
| Kliyan | `(pending\|confirmed) → cancelled` sèlman |
| Restoran | `pending→confirmed→preparing→ready`, + `(pending\|confirmed\|preparing\|ready) → cancelled` |
| Livrè | `ready→assigned→picked_up→delivered` — **sekans strik, PA gen so-kout** |
| Admin | **nenpòt** tranzisyon (`v_allowed := true` san kondisyon) |

**Repons kesyon eksplisit** : **NON**, `delivered` PA ka rive san `picked_up` — pou yon livrè, sèl chemen ki mennen nan `delivered` se `picked_up→delivered`, pa gen so-kout `assigned→delivered` ni `ready→delivered`. **Sèl eksepsyon** : yon admin (`v_allowed := true` san restriksyon) ka fòse nenpòt tranzisyon, ki gen ladan yon so-kout — sa se yon zouti admin deliberateman san limit, pa yon twou nan wòl livrè/restoran/kliyan.

---

## 4. 2 livrè ki pran menm kòmand

**Site, deja rezoud** (Faz 1, F-02) : `deliveries.order_id UNIQUE` + `SELECT ... FOR UPDATE` sou `orders` anndan `claim_delivery_secure` — dezyèm livrè a bloke pa lock la, resevwa yon mesaj Kreyòl klè (`'Kòmand sa a pa disponib ankò...'`), pa yon erè teknik. **Pa reprodwi.**

---

## 5. Kalkil komisyon

**Site, deja etabli kòm "pi byen konstwi"** (`GLOBAL_AUDIT_360_2026-08-13.md` §303) : `wallets`+`wallet_transactions` (ledger append-only)+`commission_ledger`+`payout_commissions` (FIFO, `LEAST(outstanding, remaining)`, pa gen sou-kouvèti posib), `SELECT...FOR UPDATE` kont doub-debi. **Pa reprodwi.**

---

## 6. Kalkil frè livrezon — **finding konkrè, nouvo**

**KONFIME** : `restaurants.delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0` (`20260703060847...sql:34`). `create_order_secure` itilize `COALESCE(v_restaurant.delivery_fee, 150)` — men **rechèch egzoustif konfime AUKENN kòd (INSERT restoran, UI, RPC) pa janm mete `delivery_fee` a yon lòt valè pase default `0` a**. Konsekans : `v_restaurant.delivery_fee` pa janm `NULL` an pratik (kolòn `NOT NULL`), donk **fallback `150` a pa janm deklanche — kòd mò**.

**Egzanp chif konkrè** (kòmand 500 HTG, 2 atik) :
- Jodi a : `subtotal=500 + delivery_fee=0 + service_fee=0 = total=500` — **livrezon gratis pou tout restoran**, pa yon chwa afiche/dokimante okenn kote.
- Sa `COALESCE(...,150)` te sipoze bay si `delivery_fee` te janm `NULL` : `500 + 150 + 0 = 650`.

**Pa gen okenn UI/RPC pou yon restoran/admin mete yon `delivery_fee` pou kont yo** (rechèch `src/routes/`, `src/components/dashboard/` — 0 fòm modifikasyon jwenn, sèlman afichaj).

**Nivo/aksyon** : **PA yon bug teknik** — se yon **desizyon metye ki merite yon repons eksplisit** (Règ A5) : èske livrezon gratis se entansyonèl (estrateji akizisyon), oswa èske gen yon mekanis mete yo pa janm branche ? **Dokimante, pa korije.**

---

## 7. Anilasyon / Ranbousman

**Site, deja konfime an detay** : `complete_refund_secure` (Faz 1, Faz 10 §1), retou estòk otomatik sou `cancelled`/`refunded` (NKD-010, deja aplike sou pwodiksyon). **Pa reprodwi.**

---

## 8. Ka limit — **gap konfime, nouvo**

Rechèch egzoustif (`grep -rln` sou `src/` + tout migrasyon) pou mekanis dedye :

| Ka | Jwenn ? |
|---|---|
| Kliyan absan (livrè rive, pèsonn pa reponn) | **0 rezilta** — okenn mekanis/estati/RPC dedye |
| Adrès pa jwenn/pa egziste | **0 rezilta** |
| Koneksyon koupe pandan livrezon (livrè offline) | **0 rezilta** |

**Konsekans konkrè, deja demontre nan §3** : yon livrè ki gen yon kòmand `picked_up` men **pa ka livre l** (kliyan absan, adrès pa jwenn) **pa gen okenn tranzisyon estati valid pou li menm** — tablo tranzisyon livrè a se sèlman `picked_up→delivered`, **pa gen `picked_up→cancelled` ni yon estati "echèk livrezon"** pami 9 estati yo. Sèl opsyon livrè a genyen : (a) kontakte kliyan/admin manyèlman (telefòn deja disponib nan UI), (b) tann yon admin entèvni pou fòse yon tranzisyon (admin ka fè nenpòt), oswa (c) — risk — make `delivered` pou yon livrezon ki pa t reyisi.

**Nivo/aksyon** : **Gap konfime, mande desizyon metye** (Règ A5) — èske yon 10yèm estati (egzanp `failed_delivery`) ta itil, oswa èske pwosesis aktyèl la (eskalasyon manyèl bay admin) se sa ki vle a ? **Dokimante, pa korije, pa envante yon nouvo estati inilateralman.**

---

## 9. Rezime KONFIME / ESTIMASYON / PA VERIFYE

**KONFIME** :
- 4 chemen "konfimasyon final" peman idantifye, tout konvèje sou `paid`.
- 9 estati kòmand, tab tranzisyon konplè pou 4 wòl, `delivered` mande `picked_up` toujou (sof admin).
- 2 livrè menm kòmand — deja bloke (site).
- Komisyon FIFO — deja solid (site).
- `delivery_fee` default `0`, `COALESCE(...,150)` se kòd mò — 0 UI/RPC pou modifye l.
- Retou estòk sou anilasyon/ranbousman — deja aplike (NKD-010).

**ESTIMASYON** : okenn.

**PA VERIFYE** :
- Backup rekonsilyasyon Stripe si webhook echwe silansye.
- Kilès nan 3 ka limit yo (kliyan absan, adrès, koneksyon) mèt pwojè a konsidere reyèlman posib/frekan an pratik.

---

## 10. Kwazman ak backlog egzistan

Pa gen nouvo ID NKD kreye — tout 2 gap konfime (§6 frè livrezon, §8 ka limit) se desizyon metye (Règ A5), pa vilnerabilite. **3 bagay site pou atansyon mèt pwojè a** :
1. `delivery_fee` — konfime livrezon gratis pou tout moun jodi a, entansyonèl oswa non ?
2. Estati/pwosesis pou livrezon ki echwe (kliyan absan, adrès).
3. Backup rekonsilyasyon Stripe (opsyonèl, konpare ak MonCash/PLOP ki gen youn).

---

Kanpe la. Ap tann `KONTINYE` pou Faz 11.
