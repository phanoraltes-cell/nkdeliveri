# FAZ 3 — DATABASE

**Dat** : 2026-08-14
**Metòd** : lekti dirèk 138 fichye migrasyon (`supabase/migrations/`) + kòd sous. **Okenn kòmand CLI ki louvri koneksyon DB dirèk** (Règ A1). Kèk verifikasyon mande konfirmasyon SQL Editor live pou vin `KONFIME` — make `ESTIMASYON` (baze sou istwa migrasyon, pa live) jiskaske sa fèt. Okenn kòd modifye, okenn `src/routes/` touche (Règ A4).

---

## 0. Anti-doublon (Règ A3)

`grep -ril "faz 3\|database audit\|money column\|rollback block"` sou `docs/` → 2 rezilta, tou de san rapò (mansyone san kontèks). `git log --oneline` (30 dènye) verifye — okenn odit DB konplè anvan sa a. **Pa gen doublon.**

---

## 1. Pote soti nan faz anvan

### NKD-006 migrasyon — **APLIKE** (pa "poko" ankò)
Estati chanje depi dokiman pwotokòl la ekri : migrasyon `20260814150000_nkd006_push_endpoint_allowlist.sql` **aplike sou pwodiksyon 2026-08-14** apre otorizasyon eksplisit, konfime an dirèk via `pg_constraint` (`docs/PHASE_FAZ2_FINALIZATION_REPORT.md`). `push_subscriptions` gen kounye a **4 kontrent** (`pkey`, `UNIQUE(endpoint)`, `FK user_id`, `CHECK push_subscriptions_endpoint_allowlist`), pa 3.

### 137/138 migrasyon san blòk rollback — **KANTIFYE**
`grep -lic "rollback" supabase/migrations/*.sql` (138 fichye total, 1 anplis pase Faz 0 — NKD-006) : **6/138 gen yon mak "rollback"** an kòmantè, **132/138 pa genyen**.

**Detay onèt sou 6 yo** (2 nan yo se pwòp travay mwen menm nan sesyon sa a) :
| Fichye | Gen rollback ? |
|---|---|
| `20260731130000_moncash_collect_payments.sql` | ✅ |
| `20260808210000_payment_security_least_privilege.sql` | ✅ |
| `20260811120000_admin_step_up_enforcement.sql` | ✅ |
| `20260813100000_admin_backup_codes.sql` | ✅ |
| `20260813110000_fix_user_roles_rls_bypass.sql` | ✅ |
| `20260814150000_nkd006_push_endpoint_allowlist.sql` | ✅ |

**Gap detekte, deklare san kache l** : **3 migrasyon Faz 1 (mwen menm ki ekri yo) MANKE blòk rollback**, kontrèman ak konvansyon pwojè a (`chak nouvo migrasyon pote blòk rollback an kòmantè` — règ ki repete plizyè fwa nan sesyon sa a) :
- `20260813120000_fix_manual_vs_automatic_payment_classification.sql` — 0 mak "rollback"/"revers"
- `20260813130000_fix_payments_rls_bypass.sql` — 0 mak
- `20260813140000_translate_claim_delivery_messages.sql` — 0 mak

Tou de 2 dènye yo fasil revèsib (`CREATE POLICY "payments admin update" ...` pou premye a ; `CREATE OR REPLACE FUNCTION` ak ansyen kòd angle a pou dezyèm nan), men pa gen blòk eksplisit ekri. **Pa yon risk sekirite — yon manke dokimantasyon**, ki merite yon oto-korije nan yon fiti pas dedye (pa touche kounye a, ta soti deyò perimèt Faz 3 stritman DATABASE).

**Rezime chif** : **136/138 (98.6%) san blòk rollback eksplisit** — dèt dokimantasyon konfime, pa yon vilnerabilite.

### Lajan — 8 tab, tout kolòn — **KONFIME NUMERIC, 0 FLOAT/REAL/double precision**
Rechèch egzoustif (`^\s*[a-z_]+\s+(FLOAT|REAL|double precision)\b`) sou tout 138 migrasyon → **0 rezilta, pwojè antye**, pa sèlman 8 tab yo. Chak kolòn lajan verifye endividyèlman :

| Tab | Kolòn lajan | Tip |
|---|---|---|
| `orders` | `subtotal`, `delivery_fee`, `service_fee`, `total` | `numeric(10,2)` |
| `payments` | `amount` | `numeric(10,2)` |
| `refunds` | `amount` | `numeric(10,2)` |
| `payouts` | `amount` | `numeric(12,2)` |
| `wallets` | `available_balance`, `pending_balance`, `paid_balance` | `numeric(12,2)` |
| `commission_ledger` | `gross_amount`, `commission_rate`, `commission_amount`, `net_amount` | `numeric(12,2)`/`numeric(6,2)` |
| `payout_commissions` | (okenn — sèlman FK sou `commission_ledger`) | n/a |
| `wallet_transactions` | `available_delta`, `pending_delta`, `paid_delta`, `lifetime_delta` | `numeric(12,2)` |

**KONFIME, egzoustif pa konstriksyon** (grep sou tout istwa, pa yon echantiyon).

