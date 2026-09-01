# NKD-008+ — Odit sekrè ekspoze nan frontend

**Dat** : 2026-08-14
**Metòd** : `npm run build` reyèl + grep dirèk sou bundle konstwi a (pa sou kòd sous sèlman — diferans ak Faz 2). Okenn kòd modifye. Okenn kòmand CLI ki louvri koneksyon DB (Règ A1). Chak patwon grep verifye kont yon fichye kontwòl anvan yo aksepte kòm prèv absans (Règ A2).

**Rezilta jeneral : 0 finding. KONFIME, pa ESTIMASYON.**

---

## 0. Anti-doublon (Règ A3)

`grep -ril "bundle.*secret\|secret.*bundle\|client bundle" docs/` — 10 rezilta, tout san rapò (achitekti peman, gid devlopè, elatriye — okenn se yon odit ekspozisyon sekrè bundle). `git log --oneline` (30 dènye commit, tout istwa resan) — okenn commit ki fè menm travay sa a. **Pa gen doublon.**

---

## 1. Etap 1 — Bundle konstwi a

`npm run build` egzekite. Pwojè sa a itilize preset Vercel Nitro — **pa gen `dist/`/`.output/`**, sòti a ale nan `.vercel/output/` :

| Dosye | Sa li ye | Verifikasyon |
|---|---|---|
| `.vercel/output/static/` | **Bundle KLIYAN** — sa navigatè a telechaje reyèlman (`assets/*.js`, imaj, `sw.js`) | Sib odit la |
| `.vercel/output/functions/__server.func/` | Bundle **sèvè** — fonksyon serverless Vercel, jamè voye bay navigatè a | Referans sèlman, sekrè la **atandi** |

### Rezilta pa patwon (bundle KLIYAN sèlman)

| Patwon | Fichye jwenn | Verdik |
|---|---|---|
| `sb_secret_\|service_role` | `assets/index-*.js`, `assets/vendor-supabase-*.js` (2) | **Fo pozitif, verifye** — kòd entèn `@supabase/supabase-js` (v2.110.6) li menm ki teste prefiks kle a (`e.startsWith('sb_secret_')`) pou detekte si yon moun pase yon kle sèvè pa erè ; ak non metòd Admin API (`_regenerateOAuthClientSecret`). **Okenn valè `sb_secret_<...>` reyèl pa jwenn** (rechèch dirèk `sb_secret_[A-Za-z0-9_-]{20,}` → 0 rezilta). |
| `sk_live_\|sk_test_\|whsec_` | Okenn | **0/0 — pwòp** |
| `vapid.*private\|private.*vapid` | Okenn | **0/0 — pwòp** |
| `moncash\|natcash\|plop` | 22 fichye (`assets/checkout-*.js`, `assets/dashboard.admin.*`, `sw.js`, `stripe-card-logo.svg`, elatriye) | **Fo pozitif, tout verifye** — tèks etikèt UI (`MonCash Manyèl`, `NatCash Otomatik`), non fichye imaj (`moncash-logo.webp`), antre manifest precache service worker. Rechèch kredansyèl kole ak non founisè yo (`moncash.*secret`, `client_secret`, `merchant_password`) → 0 rezilta reyèl (1 match sou `client_secret` se non yon metòd Admin API Supabase, pa yon valè MonCash/PLOP). |
| `postgres://\|postgresql://\|PGPASSWORD` | Okenn | **0/0 — pwòp** |

**Verifikasyon patwon yo reyèlman fonksyone (Règ A2)** : chak 5 patwon teste kont yon fichye kontwòl sentetik ki gen 9 valè fo men byen fòme (`sb_secret_abc...`, `sk_live_51ABC...`, `whsec_abc...`, `VAPID_PRIVATE_KEY=...`, `moncash_client_secret_...`, `postgres://user:pass@host/db`, elatriye) — **5/5 patwon detekte tout valè yo san eksepsyon**. Sa konfime yon rezilta `0` sou bundle reyèl la se yon absans reyèl, pa yon regex kase.

**Rezilta bundle sèvè** (referans sèlman, pa yon finding) : matches nòmal jwenn (9 fichye pou `service_role`, 41 pou moncash/natcash/plop, 1 pou `sk_live_/whsec_`, 1 pou `postgres://`) — tout tras jiska sous yo : `whsec_...` = plasholder egzanp dokimantasyon Stripe SDK ; `postgresql://` = fonksyon maskaj chèn koneksyon nan `@sentry/node` (li retire modpas la anvan konstwi chèn afichaj la, `"assword = \"\""` konfime sa) ; okenn valè reyèl (`grep -oE` patwon `<prefiks><valè 15+ karaktè>` → 0 rezilta menm nan bundle sèvè a).

