# Newsletter — Remediation Phase 1 : vizibilite sou echèk anvwa

**Dat**: 2026-08-09
**Referans**: `docs/NEWSLETTER_EMAIL_REMEDIATION_AUDIT.md` § 5, Phase 1.
**Statut**: kòd + tès + migrasyon ekri epi verifye — **migrasyon poko aplike, anyen poko komite**, dapre konvansyon pwojè a.

## Objektif

Faz 1 pa "rezoud" echèk anvwa yo — li fè yo **dyagnostikab**. Anvan chanjman sa a, chak echèk (rezo, 429 Resend, 401 kle envalid, 500 Resend...) te tonbe nan yon senp `failed++` san okenn detay konsève okenn kote.

## Sa ki chanje

### 1. Nouvo migrasyon — `supabase/migrations/20260809100000_newsletter_send_log.sql`
Nouvo tab `newsletter_send_log`, menm patwon ak `plop_api_logs`/`stripe_api_logs` (append-only via `private.prevent_log_mutation()`, lekti rezève pou admin/super_admin via `private.has_role`, ekriti rezève pou `service_role` sèlman). Chak liy = yon tantativ Resend endividyèl: `recipient_email`, `success`, `http_status`, `error` (mesaj Resend lan oswa tèks brit si se pa JSON), `duration_ms`, `broadcast_id` (pou gwoupe tout liy yon menm anvwa), `subject`, `triggered_by`.
`npm run check:migrations` konfime: 125 migrasyon, 0 danje.

### 2. `src/lib/send-newsletter.functions.ts`
- Nouvo fonksyon `sendOne()` — yon sèl apèl Resend ki **pa janm voye eksepsyon**: chak rezilta (siksè, erè HTTP, erè rezo) retounen kòm done olye pwopaje kòm yon throw. Sa a se fiks Pwen A nan odit la.
- Prekosyon repete espre sou lekti kò repons lan: `.text()` yon sèl fwa, apre sa `JSON.parse` sou tèks kaptire a — menm bug "disturbed body" ki te deja koute Faz P1 PLOP la (`docs/PLOP_CLIENT_REMEDIATION_REPORT.md`) pa repwodwi isit la.
- Chak gwoup (`BATCH_SIZE=10`, **pa chanje** — throttling se Faz 2/3, pa Faz 1) ekri liy log li yo **imedyatman apre li fini**, pa nan fen tout apèl la — konsa menm si tout apèl la ta rive fè timeout (Pwen C nan odit la), gwoup ki te deja fini yo kite yon tras.
- Log ekri se "best-effort" (anvlope nan try/catch, `console.error` si l echwe) — yon pwoblèm nan log la pa dwe janm bloke vrè anvwa a.
- Repons `sendNewsletterBroadcast` a kounye a gen ladan `broadcastId` ak `failureSamples` (jiska 3 rezon distenk, tou kaptire tou de nan JS ak nan baz done a).

### 3. `src/routes/_authenticated/dashboard.admin.customers.tsx`
Lè `failed > 0`, `toast.warning` (olye `toast.success`) montre rezon yo dirèkteman (`failureSamples`) — admin lan wè "poukisa" san bezwen chèche nan baz done a.

## Verifikasyon

| Etap | Rezilta |
|---|---|
| `npm run typecheck` | ✅ Klè |
| `npm run lint` | ✅ 0 erè (13 avètisman pre-egzistan ki pa gen rapò, tout nan fichye mwen pa t touche) |
| `npm run check:migrations` | ✅ 125 migrasyon, 0 danje |
| `npx vitest run` | ✅ **137/137** (130 avan + 7 nouvo pou `sendOne`) |
| `npx vite build` | ✅ siksè |

7 nouvo tès (`src/lib/__tests__/send-newsletter.test.ts`) kouvri: siksè, peyload egzat voye bay Resend, erè HTTP ak mesaj JSON Resend lan, erè HTTP ak kò non-JSON (prèv fiks "disturbed body" la), erè HTTP ak kò vid, erè rezo (fetch rejte), ak twonkaj yon mesaj erè twò long.

## Sa ki PA t chanje nan Faz sa a (espre)

- `BATCH_SIZE=10`, konkirans, absans throttling/retry — sa se Faz 2/3.
- Limit 3 tantativ/èdtan — Faz 4.
- `maxDuration` fonksyon serverless — Faz 5.
- Okenn paj admin pou wè `newsletter_send_log` — pa mande nan Faz 1; done yo ekziste kounye a e ka konsilte via SQL/REST admin-only pandan y ap tann yon desizyon sou si yo bezwen yon vizyèl dedye (menm jan ak `plop_api_logs` anvan `dashboard.admin.collect.tsx` te ekziste).

## Pwochen etap

Faz 1 sèlman ranpli **konpreyansyon**, li pa rezoud echèk yo. Yon fwa migrasyon an aplike epi yon vrè tès anvwa fèt, log yo ap revele pou premye fwa **egzakteman** kilès nan kòz yo (B: rate limit Resend, C: timeout, D: limit 3/èdtan, oswa F: kle envalid) ki reyèlman lakòz sa ki rapòte a — epi sa ap gide Faz 2 (`/emails/batch`) san espekilasyon.

**Pa gen okenn migrasyon aplike, pa gen okenn deplwaman, pa gen okenn commit** — ap tann konfimasyon.