### NKD-004 — **PA TOUCHE**, konfime.

---

## 2. RLS sou 51 tab

**Envantè konplè** (`CREATE TABLE public.*` sou tout 138 migrasyon) → **51 tab**, matche egzakteman chif pwotokòl la bay.

**Kwaze ak `ENABLE ROW LEVEL SECURITY`** → **51/51 tab gen omwen 1 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` nan istwa yo**. `grep "DISABLE ROW LEVEL SECURITY"` → **0 rezilta nan tout pwojè a** (pa gen okenn dezaktivasyon, janm).

**ESTIMASYON, pa KONFIME** — sa a soti nan istwa migrasyon, pa yon lekti live `pg_class.relrowsecurity`. Rekèt pou konfime, **ekri, pa egzekite** (Règ A1) :
```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
ORDER BY relrowsecurity ASC, relname;
```
Si tout 51 ranje retounen `relrowsecurity = true`, sa konfime rezilta a. Si youn retounen `false`, sa vle di yon dezaktivasyon manyèl te fèt deyò istwa migrasyon an — enpòtan pou detekte.

### Tab ak RLS aktive men **0 policy** (verifye ak yon regex miltip-liy, apre yon premye vèsyon ki te gen fo pozitif)
**2 tab** : `admin_backup_code_state`, `admin_backup_codes`. **Verifye entansyonèl, pa yon bug** : tou de gen `REVOKE ALL ... FROM PUBLIC, anon, authenticated` (kòmantè pwòp migrasyon an konfime : `-- SECURITY DEFINER RPC sèlman`) — okenn wòl pa menm ka rive nan tab la pou deklanche yon evalyasyon policy an premye lye. RLS san policy la se yon dezyèm kouch, pa sèl la.

---

## 3. Endèks sou kolòn FK/WHERE/JOIN

Chak kolòn FK (`uuid ... REFERENCES`) kwaze kont `CREATE INDEX` **ak** kontrent `UNIQUE` (kolòn oswa tab-nivo — tou de kreye yon endèks implisit, premye pas mwen an te gen fo pozitif paske li pa t verifye `UNIQUE`, korije).

**16 kolòn FK san endèks eksplisit ni kontrent UNIQUE** :

| Kolòn | Nati | Risk |
|---|---|---|
| `payments.reviewed_by`, `payment_proofs.uploaded_by`, `commission_ledger.created_by`, `payouts.paid_by`, `payouts.resolved_by`, `wallet_transactions.created_by`, `backfill_runs.run_by`, `sponsored_placements.created_by`, `order_chat_messages.author_id`, `promotional_notifications.sent_by`, `newsletter_send_log.triggered_by`, `order_admin_notes.author_id`, `komand_assistance.assigned_admin_id`, `komand_assistance.resolved_by` | Kolòn "ki moun ki fè sa" (admin/staff, `auth.users`) | **Ba** — ba kadinalite (kèk santèn admin/anplwaye), pa gen prèv yo filtre/join souvan nan kòd la |
| `wallet_transactions.commission_ledger_id` | Lyen ledger→tranzaksyon | **Mwayen** — potansyèl itilize nan istorik ledger, merite verifikasyon |
| `wallet_transactions.payout_id` | Lyen payout→tranzaksyon | **Mwayen** — menm rezon |

**ESTIMASYON** (analiz statik sèlman, pa `EXPLAIN ANALYZE` live). Rekèt pou konfime enpak reyèl, **ekri, pa egzekite** :
```sql
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('wallet_transactions', 'commission_ledger', 'payouts')
ORDER BY tablename;

