# NKD — FAZ 2 : SECURITY AUDIT

**Dat** : 2026-08-14
**Metòd** : `grep`/lekti dirèk kòd + migrasyon + istwa git (`git log -S`, pickaxe, egzoustif pa konstriksyon). Okenn kòd pa modifye pandan Faz 2. Chak chif deklare ak patwon egzak li, make **KONFIME** (egzoustif/verifye plizyè fason) oswa **ESTIMASYON** (yon sèl patwon/metòd, ka gen manke).

---

## 1. Sekrè kode an dur

### Kòd aktyèl (HEAD)

**KONFIME, pwòp.** `grep -rnE "(sk_live_|sk_test_|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC )?PRIVATE KEY-----)" src/ supabase/` → 0 rezilta. `grep -rnE "(api[_-]?key|secret|password|token)\s*[:=]\s*[\"'][A-Za-z0-9+/_=-]{16,}[\"']"` (eskli `__tests__`/`mock`/`example`) → 0 rezilta.

### Istwa git — **NKD-007**

**Konstatasyon** : 3 commit byen bonè (`6e920ab`, `d093030`, `f3ed3b6` — 2026-07-02/03/04, jis apre gabarit orijinal la) te genyen yon vrè fichye `.env` (pa `.env.example`) komite. Verifye pa **patwon `pathspec`** (`git log --all --oneline -- ".env" ".env.local" ".env.*.local"`), pa yon grep tèks — sa **KONFIME**, pa ESTIMASYON, paske Git swiv fichye pa non egzat, pa yon regex ki ka rate yon varyasyon.

**Kontni** (non varyab sèlman verifye, **okenn valè pa gen dwa parèt nan rapò sa a**) :

