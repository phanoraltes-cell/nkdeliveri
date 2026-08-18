# NKD-011 + NKD-012 — Idanpotans ak doub soumisyon

**Dat** : 2026-08-18
**Sous** : Faz 5/6 (idanpotans, jesyon erè) + Senaryo A (koneksyon koupe pandan checkout). Règ A5 leve pou pòte sa a sèlman.
**Estati** : Migrasyon + kòd ekri, `npm run verify` vèt (221/221 tès), **PA APLIKE sou pwodiksyon, PA POUSE** — tann tès SQL mèt pwojè a kouri + otorizasyon eksplisit.

---

## 1. Rezilta Etap 0

- **`src/routes/checkout.tsx`** : `submit()` te fè yon sèl `supabase.rpc("create_order_secure", ...)`, san kle idanpotans, san retry. `catch (e) { toast.error(e instanceof Error ? e.message : ...) }` — mesaj brit dirèk, **pa t itilize `rpc-errors.ts` ditou**.
- **De patwon idanpotans egziste deja, pa envante yon twazyèm** :
  - `moncash_webhook_events` (tab separe, `UNIQUE(event_id)`, INSERT-dabò/kenbe `23505`) — egziste paske yon livrezon webhook gaye sou plizyè etap **andeyò yon sèl tranzaksyon**.
  - `commission_ledger` (endèks inik pasyèl sou menm tab la + `INSERT ... ON CONFLICT ... DO NOTHING RETURNING id`) — itilize **anndan yon sèl fonksyon/tranzaksyon**, egzakteman fòm `create_order_secure` a.
  → Chwazi patwon `commission_ledger` a, adapte an `DO UPDATE ... RETURNING` (pa `DO NOTHING`) paske NKD-011 bezwen `order_id` ki egziste a tounen, pa silans.
- **Okenn kolòn/tab pa t egziste deja** pou `orders`.
- **`src/lib/rpc-errors.ts`** klase sèlman kòd SQLSTATE Postgres — **okenn distenksyon rezo/metye**, e **`translateSupabaseError` pa t rele okenn kote nan aplikasyon an** (sèlman nan pwòp tès li).

## 2. Kesyon `KANPE EPI MANDE` — repons resevwa

| Kesyon | Repons |
|---|---|
| Estrikti DB | **Kolòn `orders.idempotency_key` + endèks inik**, pa yon tab separe — rezon : `create_order_secure` deja yon sèl tranzaksyon, patwon `commission_ledger` a pi pre. |
| Kle nil/vid | **Rejte san kondisyon** — checkout.tsx se sèl kalè reyèl la (konfime Etap 0). |

## 3. Migrasyon — `supabase/migrations/20260818100000_nkd011_order_idempotency.sql`

- `orders.idempotency_key uuid` (nullable — plizyè `NULL` pa antre an konfli nan yon endèks inik) + `orders_idempotency_key_uniq`.
- `private.create_order_secure` ak `public.create_order_secure` — chak grandi ak `_idempotency_key uuid DEFAULT NULL` (dènye paramèt, san reòdone lòt yo). `DROP FUNCTION` anvan pou tou de (chanjman siyati reyèl — menm konvansyon ak dènye fwa fonksyon sa a te grandi, `20260723090000...sql:336`).
- Kè a : `INSERT INTO orders (...) VALUES (...) ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = orders.updated_at RETURNING id, (xmax = 0) INTO v_order_id, v_was_inserted;` — yon sèl deklarasyon atomik. `IF NOT v_was_inserted THEN RETURN v_order_id; END IF;` anvan bouk atik yo — okenn dezyèm dekremantasyon estòk, okenn dezyèm `payments`.
- Kòmand ki echwe (estòk ensifizan) : okenn netwayaj nesesè — `RAISE EXCEPTION` anile tout tranzaksyon an, kle a pa janm rive komite, li lib otomatikman.

`npm run check:migrations` : ✅ 144 migrasyon, pa gen danje overload.

### Tès SQL — `docs/NKD011_ORDER_IDEMPOTENCY_TEST.sql` (fòma A10)

**EKRI, PA EGZEKITE.** Tab tanporè `test_results` + `SELECT * FROM test_results ORDER BY tes;` anvan `ROLLBACK` — okenn `RAISE NOTICE`.

