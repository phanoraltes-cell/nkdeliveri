# PAS 0 — Rekonesans + Architecture Map

## BLÒK 1 — Kontèks pwojè (ranpli/konfime pandan PAS 0)

```yaml
pwojè: nkdeliveri (NK Deliveri)
objektif_biznis: Plateforme livrezon manje lokal (Gonaïves, Ayiti) — kliyan, restoran, chofè, admin
stad: production live (nkdeliveri.com aktif, deplwaye sou Vercel, DNS/Cloudflare pwodiksyon)
itilizatè_prod: NOT VERIFIED — pa gen aksè metric/analytics/DB pou konte

repo:
  chemen_lokal: c:\Web Project\nkdeliveri
  branch: main
  monorepo: non (yon sèl pakè npm)

stack_deklare: PA T RANPLI pa itilizatè a nan BLÒK 1 — pa gen referans pou konpare.
  Sa ki swiv se STACK REYÈL OBSÈVE (pa yon konparezon):

stack_reyèl:
  frontend: React 19 (implicite pa @types/react) + TanStack Router + TanStack Query + Tailwind v4 + Radix UI + Framer Motion
  meta_framework: TanStack Start (@tanstack/react-start) — SSR, server functions (createServerFn)
  backend: Server functions TanStack Start (*.functions.ts) + API routes (src/routes/api.*.ts) — PA gen Express/Fastify separe
  database: Supabase (Postgres) — @supabase/supabase-js, 151 fichye migration SQL
  auth: Supabase Auth (pa gen lòt pakè auth (NextAuth, Clerk, elt.) detekte)
  storage: Supabase Storage (sipoze — pa verifye ankò, PAS 4)
  peman: Stripe (kat kredi) + MonCash (entegrasyon kustom, Ayiti) + Plop (entegrasyon kustom)
  push_notifikasyon: web-push (@block65/webcrypto-web-push) + VAPID
  erreur_tracking: Sentry (@sentry/node + @sentry/react)
  pdf: jspdf + jspdf-autotable (resi, rapò)
  kat/jewografi: Leaflet + react-leaflet + OSRM (routing)
  pwa: vite-plugin-pwa (strategy injectManifest) + workbox — sw.ts kustom
  deployment: Vercel (nitro preset "vercel"), DNS/CDN Cloudflare devan Vercel
  ci: GitHub Actions (.github/workflows/ci.yml) — lint/typecheck/format/build + 2 suite E2E + validasyon migration
  test: Vitest (unit) + Playwright (E2E, ak @axe-core/playwright pou aksesibilite, playwright-lighthouse)

wòl_itilizatè (dedwi nan src/routes/_authenticated/dashboard.*): client, restoran, chofè (driver), admin
done_ki_pi_sansib (dedwi, pa konfime pa itilizatè a): balans wallet/peman (Stripe/MonCash/Plop),
  done idantite chofè (register-documents.functions.ts), adrès livrezon kliyan, wòl itilizatè

aksè_odit_la_genyen:
  kòd_sous: WI
  git_history: WI (git log + gh CLI)
  database_dev: NON
  database_prod: NON
  logs_production: NON (konektè Vercel MCM pa wè pwojè a; pa gen lòt aksè log)
  dashboard_hosting: PASYÈL (gh Actions checks/logs WI; dashboard Vercel li menm NON)
  anviwònman_staging: NON — PA EGZISTE (verifye, gade "Blokaj" anba a)

pwòb_aktif_otorize: WI sou staging sèlman (dapre repons itilizatè a) — MEN pa gen staging ki egziste,
  donk EFEKTIVMAN NON pou kounye a. PAS 1 ap rete read-only/static.
lang_rapò: Kreyòl (defo, pa kontredi pa itilizatè a)
```

## 1. Envantè

- **863** fichye track pa git.
- Divizyon prensipal: `src/` (334), `docs/` (206), `supabase/` (162 — 151 migrasyon SQL + tès), `public/` (79), `e2e/` (42).
- `src/`: `components/` (110), `lib/` (98), `routes/` (77), `hooks/` (32), `integrations/` (5), `assets/` (5), `services/` (1).
- **151 migrasyon SQL** — istwa evolisyon DB byen dokimante, men gwo volim (PAS 2 ap gen anpil travay).
- **206 fichye `docs/`** — majorite sanble se rapò odit/enside anteryè (`*_AUDIT_*.md`, `*_REPORT.md`, runbooks) pase dokimantasyon itilizatè.

## 2. Stack deklare vs reyèl

Itilizatè a pa t ranpli chan `stack_deklare` nan BLÒK 1 → **pa gen konparezon posib**. Stack reyèl la dokimante pi wo a, sòti dirèkteman nan `package.json` (verifye, pa sipozisyon).

## 3. Kòmpozan kle idantifye

