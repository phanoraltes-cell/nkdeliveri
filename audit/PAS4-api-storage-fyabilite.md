# PAS 4 — API + Storage + Fyabilite

**Estati aksè**: analiz statik (kòd + migrasyon SQL). Pa gen tès reyèl upload/API.

## Storage — envantè 9 bucket

| Bucket                   | Piblik     | Limit gwosè         | MIME allowlist     | Istwa                                                                                                        |
| ------------------------ | ---------- | ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `menu-photos`            | ✅         | 5MB                 | jpeg/png/webp      | Limit ajoute retwoaktivman ([20260713120000](supabase/migrations/20260713120000_secure_storage_buckets.sql)) |
| `restaurant-assets`      | ✅         | 5MB                 | jpeg/png/webp      | Menm                                                                                                         |
| `avatars`                | ✅         | 3MB                 | jpeg/png/webp      | Menm                                                                                                         |
| `driver-documents`       | ❌ (prive) | 8MB                 | jpeg/png/webp/pdf  | Menm — done idantite chofè                                                                                   |
| `payment-proofs`         | ❌ (prive) | 8MB                 | jpeg/png/webp/pdf  | Menm                                                                                                         |
| `payout-proofs`          | ❌ (prive) | 8MB                 | jpeg/png/webp/pdf  | Limit depi kreyasyon                                                                                         |
| `dispute-attachments`    | ❌ (prive) | 8MB                 | jpeg/png/webp/pdf  | Limit depi kreyasyon                                                                                         |
| `order-chat-attachments` | ❌ (prive) | 8MB                 | jpeg/png/webp/heic | Limit depi kreyasyon                                                                                         |
| `ads-media`              | ✅         | 50MB (yon sèl valè) | imaj+videyo        | Gade API-001                                                                                                 |

**Istwa enpòtan**: 5 premye bucket yo te kreye SAN `file_size_limit`/`allowed_mime_types` (okenn limit motè-Storage pou tout aplikasyon an nan premye 10 jou yo). Ekip la menм te jwenn sa ("Security remediation Phase 1, item 2") epi korije l retwoaktivman ak `UPDATE storage.buckets`, sinkwonize ak `src/lib/file-validation.ts` (menм limit yo, dokimante kòm "single source of truth" pou UI a, otorite reyèl la se motè Storage a). **CONFIRMED korije, eta aktyèl la bon.**

## Kontwòl aksè fichye (RLS `storage.objects`)

- **Izolasyon dosye pa itilizatè**: `payment-proofs` itilize `(storage.foldername(name))[1] = auth.uid()::text` — chak itilizatè ka ekri/li sèlman anba pwòp dosye ID li. Paske Supabase Storage se yon object store (kle opak, pa yon vrè sistèm fichye), yon sekans `../` nan non fichye a **pa ka "chape" nan yon lòt dosye** — li ta jis fè pati kle a literalman, ki toujou dwe kòmanse ak menм prefiks `auth.uid()` a pou pase chèk la. **CONFIRMED san risk path-traversal reyèl.**
- **Bug istorik jwenn e korije**: `driver-documents`/`restaurant-assets` te sèlman tcheke `has_role('admin')`, kite yon kont `super_admin`-sèlman (san wòl 'admin' separe) BLOKE de reviz dokiman chofè — [20260706150555_fix_super_admin_storage_gap.sql](supabase/migrations/20260706150555_fix_super_admin_storage_gap.sql). Sa se yon bug "twò restriksyone" (fonksyonalite kase), pa yon twou sekirite — **korije, konfime.**
- Sanitizasyon non fichye kliyan-side (`sanitizeFileName` nan `storage-upload.ts`) — retire separatè chemen ak karaktè danjere anvan yo rive nan chemen an, kòm yon dezyèm kouch pwoteksyon (pa sèl la, RLS se vrè fwontyè a).

## 🔵 API-001 — `ads-media`: yon sèl limit 50MB pou imaj+videyo

Motè Storage a aksepte imaj jiska 50MB (limit reyèl aplikasyon an vle se 5MB pou imaj) — sèl kontwòl 5MB la se kliyan-side, kontounab. Ekip la deja rekonèt sa nan pwòp kòmantè kòd yo. Enpak: kou depo/bann pasan, pa yon konpwomi sekirite (aksè ekri sipoze limite a admin).

## 🔵 API-002 — `/api/csp-report` san rate-limit

Andpoint piblik san sesyon, san limit kantite requèt (sèlman yon limit gwosè kò 20KB). Chak "vyolasyon valid" deklanche yon evènman Sentry — yon inondasyon requèt ta ka gaspiye quota Sentry/bri log san yon vrè risk done.

## API — jesyon erè

`grep` sou tout wout API/server functions pou `.stack`/`err.stack`: **0 match** — okenn stack trace voye nan yon repons. Mesaj erè yo (`throw new Error(x.message)`) toujou soti nan mesaj RPC PostgreSQL kastonize an Kreyòl (ex: "Balans disponib la pa ase", "Forbidden"), pa detay entèn SQL/schema. **CONFIRMED bon pratik**, verifye sou echantiyon deja li nan PAS 1/3 (webhook handlers, manage-user, initiate-provider-payout).

## Fyabilite — deja kouvri an detay nan PAS 1/3

Idempotans (kòmand, webhook, refund) deja verifye an pwofondè — gade `audit/PAS3-business-logic-peman.md`. Pa repete isit la.

## Rezime severite PAS 4

- 🔴 0 CRITICAL / 🟠 0 HIGH / 🟡 0 MEDIUM
- 🔵 **2 LOW** (API-001, API-002)
- Storage bucket limits, izolasyon dosye pa itilizatè, ak absans stack-trace leak — **tout CONFIRMED bon**

## Limit pas sa a (onèt)

- RLS `storage.objects` pou `ads-media`, `menu-photos`, `restaurant-assets`, `avatars`, `dispute-attachments`, `order-chat-attachments`, `payout-proofs` **PA tout verifye endividyèlman** (sèl `payment-proofs`/`driver-documents` verifye an detay).
- Pa gen tès reyèl upload (mande yon anviwònman aktif).
- Timeout/retry nivo rezo (fetch/XHR) pa revize an detay pou chak apèl API — sèl `storage-upload.ts` gen yon `AbortSignal` eksplisit.

---

**Èske mwen kontinye ak PAS 5 (Achitekti kòd + Pèfòmans)?**