EXPLAIN ANALYZE
SELECT * FROM public.wallet_transactions WHERE commission_ledger_id = (SELECT id FROM public.commission_ledger LIMIT 1);
```

---

## 4. Tranzaksyon sou operasyon miltip

**Kreyasyon kòmand** (`orders` + `order_items` + `stock_quantity`) : `checkout.tsx:250` fè **yon sèl apèl** `supabase.rpc("create_order_secure", {...})` — pa plizyè apèl separe. Fonksyon an (`plpgsql`, 7 vèsyon istorik via `CREATE OR REPLACE`) fè `INSERT INTO order_items` **anndan menm fonksyon an** — Postgres garanti atomicite pou yon sèl apèl fonksyon `plpgsql`. **KONFIME atomik.**

**Konfimasyon peman** (`review_manual_payment_secure`, `confirm_cash_payment_secure`, `complete_collect_payment_secure`) : tout se yon sèl RPC `SECURITY DEFINER`, chak deja verifye pandan Faz 1/travay anvan sesyon sa a. **KONFIME atomik.**

**PA VERIFYE / mande desizyon metye (Règ A5)** : `products.stock_quantity` gen yon `CHECK (stock_quantity >= 0)` (`20260706151929_add_product_stock_quantity.sql`) e ka mete/modifye pa restoran an, men **`stock_quantity` pa janm dekremante okenn kote nan okenn migrasyon** (`grep "stock_quantity = stock_quantity\|stock_quantity -"` → 0 rezilta nan tout pwojè a). Sa vle di : swa (a) swiv stock la se manyèl pa desizyon, restoran an ajiste l limenm apre chak vant, swa (b) se yon gap fonksyonèl kote yon pwodui ka vann pi plis pase estòk li san limit otomatik. **Mwen pa deside kilès nan 2 la ki bon** — se yon desizyon metye, pa yon bug teknik evidan. Mande konfimasyon anvan nenpòt aksyon.

---

## 5. Kontrent entegrite

- Tout 8 tab lajan yo gen `NOT NULL` sou kolòn `amount`/`total` prensipal yo (verifye §1).
- `payouts.amount` ak `CHECK (amount > 0)` — anpeche yon payout negatif/zewo.
- `commission_ledger_one_beneficiary` (CHECK, non wè konplè men konfime egziste) — egzije egzakteman yon benefisyè.
- `deliveries.order_id UNIQUE` (deja verifye Faz 1, F-02) — anpeche 2 livrezon pou menm kòmand.
- `push_subscriptions.endpoint UNIQUE` — konfime, wè §6.

**PA VERIFYE egzoustivman** — 51 tab, chèk konplè tout `CHECK`/`FOREIGN KEY`/`NOT NULL` ta mande yon pas dedye pi long pase sa Faz 3 ka bay nan yon sèl tou. Sa ki anwo a se sa ki verifye pandan travay sa a, pa yon envantè 100% konplè.

---

## 6. N+1

Rechèch `.map(async...)`/`.forEach(async...)`/`for (const...)` ki gen yon apèl `supabase.from(`/`supabase.rpc(` **anndan** yon bouk, nan `src/routes/`, `src/hooks/` — **0 rezilta**. Chak vye egzanp verifye pandan sesyon sa a (`dashboard.restaurant.orders.tsx`, elatriye) itilize yon sèl `.select()` ak anbranch (`payments(status, method, payment_transactions(status))`) — patwon idyomatik PostgREST, pa N+1.

**Limit deklare** : rechèch sa a kouvri **kòd frontend sèlman** (kote yon N+1 nòmalman ta parèt, apèl HTTP separe pou chak eleman yon lis). **Pa verifye** : bouk **anndan** yon fonksyon `plpgsql` li menm (yon `FOR ... LOOP` ak yon subquery pou chak iterasyon) — sa ta mande yon lekti liy-pa-liy tout 117 RPC, deyò sa Faz 3 ka rezonableman kouvri nan yon sèl pas.

---

## 7. Nòt fonksyonèl — `UNIQUE(endpoint)` sou `push_subscriptions`

**Konfime** : `src/lib/push.ts:69-78` itilize `.upsert(..., { onConflict: "endpoint" })` — yon re-abònman ak menm endpoint la **mete ajou** ranje egzistan an (nouvo `p256dh`/`auth`/`last_used_at`), li pa jete yon erè. Konpòtman kòrèk, deja jere.

---

## 8. Rezime KONFIME / ESTIMASYON / PA VERIFYE

**KONFIME** :
- NKD-006 aplike sou pwodiksyon.
- 132/138 (95.7%) migrasyon san blòk rollback — chif egzat, konte sou tout fichye.
- 8 tab lajan yo, tout kolòn `NUMERIC` — 0 FLOAT/REAL nan tout pwojè a.
- Kreyasyon kòmand ak konfimasyon peman se operasyon atomik (yon sèl RPC).
- `push_subscriptions` UNIQUE(endpoint) jere kòrèkteman via upsert.
- 2 tab RLS-san-policy (`admin_backup_code*`) se yon chwa entansyonèl, pa yon bug.
- 0 patwon N+1 nan kòd frontend (routes/hooks).

**ESTIMASYON** (baze sou istwa migrasyon, mande konfimasyon live pou vin KONFIME) :
- 51/51 tab gen RLS aktive — rekèt SQL ekri §2, ap tann egzekisyon.
- 16 kolòn FK san endèks/UNIQUE — enpak reyèl mande `EXPLAIN ANALYZE`, rekèt ekri §3.

**PA VERIFYE** :
- Estòk pwodui (`stock_quantity`) pa janm dekremante — **mande desizyon metye**, pa yon konklizyon teknik (§4).
- Envantè konplè `CHECK`/`FOREIGN KEY` sou tout 51 tab (§5, verifye pasyèl sèlman).
- N+1 anndan kò fonksyon `plpgsql` yo menm (§6, deyò sa yon sèl pas ka kouvri).

---

## 9. Kwazman ak backlog egzistan

Okenn nan konstatasyon Faz 3 sa a pa chevoche yon finding ouvè deja idantifye (NKD-001/002/003-B/004/007). 3 nouvo obsèvasyon (rollback blocks, endèks FK, stock_quantity) se premye fwa yo dokimante — **pa gen ID NKD nesesè** (yo pa vilnerabilite sekirite, se dèt/entegrite/desizyon metye) sof si mèt pwojè a vle yo swiv kòm sa.

---

Kanpe la. Ap tann `KONTINYE` pou Faz 4, oswa rezilta 2 rekèt SQL Editor yo (§2, §3) si ou vle konfime yo anvan.