| Kòmpozan                            | Kote                                    | Kantite                             |
| ----------------------------------- | --------------------------------------- | ----------------------------------- |
| API routes (fichye)                 | `src/routes/api.*.ts`                   | 6 (cron×2, webhook×3, csp-report×1) |
| Server functions (`*.functions.ts`) | `src/lib/*.functions.ts`                | 18                                  |
| Routes UI otantifye                 | `src/routes/_authenticated/**`          | (sou-ansanm nan 77 routes total)    |
| Payment providers (kòd kustom)      | `src/lib/payment-providers/*.server.ts` | Stripe, MonCash, Plop               |
| Service worker kustom               | `src/sw.ts`                             | 1                                   |
| Migrasyon SQL                       | `supabase/migrations/*.sql`             | 151                                 |

## 4. Envantè varyab anviwònman (non sèlman, pa valè)

**Ekspoze kliyan (`VITE_` prefiks, 5)**: `VITE_COMMIT_SHA`, `VITE_OSRM_URL`, `VITE_SENTRY_DSN`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL`.

**Sèvè sèlman (23)**: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_JWK`, `RESEND_API_KEY`, `SENTRY_DSN`, `MONCASH_CLIENT_ID`, `MONCASH_CLIENT_SECRET`, `MONCASH_MERCHANT_ID`, `MONCASH_API_URL`, `MONCASH_WEBHOOK_SECRET`, `PLOP_CLIENT_ID`, `PLOP_CLIENT_SECRET`, `PLOP_PAYMENT_METHOD`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRESENTMENT_CURRENCY`, `STRIPE_HTG_CONVERSION_RATE`, `CRON_SECRET`.

**Chèk sekirite fèt (rezilta nan REC-001)**: 8 sekrè sèvè ki pi sansib yo (`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MONCASH_CLIENT_SECRET`, `MONCASH_WEBHOOK_SECRET`, `PLOP_CLIENT_SECRET`, `VAPID_PRIVATE_JWK`, `RESEND_API_KEY`) — **CONFIRMED 0 match** nan bundle client konpile a (build lokal, preset Vercel).

## 5. Top 10 fichye ki gen plis risk (gwosè × sansiblite)

| #   | Fichye                                                           | Liy | Poukisa li nan lis la                                                               |
| --- | ---------------------------------------------------------------- | --- | ----------------------------------------------------------------------------------- |
| 1   | `src/routes/checkout.tsx`                                        | 697 | Flux peman kliyan konplè                                                            |
| 2   | `src/routes/_authenticated/dashboard.admin.collect.tsx`          | 590 | Admin — koleksyon lajan                                                             |
| 3   | `src/routes/_authenticated/dashboard.admin.ads.tsx`              | 576 | Admin — jesyon piblisite/peman                                                      |
| 4   | `src/routes/_authenticated/dashboard.admin.payouts.tsx`          | 535 | Admin — **sòti lajan** (payout)                                                     |
| 5   | `src/lib/payment-providers/moncash-client.server.ts`             | 519 | Kliyan API MonCash                                                                  |
| 6   | `src/components/dashboard/admin/komand-detail-dialog.tsx`        | 518 | Admin — detay kòmand                                                                |
| 7   | `src/routes/_authenticated/dashboard.driver.history.tsx`         | 509 | Chofè — istwa/pèfòmans                                                              |
| 8   | `src/routes/_authenticated/dashboard.admin.finance.tsx`          | 509 | Admin — finans global                                                               |
| 9   | `src/routes/_authenticated/dashboard.restaurant.orders.tsx`      | 487 | Restoran — kòmand                                                                   |
| 10  | `src/routes/_authenticated/dashboard.admin.payout-migration.tsx` | 485 | Admin — **zouti migrasyon payout** (aksyon danjere potansyèl, itilize yon sèl fwa?) |

`src/lib/manage-user.functions.ts` ak `src/lib/payment-providers/plop-client.server.ts` (481 liy) rete kandida priyorite pou PAS 1/3 menм si yo pa nan Top 10 gwosè a — non fonksyon an (`manage-user`) sijere yon aksyon privilejye.

## ARCHITECTURE MAP (reyèl)

```text
Kliyan (React 19 + TanStack Router, SSR pa TanStack Start)
   ↓ fetch / server functions (RPC-style, pa REST klasik)
