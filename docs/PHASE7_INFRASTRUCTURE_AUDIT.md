# FAZ 7 — INFRASTRUCTURE

**Dat** : 2026-08-14
**Metòd** : lekti kòd/config sous. Règ Seksyon A `docs/PROTOKOL_FAZ3_A_FAZ11.md` aplike (A1-A9).

---

## 0. Anti-doublon (Règ A3)

Kouvèti egzistan konsiderab jwenn — site, pa rebati :
- **TLS/Cloudflare/headers/DNS** : `docs/SECURITY_PERIMETER_AUDIT_2026-08-13.md` — rekonesans **reyèl** (`nslookup`, `openssl s_client`, apèl HTTP reyèl kont `www.nkdeliveri.com`) deja fèt, chak konstatasyon make VERIFIED/PARTIALLY VERIFIED/NOT VERIFIED, pa sipoze.
- **Branch protection / CI/CD** : `docs/DEVOPS.md` deja dokimante an detay, ak yon konklizyon eksplisit deja la.
- **Backup/restore, konfig anviwònman** : `docs/BACKUP_RESTORE.md`, `docs/ENVIRONMENTS.md` egziste.

---

## 1. `.github/workflows/ci.yml` — li konplè (Faz 0 : `PA JWENN`, kounye a li)

**KONFIME** : 4 job — `quality` (lint/format/typecheck/`check:migrations`/build), `migrations-db` (stack Supabase lokal konplè + regresyon sekirite C-01), `e2e-functional`, `e2e-cross-cutting`. Byen konstwi, deklanche sou PR **ak** push sou `main`.

### **Konstatasyon prensipal, deja dokimante men merite mete devan** (`docs/DEVOPS.md:19-24, 28-29`)

**Ci.yml pa deplwaye anyen.** Vercel deplwaye **endepandaman** chak push sou `main` (pwodiksyon dirèk) via entegrasyon GitHub natif li — **pa gen okenn koneksyon ant rezilta CI a ak deplwaman an**. Vercel "kouri" an paralèl ak CI, pa apre li.

**Pi enpòtan** : `docs/DEVOPS.md:28` deklare eksplisitteman — **"Non appliquées automatiquement par ce dépôt"** — règ pwoteksyon branch (`main`) yo (egzije PR, egzije CI pase, entèdi push dirèk) **rekòmande men jamè aplike reyèlman**. Kòmand `gh api ... branches/main/protection` la ekri men **pa janm egzekite**.

**Konsekans konkrè, konfime pa pwòp konpòtman sesyon sa a** : chak fichye nan seri Faz 0-7 sa a te commit **epi push dirèkteman sou `main`** (san PR, san atann CI) — sa demontre **anpirikman** ke `main` pa gen okenn pwoteksyon aktif jodi a. Yon push dirèk sou `main`, menm si li ta kraze build la nèt, ta deplwaye sou pwodiksyon **san CI janm gen chans bloke l**.

**Nivo** : sa a se yon **risk pwosesis konfime, deja dokimante ak yon fiks ekri** (kòmand `gh api` nan `DEVOPS.md`) — pa yon nouvo finding NKD, se yon dosye ki merite re-parèt paske Faz 7 mande l eksplisitteman. **Aksyon** se yon desizyon mèt pwojè a (Règ A5 — aplike règ branch protection yo mande yon aksè admin GitHub, yon aksyon deliberateman pa fèt otomatikman pa okenn ajan).

---

## 2. Liy ensidan CLI

**Deja nan backlog** (`docs/INCIDENT_2026-08-14_CLI_CREDENTIAL.md` §"Nòt pou Faz 7") — entèdi CLI Supabase pandan sesyon odit sekirite, deja aplike kòm Règ A1 nan `docs/PROTOKOL_FAZ3_A_FAZ11.md`. **Konfime toujou aplike** — okenn kòmand CLI DB dirèk egzekite pandan tout Faz 3-7.

---

## 3. NKD-007 Q1/Q2 — rete `PA VERIFYE`

**Q3 deja reponn** (Faz 2 finalizasyon) : **NON**, pa gen `service_role` key nan 3 kòmi yo.

**Q1/Q2 mande** swa (a) verifikasyon manyèl ou nan Dashboard Supabase (chèche referans pwojè istorik ki soti nan `.env` kòmi 2026-07-02/03, valè li pa dwe parèt nan rapò a) pou konfime si pwojè a toujou aktif, swa (b) yon apèl Management API `GET /v1/projects` (lekti sèlman) ki mande otorizasyon eksplisit (Règ A1). **Pa fèt nan pas sa a** — pa bloke Faz 7, men rete yon liy ouvè.

---

## 4. `.env` nan `.gitignore` + pre-commit hook

