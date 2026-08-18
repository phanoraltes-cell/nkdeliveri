# NKD-016 — Livrezon echwe

**Dat** : 2026-08-17/18
**Sous** : Faz 10 Business Logic Audit §7. Règ A5 leve pou pòte sa a sèlman.
**Estati** : Migrasyon ekri + teste (lokal/tsc/lint/build/vitest), **PA APLIKE sou pwodiksyon** — tann otorizasyon eksplisit (§9).
**Revizyon 2026-08-18** : mèt pwojè a jwenn 2 defo reyèl nan revizyon anvan aplikasyon (§10) — toude korije nan menm 2 fichye migrasyon yo (poko aplike, okenn nan yo pa t janm rive pwodiksyon).

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

**PA ANKÒ EGZEKITE.** Kontrèman ak NKD-015, tès sa a **mande** de migrasyon yo deja aplike pou vre anvan (paske li itilize valè enum yo) — pa ka teste nan yon sèl `BEGIN…ROLLBACK` konbine. Sekans pou mèt pwojè a :
1. Kouri `20260817110000_nkd016_delivery_failed_enum_values.sql` (san risk — ajoute valè enum sèlman, pa gen itilizasyon).
2. Kouri `20260817120000_nkd016_delivery_failed.sql`.
3. Kouri `docs/NKD016_DELIVERY_FAILED_TEST.sql` (BEGIN…ROLLBACK — anyen pa rete).
4. Voye rezilta yo (NOTICE/erè) — **mwen pa deklare okenn PASS san prèv egzekisyon reyèl** (Règ A9).

| ID | Tès | Rezilta |
|---|---|---|
| T0 | Kòmand san `contact_phone` rejte | ⏳ Pa teste ankò |
| T1 | `picked_up → delivery_failed` mache | ⏳ Pa teste ankò |
| T1b | Rezon "lòt" san kòmantè rejte | ⏳ Pa teste ankò |
| T2 | Livrè kredite 150 HTG, restoran pa kredite | ⏳ Pa teste ankò |
| T3 | Idanpotans — 2èm deklanchman (`orders`) pa double-kredite | ⏳ Pa teste ankò |
| T4 | `delivery_failed → delivered` mache (admin) **+ verifye pa gen doub komisyon** (Defo 1) | ⏳ Pa teste ankò |
| T5 | `delivery_failed → cancelled` : pa gen ranbousman, estòk pa retounen | ⏳ Pa teste ankò |
| T6 | Tranzisyon envalid rejte (`delivery_failed → picked_up`) | ⏳ Pa teste ankò |
| T8 | `en_route_dropoff → delivery_failed` mache (Defo 2) | ⏳ Pa teste ankò |
| T9 | `assigned → delivery_failed` rejte (livrè poko pran manje a) | ⏳ Pa teste ankò |

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

**Migrasyon aplike sou pwodiksyon ? NON.** Règ A1 rete an vigè pou pòte sa a (kontrèman ak NKD-015, pa gen otorizasyon Management-API-dirèk pou pòte sa a) — ekri, teste lokalman (tsc/lint/migrations/vitest/build), **tann mèt pwojè a kouri de fichye migrasyon yo + tès la nan SQL Editor**, epi otorizasyon eksplisit anvan aplikasyon reyèl. **Lòd deplwaman obligatwa** : migrasyon aplike (toude fichye, nan lòd) **anvan** okenn push kòd — Vercel deplwaye chak push san CI pa bloke l (Faz 7), kòd fwontèn nan li `delivery_failed`/nouvo kolòn ki pa ta egziste ankò.
