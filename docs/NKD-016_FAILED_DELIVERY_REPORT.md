# NKD-016 — Livrezon echwe

**Dat** : 2026-08-17/18
**Sous** : Faz 10 Business Logic Audit §7. Règ A5 leve pou pòte sa a sèlman.
**Estati** : Migrasyon **APLIKE sou pwodiksyon** (2026-08-18, §9), tès `BEGIN…ROLLBACK` **10/10 PASS** (§3), kòd fwontèn **pouse sou `main`** (§9).
**Revizyon 2026-08-18** : 2 defo reyèl jwenn nan revizyon anvan aplikasyon (§8b), korije nan menm 2 fichye migrasyon yo anvan aplikasyon. Apre aplikasyon, tès la te revele yon 3yèm bug — nan **tès la** sèlman (T5, §3), pa nan migrasyon an — korije, rekouri, 10/10 pase.

---

## 1. Kote `generate_commission_for_order` deklanche

`supabase/migrations/20260722100100_commission_engine.sql:143-146` :
```sql
CREATE TRIGGER trg_generate_commission_on_delivery
AFTER UPDATE ON public.orders
FOR EACH ROW WHEN (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered')
EXECUTE FUNCTION private.generate_commission_on_delivery();
```
Etriktman `orders.status = 'delivered'` sèlman. Delegasyon an rele `private.generate_commission_for_order(NEW.id, NULL, 'trigger')`, ki fè restoran + livrè ansanm.

## 2. Dekouvèt achitekti (envestigasyon, pa sipozisyon)

Gen **2 chemen paralèl** pou estati:

| | Kolòn | Enum | Kiyès ki itilize l |
|---|---|---|---|
| A | `orders.status` | `order_status` | `update_order_status_secure` — restoran + kliyan. Gen yon branch "livrè" ki egziste men **fwontèn pa rele l pou livrè**. |
| B | `deliveries.status` | `delivery_status` (**yon dezyèm enum, separe**) | `private.protect_delivery_status_transition()` — **sa a livrè a itilize reyèlman** (`dashboard.driver.history.tsx:148`, `.from("deliveries").update({status})` dirèk). Senkronize `orders.status` apre, sèlman pou `picked_up`/`delivered`. |

Konsekans : bouton "Pa ka livre" a pase pa Chemen B. `delivery_failed` ajoute nan **toude enum yo** (`order_status` AK `delivery_status`), ak `commission_entry_type` (twazyèm enum, pou `commission_ledger.entry_type`).

## 3. Fonksyon/trigè `order_status` afekte

Vèsyon vivan yo sèlman (dènye `CREATE OR REPLACE` pou chak) :
- `private.update_order_status_secure` — `20260814160000_nkd010_stock_decrement.sql:203`. **Modifye** (§5).
- `private.protect_delivery_status_transition` — `20260723090000_notifications_engine_and_gps_sharing.sql:259`. **Modifye** (§5).
- `private.create_order_secure` — `20260816120000_nkd015_delivery_fee_config.sql:151`. **Modifye** (mesaj Kreyòl sèlman, §5).
- `public.complete_refund_secure`, `private.order_visible_to_driver`, `public.get_orders_admin` — li `order_status`, **pa touche**, pa gen chanjman nesesè pou yo.

**Pwoblèm reyèl jwenn** (pa teyorik) : gad estòk `update_order_status_secure`'s la ta remèt estòk otomatikman sou `delivery_failed → cancelled` — manje a deja fèt. **Korije** : eksklizyon eksplisit `v_old_status <> 'delivery_failed'` nan gad la.

**Peman `paid` sou kòmand `cancelled`** : **deja egziste** kòm ka jodi a — `gate_order_confirm_on_payment.sql` konfime yon kòmand moncash/natcash pa ka `confirmed` san peman `paid`, e restoran ka anile yon kòmand `confirmed`. Pa gen danje rekonsilyasyon nouvo.

## 4. Kesyon "KANPE EPI MANDE" — repons resevwa

| Kesyon | Repons |
|---|---|
| Achitekti (ki chemen pou `delivery_failed`) | **RPC dedye + 2 enum** — `public.report_delivery_failed_secure`, pa yon `.update()` dirèk. |
| Komisyon sou echèk | **Trigger + fonksyon separe** — `private.generate_driver_commission_on_delivery_failure`, pa yon paramèt sou `generate_commission_for_order`. |
| Fenèt 2èdtan | **Klik manyèl admin** — pa gen enfrastrikti travay planifye nan pwojè a jodi a. |
| Repwogramasyon | **Ranvwaye pou NKD-017** — pa fè pati migrasyon sa a. |

`entry_type` nouvo pwopoze e itilize : `driver_commission_delivery_failed`.

## 5. Migrasyon (2 fichye, rezon detaye nan chak antèt)