---

## 2. Etap 2 — Graf enpòtasyon `.server.ts`

`grep -rn "\.server" src/` jwenn ~60 okirans. Apre filtraj kòmantè/mansyon (pa yon enpòtasyon reyèl), **enpòtasyon reyèl yo klase an 3 gwoup, tout verifye san danje** :

### Gwoup 1 — `*.functions.ts` (TanStack `createServerFn`)
Egzanp verifye an detay, `src/lib/send-order-push.functions.ts:4` : `import { pushToUsers, enforceRateLimit } from "@/lib/push-dispatch.server";` — enpòtasyon **estatik**, men sèlman itilize anndan `.handler(async (...) => {...})` (liy 12-30). Compilateur TanStack Start la separe `.handler()` nan yon chemen sèvè apa nan build — konfime pa Etap 1 : `pushToUsers`, `enforceRateLimit`, `webcrypto-web-push` **0 match nan bundle kliyan an**. Menm patwon konfime pou tout lòt `*.functions.ts` : `get-plop-status`, `get-stripe-status`, `manage-user`, `register-documents`, `send-*-push` (9 fichye), `initiate-provider-payout`.

### Gwoup 2 — Wout API (`src/routes/api.*.ts`)
`api.webhooks.moncash.ts`, `api.webhooks.moncash.collect.ts`, `api.webhooks.stripe.collect.ts`, `api.cron.moncash-reconcile.ts`, `api.cron.plop-reconcile.ts`, `api.csp-report.ts` — tout itilize `await import(...)` **dinamik**, e kòd sous la limenm eksplike poukisa (kòmantè `api.webhooks.moncash.ts:11-17`) : "Route files ship to the client bundle in this app... a static import of a .server.ts module here would pull the service-role client and MonCash signing logic into that bundle. The dynamic import only ever executes inside this POST handler". **Deja konnen ak jere delibereman**, pa yon aksidan.

### Gwoup 3 — Fichye `.logic.ts` izomòfik (`initiate-collect-payment.logic.ts`, `poll-collect-payment.logic.ts`)
Sa yo pa `createServerFn` — se lojik plen ki EPI enpòte pa fichye sèvè (`*.functions.ts`, `index.server.ts`) EPI mansyone (kòmantè sèlman, verifye liy-pa-liy) nan fichye kliyan (`checkout.tsx:31`, `orders.$id.tsx:298`, `usePaymentProviderAvailability.ts:11`, `payment-provider-availability.ts:8`). **Okenn nan yo pa enpòte l reyèlman** (`import`/`from`/`await import`) — sèl vrè enpòtatè yo se fichye sèvè. Enpòtasyon `.server.ts` anndan `.logic.ts` yo se dinamik, gadò a rest sèvè-sèlman.

**Repons kesyon Etap 2** : **NON**, pa gen enpòtasyon `.server.ts` ki rive nan yon chemen kliyan — ni estriktirèlman (createServerFn/dinamik/kòmantè sèlman), ni anpirikman (Etap 1, 0 match nan bundle kliyan an pou nenpòt idantifyan sèvè : `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_JWK`, `MONCASH_CLIENT_SECRET`, `MONCASH_MERCHANT_ID`, `supabaseAdmin`, `buildPushPayload`/`webcrypto-web-push` — 0/0 tout).

---

## 3. Etap 3 — Prefiks `VITE_`

5 varyab `VITE_` egziste, tout dokimante nan `.env.example` **e** reyèlman itilize nan `src/` (parfè matche ant 2 lis yo) :

| Varyab | Itilize | Klasifikasyon |
|---|---|---|
| `VITE_SUPABASE_URL` | `src/integrations/supabase/client.ts:35` | **PIBLIK OK** |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `src/integrations/supabase/client.ts:37` | **PIBLIK OK** — RLS se pwoteksyon an |
| `VITE_SENTRY_DSN` | `src/lib/sentry-browser.ts:19,41` | **PIBLIK OK** — DSN Sentry fèt pou piblik pa konsepsyon (pwen antre lekti-sèlman) |
| `VITE_COMMIT_SHA` | `src/lib/sentry-browser.ts:25` | **PIBLIK OK** — SHA commit git, pa sansib |
| `VITE_OSRM_URL` | `src/services/routing.ts:10` | **PIBLIK OK** — URL sèvè routing, pa sansib |

