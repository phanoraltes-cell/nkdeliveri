# FAZ 6 — FRONTEND

**Dat** : 2026-08-14
**Metòd** : lekti kòd sous. Règ Seksyon A `docs/PROTOKOL_FAZ3_A_FAZ11.md` aplike (A1-A9). Okenn kòd modifye, okenn `src/routes/` refaktorize (A4).

---

## 0. Anti-doublon (Règ A3) + pòte konfime

- **NKD-002** (6 god file, P3) — `docs/NKD_FAZ1_ARCHITECTURE_AUDIT.md:18-22` : `checkout.tsx` (630L), `dashboard.admin.collect.tsx` (590L), `dashboard.admin.payouts.tsx` (535L), `komand-detail-dialog.tsx` (518L), `dashboard.admin.finance.tsx` (509L), `dashboard.restaurant.orders.tsx` (487L). **Site, pa nouvo ID, pa re-kalkile.**
- **NKD-003 Pati B** (73 sit `toast.error(e...)` brit, 44 fichye) — `docs/NKD-003_MIGRATION_BACKLOG.md`, lis konplè deja egziste, diferе jiskaske Faz 11. **Site, pa nouvo ID.**
- Yon "Phase 8" (nimewotasyon diferan, yon lòt seri travay anvan Faz 3-11 sa a) deja gen `docs/PHASE8_PERFORMANCE_PWA_AUDIT.md` (gwosè bundle/PWA, mezi reyèl sou build pwodiksyon) — **pa yon doublon dirèk** (Faz 6 sa a konsène konpòtman fonksyonèl offline/rezo/responsive, pa gwosè bundle — sa se Faz 8 nan seri sa a, pita), men site pou kontèks, pa re-mezire gwosè bundle isit la.

---

## 1. NKD-009 — VAPID kle piblik an 2 kopi (fòmalize)

Idantifye premye fwa kòm "nòt achitekti, pa yon finding" nan `docs/NKD-008_FRONTEND_SECRET_EXPOSURE_AUDIT.md §3`. Fòmalize kòm **NKD-009** dapre demand ou.

