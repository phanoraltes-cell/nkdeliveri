# NKD-015 — Frè livrezon

**Dat** : 2026-08-16
**Sous** : Faz 10 Business Logic Audit §6. Règ A5 leve pou pòte sa a sèlman.

---

## 1. Investigasyon anvan kòd (§5 espesifikasyon — "efè sou rès sistèm nan")

Verifye dirèkteman nan kòd sous **anvan** ekri migrasyon an, tout 3 kesyon rezoud san mande, ak prèv :

| Kesyon                                          | Rezilta                                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Komisyon restoran sou total oswa manje sèlman ? | **Sou `subtotal` sèlman** (`commission_engine.sql:76`, `ROUND(NEW.subtotal * v_rate / 100, 2)`) — deja **eskli** frè livrezon, **pa gen chanjman** nesesè.                                                    |
| Komisyon livrè baze sou ki chif ?               | `deliveries.fee` (`commission_engine.sql:110`), ki li menm mete a `COALESCE(orders.delivery_fee, 0)` **nan moman `claim_delivery_secure`** — deja byen konekte, ap eskale kòrèkteman yon fwa frè a vin reyèl. |
| Ranbousman/rekonsilyasyon jere frè a kòmsadwa ? | Wi — `refunds.amount = payments.amount = subtotal + delivery_fee + service_fee` (`refunds.sql:102`) — ranbousman deja enkli frè a antye, rekonsilyasyon (`payments.amount`) menm jan an.                      |

**Okenn nan 3 pwen sa yo pa te bezwen KANPE EPI MANDE** — tout deja byen konekte nan achitekti egzistan an.

---

## 2. Fòm konfigirasyon — desizyon pran

Prezante 2 opsyon (chif fiks vs tab zòn) ak konsekans yo. **Desizyon** : **tab zòn** (`platform_delivery_zones`, non + pri + `is_default`).

**Swit** : pa gen mekanis matching adrès↔zòn nan pòte sa a. **Desizyon** : tout kòmand itilize zòn pa defo a — schema a pare pou plizyè zòn pita, san migrasyon adisyonèl, men konpòtman jodi a idantik ak "yon sèl chif fiks."

---

## 3. Migrasyon + tès

**Fichye** : `supabase/migrations/20260816120000_nkd015_delivery_fee_config.sql` — blòk rollback an kòmantè an tèt.

**Kontni** :

- Tab `platform_delivery_zones` (id, name, fee_htg, is_default, created_at, updated_at, updated_by) — endèks inik pasyèl ki garanti **maksimòm 1 zòn pa defo**.
- Semans 1 ranje : "Gonaïves", 150 HTG, pa defo. **150 se yon valè inisyal pou kontinyite ak ansyen chif "mò" a — pa yon chif re-derive nan yon egzijans metye, admin ka korije l imedyatman via nouvo ekran an.**
- RLS : lekti piblik (`anon, authenticated` — checkout ka rive san koneksyon), **okenn politik ekri dirèk** — RPC sèlman.
- `update_delivery_zone_fee_secure(_zone_id, _fee_htg)` — admin sèlman, **STANDARD step-up** (15 min, fallback ok — pa STRICT, paske sa se pri afichaj, pa "lajan ki soti nan platfòm nan" ni "konfigirasyon sekirite peman", 2 kategori STRICT yo).
- `create_order_secure` modifye : retire `COALESCE(v_restaurant.delivery_fee, 150)`, li kounye a `platform_delivery_zones WHERE is_default = true`. **Kòd mò retire, jan mande a.**

`npm run check:migrations` : ✅ 140 migrasyon, pa gen danje.

### Tès `BEGIN…ROLLBACK` — `docs/NKD015_DELIVERY_FEE_TEST.sql`

**Egzekite pa mèt pwojè a, 2026-08-16, nan SQL Editor** (migrasyon an + tès la ansanm, `BEGIN…ROLLBACK`, anyen pa kenbe). **Rezilta : `Success. No rows returned`** — menm siyati egzat ak chak tès anvan ki te pase pwòp nan sesyon sa a (0 `RAISE EXCEPTION` deklanche, ki ta parèt kòm yon erè, pa yon siksè). Dapre Règ A9, sa se prèv egzekisyon reyèl, pa yon prediksyon :

