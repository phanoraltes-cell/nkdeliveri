# NKD-010 — Lojik estòk pwodwi (dekremantasyon + endisponiblite)

**Dat** : 2026-08-14
**Sous** : Faz 3 Database Audit §4, `products.stock_quantity` pa janm dekremante. **Fonksyonalite metye, otorize eksplisitteman pa mèt pwojè a.**

---

## 1. Rezilta Etap 0 ak rekòmandasyon

Rekonesans lokal (`grep -rn "stock_quantity\|available" src/`) te jwenn 2 bagay ki bese risk prensipal la anvan menm rekèt SQL Editor la :
- `restaurants.$slug.tsx` (menu kliyan) te **deja** gen yon check `p.stock_quantity === 0` (pa `<= 0`, pa falsy) — yon pwodwi `NULL` te deja parèt kòm disponib.
- `product-form.tsx` te **deja** dokimante nan kòmantè li : *"Empty string = unlimited/not tracked (stored as NULL)"* — konvansyon D1 la te deja la, jis pa janm aplike bò backend.
- Yon dezyèm mekanis, `available` (bwolean, `NOT NULL DEFAULT true`), te deja egziste, deja itilize kòm filtè sèvè (`restaurants.$slug.tsx:76`).

**Rekèt SQL Editor** (kouri pa mèt pwojè a, rezilta konfime) :
```
total=2, nil=0, zewo=0, pozitif=2
available: boolean, NOT NULL, default true
stock_quantity: integer, NULLABLE, default NULL
```

**Rekòmandasyon** : **San danje pou kontinye.** Ak sèlman 2 pwodwi total, tou de deja ak yon chif pozitif, pa gen okenn ka `zewo` ki ta fè yon pwodwi disponib disparèt, e pa gen okenn migrasyon done nesesè (0 ranje `NULL` pou konvèti).

---

## 2. Repons D1-D4 (konfime pa mèt pwojè a)

| Desizyon | Repons |
|---|---|
| **D1** | Tout pwodwi dwe evantyèlman gen yon chif obligatwa (**diferan** de rekòmandasyon orijinal la, ki te "NULL = san limit pou tout tan"). |
| **D1 (swit)** | Pwodwi `NULL` jodi a **rete `NULL`** (san limit, san dekremantasyon) jiskaske restoran an antre yon chif — **okenn valè default abitrè pa asiyen**. Mekanik la idantik ak "NULL = san limit" pou pwodwi ki poko antre yon chif ; sèl diferans lan se objektif final la (tout pwodwi dwe gen yon chif, pa yon eta pèmanan). |
| **D2** | Wi — retou estòk otomatik lè `cancelled`/`refunded`. |
| **D3** | Nan `create_order_secure`, moman kreyasyon kòmand la. |
| **D4** | UI ki egziste deja (chan `stock_quantity` + chekbox `available` nan `product-form.tsx`) ase — okenn nouvo ekran. |

---

## 3. Migrasyon + rezilta tès `BEGIN…ROLLBACK`

**Fichye** : `supabase/migrations/20260814160000_nkd010_stock_decrement.sql` — **blòk rollback an kòmantè an tèt** (konsepsyon: `CREATE OR REPLACE` sou 3 fonksyon, "rollback" = remete ansyen kò fonksyon yo, pa yon `DROP`).

3 fonksyon touche, chak `CREATE OR REPLACE` ak kò konplè repwodwi — **chak liy deyò blòk NKD-010 yo idantik bit-pou-bit ak vèsyon an dirèk** (verifye kont dènye migrasyon ki te defini chak fonksyon anvan ekri) :

1. **`private.create_order_secure`** — dekremantasyon atomik anndan bouk `order_items` la, imedyatman apre chèk `available`. Yon sèl `UPDATE ... WHERE id = ... AND (stock_quantity IS NULL OR stock_quantity >= qty)`, `IF NOT FOUND THEN RAISE EXCEPTION 'Pa gen ase estòk pou "%" kounye a.'` — pa janm `SELECT` apre sa `UPDATE`.
2. **`private.update_order_status_secure`** — nouvo varyab `v_old_status` kaptire **anvan** UPDATE pwòp fonksyon an (ki ekrase `v_order`). Apre transisyon an reyisi : `IF _new_status IN ('cancelled','refunded') AND v_old_status NOT IN ('cancelled','refunded') THEN <retou estòk>`.
3. **`public.complete_refund_secure`** — menm gad "ansyen estati pa t deja tèminal" la, itilize `v_order_status` ki deja egziste nan fonksyon an, pou anpeche yon **doub kredi atravè 2 chemen ekriti yo** (si yon admin fòse `update_order_status_secure(id,'refunded')` dirèkteman, epi `complete_refund_secure` rele apre pou menm kòmand la).

