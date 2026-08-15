# FAZ 5 — API

**Dat** : 2026-08-14
**Metòd** : lekti kòd sous + migrasyon. Règ Seksyon A `docs/PROTOKOL_FAZ3_A_FAZ11.md` aplike (A1-A9). Okenn kòd modifye.

---

## 0. Anti-doublon (Règ A3)

`docs/FULL_PLATFORM_AUDIT_2026-08-13.md` §7 deja gen yon envantè RPC konplè : **117 fonksyon `public.*`, 85 `_secure`, 31 `get_*_admin`** (VERIFIED pa grep egzoustif sou 135 migrasyon), ak patwon dominan deja konfime plizyè fwa (`SECURITY DEFINER` + `search_path` fikse + reveri­fikasyon `has_role()`/pwopriyete + `REVOKE ALL`/`GRANT EXECUTE TO authenticated`). §3 gen envantè 60 wout ak `Auth | Wòl | Risk`, §5 gen fich apwofondi pou 12 wout ki pi kritik yo. **Site, pa rebati.** Faz 5 konsantre sèlman sou sa ki pa t deja kouvri : kondisyon retou NKD-005, Kategori D sou ang RPC, idanpotans, paginasyon, kòd HTTP.

---

## 1. NKD-005 — Kondisyon retou (verifye eksplisitteman)

**Kesyon** : èske gen yon RPC ki ekspoze yon chemen `UPDATE`/`DELETE`/`TRUNCATE` sou yon tab pwoteje pa `prevent_log_mutation()` bay yon wòl ki pa `service_role` ?

**7 tab pwoteje** (envantè konplè, grep egzoustif) : `admin_backup_codes`, `moncash_api_logs`, `moncash_webhook_events`, `newsletter_send_log`, `order_admin_notes`, `plop_api_logs`, `stripe_api_logs`.

**KONFIME, egzoustif** : rechèch `(UPDATE|DELETE FROM|TRUNCATE)` sou chak nan 7 tab yo, deyò definisyon pwòp trigger yo, sou tout 139 migrasyon :
- 6 nan 7 tab yo (`moncash_api_logs`, `moncash_webhook_events`, `newsletter_send_log`, `order_admin_notes`, `plop_api_logs`, `stripe_api_logs`) : **0 okirans** — okenn RPC pa janm eseye modifye/efase ranje ladan yo, kèlkeswa wòl.
- `admin_backup_codes` : 2 `UPDATE` jwenn (`generate_admin_backup_codes_secure`, `verify_admin_backup_code_secure`) — **atandi ak san danje** : trigger `prevent_log_mutation` la sèlman sou `BEFORE DELETE`/`BEFORE TRUNCATE` pou tab sa a espesyalman (konsepsyon orijinal fonksyonalite a, deja dokimante : "UPDATE rete pèmèt — `used_at`/`revoked_at` bezwen ka chanje"), donk `UPDATE` yo **pa menm rive nan chemen trigger la**.

**Konklizyon : NKD-005 rete P3.** Okenn kondisyon retou pa deklanche.

---

## 2. Kategori D (enumeration) — sou ang RPC

**Patwon rechèche** : yon RPC ki fè `SELECT ... WHERE id = X`, epi retounen 2 mesaj diferan selon si ranje a **pa egziste** ("X not found") kont si li egziste men **wòl la pa gen dwa** ("Forbidden") — sa ta pèmèt yon atakè distenge "pa egziste" de "egziste men pwoteje" pa souvan tès ID.

**Konfime patwon an EGZISTE** (egzanp `update_order_status_secure`) : `IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; ... IF NOT v_allowed THEN RAISE EXCEPTION 'Illegal status transition...'/'Forbidden'`. Menm patwon jwenn nan RPC peman/ranbousman yo (`Payment not found`, `Refund not found`, apre sa yon chèk wòl separe).

**Men PA eksplwatab an pratik** — menm rezònman ak Faz 2 (§2, Kategori D, ki te gade sou ang trigger) : **tout kle prensipal yo se `uuid PRIMARY KEY DEFAULT gen_random_uuid()`** (128 bit alatwa) — yon atakè pa ka "eseye" yon ID pou konfime li egziste, paske li pa ka menm **jenere** yon ID valid pou teste an premye lye. Distenksyon mesaj la pa gen okenn valè pratik san yon mwayen jenere/vole yon vrè ID anvan.

**Verifikasyon adisyonèl** : `order_number` (fòma `NK-XXXXXXXXXX`, 10 karaktè hex ki soti nan yon `gen_random_uuid()`) **jamè aksepte kòm paramèt rekèt** nan okenn RPC — tout chèche fèt pa `_order_id uuid`. Pa gen chemen altènatif ak yon idantifyan pi fèb/prediktib.

**Konklizyon : okenn ka Kategori D eksplwatab jwenn, ni sou ang trigger (Faz 2) ni sou ang RPC (Faz 5).**

---

## 3. Idanpotans