- `SUPABASE_PROJECT_ID`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL` (+ varyant `VITE_*`) — **pwojè Supabase diferan de pwodiksyon aktyèl la** (référence pwojè istorik la kòmanse pa lèt diferan de `dcsnmvbtsmdbwrwbutph`, référence pwodiksyon aktyèl la, verifye plizyè fwa nan sesyon jodi a). Tout kle sa yo se kategori "publishable/anon" — dokimante eksplisitman kòm "safe to expose" nan `.env.example:17-19` aktyèl la, pa yon `SERVICE_ROLE_KEY`.
- `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`, `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID` — **DEJA ENVESTIGE AK REZOUD**, `docs/F01_GOOGLE_MAPS_KEY_REMEDIATION_REPORT.md` (2026-08-11) : kle a reinisyalize/revoke pa operatè a nan Google Cloud Console, rapòte dirèkteman. **Pa yon nouvo finding — site sèlman.**

`f3ed3b6` retire fichye `.env` la (`8 -` liy, siprime) — konfime pa gen `.env` (san `.example`) ki swiv nan HEAD (`git ls-files | grep -E "^\.env"` → `.env.e2e`, `.env.example` sèlman).

**Rechèch egzoustif pou lòt kategori sekrè, tout istwa (`git log --all -S"<patwon>"`, pickaxe — KONFIME, egzoustif pa konstriksyon, pa yon echantiyon)** :

| Patwon                                                          | Rezilta                            |
| --------------------------------------------------------------- | ---------------------------------- |
| `sk_live_` (Stripe live)                                        | 0 commit                           |
| `SUPABASE_SERVICE_ROLE_KEY=` (valè reyèl, pa `.example`/`docs`) | 1 commit (`19e7480`) — **fo done** |
| `VAPID_PRIVATE_JWK={` (valè reyèl)                              | 1 commit (`19e7480`) — **fo done** |
| `RESEND_API_KEY=re_` (fòma reyèl)                               | 0 commit                           |
| `CRON_SECRET=` (valè reyèl, pa `.example`/`docs`)               | 1 commit (`19e7480`) — **fo done** |

`19e7480` = `.env.e2e`, kòmante eksplisitman nan HEAD kòm "never contains a real secret, every value here is a fixed local placeholder" — **verifye**, tout valè kòmanse pa `e2e-fake-*` oswa pwente sou `http://127.0.0.1` (sèvè mock lokal).

**Nivo** : **P3 (dèt/pwosesis)**. Okenn kle valid pou sistèm pwodiksyon aktyèl la jwenn ekspoze. Rekòmandasyon opsyonèl (menm postur ak F-01 §11) : `git filter-repo`/BFG pou retire 2 ansyen kòmi ki gen ansyen referans pwojè Supabase istorik la — pa iminan.

**Nòt metòd** : yon tantativ redaction (`sed`) te fè yon erè teknik pandan envestigasyon sa a e te montre pou yon kout je yon fragman valè istorik nan sòti zouti a anvan li te korije imedyatman ak yon dezyèm metòd san risk. Okenn valè konplè pa janm parèt, ni la ni okenn lòt kote nan rapò sa a — deklare pou transparans, pa kache.

---

## 2. `RAISE EXCEPTION` — klasifikasyon A/B/C/D

**Chif debaz** : `grep -rn "RAISE EXCEPTION" supabase/migrations/` → 649 okirans, 157 mesaj **distenk** (`grep -rhoE "RAISE EXCEPTION '[^']*'" ... | sort -u`).

### Kategori B (angle/teknik) — **NKD-004**

**ESTIMASYON, pa KONFIME** : premye pas ak mo-kle angle (`the|is|not|must|cannot|invalid|already|error|failed|required|found|does|only|...`) jwenn **65/157**. Verifikasyon manyèl sou bò "Kreyòl" la jwenn **3 lòt** ki chape premye patwon an (`'Forbidden'`, `'Specify exactly one beneficiary'`, `'Unknown payment provider: %'`) — **prèv dirèk premye chif la te yon ESTIMASYON, konsistan ak leson 67→73 la**. Plancher reyèl konfime : **≥68/157 (≥43%)**. Lis konplè 65 premye yo nan `/tmp` pandan sesyon an, egzanp reprezantatif : `'Category not found'`, `'Dish name is required'`, `'Order not found'`, `'Only an admin can reassign a delivery'`, `'Employee not found'`, `'Restaurant not found'`, `'Promotion title is required'`.

**Enpak** : menm klas pwoblèm ak F-02 (`claim_delivery_secure`, deja korije), men **san rapò ak yon sèl fonksyon** — li kouvri jesyon pwodui/kategori/pwomosyon (restoran), anplwaye, ranbousman, litij, peman, payout. Chemen reyèl bay itilizatè a pase pa 73 sit NKD-003 (`toast.error(e.message)`). **Pwen enpòtan** : Pati A NKD-003 (`translateSupabaseError`) fè kòd `P0001` (RAISE EXCEPTION koutim) **pase san touche, delibereman** — donk yon fwa Pati B migre yon sit, mesaj angle sa yo ap **toujou parèt an angle**, jis pa gen plis risk fuit estrikti DB. NKD-004 (lang) ak NKD-003 (sekirite) se **2 pwoblèm distenk ki mande 2 koreksyon separe**, menm si yo touche menm mesaj yo.

**Chif final (finalizasyon Faz 2, 2026-08-14)** : lekti konplè, alamen, tout 157 mesaj yo (pa yon patwon mo-kle) konfime **67/157 (42.7%)**, pa ≥68 — diferans lan se yon match fo prensipal chif 65 la te fè sou `'...append-only — %...'` (Kategori C, li menm) paske `only` parèt kòm yon mo apa nan `append-only`. Detay konplè + 4 mesaj ki DEJA rezoud pa fiks F-02 la (fichye istorik sèlman, fonksyon k ap viv la pa gen yo ankò) + 63 mesaj ki rete ouvè, chak ak fichye:liy : `docs/NKD-004_RAISE_MESSAGES_BACKLOG.md`.

**Nivo** : **P3 (UX)**, dapre tablo klasifikasyon konsiy la bay pou Kategori B.

### Kategori C (fuit estrikti DB) — **NKD-005**

**1 ka jwenn, KONFIME ak kontèks konplè** :

```
supabase/migrations/20260730130000_moncash_financial_audit_log.sql:65:
  RAISE EXCEPTION 'Jounal odit sa a se append-only — % pa pèmèt sou %.%',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = '42501';
```

Trigger `private.prevent_log_mutation()` sou tab `moncash_api_logs` (append-only pa konsepsyon). `%.%` la enjekte `TG_TABLE_SCHEMA.TG_TABLE_NAME` (egzanp : `public.moncash_api_logs`) dirèkteman nan mesaj la — teknikman yon fuit non tab.

**Reyaksesibilite (nuans enpòtan)** : tab la gen `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT SELECT` sèlman bay `authenticated` — okenn wòl òdinè pa gen dwa `UPDATE`/`DELETE` menm pou deklanche trigger la an premye lye (migrasyon konfime sa eksplisitman nan pwòp kòmantè li). Sèl `service_role` ta ka menase l, e sèlman si yon bug/aksyon admin ta eseye. **Pa yon chemen aksesib pou yon itilizatè òdinè jodi a.**

**Sinèji ak NKD-003** : mesaj sa a itilize `ERRCODE = '42501'` (pa `P0001`) — sa vle di **`translateSupabaseError` (Pati A NKD-003) deja jenerize l otomatikman** si yon sit ta janm rele l epi migre nan Pati B (mape sou "Ou pa gen otorizasyon pou fè aksyon sa a.", pa mesaj brit la).

**Nivo** : ~~P1 dapre tablo klasifikasyon konsiy la (Kategori C = P1 fiks)~~ → **REKLASE P3 — mitigated by design** (finalizasyon Faz 2, 2026-08-14, §2 NKD-005). Rezon reklasman an (2, tou de KONFIME, pa sipoze) :

1. Mesaj la itilize `ERRCODE = '42501'` (pa `P0001` koutim) — `translateSupabaseError` (Pati A NKD-003, deja aplike) jenerize l otomatikman bay "Ou pa gen otorizasyon pou fè aksyon sa a." si yon sit ta janm rele l apre yon migrasyon Pati B — mesaj brit ki fè fuit non tab la pa ka rive bay yon itilizatè menm si chemen an te vin aksesib.
2. `REVOKE ALL ... FROM PUBLIC, anon, authenticated` sou `moncash_api_logs` fè trigger la **pa gen okenn chemen aksesib** pou yon wòl òdinè — sèl `service_role` ta ka menase l.

**Kondisyon retou a P1** (dwe verifye kont pa efase liy sa a) : si yon fiti faz (Faz 5 oswa pita) jwenn/kreye yon RPC `SECURITY DEFINER` ki ekspoze yon chemen `UPDATE`/`DELETE`/`TRUNCATE` sou `moncash_api_logs` (oswa nenpòt lòt tab `prevent_log_mutation()` pwoteje) bay yon wòl ki pa `service_role`, finding sa a **retounen P1 imedyatman** — reklasman sa a valab sèlman pandan reyaksesibilite a rete jan li ye kounye a.

### Kategori D (enumerasyon) — pa jwenn okenn ka konkrè

Kandida ki pi pre : `'Illegal delivery status transition: % -> %'` / `'Illegal status transition: % -> %'` — revele eta aktyèl/vize resous la. **Verifye** : RLS deja filtre aksè a liy lan **anvan** trigger la deklanche (yon itilizatè pa ka menm eseye `UPDATE` yon `delivery`/`order` ki pa pou li — RLS bloke l anvan). Donk pa gen senaryo konkrè kote mesaj sa a revele egzistans yon resous yon wòl pa gen dwa wè. **PA JWENN yon ka Kategori D eksplwatab nan pas sa a** — deklare kòm sa ye, pa envante yon finding.

---

## 3. Injection (SQL/NoSQL/command/XSS/SSRF)

| Kategori                                               | Rezilta                                                                                                                                                                                                                                                                                              | Konfyans                                      |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| SQL dinamik (`EXECUTE`)                                | 7 okirans total nan 137 migrasyon (`grep -rn "^\s*EXECUTE " supabase/migrations/`). 4 se `EXECUTE FUNCTION` (deklarasyon trigger, pa SQL dinamik). 3 se `EXECUTE '<string literal fiks>'` (`ALTER PUBLICATION supabase_realtime ADD TABLE public.<tab>`) — **zewo konkatenasyon ak done itilizatè**. | **KONFIME** — 7/7 li manyèlman, pa echantiyon |
| XSS (`dangerouslySetInnerHTML`, `.innerHTML =`)        | 0 okirans nan tout `src/`                                                                                                                                                                                                                                                                            | **KONFIME** — grep egzoustif                  |
| Command injection (`child_process`, `exec(`, `spawn(`) | 0 okirans nan `src/`/`scripts/`                                                                                                                                                                                                                                                                      | **KONFIME** — grep egzoustif                  |
| NoSQL injection                                        | Pa aplikab — Postgres sèlman, pa gen MongoDB/lòt NoSQL nan pwojè a (`package.json` konfime)                                                                                                                                                                                                          | **KONFIME** (absans depandans)                |

---

## 4. SSRF — **NKD-006**

**Konstatasyon, KONFIME ak chemen konplè trase** :

1. `src/lib/push.ts:56-78` — flux abònman push: `endpoint = sub.endpoint` (soti nan `PushSubscription` navigatè a), sèl validasyon se `if (!endpoint...) return {ok:false,...}` (pa vid). Ekri via `.from("push_subscriptions").upsert(...)`.
2. `supabase/migrations/20260703071050_b45e82fb-88ee-4630-906c-a54ff8cce6c4.sql:4,17-22` — `endpoint TEXT NOT NULL UNIQUE`, **okenn `CHECK`** sou fòma/host. Policy RLS : `WITH CHECK (auth.uid() = user_id)` — verifye sèlman **pwopriyetè**, jamè **valè** `endpoint` la.
3. `src/lib/push-dispatch.server.ts:102` — `await fetch(s.endpoint, built as unknown as RequestInit)` — **rekèt sèvè dirèk sou URL ki soti nan DB, san allowlist host**.

**Senaryo eksplwatasyon** : nenpòt itilizatè `authenticated` (kliyan, san bezwen wòl espesyal) ka ekri dirèkteman via PostgREST (`supabase.from("push_subscriptions").upsert({user_id, endpoint: "<URL vize a>", p256dh:"x", auth:"y"})`), kontounen API `PushManager` navigatè a nèt (ki ta jenere yon URL lejitim sèlman). Pwochen fwa yon evènman biznis nòmal deklanche yon push pou kont sa a (chanjman estati kòmand, mesaj chat, elatriye — atakè a pa bezwen fè lòt aksyon apre premye ekri a), sèvè a ap fè yon rekèt HTTP sòti bay URL atakè a te chwazi a.

**Enpak** : sonde rezo entèn (limite pa anviwònman Vercel serverless, mwens rich pase yon VPC tradisyonèl men pa zewo), oswa itilize sèvè NK Deliveri a kòm yon relè pou atake yon twazyèm pati (abi IP egzòd konfyans lan). Pa yon vektè fuit done lòt itilizatè (chak moun sèlman ka manipile pwòp `endpoint` yo).

**Nivo** : **P1 — vilnerabilite eksplwatab, 7 jou.**

---

## 5. Validasyon/sanitizasyon done itilizatè

`zod` prezan nan **18 fichye** (`grep -rl "from \"zod\"" src/`), konsantre nan fonksyon sèvè TanStack Start (`*.functions.ts`) + 2 fichye wout (`auth.index.tsx`, `restaurants.index.tsx`). **ESTIMASYON, pa yon kat konplè** : pa gen konparezon fèt ak total sifas mutasyon (117 RPC + N fonksyon sèvè) pou konnen pousantaj kouvèti reyèl la. Pa yon "pa gen validasyon ditou" — se yon konstatasyon pasyèl ki merite yon pas dedye si presizyon nesesè.

---

## 6. CORS / Headers / Rate limiting / Brute-force

**Deja odite an detay** nan `docs/SECURITY_PERIMETER_AUDIT_2026-08-13.md` (§7-11, §16) — pa re-fè isit pou evite doub-travay eksplisitman siyale nan Faz 0. Rezime site : CSP strikt ak nonce dinamik VERIFIYE, rate limiting aplikatif VERIFIYE sou login/reset/upload, gap CF-04 (`/api/csp-report` san rate limit) deja idantifye, CF-01 (origin bypass Vercel) toujou `NOT REMEDIATED` — pa reklase isit, wè dokiman orijinal la.

---

## 7. Upload fichye

**Deja odite** nan `docs/SECURITY_PERIMETER_AUDIT_2026-08-13.md` §6 (bucket public/privé, `file_size_limit`/`allowed_mime_types` nan `20260713120000_secure_storage_buckets.sql`) — pa reklase.

---

## 8. Log ak done sansib

**ESTIMASYON, yon sèl patwon (mo-kle angle sèlman — pa Kreyòl)** : `grep -rn "console\.(log|error|warn)(.*\\(phone|address|lat|lng|...\\)" src/` → **1 sèl rezilta**, `src/hooks/useDriverLocation.ts:52` — log yon **objè erè** (echèk mizajou pozisyon), pa yon valè lat/lng brit li menm. **Pa yon pas konplè** — mank verifikasyon ak mo-kle Kreyòl (`telefòn`, `adrès`, `kòdone`) ak lòt patwon log (`console.info`, `Sentry.captureMessage` ak done bri). Rekòmande yon dezyèm pas dedye si nesesè.

---

## 9. Aksè GPS/lokalizasyon — **pozitif, KONFIME**

Twa mekanis distenk, chak li ak politik RLS li nan kontèks konplè :

| Tab/kolòn                          | Ki sa li ye                                                     | Ki moun ki ka wè l                                                                                                   | Fichye:Liy                                                          |
| ---------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `customer_delivery_locations`      | Pozisyon kliyan pataje pou 1 livrezon                           | admin, kliyan pwopriyetè kòmand lan, livrè asiyen an — **sèlman**                                                    | `20260723090000_notifications_engine_and_gps_sharing.sql:155-178`   |
| `deliveries.driver_lat/driver_lng` | Pozisyon livrè pou 1 livrezon espesifik                         | admin, kliyan pwopriyetè kòmand lan, restoran/anplwaye, livrè asiyen an — **sèlman**, via policy `"deliveries read"` | `20260721120000_order_items_deliveries_staff_driver_read.sql:36-44` |
| `drivers.current_lat/current_lng`  | Pozisyon global/aktyèl livrè a (tout tan, pa lye ak 1 livrezon) | **livrè a limenm + admin sèlman** — okenn kliyan, okenn lòt livrè                                                    | `20260703055033_...:32-33`                                          |

**Pa gen okenn chemen jwenn kote yon kliyan ka wè pozisyon yon livrè andeyò yon livrezon aktif ki pou li**, ni kote yon livrè ka wè pozisyon global yon lòt livrè. Modèl la byen separe "pozisyon global" (prive) ak "pozisyon pandan yon livrezon espesifik" (pataje ak moun ki konsène yo sèlman) — **bon design, verifye ak lekti konplè 3 policy yo, pa sipoze**.

---

## 10. Rezime findings Faz 2

| ID      | Kategori                                                                           | Nivo                                                                                       | Chif                                    | Konfyans                                                                        |
| ------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------- |
| NKD-004 | RAISE EXCEPTION an angle (Kategori B)                                              | P3                                                                                         | 67/157 (42.7%)                          | KONFIME pa lekti konplè (2026-08-14) — `docs/NKD-004_RAISE_MESSAGES_BACKLOG.md` |
| NKD-005 | Fuit non tab nan trigger `prevent_log_mutation` (Kategori C)                       | ~~P1*~~ **P3 — mitigated by design** (rekl. 2026-08-14, §2)                                | 1 ka                                    | KONFIME, ak nòt reyaksesibilite ki redwi risk pratik                            |
| NKD-006 | SSRF via `push_subscriptions.endpoint` san validasyon                              | P1 → **FIXED** (finalizasyon Faz 2, 2026-08-14 — `docs/PHASE_FAZ2_FINALIZATION_REPORT.md`) | 1 chemen konplè                         | KONFIME, chemen dat-a-dat trase                                                 |
| NKD-007 | Ansyen `.env` (pwojè Supabase diferan + kle Google Maps deja rezoud) nan istwa git | P3                                                                                         | 3 kòmi, 2 varyab sansib (1 deja rezoud) | KONFIME (pathspec + pickaxe egzoustif)                                          |

*NKD-005 te klase P1 dapre gid klasifikasyon Kategori C bay pou Faz 2 a; reklase P3 (mitigated by design) pandan finalizasyon Faz 2 (2026-08-14) — wè §2 pou 2 rezon konfime yo ak kondisyon retou a P1.

**Pa gen okenn ka Kategori D** (enumerasyon) jwenn — deklare kòm sa ye.

---

_Faz 2 fini. Okenn kòd modifye. Kanpe pou KONTINYE dapre fòma mande a._