**Kontrent `products_stock_quantity_non_negative`** deja egziste (`20260706151929_add_product_stock_quantity.sql`) — **pa gen nouvo CHECK ajoute**, migrasyon sa a apiye sou li kòm dènye filè.

`npm run check:migrations` : ✅ 139 migrasyon eskane, pa gen danje pa rezoud.

### Tès `BEGIN…ROLLBACK` — `docs/NKD010_STOCK_TEST.sql`

Kouri via Management API (SQL Editor ekivalan) apre otorizasyon, **anyen pa kenbe** (`ROLLBACK` final) :

| ID | Tès | Rezilta | Prèv |
|---|---|---|---|
| T1 | Dekremantasyon senp : estòk 5, kòmand 2 | ✅ PASS | Estòk 5 → 3 |
| T2 | Estòk ensifizan : estòk 3, kòmand 10 | ✅ PASS | Tout kòmand echwe, mesaj `'Pa gen ase estòk pou "Diri Kole" kounye a.'`, **san chif, san non tab/kolòn**, estòk rete 3 |
| T4 | Pwodwi `NULL` (san limit) : kòmand 100 | ✅ PASS | Pa bloke, `stock_quantity` rete `NULL` |
| T5 | Anilasyon : estòk 3→0 apre kòmand, `cancelled` | ✅ PASS | Estòk retounen a 3 |
| T5b | Idanpotans : anile menm kòmand la 2yèm fwa | ✅ PASS | Tablo tranzisyon an rejte deziyèm tantativ la, estòk rete 3 (pa gen doub kredi) |

**T3 (konkirans reyèl)** ak **T6 (doub kredi atravè `complete_refund_secure`)** — **pa teste** nan pas sa a : yo mande swa 2 sesyon Postgres senkwonize (pgbench oswa 2 koneksyon separe kouri an paralèl), swa yon chèn fixture pi long (yon demann ranbousman apwouve konplè) pase sa yon sèl tranzaksyon `DO $$` ka eksprime. Idempotans mekanism lan (`v_old_status`/`v_order_status` gad) **verifye pa lekti kòd** (menm gad egzat itilize nan 2 kote yo), pa pa yon tès egzekite. **Rekòmande pou Faz 8 (Performance) oswa yon tès dedye si mèt pwojè a vle konfimasyon konkirans reyèl.**

---

## 4. Chanjman frontend (`fichye:liy`)

**`src/routes/restaurants.$slug.tsx:203-210`** — pwodwi ak `stock_quantity === 0` filtre **deyò lis la nèt** (pa sèlman make "Fini") anvan menm gwoupman pa kategori/konte fèt, dapre demand eksplisit mèt pwojè a ("pwodwi fini pa parèt"). Badj "Fini" ki te egziste deja (`p.stock_quantity === 0 ? "Fini" : <bouton ajoute>`) rete kòm **filè defansif** (ka pa janm rive nan pratik kounye a, men pwoteje kont yon ras si estòk chanje pandan menm sesyon an).

**Bò restoran/admin** : `product-grid.tsx`/`product-form.tsx` **pa touche** — deja montre kantite reyèl (D4).

**Ka panye deja ranpli, pwodwi fini anvan validasyon** : **okenn nouvo kòd bezwen** — `checkout.tsx:336-337` deja gen `catch (e) { toast.error(e.message) }`, ki pase mesaj Kreyòl RPC a `'Pa gen ase estòk pou "X" kounye a.'` verbatim bay kliyan an, konsistan ak konvansyon pwojè a antye. Panye a **pa** vide otomatikman sou echèk sa a — kliyan an ka ajiste kantite a epi eseye ankò.

---

## 5. Nòt deplwaman

Apre deplwaman (migrasyon aplike), verifye manyèlman :
1. Kreye/modifye yon pwodwi ak yon chif estòk (egzanp 3) via "Modifye plat", pase yon kòmand pou 3, konfime pwodwi a disparèt nan lis kliyan an (`stock_quantity` kounye a 0).
2. Anile kòmand sa a (kliyan oswa restoran), konfime pwodwi a **reparèt** nan lis kliyan an.
3. Eseye yon 2yèm kòmand ki depase estòk ki rete a, konfime mesaj Kreyòl la parèt kòm yon toast klè, pa yon erè teknik.
4. Pwodwi `NULL` (san chif antre) yo dwe kontinye disponib san limit — verifye youn pou konfime pa gen efè de bò.

**Migrasyon aplike sou pwodiksyon ? NON** — `20260814160000_nkd010_stock_decrement.sql` ekri, teste (`BEGIN...ROLLBACK`, 5/5 tès posib pase), **pa aplike**, ap tann otorizasyon eksplisit separe (Règ A6).
