# PAS 1 — Sekirite + Auth/Authz

**Estati aksè pou pas sa a**: read-only/static sèlman. Pa gen staging ki egziste (konfime PAS 0) — okenn requèt HTTP "atak" reyèl pa fèt kont production. Tout finding runtime-comportman rete LIKELY sof kote build/git lokal bay prèv dirèk (CONFIRMED).

## ⚠️ SECRET EXPOSURE DETECTED

```
Kote: .claude/settings.json (istorik git — retire nan HEAD pa 7b1e409, 2026-08-16;
      ajoute pa f4f6596, 2026-07-12)
Kalite: Bearer token — Supabase Management API (api.supabase.com/v1/projects/.../database/query)
Prefiks: PA DISPONIB — yon kouch redaksyon otomatik te ranplase valè a pa
         "__TRACKED_VAR__"/"__CMDSUB_OUTPUT__" anvan mwen te ka wè l
Ekspoze nan client bundle: NON (fichye sa a pa janm fè pati d'aucun build — se yon
         fichye konfigirasyon zouti dev, pa kòd aplikasyon)
Nan git history: WI — commit f4f6596 (2026-07-12) jiska 7b1e409 (2026-08-16),
         toujou aksesib jodi a sou origin/main (verifye: git merge-base --is-ancestor)
Severite: CRITICAL
Aksyon: revoke ak rotate imedyatman (gade SEC-001 pou detay konplè)
```

**Pa gen okenn valè sekrè ekri okenn kote nan rapò sa a, konfòm ak règ la.**

## Tablo Auth/Authz — chemen verifye

