# FAZ 8 — PERFORMANCE

**Dat** : 2026-08-16
**Metòd** : lekti kòd sous + rapò egzistan. Règ Seksyon A `docs/PROTOKOL_FAZ3_A_FAZ11.md` aplike (A1-A9).

---

## 0. Anti-doublon (Règ A3) — kouvèti trè konsiderab, deja aplike

Yon "Phase 8" pi bonè (nimewotasyon diferan, deyò seri Faz 3-11 sa a, men **menm sijè egzat**) deja fè travay la **an pwofondè, ak mezi reyèl sou build pwodiksyon** :
- `docs/PHASE8_PERFORMANCE_PWA_AUDIT.md` — mezi bundle chunk pa chunk (gzip), precache SW (256 antre, 5655 KiB), imaj deja WebP, `staleTime` React Query deja regle, **"aucun polling superflu" deja konfime**.
- `docs/PHASE8_PERFORMANCE_PWA_REPORT.md` (= rapò klotti, commit `3b4dae5`) — implemantasyon + validasyon apre 434abdd (`perf(pwa): Phase 8 — service worker precache scope, LCP lazy-loading, deferred Sentry`) — **deja merge nan `main`**, pa yon travay ki rete an sispann.
- `docs/POLLING_REMEDIATION_REPORT.md` — bug polling/reantrans reyèl jwenn **e korije** (`useCollectPaymentPoll.ts`, verrou `inFlight`), 18 nouvo tès, tout rès mekanis la (4 faz degresif, jitter, poz sou vizibilite, 15 min limit, netwayaj unmount) deja konfime kòrèk.

**Konsekans** : Faz 8 nan seri sa a **pa dwe repwodwi okenn nan mezi sa yo**. Sèl travay ki rete se (a) konfime rapò yo toujou aktyèl (pa kraze pa yon chanjman apre 434abdd), (b) fè kwazman ak Faz 3 (endèks) ak Faz 5/6 (idanpotans, N+1) ki poko fèt eksplisitteman pou pèfòmans, (c) konpòtman anba anpil kòmand ansanm.

---

## 1. Konfimasyon rapò egzistan yo toujou aktyèl

**KONFIME, spot-check** : `src/router.tsx:20` toujou gen `staleTime: 30_000` — idantik ak sa `PHASE8_PERFORMANCE_PWA_REPORT.md` dekri. Okenn commit ant `434abdd` (2026-08-07) ak jodi a (Faz 0-7, seri sa a) pa t touche `router.tsx`, `src/sw.ts`, ni okenn chunk vandeur — konfime pa `git status`/istwa Faz 0-7 (tout chanjman te dokimante fichye pa fichye, okenn nan yo pa t nan zòn pèfòmans). **Rapò yo rete valid.**

---

## 2. Kwazman ak Faz 3 — endèks

Faz 3 (§3, `docs/PHASE3_DATABASE_AUDIT.md`) te jwenn **16 kolòn FK san endèks eksplisit ni UNIQUE**, majorite yo kolòn "ki moun ki fè sa" (`reviewed_by`, `created_by`, elatriye — ba kadinalite). **2 pi enteresan pou pèfòmans** deja site : `wallet_transactions.commission_ledger_id`/`payout_id`. **Pa gen nouvo travay isit la** — Faz 3 deja rekòmande `EXPLAIN ANALYZE` si mèt pwojè a vle konfimasyon enpak reyèl. **Site, pa reprodwi.**

---

## 3. Kwazman ak Faz 5/6 — idanpotans ak N+1

- Faz 5 (§3) : `create_order_secure` pa gen kle idanpotans sèvè — deja dokimante, deja site pou Faz 10.
- Faz 6 (§2) : okenn deteksyon `navigator.onLine`, retry React Query default 3x ak backoff — deja dokimante.
- Faz 5/6 tou de : **0 patwon N+1** jwenn nan kòd frontend routes/hooks.

**Pa gen nouvo bagay pou ajoute isit la** — sa yo se konsekans biznis/UX (Faz 5/6/10), pa yon nouvo dekouvèt pèfòmans.

---

## 4. Konpòtman anba anpil kòmand ansanm (nouvo, pa t deja verifye eksplisitteman)

**KONFIME, dapre design** : Kanban restoran an limite a **100 kòmand ki pi resan yo** (`dashboard.restaurant.orders.tsx`, deja li pandan Faz 1) — pa yon `.range()` paginasyon, yon bòn fiks. Sa vle di si yon restoran gen plis pase 100 kòmand aktif/resan an menm tan, Kanban a **pa montre yo tout**, men vue "Lis" (menm ekran) **se li ki pajine vre** (`PaginationControls`, Faz 5) — donk gen toujou yon fason wè tout kòmand, jis pa nan Kanban a.

**KONFIME** : chak kòmand kreye se yon RPC atomik (`create_order_secure`) ki fè `INSERT`/`UPDATE` sou `orders`/`order_items`/`products`/`payments` **anndan yon sèl tranzaksyon** — pa gen kondisyon kous kote 2 kliyan k ap kòmande anmenmtan yo ta jwenn yon eta enkoyeran (chak apèl konplètman sekans, Postgres garanti sa pou yon sèl apèl fonksyon).

**PA VERIFYE** : konpòtman reyèl anba **chaj wo konkirans** (100+ kòmand kreye an menm tan, egzanp lè gen yon pwomosyon) — sa mande yon tès chaj reyèl (`pgbench`/zouti ekivalan), deyò sa yon lekti kòd statik ka konfime. Menm limit deja site nan T3 NKD-010 (Faz 3/travay estòk) — **pa touche, dapre lis eksplisit "pa nan pòte" pwomt anvan an** ("Anvan premye vrè restoran, pa anvan Faz 8" — nou la kounye a nan Faz 8, men pwomt sa a espesifikman pa mande koreksyon/tès pou T3/T6, sèlman odit pèfòmans jeneral).

---

## 5. Rezime KONFIME / ESTIMASYON / PA VERIFYE

**KONFIME** :
- Tout mezi/koreksyon "Phase 8" (lòt seri) toujou aktyèl, verifye pa spot-check `staleTime`.
- Polling (`useCollectPaymentPoll`) deja korije, deja teste.
- Kreyasyon kòmand atomik, sekans, pa gen kondisyon kous nan yon sèl apèl.
- Kanban 100-bòn fiks, men Lis pajine — pa gen done pèdi, jis yon vue segondè ki limite.

**ESTIMASYON** : okenn nouvo.

**PA VERIFYE** :
- Chaj wo konkirans reyèl (100+ kòmand simultane) — mande zouti tès chaj ki pa disponib.

---

## 6. Kwazman ak backlog egzistan

Pa gen nouvo ID NKD. Tout sa ki ta ka sanble yon nouvo finding (endèks, idanpotans, N+1, T3/T6) deja gen yon kay (Faz 3/5/6/10, T3/T6 NKD-010) — site, pa double.

---

Kanpe la. Ap tann `KONTINYE` pou Faz 9.
