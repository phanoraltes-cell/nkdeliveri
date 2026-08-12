# 🔐 Kòd sekou (backup codes) — dezyèm opsyon 2FA pou admin

**Dat** : 2026-08-13
**Referans** : `docs/ADMIN_ACCESS_SECURITY_AUDIT.md` / `docs/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md` (modil TOTP orijinal la), plan `breezy-soaring-sutton`.
**Estati** : Migration + kòd ekri e **verifye pa tès transaksyonèl reyèl (BEGIN/ROLLBACK) sou pwodiksyon**. `npm run verify` konplètman vèt. **Migration POKO aplike an pwodiksyon** — an atant konfimasyon eksplisit, konfòm ak règ absoli pwojè a. **Okenn commit, okenn push.**

---

## 1. Demand orijinal la

Itilizatè a te mande: nan sistèm otantifikasyon a doub fakte (2FA) pou admin, ajoute yon dezyèm posibilite pou admin ka konfime idantite li ak yon **kòd sekrè**, apa de kòd TOTP la (ki mande eskane yon QR kòd nan yon aplikasyon otantifikasyon), epi analize estrikti sit la pou pwopoze pi bon sistèm posib.

## 2. Analiz reyèl fè anvan konsepsyon (pa sipozisyon)

- **Login inisyal la pa gen okenn 2FA jodi a** — `auth.index.tsx` konekte dirèkteman apre `signInWithPassword`/`signInWithOAuth`, san okenn etap MFA. Sistèm 2FA ki egziste a se yon kouch **step-up** aplike sèlman apre login, sou aksyon sansib ak sou tablo admin (`AdminIdleLock`).
- **Pa gen enfrastrikti SMS** (`mfa_phone_enroll_enabled: false` sou pwojè Supabase a, pa gen Twilio) ni **WebAuthn/passkey** (`mfa_web_authn_enroll_enabled: false`) — tou de deja evalye e ekate nan premye chantye sekirite a (§8 nan audit orijinal la).
- **Pa gen okenn presedan** kòd sekou/PIN/OTP-pa-imèl nan tout kodbaz la.
- **`pgcrypto` konfime aktive** (`SELECT extname FROM pg_extension` → prezan, schema `extensions`), verifye an dirèk sou pwodiksyon anvan ekri migration an — pa yon sipozisyon.
- Yon kòd voye pa imèl ta pi fèb (menm bwat lèt ak kont lan, pa yon vrè faktè endepandan) e ta mande menm kantite nouvo schema san bay okenn benefis siplemantè — **kòd sekou (menm apwòch ak GitHub/Google) se chwa ki pi solid**.

## 3. Desizyon konfime ak itilizatè a (AskUserQuestion)

| Kesyon                                                                      | Desizyon                                                                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Kòd sekou ka debloke aksyon STRICT yo (wòl, dekesman, konfigirasyon peman)? | **Non — sèlman STANDARD** (revizyon/konplete ranbousman, deblokaj tablo admin). STRICT rete TOTP sèlman, san eksepsyon. |
| Jenerasyon kòd sekou mande TOTP deja aktive?                                | **Non — endepandan konplètman.** Yon admin ka jenere/itilize kòd sekou menm si li pa janm anrejistre TOTP.              |

## 4. Arkitekti

Kòd sekou plig dirèkteman nan sistèm step-up ki egziste deja a (`private.admin_step_up_status()`), kòm yon **twazyèm chemen prèv** — pa yon dezyèm sistèm paralèl:

```
private.admin_step_up_status(_max_age, _allow_fallback)
  ├── TOTP verifye + aal2 fre         → 'ok' (STANDARD ak STRICT)
  ├── Kòd sekou verifye fre           → 'ok' (STANDARD sèlman — _allow_fallback obligatwa)
  └── Sesyon fre (fallback ansyen an) → 'ok' (STANDARD sèlman)
```

## 5. Migration — `supabase/migrations/20260813100000_admin_backup_codes.sql`

### Schema

- **`public.admin_backup_codes`** — yon liy pa kòd emèt, `code_hash` (bcrypt, `extensions.crypt()`), `used_at`/`revoked_at`. Okenn grant dirèk — RPC `SECURITY DEFINER` sèlman. Append-only (`private.prevent_log_mutation()` sou DELETE/TRUNCATE, UPDATE toujou pèmèt pou `used_at`/`revoked_at`).
- **`public.admin_backup_code_state`** — yon liy pa admin, `last_verified_at` (li pa `admin_step_up_status()`), `codes_remaining`.

### RPC (SECURITY DEFINER, wòl reverifye endepandamman nan chak)

- **`generate_admin_backup_codes_secure()`** — mande step-up STANDARD, revoke ansyen kòd ki pa itilize, jenere 10 kòd (fòma `XXXXX-XXXXX`, alfabè Crockford Base32), retounen yo an klè **yon sèl fwa**.
- **`verify_admin_backup_code_secure(_code)`** — rate-limited (5 tantativ/10 min, menm mekanis ak `initiate_payout_secure`), konsome yon kòd yon sèl fwa.
- **`get_admin_backup_codes_status_secure()`** — li sèlman, jamè `code_hash`.

### Antropi ak jenerasyon