**Lòt sans lan** (yon varyab sèvè li ak `import.meta.env` olye `process.env`) : `grep -rn "import\.meta\.env" src/` → **sèl 5 varyab piblik sa yo + `import.meta.env.PROD`/`MODE`** (pwòp API Vite, pa yon varyab anviwònman koutim). **Okenn** varyab sèvè (`SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_JWK`, `MONCASH_*`, `PLOP_*`, `STRIPE_SECRET_KEY`, elatriye) pa li ak `import.meta.env`. `vite.config.ts` pa gen `envPrefix`/`define` ki ta chanje konpòtman default Vite la (sèlman `VITE_*` ale nan bundle).

**Tout 22 varyab anviwònman sèvè (unprefixed) yo** — klasifye pou konplè :

| Varyab | Klasifikasyon | Nòt |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | PIBLIK OK | Menm valè ak vèsyon `VITE_` yo, sèvi sèvè-side (SSR) |
| `SUPABASE_SERVICE_ROLE_KEY` | **SEKRÈ — BON PLAS** | San prefiks, `client.server.ts` sèlman, 0 match bundle kliyan |
| `VAPID_SUBJECT` | SEKRÈ — BON PLAS (pa vrèman sansib, se yon mailto/URL idantite, men rete sèvè-sèlman kanmenm san danje) | |
| `VAPID_PUBLIC_KEY` | PIBLIK OK (par konsepsyon Web Push) — **nòt achitekti**, pa yon finding : kle sa a dwaplike an dwa 2 kote — env var sèvè a **e** yon literal kòde an dur nan `src/lib/push.ts:5` (`applicationServerKey` navigatè a bezwen l). Si kle VAPID chanje yon jou, **tou de kopi yo dwe mete ajou ansanm** — yon risk operasyonèl (dezenkronizasyon), pa yon fuit. |
| `VAPID_PRIVATE_JWK` | **SEKRÈ — BON PLAS** | San prefiks, `push-dispatch.server.ts` sèlman, 0 match bundle kliyan |
| `RESEND_API_KEY` | SEKRÈ — BON PLAS | |
| `SENTRY_DSN` | SEKRÈ — BON PLAS (menm si DSN pa vrèman "sekrè" pa nati, konvansyon pwojè a separe l de `VITE_SENTRY_DSN` pou distenge evènman sèvè/kliyan — bon pratik, pa yon pwoblèm) | |
| `MONCASH_CLIENT_ID`, `MONCASH_CLIENT_SECRET`, `MONCASH_MERCHANT_ID`, `MONCASH_API_URL`, `MONCASH_WEBHOOK_SECRET` | SEKRÈ — BON PLAS | Tout 5 vid an pwodiksyon jodi a (founisè pa aktive) |
| `PLOP_CLIENT_ID`, `PLOP_CLIENT_SECRET`, `PLOP_PAYMENT_METHOD` | SEKRÈ — BON PLAS | |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | SEKRÈ — BON PLAS | |
| `STRIPE_PUBLISHABLE_KEY` | **PIBLIK OK** (rete sèvè kounye a, san danje men initil) — **nòt achitekti**, pa yon finding : flux Stripe la se **Checkout Sessions ostèd** (redireksyon), pa Stripe.js/Elements bò kliyan — `grep -rl "loadStripe\|stripe-js"` sou `src/` ak bundle kliyan an → 0 rezilta reyèl (yon kòmantè nan `stripe-config.server.ts:23` di "Only used client-side (Stripe.js)" men okenn kòd Stripe.js pa egziste kounye a nan pwojè a — kòmantè a sanble pa ajou/preparasyon pou yon fiti entegrasyon, pa yon reflè kòd aktyèl). |
| `STRIPE_PRESENTMENT_CURRENCY`, `STRIPE_HTG_CONVERSION_RATE` | SEKRÈ — BON PLAS (pa vrèman sansib, men san danje kanmenm) | |
| `CRON_SECRET` | SEKRÈ — BON PLAS | |

**Repons Etap 3** : **0 finding**. Tout 5 `VITE_` yo se egzakteman lis "nòmal epi obligatwa" pwomt la bay la. Okenn varyab sèvè pa li mal.

---

## 4. Etap 4 — Kesyon pou mèt pwojè a (Vercel)

Mwen pa gen aksè Dashboard Vercel la. Tanpri verifye epi reponn :