**KONFIME** : `.gitignore:24-25` gen `.env` **ak** `.env.*` (2 liy separe — kouvri `.env.local`, `.env.production`, elatriye, pa sèlman `.env` egzat).

**KONFIME, gap** : **okenn framework pre-commit hook enstale** (`.husky/` pa egziste, `package.json` pa gen `prepare`/`husky`/`lint-staged`). Sa vle di pwoteksyon kont commit aksidantèl yon vrè `.env` **repoze antyèman sou `.gitignore`** — ki deja demontre li ka echwe (istwa git te gen yon vrè `.env` komite 3 fwa byen bonè, Faz 2 NKD-007, anvan `.gitignore` te ranfòse). `.gitignore` sèlman anpeche Git **swiv** yon fichye, li pa anpeche yon moun fè `git add -f .env` deliberateman oswa aksidantèlman.

**Nivo** : P3 — risk pwosesis, pa yon vilnerabilite aktyèl (istwa a deja netwaye, `.env` pa nan HEAD). **Pa gen nouvo ID NKD** — se yon rekòmandasyon operasyonèl (egzanp : `gitleaks`/`detect-secrets` kòm yon step CI adisyonèl, oswa yon hook `pre-commit` lokal), site pou Faz 11 si mèt pwojè a vle l.

---

## 5. Deplwaman otomatik Vercel

**Reponn nèt** : **WI**, push sou `main` deplwaye dirèk sou pwodiksyon, san CI kòm baryè (§1). Sa gen konsekans DIRÈK sou tout seri koreksyon sa a — chak `git push origin main` mwen fè pandan Faz 0-7 te (an teyori) kapab imedyatman vizib sou `www.nkdeliveri.com` menm si `npm run verify` te echwe apre push la (li pa t janm echwe, men mekanis lan pa t la pou anpeche l si li te rive).

---

## 6. TLS / Cloudflare / Headers / DNS

**Site antyèman**, `docs/SECURITY_PERIMETER_AUDIT_2026-08-13.md` — HSTS, CSP strikt ak nonce pa rekèt, `X-Frame-Options: DENY`, `Permissions-Policy` restrictif, `Cross-Origin-Opener-Policy` — tout **VERIFIED** an dirèk sou pwodiksyon. **Pa reprodwi.**

---

## 7. Monitoring

**KONFIME (deja li plizyè fwa pandan sesyon sa a)** : Sentry (`sentry.server.ts`/`sentry-browser.ts`), 2 pwojè separe (kliyan/sèvè), no-op total si DSN absan, tag release/anviwònman otomatik pa Vercel (`VERCEL_GIT_COMMIT_SHA`). **PA VERIFYE** : konfigirasyon alèt reyèl (seuil, kanal notifikasyon) — sa se paramèt Dashboard Sentry, pa nan repo a.

---

## 8. Plan restorasyon

**Egziste** : `docs/BACKUP_RESTORE.md`. **Pa li an detay nan pas sa a** (deyò tan disponib) — konfime prezans li sèlman, pa kontni li.

---

## 9. Pa gen Docker

**Konfime, konsistan ak rès sesyon an** : `ci.yml`'s `migrations-db` job itilize Supabase CLI (`supabase start`, ki BOOT Docker anndan li menm nan CI, pa lokalman nan sesyon sa a) — **pa gen anviwònman lokal reprodwi disponib nan sesyon sa a menm jan an**, konfime konvansyon deja etabli tout Faz 3-11.

---

## 10. Rezime KONFIME / ESTIMASYON / PA VERIFYE

**KONFIME** :
- `ci.yml` li konplè, byen konstwi, 4 job.
- Branch protection **pa aplike** (dokimante deja, konfime anpirikman pa konpòtman sesyon sa a).
- `.env`/`.env.*` byen nan `.gitignore`, men **pa gen pre-commit hook**.
- Vercel deplwaye chak push san CI kòm baryè.
- TLS/Cloudflare/headers deja VERIFIED (site).
- Monitoring Sentry konfime.
- `docs/BACKUP_RESTORE.md` egziste.

**ESTIMASYON** : okenn nouvo.

**PA VERIFYE** :
- NKD-007 Q1/Q2 (estati pwojè istorik la).
- Konfigirasyon alèt Sentry reyèl.
- Kontni detaye `BACKUP_RESTORE.md` (prezans konfime sèlman).

---

## 11. Kwazman ak backlog egzistan

Pa gen nouvo ID NKD kreye. **De bagay site pou atansyon mèt pwojè a** (pa vilnerabilite, desizyon pwosesis) :
1. Aplike branch protection `main` (kòmand deja ekri, `DEVOPS.md`).
2. Ajoute yon pre-commit hook/scanner sekrè (§4).

---

Kanpe la. Ap tann `KONTINYE` pou Faz 8.