| ID     | Tès                                                                                  | Rezilta | Prèv                     |
| ------ | ------------------------------------------------------------------------------------ | ------- | ------------------------ |
| T-read | `anon`/`authenticated` ka li pri a (bezwen pou checkout)                             | ✅ PASS | Okenn `T-read-FAIL` leve |
| T1     | `orders.delivery_fee` = pri zòn nan, `total = subtotal + delivery_fee + service_fee` | ✅ PASS | Okenn `T1-FAIL` leve     |
| T2     | Non-admin rejte lè l eseye chanje pri a                                              | ✅ PASS | Okenn `T2-FAIL` leve     |
| T3     | Admin san step-up fre rejte                                                          | ✅ PASS | Okenn `T3-FAIL` leve     |
| T4     | Chanje pri a → ansyen kòmand kenbe ansyen pri, nouvo kòmand pran nouvo pri           | ✅ PASS | Okenn `T4-FAIL` leve     |

**5/5 tès pase.**

---

## 4. Chanjman UI (`fichye:liy`)

**Nouvo** :

- `src/hooks/useDeliveryFee.ts` — hook pataje (React Query), li `platform_delivery_zones` default zone.
- `src/routes/_authenticated/dashboard.admin.delivery-fee.tsx` — nouvo ekran admin, STANDARD step-up (`withReauth(..., "standard")`).
- `src/routes/_authenticated/dashboard.admin.index.tsx:16,362-367` — nouvo kat navigasyon "Frè livrezon".

**Modifye** :

- `src/routes/checkout.tsx:163-176` (retire ansyen rekèt `restaurants.delivery_fee`), nouvo `useDeliveryFee()`, bouton "Konfime kòmand" kounye a gen `disabled={submitting || platformFee.isLoading}` an plis. **Liy separe "Sou-total"/"Frè livrezon"/"Total" te deja egziste** (`checkout.tsx:404-417`) — sèl sous done a chanje, pa estrikti afichaj la.
- `src/components/home/popular-restaurants-section.tsx` — `r.delivery_fee` (ki ta rete tanporèlman toujou 0 apre chanjman sa a) ranplase pa `useDeliveryFee()`.
- `src/routes/restaurants.$slug.tsx` — menm bagay, header restoran an.
- `src/routes/restaurants.index.tsx` — 2 kote (lis prensipal + kat sponsorize).
- `src/integrations/supabase/types.ts` — antre `platform_delivery_zones` (Tables) ak `update_delivery_zone_fee_secure` (Functions), pozisyon alfabetik egzat (menm konvansyon ak tout lòt tab/fonksyon pwojè a).

**Restoran** : `product-form.tsx`/`product-grid.tsx` **pa touche** — dapre spesifikasyon, restoran an pa wè ni jere pri livrezon an.

**`restaurants.delivery_fee` (kolòn)** : **pa touche, pa efase** — pa gen okenn nouvo `INSERT`/`UPDATE` sou li apre sa a, men efase l ta mande revize tout lòt sit ki ta ka li l ankò nan lavni, deyò sa pwomt sa a mande. Dokimante kòm yon kolòn kounye a inyore, pa yon aksyon.

---

## 5. Verifikasyon `npm run verify`

`npx tsc --noEmit` ✅, `eslint` ✅ (2 erè fòmataj korije pa Prettier), `vitest` ✅ 212/212 tès (0 regresyon), `npm run build` ✅ (routeTree.gen.ts regenere ak nouvo wout la), `check:migrations` ✅.

---

## 6. Kesyon `KANPE EPI MANDE` ki rete

**Okenn.** 2 desizyon mande (estrikti pri a, mekanis matching zòn) tou de reponn pa mèt pwojè a anvan enplemantasyon an kòmanse. 3 kesyon "efè sou rès sistèm nan" rezoud dirèkteman nan kòd sous, san mande.

---

## 7. Estati aplikasyon

**Migrasyon aplike sou pwodiksyon ? WI**, 2026-08-16, apre tès `BEGIN…ROLLBACK` konfime pase (§3). Sekans reyèl la : (1) mèt pwojè a kouri tès konbine a (migrasyon + tès) nan SQL Editor, `Success. No rows returned` ; (2) migrasyon an aplike pou vre via Management API (`database/query` — ekivalan SQL Editor, pa CLI) nan pwòp tranzaksyon li, ansanm ak ranje tracking `supabase_migrations.schema_migrations` ; (3) konfime an dirèk sou pwodiksyon :

- `platform_delivery_zones` gen egzakteman 1 ranje : "Gonaïves", 150.00, `is_default = true`.
- `update_delivery_zone_fee_secure` egziste nan `pg_proc`.
- `private.create_order_secure` k ap viv la kounye a li `platform_delivery_zones` (`LIKE '%platform_delivery_zones%'` → `true`) e **pa gen ankò** ansyen `COALESCE(...,150)` la (`LIKE '%COALESCE%150%'` → `false`).

Kòd (commit `5d0afb4`) ak migrasyon an kounye a **koyerans total** sou pwodiksyon — pare pou pouse san risk fenèt kase.