### Kreyasyon kòmand (`create_order_secure`) — **PA gen vrè idanpotans, mande atansyon mèt pwojè a**

**Konfime** : `checkout.tsx:147,619-621` gen yon gad **UI sèlman** (bouton `disabled={submitting}` pandan apèl la an kou) — sa anpeche yon doub-klik òdinè. **Men pa gen okenn kle idanpotans** (yon token jenere pa kliyan, tcheke kont yon tab "deja trete") anndan `create_order_secure` li menm : si menm rekèt la voye 2 fwa nan nivo rezo a (koneksyon fèb, retès otomatik nan navigatè/rezo — yon reyalite atandi pou piblik sib NK Deliveri an Ayiti, deja idantifye kòm yon konsiderasyon pou Faz 6), 2 kòmand separe ka kreye, tou de valid, tou de dekremante estòk (NKD-010) endepandaman.

**Kontras** : webhook MonCash (`moncash-webhook-handler.server.ts:79`) **LI menm idanpotan** — yon evènman resevwa 2 fwa retounen `{outcome: "duplicate"}` san double-trete. Sa montre patwon idanpotans deja konnen/aplike **nan** pwojè a, jis pa nan `create_order_secure`.

**Règ A5 aplike** : sa se yon desizyon metye (èske yon kle idanpotans dwe ajoute, ki gwosè fenèt tan, ki konpòtman lè yon doub-detekte) — **pa yon fiks teknik mwen ka fè inilateralman**. Dokimante isit la, pa korije.

### Konfimasyon peman
`review_manual_payment_secure` (gad kont re-desizyon deja verifye Faz 1), `confirm_cash_payment_secure` (double-konfimasyon kliyan+livrè), `complete_collect_payment_secure` (webhook, idanpotan par konsepsyon). **KONFIME idanpotan** pou tou 3.

---

## 4. Paginasyon

**KONFIME** (echantiyon, pa 100% egzoustif) : 12 fichye itilize `PaginationControls`/`.range()`, ki gen ladan wout kliyan yo (`restaurants.index.tsx:51`, `orders.index.tsx`) ak wout admin yo (31 RPC `get_*_admin` deja konfime pajine, `FULL_PLATFORM_AUDIT_2026-08-13.md`).

**Nòt UX (pa yon finding sekirite)** : `dashboard.driver.history.tsx:74` itilize yon `.limit(50)` fiks olye yon vrè paginasyon (pa gen "paj swivan") — yon livrè ak plis pase 50 livrezon istorik pa ka wè pi ansyen yo nan ekran sa a. Bòn rezonab, pa yon danje, men yon limit fonksyonèl reyèl.

---

## 5. Kòd HTTP

**KONFIME** — 3 wout API verifye endividyèlman :
- `api.webhooks.moncash.ts` : pwopaje `result.httpStatus` (401 siyati envalid, 200 siksè/doublon, 500 erè entèn) — pa janm 200 pou yon echèk.
- `api.cron.moncash-reconcile.ts` : 500 (config manke), 401 (`CRON_SECRET` envalid), 200 (siksè), 500 (erè egzekisyon).
- `api.csp-report.ts` : 413 (peyload twò gwo), 204 (aksepte, pa gen kontni pou retounen).

Chak wout retounen yon kòd ki byen reflete rezilta reyèl la — pa gen `200` jenerik sou echèk.

---

## 6. Rezime KONFIME / ESTIMASYON / PA VERIFYE

**KONFIME** :
- NKD-005 rete P3 — okenn RPC pa ekspoze mutasyon sou 6/7 tab pwoteje yo ; `admin_backup_codes` UPDATE atandi/san danje.
- Okenn ka Kategori D eksplwatab (UUID kle prensipal + `order_number` jamè yon paramèt rekèt).
- Webhook/konfimasyon peman idanpotan.
- Kòd HTTP kòrèk sou 3 wout API verifye.
- Paginasyon prezan sou echantiyon wout kliyan/admin verifye + envantè 31 RPC admin deja etabli.

**ESTIMASYON** : okenn nouvo — chak KONFIME anwo a soti nan grep egzoustif oswa lekti dirèk, pa yon sèl patwon san kontèks.

**PA VERIFYE** :
- Paginasyon 100% egzoustif sou tout lis ki ka grandi (echantiyon verifye, pa chak wout/RPC endividyèlman).
- Kòd HTTP sou lòt wout API ki pa nan 3 yo verifye a.

---

## 7. Kwazman ak backlog egzistan

Pa gen chevochman ak NKD-001/002/003-B/004/007. **Yon sèl bagay pote atansyon mèt pwojè a san yon nouvo ID** : manke idanpotans `create_order_secure` (§3) — pa yon vilnerabilite sekirite, se yon desizyon metye ki merite deba (Règ A5), site pou Faz 10 (Business Logic) tou si l ta bezwen re-parèt la.

---

Kanpe la. Ap tann `KONTINYE` pou Faz 6.
