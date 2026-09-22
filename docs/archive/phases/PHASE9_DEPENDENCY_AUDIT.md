# Faz 9 — Dependency Audit

**Dat** : 2026-08-18
**Pòte** : Odit sèlman — **okenn pake pa mete ajou nan sesyon sa a** (Règ A4, Faz 11 poko fèt).
**Anti-doublon (A3)** : `docs/DEPENDENCIES.md` (2026-07-15, Faz 6) deja kouvri anpil menm teren an — sitasyon, pa repetisyon, pou tout sa ki toujou vre.

---

## 1. Findings

| ID      | Nivo   | Konstatasyon                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Prèv                                                                                                                                                                                     |
| ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NKD-018 | **P2** | 2 depandans pwodiksyon reyèl gen lisans ki poze kesyon pou yon pwodwi komèsyal : `react-leaflet`/`@react-leaflet/core` (Hippocratic-2.1, restriksyon "itilizasyon etik"), `@block65/custom-error` (transitif nan `@block65/webcrypto-web-push`, `UNLICENSED` — `LICENSE.md` di eksplisitman "not permitted to reproduce/copy/distribute"). Toude sèvi nan chemen pwodiksyon reyèl (kat/GPS livrè, push notification sèvè). Desizyon biznis/legal, pa yon fiks teknik — **A5 aplike** | `npx license-checker --summary` (Hippocratic-2.1 ×2, UNKNOWN ×1) + `node_modules/@block65/custom-error/LICENSE.md` li dirèkteman                                                         |
| NKD-019 | P3     | `src/sw.ts` (`:3-6`) enpòte `workbox-precaching`/`workbox-routing`/`workbox-strategies`/`workbox-expiration` dirèkteman, men okenn nan yo pa deklare kòm depandans dirèk nan `package.json` — yo mache jodi a sèlman paske `vite-plugin-pwa` → `workbox-build` bay yo transitivman. Si `vite-plugin-pwa` chanje pwòp depandans entèn li yon jou, `src/sw.ts` ka kase san `npm` pa janm siyale l kòm yon bagay ki afekte depandans dirèk pwojè a                                      | `npx depcheck` ("Missing dependencies") + `npm ls workbox-precaching workbox-routing workbox-strategies workbox-expiration` (montre `vite-plugin-pwa@1.3.0 → workbox-build@7.4.1 → ...`) |

**Okenn P1.** `npm audit` : 0 vilnerabilite (tout nivo — info/low/moderate/high/critical), 1049 pake total (294 prod, 629 dev, 181 optional, 75 peer).

---

## 2. KONFIME pwòp

- **0 vilnerabilite konni** : `npm audit --json` → `"total": 0` sou tout kategori. `npm audit` (tèks) konfime : `found 0 vulnerabilities`.
- **`pg` konplètman absan** (item 6 pwomt la) : pa nan `package.json`, pa nan `package-lock.json`, pa nan `node_modules`, `git diff HEAD -- package.json package-lock.json` vid. Eta a **pwòp kounye a**, kèlkeswa pwovnans lentsidan an (§4 — pa jwenn okenn tras ekri kòrespondan).
- **`package-lock.json` komite** : `git ls-files package-lock.json` konfime li swiv.
- **Pa gen sous ki pa npm** : `grep` sou `git+`/`github:`/`http` nan `package.json` — 0 rezilta, tout depandans soti nan rejis npm.
- **0 `postinstall`/`preinstall`/`install` script** nan 59 depandans dirèk yo (33 prod + 26 dev) — verifye pa yon script Node ki li `package.json` chak youn.
- **`@fontsource/bricolage-grotesque`, `@fontsource/instrument-sans`, `tailwindcss`, `tw-animate-css`** — `depcheck` make yo "unused", **fo pozitif konfime manyèlman** (`src/styles.css:1-10`, chaje pa `@import` CSS, pa yon `import` JS/TS — egzakteman kategori A2/pwomt la te avèti sou li).
- **`supabase` (devDependency, CLI)** — `depcheck` make l "unused" tou, **fo pozitif** : se yon zouti CLI itilize manyèlman/entèaktivman (`npx supabase ...`), pa yon pake ki chaje pa yon `import` — depcheck pa ka wè itilizasyon konsa.
- **0 pake abandone/estal** : echantiyon verifye (`sonner`, `zod`, `lucide-react`, `recharts`, `@vitejs/plugin-react`, `@lovable.dev/vite-tanstack-config`) tout gen yon piblikasyon **nan dènye jou/semèn yo** (`npm view <pkg> time.modified`) — pa gen okenn ki depase 18 mwa.
- **9 mizajou major "deja konnen, deja diferе" (`docs/DEPENDENCIES.md`, 2026-07-15) toujou vre jodi a, chif yo jis avanse** : `zod` 3→4, `lucide-react` 0.575→1.x, `eslint` 9→10, `eslint-plugin-react-hooks` 5→7, `typescript` 5.9→7.0, `@vitejs/plugin-react` 5→6, `globals` 15→17, `@lovable.dev/vite-tanstack-config` 2.7→2.15, `@types/node` 22→26 (**volontèman pa swiv** — `.nvmrc` fikse Node 22 pou egzekisyon, mizajou tip yo ta dezenkronize ak runtime reyèl la). **Pa yon nouvo finding — site, pa re-deklare.**

---

## 3. ESTIMASYON deklare