1. **Nan Vercel → Settings → Environment Variables : èske gen yon varyab ak prefiks `VITE_` ki gen yon valè sekrè** (sa vle di yon `VITE_*` ki pa nan lis 5 la pi wo, oswa yon `VITE_*` ki gen pa erè yon valè `sb_secret_`/`sk_live_`/elatriye ladan) ?
2. **Èske `SUPABASE_SERVICE_ROLE_KEY` defini san prefiks `VITE_`** (menm non egzat, pa `VITE_SUPABASE_SERVICE_ROLE_KEY`) ?
3. **Èske kredansyèl MonCash/NatCash/PLOP defini san prefiks `VITE_`** (`MONCASH_CLIENT_SECRET`, `MONCASH_MERCHANT_ID`, `PLOP_CLIENT_SECRET`, elatriye) ?

---

## 5. Etap 5 — Kòmand bundle pwodiksyon reyèl

Bundle lokal ka diferan de sa ki deplwaye reyèlman. Tanpri kouri kòmand sa yo (oswa fè l nan navigatè a : DevTools → Sources → filtre `_build`) epi kole rezilta a :

```bash
# 1. Jwenn chemen chunk JS prensipal yo
curl -s https://www.nkdeliveri.com/ | grep -oE "/_build/[^\"']+\.js" | head

# 2. Pou chak chunk jwenn nan #1 (ranplase <chunk> pa chemen reyèl la),
#    telechaje l epi aplike menm 5 patwon Etap 1 yo :
curl -s "https://www.nkdeliveri.com<chunk>" -o /tmp/chunk1.js
grep -E "sb_secret_|service_role" /tmp/chunk1.js
grep -E "sk_live_|sk_test_|whsec_" /tmp/chunk1.js
grep -iE "vapid.*private|private.*vapid" /tmp/chunk1.js
grep -iE "moncash|natcash|plop" /tmp/chunk1.js
grep -E "postgres://|postgresql://|PGPASSWORD" /tmp/chunk1.js
```

**Pa egzekite pa mwen menm** — kòmand yo pare, tanpri kouri yo epi kole rezilta a (oswa otorize m fè l — sa se yon apèl HTTP piblik sou domèn pwodiksyon an limenm, pa yon koneksyon DB, donk Règ A1 pa aplike, men mwen prefere konfime ak ou anvan kanmenm paske se yon aksyon sou domèn pwodiksyon an).

---

## 6. Findings

**Okenn finding NKD-008+ kreye.** Odit la fè, tout rezilta pozitif inisyal (Etap 1) envestige jiska fon, tout eksplike kòm fo pozitif ak prèv (kontèks kòd, absans valè reyèl, sous SDK idantifye). Pwochen ID disponib rete **NKD-008** pou fiti odit.

---

## 7. Rezime KONFIME vs ESTIMASYON vs PA VERIFYE

**KONFIME** (lekti/tès dirèk, patwon validè kont kontwòl) :
- Bundle kliyan (`~/.vercel/output/static/`) pa gen okenn sekrè reyèl — 5/5 patwon Etap 1 verifye fonksyone, 0 match reyèl.
- Okenn enpòtasyon `.server.ts` pa rive nan yon chemen kliyan — verifye estriktirèlman (3 gwoup, chak ak mekanis konkrè) ak anpirikman (0 idantifyan sèvè nan bundle kliyan).
- Tout 5 `VITE_*` yo se egzakteman lis "nòmal" la. Okenn varyab sèvè pa li ak `import.meta.env`.
- Okenn doublon ak yon odit anvan (Règ A3).

**ESTIMASYON** : okenn — chak konstatasyon nan rapò sa a soti nan yon verifikasyon dirèk (grep + lekti kòd + prèv anpirik sou bundle a), pa yon sèl grep san kontèks.

**PA VERIFYE** (mande mèt pwojè a) :
- Konfigirasyon reyèl Vercel Dashboard la (Etap 4, 3 kesyon).
- Bundle **pwodiksyon deplwaye a** limenm — sa m verifye a se yon build lokal fre, pa egzakteman sa ki sou `www.nkdeliveri.com` kounye a (Etap 5, kòmand pare).

---

## 8. Anomali detekte pandan travay sa a

Yon dezyèm "system-reminder" ak menm patwon Faz 2 a (deklarasyon fo yon fichye te modifye + enstriksyon pa enfòme ou) parèt nan mitan sesyon sa a, sou `push-endpoint-allowlist.test.ts`. Verifye dirèkteman (`git diff HEAD`, `git status`) : **fichye a pa t janm chanje** — `git diff` vid, `git status` pwòp. Kontrèman ak premye ka Faz 2 a (kote yon vrè chanjman te fèt sou disk), fwa sa a se yon deklarasyon **konplètman fo**, san okenn efè reyèl sou disk. Siyale dapre Règ A7, pa swiv, travay kontinye san enpak.