Route/Server-function layer (src/routes/**, src/lib/**.functions.ts)
   ↓
Business logic — MELANJE nan routes/*.tsx ak *.server.ts/*.functions.ts
   (PA gen yon "service layer" separe klèman idantifye — pou konfime nan PAS 5)
   ↓
Database: Supabase Postgres — 151 migrasyon, aksè pa verifye (pa gen konesyon)

Sèvis ekstèn:
  - Supabase Auth (idantifikasyon)
  - Stripe (peman kat kredi entènasyonal)
  - MonCash (peman mobil ayisyen — API kustom)
  - Plop (twazyèm founisè peman — API kustom)
  - Resend (imel)
  - Sentry (erreur tracking, front + back)
  - OSRM (routing/distans livrezon)
  - Web Push (VAPID, notifikasyon)

Kwaze:
  Auth        → EGZISTE (Supabase Auth) — pa verifye ankò si tout wout pwoteje kòrèkteman (PAS 1)
  Storage     → PASYÈL — pakè @supabase/supabase-js la gen storage, itilizasyon reyèl pa konfime (PAS 4)
  Realtime    → SUSPECTED — non fichye "useRealtimeTableSync" jwenn nan build output, pa verifye ankò
  Jobs (cron) → EGZISTE — 2 wout api.cron.* (moncash-reconcile, plop-reconcile), pwoteje pa CRON_SECRET (sitasyon kòd, pa verifye konpòtman)
  Webhooks    → EGZISTE — 3 wout (stripe.collect, moncash.collect, moncash) — verifikasyon siyati PAS 1/3
  Peman       → EGZISTE — 3 founisè (Stripe, MonCash, Plop) — priyorite PAS 3
  Notifikasyon→ EGZISTE — Web Push (18 fichye *.functions.ts) + imel (Resend)
  Monitoring  → EGZISTE — Sentry front+back; CSP report route (api.csp-report.ts)
```

## PLAN ODIT (jistifikasyon priyorite pou pwojè SA A)

- **PAS 1 (Sekirite/Auth) — priyorite maksimòm, MEN limite a static.** San staging ni pwòb aktif otorize, tout finding runtime plafone a LIKELY. Fokis: 6 wout API/webhook/cron + 18 server functions — sa yo se sèl "pòt antre" ki pa pase pa yon UI, egzakteman kesyon santral BLÒK PAS 1 la.
- **PAS 2 (Database/RLS) — analiz static sèlman, pa gen aksè DB.** 151 migrasyon pou revize; tout finding RLS plafone a LIKELY oswa SUSPECTED, jamè CONFIRMED (pa gen `pg_policies` reyèl aksesib).
- **PAS 3 (Peman) — priyorite wo.** 3 founisè peman (Stripe/MonCash/Plop) + payout admin (`dashboard.admin.payouts.tsx`, `dashboard.admin.payout-migration.tsx`) = "aksyon ki pi danjere" evidan pou pwojè sa a.
- **PAS 4 (API/Storage) — mwayen.** Storage itilizasyon pa ko konfime.
- **PAS 5 (Achitèkti/Pèfòmans) — mwayen.** Melanj lojik biznis nan routes/*.tsx ak *.server.ts pral mande atansyon.
- **PAS 6 (UX/UI) — pi ba priyorite pou yon backend/peman-santrik sistèm**, epi konfyans deja plafone a LIKELY pa dokiman an menм.
- **PAS 7 (DevOps) — enpòtan.** Repo a gen istwa reyèl enside prodiksyon resan (deplwaman bloke pa konfli non pwojè Vercel, dezyèm lockfile dezsenkwonize, cache PWA ki bay done pouri) — tout sa deja konfime nan konvèsasyon anvan sesyon sa a, itil kòm kontèks pou PAS 7.

## BLOKAJ

1. **Pa gen aksè database (dev ni prod).** Tout finding PAS 2 ap CONFIRMED sèlman pou sa ki li dirèkteman nan fichye migration; konpòtman runtime rete LIKELY/SUSPECTED. Aksè ki ta debloke sa: yon konesyon SELECT-sèlman (Supabase MCP oswa idantifyan read-only).
2. **Pa gen anviwònman staging.** Konfime: `staging.nkdeliveri.com` retounen 404 (docs/SECURITY_PERIMETER_AUDIT_2026-08-13.md), pa gen PR/preview aktif kounye a (`gh pr list` — 0 louvri). Otorizasyon "pwòb aktif sou staging" itilizatè a bay la pa ka aplike jodi a. Aksè ki ta debloke sa: yon deplwaman preview Vercel oswa yon anviwònman staging dedye.
3. **Pa gen aksè logs production ni dashboard Vercel konplè.** Konektè Vercel MCM disponib la lye ak yon lòt kont ki pa gen aksè a pwojè "nkdeliveri" a (verifye — `list_projects` retounen vid).
4. **Itilizatè_prod ak done_ki_pi_sansib/aksyon_ki_pi_danjere pa t konfime eksplisitman pa itilizatè a** — mwen dedwi yo nan kòd la (gade BLÒK 1 pi wo, make "dedwi, pa konfime"). Si gen yon lòt aksyon/done pi sansib itilizatè a konnen ki pa parèt nan kòd la (ex: yon operasyon manyèl deyò sistèm nan), li pa nan pòte odit sa a.

## Fichye ekri nan `audit/`

- `audit/findings.jsonl` — 2 finding (REC-001, REC-002)
- `audit/commands.log` — istwa kòmand + lis fichye li
- `audit/evidence/pas0-dependencies.txt`, `pas0-routes.txt`, `pas0-server-functions.txt`, `pas0-secret-references.txt`
- `audit/PAS0-rekonesans.md` — dokiman sa a

---

**Èske mwen kontinye ak PAS 1?**