- **`framer-motion` 12.42.2 → 13.1.0 (major)** — pa t nan tab "major disponib" `docs/DEPENDENCIES.md` la (swa ajoute apre 15 jiyè, swa te ankò sou menm major lè sa a). Pa gen ase kontèks pou konfime kilès — mache kòm yon **nouvo** finding kandida, men mande yon dezyèm verifikasyon (`git log -p -- package.json | grep framer-motion` pou dat entwodiksyon) anvan l ka klase definitivman kòm "nouvo depi jiyè" vs "te la deja, pa t site". Pa gen risk operasyonèl imedya idantifye (anime UI sèlman, pa yon chemen kritik) — **pa mande yon nouvo NKD ID pou kounye a**, jis site kòm yon 10yèm liy pou ajoute nan `docs/DEPENDENCIES.md` yon pwochen fwa dokiman sa a mizajou.
- **Echantiyon "sèl mentnè" a (6 pake)** pa yon envantè konplè 59 depandans dirèk yo — reprezantatif dapre demand pwomt la ("pa liste tout"), pa yon garanti okenn lòt pake pa gen menm pwofil.

---

## 4. PA VERIFYE

- **Reklamasyon pwomt la** : "Faz 8 te note `npm ci` te repare `node_modules` apre yon tantativ `npm install pg`." Rechèch egzosstiv fèt (A3) : `grep` sou 3 fichye Faz 8 yo (`PHASE8_PERFORMANCE_AUDIT.md`, `PHASE8_PERFORMANCE_PWA_AUDIT.md`, `PHASE8_PERFORMANCE_PWA_REPORT.md`) pou `\bpg\b` → **0 rezilta**. `git log --all --grep="pg"` (mesaj commit) → 0 rezilta. `git log -- package-lock.json` → pa gen okenn commit ki mansyone `pg` swa nan mesaj li. Sèl kote `npm install pg` parèt nan tout depo a se `PROTOKOL_FAZ3_A_FAZ11.md` Règ A1 — kòm yon **egzanp kòmand entèdi**, pa yon istwa ensidan ak yon "repare" naratif. **Mwen pa ka konfime orijin/pwovnans reklamasyon sa a nan achiv ekri pwojè a** — eta aktyèl la (§2, `pg` konplètman absan) rete konfime endepandamman de sa, men si detay "Faz 8" a enpòtan pou dosye w, li ta bon pou verifye ak pwòp nòt ou (posib li te yon echanj vèbal ki pa t janm ekri, oswa yon faz ki pa gen non "Faz 8" nan achiv la).
- **`framer-motion`** — dat entwodiksyon egzat nan pwojè a (§3).
- **Odit dat piblikasyon konplè sou tout 59 depandans dirèk yo** — sèlman yon echantiyon 6 pake verifye (§2). Rès la **ESTIMASYON pa absans dwapo `npm outdated`** (ki li menm baze sou vèsyon disponib, pa dat), pa yon KONFIME endividyèl pou chak pake.

---

## 5. Kwazman ak backlog ki egziste deja

- `docs/DEPENDENCIES.md` (2026-07-15) — sous prensipal pou tout mizajou major yo, deja site pi wo. **Pa re-ouvri, pa re-fè travay la.**
- `docs/PHASE8_PERFORMANCE_PWA_AUDIT.md` — deja kouvri gwosè bundle/precache (site dapre enstriksyon pwomt la, pa re-analize).
- Okenn lòt dosye `docs/` pa mansyone `dependency`/`depcheck`/`license.check`/`workbox` anvan jodi a (`grep -rli` konfime) — NKD-018/019 se vrèman nouvo, pa yon doublon.
- Pa gen kwazman ak NKD-001/002/003B/004/009/017 (deferе eksplisitman deyò pòte sa a).

---

## 6. Plan remèd

**Okenn P1 — pa gen plan remèd ijan nesesè.**

Pou NKD-018 (lisans) ak NKD-019 (workbox undeclared) — **pa aplike anyen nan sesyon sa a** (A4, se yon odit). Rekòmandasyon pou yon pwochen faz/tikè apa :

- NKD-018 : mande yon revizyon legal/biznis (Règ A5) sou si Hippocratic-2.1 (`react-leaflet`) ak yon depandans `UNLICENSED` (`@block65/custom-error`, transitif) akseptab pou NK Deliveri kòm pwodwi komèsyal — pa yon desizyon teknik.
- NKD-019 : ajoute `workbox-precaching`, `workbox-routing`, `workbox-strategies`, `workbox-expiration` kòm depandans dirèk (`dependencies`, paske `src/sw.ts` egzekite an pwodiksyon) nan `package.json`, ak vèsyon ki matche sa `vite-plugin-pwa@1.3.0` bay jodi a (`7.4.1`) — chanjman `package.json`/`package-lock.json`, rezève pou Faz 11 oswa yon tikè dedye apre.

---

## Rezime chif (A2 — chak youn ak kòmand ki pwodui l)

| Chif                                                            | Valè                                            | Kòmand                                            |
| --------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| Vilnerabilite konni                                             | 0                                               | `npm audit --json`                                |
| Depandans total                                                 | 1049 (294 prod, 629 dev, 181 optional, 75 peer) | `npm audit --json` (`.metadata.dependencies`)     |
| Depandans dirèk                                                 | 59 (33 prod + 26 dev)                           | `node -e` sou `package.json`                      |
| Pake ki gen yon major dèyè (deja konnen)                        | 9                                               | `npm outdated` + `docs/DEPENDENCIES.md`           |
| Pake initil (reyèl)                                             | 0                                               | `npx depcheck` + verifikasyon manyèl chak rezilta |
| Lisans GPL/AGPL/SSPL                                            | 0                                               | `npx license-checker --summary`                   |
| Lisans ki poze kesyon (Hippocratic/UNLICENSED)                  | 3 pake (2 pwojè + 1 transitif)                  | `npx license-checker --json`, filtre              |
| Script `install`/`postinstall`/`preinstall` nan depandans dirèk | 0                                               | script Node dedye                                 |