- **`supabase/migrations/20260817110000_nkd016_delivery_failed_enum_values.sql`** — 3 valè enum sèlman (`order_status`, `delivery_status`, `commission_entry_type`). Separe de rès la paske Postgres pa pèmèt itilize yon nouvo valè enum nan menm tranzaksyon ki ajoute l — dwe **aplike e komite pou vre anvan** dezyèm fichye a.
- **`supabase/migrations/20260817120000_nkd016_delivery_failed.sql`** — tout rès la :
  - Kolòn : `orders.delivery_failed_at`, `deliveries.failure_reason`, `deliveries.failure_comment` + CHECK.
  - CHECK `orders_contact_phone_required` (0 ranje ki pa konfòm konfime pa mèt pwojè a nan SQL Editor, 2026-08-17 — aplike dirèkteman).
  - `private.create_order_secure` — 2 mesaj vin Kreyòl, rès la idantik.
  - `private.protect_delivery_status_transition` — `('picked_up','delivery_failed')` ajoute nan lis tranzisyon livrè a, senkronizasyon `orders.status`/`delivery_failed_at` ajoute, GPS auto-revoke ajoute pou `delivery_failed`.
  - `private.update_order_status_secure` — gad estòk eksklizyon + mesaj kliyan spesifik sou `delivery_failed → cancelled` (san ranbousman).
  - `public.report_delivery_failed_secure(_order_id, _reason, _comment)` — nouvo RPC, valide rezon (4 valè) + kòmantè obligatwa si "lòt", verifye livrè asiyen oswa admin, `picked_up` sèlman kòm sous.
  - `private.generate_driver_commission_on_delivery_failure()` + `trg_generate_driver_commission_on_delivery_failure` (`AFTER UPDATE ON orders WHEN NEW.status='delivery_failed'`) + endèks inik pasyèl idanpotan.

`npm run check:migrations` : ✅ 142 migrasyon, pa gen danje overload.

### Tès `BEGIN…ROLLBACK` — `docs/NKD016_DELIVERY_FAILED_TEST.sql`

**Pas 1 — 2026-08-18** : T0-T4 `PASS`, **T5 `FAIL`** (`before=8, after=8` — bug nan tès la, pa nan migrasyon an, analize pi ba). T6/T8/T9 pa t kouri (tranzaksyon an tonbe nan T5).

**Pas 2 — 2026-08-18, apre koreksyon T5** : `Success. No rows returned`, okenn ERROR. SQL Editor Supabase pa gen onglet Messages (RAISE NOTICE pa vizib), men **kontras dirèk ak pas 1 la** (ki te bay `ERROR: P0001: T5-FAIL` klè) konfime absans erè a se yon reyèl `PASS`, pa yon absans done — menm rezònman ki aplike pou NKD-015. Dapre Règ A9, sa se prèv egzekisyon reyèl. **10/10 tès pase.**

**Analiz `T5-FAIL` (pas 1)** : bug nan **tès la**, pa nan migrasyon an. Chif yo (`before=8, after=8`) te deja pwouve estòk la **pa t chanje ditou** — konpòtman ki egzakteman atandi (delivery_failed → cancelled pa dwe touche estòk). `v_stock_before` te kaptire **apre** `create_order_secure` deja dekremante l (10→8), donk konparezon an kont `v_stock_before - 2` te doub-soustrè. **Korije** : konparezon vin `v_stock_after <> v_stock_before` (san `- 2`).

| ID | Tès | Rezilta | Prèv |
|---|---|---|---|
| T0 | Kòmand san `contact_phone` rejte | ✅ PASS | Pas 1, 2026-08-18 |
| T1 | `picked_up → delivery_failed` mache | ✅ PASS | Pas 1, 2026-08-18 |
| T1b | Rezon "lòt" san kòmantè rejte | ✅ PASS | Pas 1, 2026-08-18 |
| T2 | Livrè kredite 150 HTG, restoran pa kredite | ✅ PASS | Pas 1, 2026-08-18 |
| T3 | Idanpotans — 2èm deklanchman (`orders`) pa double-kredite | ✅ PASS | Pas 1, 2026-08-18 |
| T4 | `delivery_failed → delivered` mache (admin) **+ verifye pa gen doub komisyon** (Defo 1) | ✅ PASS | Pas 1, 2026-08-18 — **konfime Defo 1 korije, pa gen 300 HTG** |
| T5 | `delivery_failed → cancelled` : pa gen ranbousman, estòk pa retounen | ✅ PASS | Pas 2, 2026-08-18 (apre koreksyon off-by-one nan tès la) |
| T6 | Tranzisyon envalid rejte (`delivery_failed → picked_up`) | ✅ PASS | Pas 2, 2026-08-18 |
| T8 | `en_route_dropoff → delivery_failed` mache (Defo 2) | ✅ PASS | Pas 2, 2026-08-18 |
| T9 | `assigned → delivery_failed` rejte (livrè poko pran manje a) | ✅ PASS | Pas 2, 2026-08-18 |

**10/10 tès pase.**

## 6. Chanjman UI (`fichye:liy`)

**Nouvo** :
- `src/routes/_authenticated/dashboard.admin.delivery-failed.tsx` — ekran admin, lis kòmand `delivery_failed`, tan ki pase, bouton "Kliyan vin chèche l" (→ `delivered`) / "Anile — pa gen ranbousman" (→ `cancelled`, konfimasyon si poko 2h).
- `src/routes/_authenticated/dashboard.admin.index.tsx:369-374` — nouvo kat navigasyon "Livrezon echwe".