**Konstatasyon** : kle piblik VAPID egziste an **de kopi endepandan**, ki dwe toujou rete idantik pou push notifikasyon yo mache :
1. `src/lib/push.ts:4-5` — literal kòde an dur : `const VAPID_PUBLIC_KEY = "BJ06H-steLp_..."` (itilize pa `pushManager.subscribe()` bò navigatè a).
2. Env var `VAPID_PUBLIC_KEY` (san prefiks `VITE_`) — itilize sèvè-side pa `push-dispatch.server.ts`/`send-push.functions.ts` (via `@block65/webcrypto-web-push`'s `buildPushPayload`) pou siyen peyload push la.

**Risk** : si kle VAPID la janm chanje (rotasyon), **2 kote separe** dwe mete ajou ansanm — env var Vercel a **ak** liy kòd sa a. Yon sèl nan yo mete ajou pandan lòt la rete ansyen an ta kase **tout** notifikasyon push (siyati sèvè a pa ta matche kle kliyan an te itilize pou abòne l).

**Nivo** : **P3** — pa yon fuit sekirite (kle piblik VAPID fèt pou piblik, deja klase PIBLIK OK nan NKD-008), se yon risk operasyonèl/dezenkronizasyon.

**Fichye:Liy** : `src/lib/push.ts:4-5` (kopi 1), env var `VAPID_PUBLIC_KEY` (kopi 2, `.env.example:39`, konsome nan `push-dispatch.server.ts:71-75`).

**PA korije nan pas sa a** (Règ A4, sa se yon odit) — dokimante pou yon fiti pwomt remédiation si ou vle.

---

## 2. Offline / koneksyon fèb (kritik pou Ayiti)

### Sa ki deja byen fèt (KONFIME)
- `src/sw.ts` : `NavigationRoute` ak `NetworkFirst` (5s timeout) pou navigasyon, `CacheFirst` pou asset estatik (js/css/imaj), ak yon `setCatchHandler` ki retounen `offline.html` (**konfime egziste**, `public/offline.html`) lè yon navigasyon echwe san rezo **ak** san antre precache.
- `vite-plugin-pwa` mode `injectManifest` (Service Worker ekri alamen, pa jenere otomatikman) — 226 antre precache, 3142 KiB.

### Gap jwenn (nouvo, pa deja dokimante)
**Okenn deteksyon `navigator.onLine`/evènman `online`/`offline` okenn kote nan `src/`** (`grep -rln "navigator\.onLine\|window\.addEventListener(.online"` → 0 rezilta). Konsekans konkrè :
- Aplikasyon an pa gen okenn mwayen di kliyan an "ou dekonekte kounye a" — chak echèk rezo parèt kòm yon erè jeneral (toast), idantik ak yon erè serveur reyèl, san distenksyon.
- Konbine ak §5 (React Query default), yon `query` ki echwe **retry otomatikman 3 fwa** ak backoff eksponansyèl anvan l montre yon erè — sou yon koneksyon Ayiti tipik ki "fèb men prezan" (pa "konplètman koupe"), sa ka pran plizyè segond anvan itilizatè a wè AYEN, pa gen endikatè "ap eseye ankò" vizib.

**Nivo** : **P3** (UX, pa sekirite) — men risk pratik reyèl pou baz itilizatè sib la. Site pou Faz 10/11 si mèt pwojè a vle yon endikatè "ou òflòn" global.

---

## 3. Konsomasyon done

**Deja odite an pwofondè** nan lòt seri ("Phase 8" — `docs/PHASE8_PERFORMANCE_PWA_AUDIT.md`) : gwosè chunk pa chunk, `vendor-pdf`/`vendor-charts`/`vendor-leaflet` deja izole pa wout/`import()` dinamik, 174 chunk wout-separe. **Pa reprodwi mezi sa yo isit la** — se Faz 8 (nan seri sa a) ki dwe re-verifye/aktyalize yo si nesesè.

---

## 4. Jesyon erè rezo

**KONFIME** : `catch (e) { toast.error(e instanceof Error ? e.message : "...") }` se patwon dominan (73 sit, NKD-003 Pati B) — mesaj toujou parèt, pa gen "silans" sou echèk. **Men** : okenn diferansyasyon "erè rezo" (fetch failed, timeout) kont "erè metye" (RPC rejte) — tou de parèt idantik nan yon toast wouj. Pou yon itilizatè sou yon koneksyon fèb, sa vle di yo pa ka fasilman di si yo ta dwe "eseye ankò kounye a" (erè rezo, transitwa) oswa "chanje sa m ap eseye fè a" (erè metye, pèsistan).

**Konekte ak Faz 5** : manke idanpotans `create_order_secure` (Faz 5 §3) vin **pi konkrè** isit la — yon itilizatè ki wè yon "erè" san konnen si se rezo oswa metye, epi ki eseye ankò, ka kreye yon doub kòmand si echèk orijinal la te an reyalite yon *timeout* apre kòmand la te deja kreye sèvè-side.

---

## 5. Responsive mobil

**Site, pa re-odite** : istwa git montre **5 commit dedye** deja korije pwoblèm responsive reyèl, **verifye pa render aplikasyon an vre** (pa sèlman lekti kòd) : `d919070 fix(responsive): Phase 6 — 2 real bugs caught by actually rendering the app`, `f91e3fb`, `e374116`, `29e42eb feat(restaurant): responsive default for orders Kanban/List (P11, F-03)`, `f153cf8 fix(notifications): responsive/a11y/Design-System remediation (P12)`. **Pa gen nouvo pwoblèm jwenn nan yon lekti kòd sipèfisyèl** — yon re-verifikasyon reyèl (render aplikasyon an sou plizyè gwosè ekran) ta mande zouti ki pa disponib nan sesyon sa a (pa gen navigatè pilotab).

---

## 6. Fuite done nan bundle

**Deja fèt an detay, NKD-008** (`docs/NKD-008_FRONTEND_SECRET_EXPOSURE_AUDIT.md`) — 0 finding, KONFIME. **Pa reprodwi.**

---

## 7. Service worker (`src/sw.ts`)

**KONFIME**, lekti konplè fichye a (141 liy) :
- Precache + `cleanupOutdatedCaches()` — pa gen vye cache ki rete abandone.
- `NetworkFirst` (nav, 5s) / `CacheFirst` (asset) — chwa apwopriye pou chak tip resous.
- `offline.html` fallback — konfime egziste, plain HTML san depandans bundle JS (rezistan si bundle a li menm pa chaje).
- `SKIP_WAITING` bridge — pèmèt yon nouvo vèsyon SW pran kontwòl san atann tout onglè fèmen (bon pratik pou deplwaman rapid).
- Push handler : verifye si paj sib la deja "focused" anvan afiche yon notifikasyon (evite doub-notifye yon moun k ap gade paj la deja) — deja li pandan travay NKD-006/010 pi bonè.
- `notificationclick` : `focus()` + `navigate()` sou yon onglè egzistan, oswa `openWindow()` si okenn — konpòtman estanda kòrèk.

**Pa gen nouvo pwoblèm jwenn nan `sw.ts` li menm.**

---

## 8. Rezime KONFIME / ESTIMASYON / PA VERIFYE

**KONFIME** :
- `sw.ts` byen konstwi, `offline.html` egziste, precache/cleanup kòrèk.
- 0 fuite done nan bundle (NKD-008, site).
- Responsive deja korije plizyè fwa, verifye pa render reyèl (istwa git, site).
- `catch (e) { toast.error(e.message) }` se patwon dominan — pa gen echèk silansye.

**ESTIMASYON** : okenn nouvo.

**PA VERIFYE** :
- Konpòtman responsive **reyèl** sou yon vre navigatè (mande zouti ki pa disponib isit la — chèk istorik sifi pou kounye a).
- Konsomasyon done pa mezire ankò (site Faz 8/"Phase 8" olye re-mezire).

---

## 9. Kwazman ak backlog egzistan

- NKD-002, NKD-003 Pati B : site, pa touche.
- **NKD-009 fòmalize** (VAPID de kopi, P3) — pa korije, dokimante.
- Gap deteksyon offline (§2) ak diferansyasyon erè rezo/metye (§4) : pa gen nouvo ID NKD (se UX/reliability, pa sekirite) — site pou Faz 10/11 si mèt pwojè a vle adrese yo.

---

Kanpe la. Ap tann `KONTINYE` pou Faz 7.