Kòd yo jenere ak `extensions.gen_random_bytes()` (pgcrypto, CSPRNG reyèl) — **pa** fonksyon `random()` plpgsql la, ki pa yon jeneratè kriptografikman sekirize. Sa te korije apre yon revizyon pandan konsepsyon an, paske sa yo se vrè sekrè otantifikasyon, pa jis yon idantifyan itilizatè entèfas.

## 6. Bug reyèl jwenn ak korije pandan tès la

Tès inisyal la te dekouvri yon pwoblèm reyèl: `verify_admin_backup_code_secure` te `RAISE EXCEPTION` sou yon move kòd. PostgREST antoure chak apèl RPC nan **yon sèl transaksyon** — yon eksepsyon anile **tout** sa apèl la te fè, ki gen ladan enkremantasyon `check_rate_limit_secure` la ki te fèt kèk moman avan nan **menm apèl la**. Rezilta: chak tantativ move kòd t ap anile pwòp limit vitès pa l, kidonk yon atakè te ka eseye kòd endefiniman san limit vitès la janm reyèlman deklannche — menm leson deja dokimante nan pwojè a pou log odit yo (`log_admin_step_up_event_secure` kòm apèl separe), aplike isit la pou rate-limiting.

**Korijaj** : `verify_admin_backup_code_secure` kounye a `RETURN false` (pa `RAISE`) pou yon move kòd/kòd deja itilize/antre malfòme — apèl la reyisi (komite), donk enkremantasyon rate-limit ki te fèt anvan an rete valab. Sèlman echèk wòl ak limit vitès depase toujou `RAISE`.

## 7. Frontend

| Fichye                                                   | Wòl                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/hooks/useBackupCodes.ts` (nouvo)                    | Menm fòm ak `useTotpFactor.ts` — `generate()`, `verify()`, estati                                                 |
| `src/routes/_authenticated/dashboard.admin.security.tsx` | Nouvo seksyon "Kòd sekou" — jenerasyon, modal "montre yon sèl fwa" ak checkbox konfimasyon, konpteur "N kòd rete" |
| `src/hooks/useReauth.ts`                                 | Nouvo mòd `"backup"`, `confirmBackup()` (satisfè `"standard"` sèlman)                                             |
| `src/components/reauth-dialog.tsx`                       | Katriyèm fòm pou antre kòd sekou, lyen switch ant TOTP/kòd sekou                                                  |
| `src/components/dashboard/admin/admin-idle-lock.tsx`     | Kòd sekou ofri kòm yon opsyon separe, endepandan de si TOTP aktive                                                |
| `src/integrations/supabase/types.ts`                     | 3 nouvo siyati RPC ajoute alfabetikman                                                                            |

## 8. Tès

### Tès transaksyonèl (BEGIN/ROLLBACK, sou pwodiksyon, via Management API)

11 asèsyon, tou de pas reyisi apre korije 2 bug (fòma hash ak rate-limit rollback — wè §6), zewo rezidi konfime apre:

1. Non-admin rejte sou tou de RPC ekriti.
2. Jenerasyon reyisi **san TOTP** (konfime pa gen prerekizit).
3. 10 kòd inik, fòma korèk, `code_hash` diferan de tout kòd an klè.
4. Verifikasyon yon kòd valid reyisi, `codes_remaining` desann.
5. Menm kòd itilize 2 fwa → `false`.
6. Kòd envalid → `false`, okenn chanjman eta.
7. Limit vitès deklannche presizeman apre 6 tantativ (pa "kòd mal").
8. `admin_step_up_status`: STANDARD `'ok'` apre kòd sekou, STRICT **pa** `'ok'` — `add_user_role_secure` toujou rejte ak `STEP_UP_REQUIRED_MFA`.
9. Rejenerasyon anile ansyen kòd yo, 10 nouvo.
10. `DELETE`/`TRUNCATE` rejte, `UPDATE` toujou pèmèt.

### `npm run verify`

✅ Vèt — typecheck, lint, `check:migrations`, **173/173 tès** (pa gen nouvo tès pi lojik ajoute — `useBackupCodes.ts` se yon wrapper fen sou `supabase.rpc()`, menm jan ak `useTotpFactor.ts` ki li menm pa gen tès dedye, lojik reyèl la se nan SQL, deja kouvri pa §8), build pwodiksyon reyisi.

## 9. Sekirite — rezime

- Frontend pa janm otorite a — chak RPC reverifye wòl endepandamman.
- STRICT rete TOTP sèlman, san eksepsyon — konfime pa tès §8.9.
- Kòd yo hash (bcrypt) e jenere ak CSPRNG reyèl (`gen_random_bytes`).
- Itilizasyon yon sèl fwa, garanti atomik (`WHERE used_at IS NULL` sou UPDATE).
- Rate-limited kont tantativ divinasyon, korije pou reyèlman efikas (§6).
- Log odit: `admin_backup_codes_generated` (kantite sèlman), `admin_backup_code_used` (kantite ki rete sèlman) — jamè kòd yo.

## 🚦 Estati

**Kòd + migration prè, tès transaksyonèl reyisi (zewo rezidi). Migration POKO aplike — an atant konfimasyon eksplisit ou anvan aplikasyon an pwodiksyon (jamè `supabase db push` otomatik). Okenn commit, okenn push efektye.**