| Chemen | Otantifikasyon | Otorizasyon wòl | Verifikasyon pwopriyetè | Validasyon input | Rate limit | Vèdik |
|---|---|---|---|---|---|---|
| `POST /api/webhooks/stripe/collect` | Siyati Stripe (`stripe.webhooks.constructEvent`, SDK ofisyèl) — [stripe-client.server.ts:240](src/lib/payment-providers/stripe-client.server.ts#L240) | n/a (webhook, pa yon itilizatè) | `event.ourReference` dwe matche yon `payment_transactions` egzistan (via RPC) | Zod pa aplikab — payload Stripe deja verifye pa siyati | n/a (Stripe pa retry san limit; RPC idempotan) | **PWOTEJE** |
| `POST /api/webhooks/moncash/collect` | Siyati HMAC-SHA256 + `timingSafeEqual` — [moncash-provider.server.ts:48-62](src/lib/payment-providers/moncash-provider.server.ts#L48) | n/a | Menм patwon ak Stripe collect | Payload parse ak chèk fòma | Idempotans DB (UNIQUE constraint) | **PWOTEJE** |
| `POST /api/webhooks/moncash` | Menм HMAC+timingSafeEqual | n/a | Menm | Menm | Menm | **PWOTEJE** |
| `GET /api/cron/moncash-reconcile` | `CRON_SECRET` (konparezon `!==`, PA timing-safe) | n/a (Vercel Cron sèlman) | n/a | n/a | n/a | **PWOTEJE** (ak yon fèblès teyorik — SEC-002) |
| `GET /api/cron/plop-reconcile` | Menm patwon CRON_SECRET | n/a | n/a | n/a | n/a | **PWOTEJE** (SEC-002) |
| `suspendUserAccount` (server fn) | `requireSupabaseAuth` middleware (sesyon Supabase valid) | `has_role(admin\|super_admin)` verifye SÈVÈ-SIDE, + super_admin-only pou sispann yon lòt admin | Anpeche oto-sispansyon (`data.userId === userId`) | Zod (`userId: uuid`) | Pa verifye eksplisitman nan fichye sa a | **PWOTEJE** |
| `anonymizeCustomerAccount` (server fn) | `requireSupabaseAuth` | `has_role(admin\|super_admin)` + RPC `anonymize_customer_secure` gen pwòp chèk step-up STRICT (dapre migrasyon) | RPC verifye kont sib la se yon 'customer' sèlman | Zod | Pa verifye eksplisitman | **PWOTEJE** |
| `initiateProviderPayout` (server fn) | `requireSupabaseAuth` | **Delege bay RPC** `initiate_payout_secure` — verifye: role admin/super_admin + `require_admin_step_up_strict()` (MFA fre <5min) | RPC verifye balans wallet ak `FOR UPDATE` (lock ranje, anpeche kous) | Zod (`amount: positive`, `restaurantId` XOR `driverId`) | `check_rate_limit_secure('initiate_payout', 30, 600)` **NAN RPC a** | **PWOTEJE** (prèv statik nan migrasyon — konpòtman runtime rete LIKELY, PAS 2 pral apwofondi) |
| `POST /auth/v1/token` (sign-in, via `auth.index.tsx`) | Supabase Auth (GoTrue) | n/a | n/a | Zod/HTML input | RPC `check_auth_rate_limit_secure` — **REKÈT SEPARE, KA KONTOUNEN** si atakè a rele GoTrue dirèkteman | **EKSPOZE (pasyèl)** — SEC-003 |
| `_authenticated/*` (tout dashboard) | `beforeLoad` sesyon (`getSession()`), **`ssr: false` (client-side sèlman)** | Wòl chaje ak montre nan UI, MEN kòmantè kòd la eksplisit di sa se yon "gate UX", VRÈ fwontyè a se RLS/RPC anba a | n/a nan nivo route | n/a | n/a | **NOT VERIFIED pou chak sou-wout endividyèl** — achitekti a depann de RLS/RPC pou chak aksyon, pa nan sa ki verifye isit la |

## Chemen ki PA VERIFYE (18 server function, 71 lòt wout)

Pou 15 lòt fichye `*.functions.ts` (send-*-push, get-*-status, poll-collect-payment, register-documents, send-newsletter) ak tout sou-wout `_authenticated/dashboard.*` (52 fichye) — **NOT VERIFIED**. Aksè ki ta debloke sa: plis tan/pas dedye, oswa yon lis priyorite plis presi de itilizatè a sou ki wout ki pi kritik pou li.

## OWASP — pwen verifye

| Kontwòl | Rezilta | Konfyans |
|---|---|---|
| Headers sekirite (`vercel.json`) | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security` (HSTS preload), `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin-allow-popups` — tout prezan | CONFIRMED (verifye pa yon curl anvan nan sesyon sa a sou live site) |
| CSP | Prezan, strict (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, nonce pou script) + `report-uri`/`report-to` | CONFIRMED |
| CORS (`Access-Control-Allow-Origin`) | Okenn konfigirasyon eksplisit jwenn nan `src/` — pa gen wildcard/pèmisiv | CONFIRMED (rechèch: 0 match) |
| Sekrè sèvè nan bundle client | 0/8 verifye ekspoze | CONFIRMED (REC-001, PAS 0) |
| `.env*` tracked pa aksidan | `.env.e2e` tracked men **tout valè se plasholder fo** (verifye pa Read); `.env.local` PA tracked | CONFIRMED |
| Sekrè nan git history (varyab aplikasyon) | 0 match pou `SERVICE_ROLE`/`sk_live`/`sk_test`/`BEGIN PRIVATE KEY` kòm VALÈ reyèl nan kòd aplikasyon an | CONFIRMED — **MEN** gade SEC-001 pou yon lòt kalite sekrè (zouti dev) |
| Webhook siyati (Stripe + MonCash ×2) | Toude korèkteman enplemante (SDK ofisyèl / HMAC+timingSafeEqual) | CONFIRMED |
| Rate-limit login | Egziste nan kòd aplikasyon an, MEN kontounab (SEC-003) | LIKELY |
| Idantifikasyon aksyon "STRICT step-up" (re-auth MFA fre) pou aksyon lajan/wòl | Egziste, dokimante nan migrasyon 20260811120000, kouvri `initiate_payout_secure` ak 4 lòt RPC | CONFIRMED (statik) |

## Rezime severite PAS 1

- 🔴 **1 CRITICAL** (SEC-001 — sekrè nan git history)
- 🟠 **0 HIGH**
- 🟡 **1 MEDIUM** (SEC-003 — rate-limit login kontounab)
- 🔵 **1 LOW** (SEC-002 — timing-safe comparison)
- Plizyè kontwòl **CONFIRMED efikas** (webhooks, headers, CSP, separasyon sekrè, step-up MFA sou peman)

## Obsèvasyon achitekti (enpòtan pou PAS 2)

Kòd la swiv yon patwon konsistan: server functions verifye **idantite** (`requireSupabaseAuth`) men delege **otorizasyon** (wòl, balans, step-up) bay RPC Postgres (`*_secure` functions, `SECURITY DEFINER`). Sa vle di **kalite reyèl sekirite sistèm nan depann prèske antyèman de kalite chèk anndan RPC yo** — yon sèl RPC ki manke yon chèk wòl ta ka yon twou total, menм si server function ki rele l la sanble "pwoteje". PAS 2 dwe trete envantè konplè RPC yo (ki gen `SECURITY DEFINER`) kòm priyorite absoli, pa yon egzèsis segondè.

## Limit pas sa a

- Pa gen aksè runtime/DB — tout "PWOTEJE" pou webhook/RPC yo baze sou lekti kòd/migrasyon statik, pa yon tès reyèl.
- 18 server functions - 3 verifye an detay (manage-user ×3, initiate-provider-payout) = 4 sou 18. 14 rete **NOT VERIFIED**.
- 52 sou-wout `_authenticated/dashboard.*` — 0 verifye endividyèlman (achitekti jeneral la sèlman verifye).
- Pa gen tès CSRF, IDOR, oswa SSRF eksplisit fèt (mande swa aksè staging pou pwòb aktif, swa plis tan pou analiz statik apwofondi chak wout).

---

**Èske mwen kontinye ak PAS 2 (Database + RLS + RPC)?**