**Modifye** :
- `src/routes/_authenticated/dashboard.driver.history.tsx:141-172` (nouvo mutation `reportFailed`), `:186-266` (bouton "Pa ka livre" + fòm rezon/kòmantè enline, menm modèl ak fòm litij kach ki deja egziste pi ba).
- `src/lib/send-order-status-push.functions.ts:20-28` — antre `delivery_failed` nan `STATUS_COPY`, voye apre `report_delivery_failed_secure` reyisi.
- `src/lib/delivery-status.ts`, `src/lib/order-status.ts` — etikèt Kreyòl "Livrezon echwe" pou nouvo valè a.
- `src/integrations/supabase/types.ts` — 3 enum ajou, `deliveries`/`orders` kolòn nouvo, `report_delivery_failed_secure` antre.

**Pa touche** : `dashboard.restaurant.orders.tsx` (restoran pa wè/jere sa), NKD-001/002/003B/004/009/011/012.

## 7. Verifikasyon `npm run verify`

`npx tsc --noEmit` ✅, `eslint` ✅ (0 erè — 3 avètisman `react-refresh` preegzistan, san rapò ak NKD-016), `check:migrations` ✅ (142 migrasyon, pa gen danje overload), `vitest` ✅ **212/212** (0 regresyon), `npm run build` ✅. Re-verifye ankò apre koreksyon 2 defo yo (§8b) — menm rezilta.

## 8b. Defo jwenn nan revizyon (2026-08-18, anvan okenn aplikasyon) — korije

**Defo 1 — doub komisyon livrè (kritik, pèt lajan)** : `picked_up → delivery_failed` kredite livrè a 150 HTG (`entry_type = 'driver_commission_delivery_failed'`). Si kliyan an vin chèche manje a nan biwo a e admin mete kòmand lan `delivered`, `trg_generate_commission_on_delivery` (ki poko t modifye) deklanche `generate_commission_for_order`, ki t ap kredite **menm livrè a ankò**, 150 HTG anplis, sou yon `entry_type` diferan (`order_commission`) — 2 endèks inik separe pa wè youn lòt. **Rezilta ta ye : 300 HTG pou yon sèl livrezon.**

**Koreksyon** : `private.generate_commission_for_order` (§7 nan migrasyon an) — bò livrè a sèlman kounye a sote si yon ranje `driver_commission_delivery_failed` deja egziste pou kòmand+livrè a. Bò restoran an **pa chanje** — kliyan an resevwa manje a nan biwo a, restoran an merite komisyon li kanmenm.

**Defo 2 — livrè bloke nan `en_route_dropoff`** : `report_delivery_failed_secure` te egzije `deliveries.status = 'picked_up'` sèlman, men moman ki pi pwobab pou dekouvri yon echèk se **lè livrè a rive sou plas** (`en_route_dropoff`) — bouton "Pa ka livre" ta rejte l egzakteman lè li ta pi itil.

**Koreksyon** : `en_route_dropoff` ajoute kòm sous valab ni nan `report_delivery_failed_secure` (§5) ni nan `protect_delivery_status_transition` (§3) — de kote yo dwe rete idantik oswa youn ta rejte sa lòt la aksepte.

## 8. Kesyon ki rete

**Okenn** pou pòte sa a. Repwogramasyon ranvwaye pou **NKD-017** (yon pwochen tikè).

## 9. Estati aplikasyon

**Migrasyon aplike sou pwodiksyon ? WI**, 2026-08-18 — toude fichye (`20260817110000_...enum_values.sql` ak `20260817120000_...delivery_failed.sql`, avèk koreksyon Defo 1+2 yo ladan), pa mèt pwojè a li menm nan SQL Editor. **Konfime 9/9 eleman** (RPC `report_delivery_failed_secure`, trigger `trg_generate_driver_commission_on_delivery_failure`, 2 endèks — `orders_delivery_failed_at_idx` ak `commission_ledger_order_driver_delivery_failed_uniq`, 3 kolòn — `orders.delivery_failed_at`, `deliveries.failure_reason`, `deliveries.failure_comment`, 2 kontrent — `orders_contact_phone_required`, `deliveries_failure_reason_valid`) **+ 3 valè enum** (`delivery_failed` nan `order_status`/`delivery_status`, `driver_commission_delivery_failed` nan `commission_entry_type`). Migrasyon yo **pa retouche ankò** — bug T5 a te nan tès la sèlman (§3), pa nan yo.

**Tès rekouri 2026-08-18** (apre koreksyon T5) : `Success. No rows returned`, okenn ERROR — kontras dirèk ak echèk klè pas 1 la konfime yon reyèl `PASS`, pa yon absans done (menm rezònman NKD-015, dapre Règ A9). **10/10 tès pase.** Kòd fwontèn kounye a **pouse sou `main`** — lòd deplwaman respekte (migrasyon deja aplike anvan push, Faz 7).