| ID | Tès | Estati |
|---|---|---|
| T1 | Menm kle 2 fwa → menm `order_id` | ⏳ Ekri, pa egzekite |
| T1b | Menm kle 2 fwa → 1 sèl ranje `orders` | ⏳ Ekri, pa egzekite |
| T2 | Menm kle 2 fwa → estòk dekremante 1 fwa | ⏳ Ekri, pa egzekite |
| T3 | Menm kle 2 fwa → 1 sèl ranje `payments` | ⏳ Ekri, pa egzekite |
| T4 | Kle diferan → kòmand diferan | ⏳ Ekri, pa egzekite |
| T5 | Echèk estòk → kle a lib pou reeseye | ⏳ Ekri, pa egzekite |
| T6 | Kle `NULL` → rejte | ⏳ Ekri, pa egzekite |
| T7 | Konkirans reyèl | **Limit onèt** : yon sèl script SQL Editor sekansyèl pa ka louvri 2 koneksyon similtane — pa ka obsève reyèlman. Verifye estriktirèlman ke fonksyon an itilize `ON CONFLICT ... DO UPDATE ... RETURNING` (atomik, pa yon `SELECT` apre `INSERT` ki ta gen ras) — garanti a rete sou pwòp mekanis lock nivo-ranje Postgres deja dokimante pou idyom sa a. **Make `NOT-TESTED`, pa `PASS`** (Règ A9). |

## 4. NKD-012 — chanjman frontend

**Nouvo** :
- `src/lib/checkout-idempotency.ts` — `getOrCreateIdempotencyKey()`/`clearIdempotencyKey()`, `localStorage` (menm mekanis ak `useCart.ts`), sivi refrechisman paj.

**Modifye** :
- `src/lib/rpc-errors.ts` — `isNetworkError(error)` (ekspòte, pa yon dezyèm sistèm : itilize menm siyal "gen yon kòd SQLSTATE oswa non" ki deja gouvène pasaj P0001 la), `NETWORK_RETRY_MESSAGE`/`NETWORK_GIVE_UP_MESSAGE`, + kòd `22P02` ajoute nan `KNOWN_PG_CODE_MESSAGES` (site reyèl : `_idempotency_key` se kounye a yon paramèt `uuid`). **Deliberasyon : pa itilize `navigator.onLine`** — li di `true` an Ayiti pandan rekèt yo echwe pou vre.
- `src/routes/checkout.tsx:119-140` — `createOrderWithRetry()` : retry otomatik (2 tantativ, backoff) **sèlman** si `isNetworkError`, menm kle idanpotans chak fwa ; erè metye jete imedyatman, jamè reseye. `:236-250` mesaj final apre echèk rezo total gen yon bouton "Wè kòmand mwen yo" → `/orders`. `:369-...` blòk `catch` final la itilize `translateSupabaseError` — **premye fwa modil NKD-003 Pati A a reyèlman itilize nan aplikasyon an**.
- `src/integrations/supabase/types.ts` — `idempotency_key` ajoute nan `orders` (Row/Insert/Update), `_idempotency_key` ajoute nan de antre `create_order_secure` (private + public).

**Pòte** : sèlman chemen checkout la, jan mande. 73 sit `toast.error` yo rete nan `docs/NKD-003_MIGRATION_BACKLOG.md`, pa touche.

## 5. Tès vitest — `src/lib/__tests__/rpc-errors.test.ts` + nouvo `checkout-idempotency.test.ts`

| Tès | Rezilta |
|---|---|
| Erè rezo (fetch `TypeError`, `Failed to fetch`) klase kòm rezo | ✅ PASS |
| Erè metye (kòd Postgres prezan, ekz. `P0001`/`23505`) klase kòm metye, pa rezo | ✅ PASS |
| Objè `PostgrestError` (pa yon `Error` reyèl) pa klase kòm rezo | ✅ PASS |
| `null`/`undefined`/string brit pa klase kòm rezo | ✅ PASS |
| `getOrCreateIdempotencyKey()` retounen menm kle a plizyè fwa (retry) | ✅ PASS |
| `clearIdempotencyKey()` fòse yon nouvo kle apre | ✅ PASS |
| Retry apre erè metye (san `clear`) kenbe menm kle a | ✅ PASS |

Egzekite pa `npm run test` — **221/221** (212 preegzistan + 9 nouvo, 0 regresyon).

## 6. `npm run verify`

`npx tsc --noEmit` ✅, `eslint` ✅ (0 erè), `check:migrations` ✅ (144 migrasyon), `vitest` ✅ **221/221**, `npm run build` ✅.

## 7. Konfimasyon

**Anyen aplike sou pwodiksyon. Anyen pouse.** Migrasyon `20260818100000_nkd011_order_idempotency.sql` tann : (1) mèt pwojè a kouri `docs/NKD011_ORDER_IDEMPOTENCY_TEST.sql` an lokal oswa nan yon `BEGIN…ROLLBACK` separe **apre** migrasyon an aplike (menm rezon Postgres ki egziste pou NKD-016 — men isit la se yon nouvo kolòn/fonksyon, pa yon nouvo valè enum, donk **ka konbine nan yon sèl `BEGIN…ROLLBACK`** kontrèman ak NKD-016, si mèt pwojè a prefere teste anvan aplike pou vre), (2) otorizasyon eksplisit pou aplike, (3) lòd deplwaman : migrasyon anvan push (Faz 7, menm règ ki toujou aplike).
