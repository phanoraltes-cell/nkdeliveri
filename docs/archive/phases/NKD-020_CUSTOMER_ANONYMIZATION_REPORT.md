# NKD-020 — Chemen efasman done pou kliyan

**Dat :** 19 Out 2026
**Estati :** Ekri, `npm run verify` an kou — **PA APLIKE sou pwodiksyon, PA POUSE**, an atant tès + otorizasyon eksplisit (Règ A6/A5).

## Envantè (verifye dirèkteman nan schema a, pa sipozisyon)

Yon **DELETE fizik** sou `auth.users` deja **enposib** jodi a pou nenpòt kliyan ki gen omwen yon
kòmand — `orders.customer_id REFERENCES auth.users(id) ON DELETE RESTRICT`
([20260703060847...sql:28](../../../supabase/migrations/20260703060847_6d01f247-de40-48c1-bbca-c99b5da19b3e.sql)).
Menm bagay pou `payment_proofs.uploaded_by`, `payments.reviewed_by`, `disputes.author_id/
resolved_by/assigned_to`, `refunds.reviewed_by` (pa gen `ON DELETE` ditou = RESTRICT pa defo).
Kèk lòt tab (`disputes.customer_id`, `refunds.customer_id`, `reviews.customer_id` CASCADE ;
`drivers.user_id` CASCADE → `deliveries.driver_id`/`reviews.driver_id` SET NULL an kaskad) ta
**efase/pèdi istwa litij/ranbousman/avi/"kilès ki te livre"** san lès si RESTRICT pa t deja bloke
operasyon an nan premye pa a.

## Desizyon pwopriyetè (KANPE EPI MANDE)

| Kesyon | Repons |
|---|---|
| Apwòch | **Anonimizasyon**, pa DELETE fizik |
| Pòte | Kont **kliyan sèlman** (wòl 'customer', san okenn lòt wòl) |
| Deklanchman | **Zouti admin sèlman** — match /privacy Sek 6 (NKD-022) ki deja pwomèt yon pwosesis manyèl |
| Done istorik (`orders.delivery_address`/`contact_phone`, `payments.sender_*`) | **Rete jan yo ye** — rezon kontabilite/legal/rezoud litij |

## Sa ki chanje (`fichye:liy`)

| Chanjman | Fichye |
|---|---|
| `profiles.anonymized_at`/`anonymized_by`, RPC `anonymize_customer_secure()`, `get_all_users_admin()` mete ajou (kolòn `anonymized_at`) | [supabase/migrations/20260819100000_nkd020_customer_anonymization.sql](../../../supabase/migrations/20260819100000_nkd020_customer_anonymization.sql) |
| Sèvè fonksyon `anonymizeCustomerAccount` — RPC (scrub `profiles`/`addresses`/`favorites`/`push_subscriptions`) + Admin API (ban 100 lane, imèl ranplase, `raw_user_meta_data` efase) | [src/lib/manage-user.functions.ts](../../../src/lib/manage-user.functions.ts) |
| Bouton "Anonimize" (sèlman pou kont ki gen SÈLMAN wòl kliyan, pa gen deja anonimize), badj "Anonimize" apre | [src/routes/_authenticated/dashboard.admin.users.tsx](../../../src/routes/_authenticated/dashboard.admin.users.tsx) |
| Tip Supabase (`profiles`, `anonymize_customer_secure`, `get_all_users_admin`) | [src/integrations/supabase/types.ts](../../../src/integrations/supabase/types.ts) |

### Detay operasyon an (2 etap, tou de obligatwa)

1. **`anonymize_customer_secure()`** (schema `public`, STRICT step-up — menm nivo ak chanjman wòl) :
   efase non/telefòn/adrès/foto nan `profiles`, efase kontni `addresses`, efase liy `favorites`/
   `push_subscriptions` antye, netwaye tout ka GPS ki ta rete (ra, deja efase otomatikman lè yon
   livrezon fini — NKD-022). **`orders`/`payments`/`disputes`/`refunds`/`reviews` pa touche ditou.**
2. **Admin API** (`supabaseAdmin.auth.admin.updateUserById`) : bloke koneksyon pou tout tan (100
   lane, menm konvansyon ak `suspendUserAccount`), ranplase imèl la (`deleted-<id>@nkdeliveri.
   invalid`) pou l sispann idantifye moun nan e libere adrès orijinal la, **efase
   `raw_user_meta_data`** — done siyati orijinal la (non/telefòn/adrès ki te antre nan fòm
   enskripsyon an) rete kache la si etap sa a pa fèt.

**Poukisa de etap separe (pa yon sèl RPC SQL)** : done GoTrue (`auth.users`) dwe pase pa Admin
API a, menm konvansyon ak `suspendUserAccount`/`reactivateUserAccount` ki deja egziste nan menm
fichye a — pa gen okenn operasyon k ap modifye `auth.users` dirèkteman nan SQL nan tout pwojè a.

## Tès (Règ A10)

Fichye : [docs/NKD020_CUSTOMER_ANONYMIZATION_TEST.sql](../sql-tests/NKD020_CUSTOMER_ANONYMIZATION_TEST.sql).
Kontrèman ak NKD-022 (kote STANDARD tier te fasil simile), STRICT tier mande yon vre `aal2` +
yon faktè TOTP verifye — tès la simile toude (yon ranje `auth.mfa_factors` + reklamasyon JWT
`aal:aal2`) pou egzèse **chemen siksè a tou**, pa sèlman rejè yo.

| Tès | Verifye |
|---|---|
| T1 | Kliyan (pa admin) rejte — `Forbidden` |
| T2 | Admin san step-up STRICT fre rejte — `STEP_UP_REQUIRED_MFA` |
| T3 | Kont mikst (kliyan+livrè) rejte, menm ak step-up fre |
| T4 | Admin pa ka anonimize pwòp tèt li |
| T5 | **Siksè** : `profiles` netwaye (non/telefòn/adrès/foto), `anonymized_at`/`anonymized_by` ranpli |
| T6 | `addresses` netwaye tou |
| T7 | Done istorik nan `orders` (adrès/telefòn) rete **entak** |
| T8 | Doub anonimizasyon rejte |
| T9 | `get_all_users_admin()` retounen `anonymized_at` kòrèkteman |

**⚠️ Pa gen ankò rezilta reyèl — fichye a ekri, tès la poko kouri.**

## Kontwòl siplemantè

- `npm run verify` (typecheck/lint/check:migrations/test/build) — **vèt, exit code 0 konfime**
  (verifye 3 fwa dirèkteman ak `$?`, pa konfyans nan rezime otomatik ki te bay yon fo "exit 0"
  yon fwa pandan yon erè TypeScript te reyèlman prezan).
- De pwoblèm reyèl jwenn e korije pandan pwosesis la, tou de anvan yo rive nan koday final la :
  1. Erè TypeScript (`_reason: data.reason ?? null` pa t satisfè `string | undefined`).
  2. **Erè build ki pa gen rapò ak NKD-020** : `npm run build` t ap echwe net paske
     `hero-livreur.png` (3.68 MB, apre de ekstansyon canvas ki fèt pi bonè sesyon sa a pou rezoud
     chevochman foto a) depase limit precache Workbox la (2 MiB pa defo). Korije nan
     [vite.config.ts](../../../vite.config.ts) (`globIgnores`) — menm konvansyon ak lòt gwo imaj ki deja
     egzante (Mockup.png, scooter.png) : imaj la rete disponib nòmalman (chaje eagerly kòm avan,
     WebP la se sa 99% moun resevwa), sèlman pa precache pa SW a alavans — CacheFirst runtime rule
     nan `src/sw.ts` pran l nan cache la premye fwa li reyèlman mande.
- Pòte limite eksplisitteman aplike ni nan RPC a (server-side, sekirite reyèl) ni nan UI a (bouton
  parèt sèlman pou kont ki gen sèlman wòl kliyan) — de kouch, pa youn sèlman.

## Pwochen etap

1. Kouri [NKD020_CUSTOMER_ANONYMIZATION_TEST.sql](../sql-tests/NKD020_CUSTOMER_ANONYMIZATION_TEST.sql) nan SQL
   Editor, konfime rezilta a (T1-T9).
2. Otorizasyon eksplisit pou aplike migrasyon an sou pwodiksyon.
3. Backfill `schema_migrations` deja ladan menm skript la (Règ A11).
4. `npm run verify` vèt konfime, otorizasyon pou pouse — **apre** migrasyon an aplike (menm lòd
   deplwaman ak chak tikè anvan sa a, paske frontend la (`manage-user.functions.ts`) rele
   `anonymize_customer_secure` ki pa egziste jiskaske migrasyon an aplike).
