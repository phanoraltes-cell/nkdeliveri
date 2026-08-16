# FAZ 4 — AUTHENTICATION

**Dat** : 2026-08-14
**Metòd** : lekti kòd sous + migrasyon. Règ Seksyon A `docs/PROTOKOL_FAZ3_A_FAZ11.md` aplike (A1 okenn CLI/koneksyon dirèk, A2 KONFIME/ESTIMASYON, A3 anti-doublon, A9 pa deklare san egzekite). Okenn kòd modifye, okenn `src/routes/` touche.

---

## 0. Anti-doublon (Règ A3)

`grep -ril` sou mo-kle sesyon/JWT/forgot-password/IDOR → 9 rezilta. 2 gen kontni ki chevoche reyèlman : `docs/SECURITY_PERIMETER_AUDIT_2026-08-13.md` (rate limiting sou `/auth/forgot-password`, `check_auth_rate_limit_secure` — **VERIFIED**) ak `docs/ADMIN_ACCESS_SECURITY_AUDIT.md` (konfime flux forgot-password se Supabase estanda, `resetPasswordForEmail`/`updateUser`, anyen espesifik admin). **Site, pa re-derive.** Okenn odit konplè Authentication (sesyon/JWT/IDOR/isolasyon wòl) pa t janm fèt — pa gen doublon sou rès sa a.

---

## 1. Pote (rapèl, pa re-dekouvri)

RBAC santralize konfime deja fè byen (Faz 1) — `src/lib/auth-guard.ts`, `get_primary_role` rele 2 fwa sèlman. **Pa re-verifye isit la.**

---

## 2. Hachaj modpas

**KONFIME** : `grep -rln "bcrypt|scrypt|argon2|hashPassword|password.*hash"` sou `src/` ak `supabase/migrations/` → 0 okirans reyèl (2 fo pozitif tou de se `@block65/webcrypto-web-push` — "crypto" nan non pakè a, san rapò ak modpas). **Okenn kòd koutim pa manyen hachaj modpas** — 100% delege bay Supabase Auth (GoTrue), ki itilize bcrypt anndan li menm, envizib pou kòd aplikasyon an.

Sèl itilizasyon `crypt()` nan pwojè a se `admin_backup_codes` (`extensions.crypt(code, extensions.gen_salt('bf'))`) — kòd sekou admin, **pa** modpas kont itilizatè, deja odite (`docs/ADMIN_BACKUP_CODES_REPORT.md`).

---

## 3. Sesyon / JWT

### Kliyan (`src/integrations/supabase/client.ts:49-55`)
```
storage: localStorage, persistSession: true, autoRefreshToken: true
```
**KONFIME**. Refresh otomatik jere pa `@supabase/supabase-js` li menm (mekanis estanda, pa yon rekonstriksyon koutim).

**Nòt achitekti (pa yon finding, yon tradeoff konnen)** : `localStorage` aksesib a nenpòt script JS ki kouri sou paj la — si yon XSS te janm egziste, token yo ta vòlab. Faz 2 (§3, Injection) te konfime **0 `dangerouslySetInnerHTML`/`.innerHTML =`** nan tout `src/` — risk la mitige pa absans XSS, pa pa yon chwa stokaj altènatif (cookie `httpOnly` ta mande yon rekonstriksyon SSR-aware pi lou, pa fèt kounye a). Konsistan ak konvansyon Supabase default la, pa yon erè spesifik pwojè sa a.

### Sèvè (`src/integrations/supabase/auth-middleware.ts:34-105`)
**KONFIME** : chak apèl `createServerFn` ki mande otantifikasyon pase pa `requireSupabaseAuth`, ki egzije yon `Authorization: Bearer <JWT>` byen fòme (3 pati, separe pa `.`), epi valide l ak `supabase.auth.getClaims(token)` — metòd ki verifye siyati kriptografik **ak** ekspirasyon (`exp`) anba tè. Yon JWT ekspire oswa fo rejte anvan menm `context.userId` etabli.

### Revokasyon (session management)
**KONFIME, byen konstwi** — `src/hooks/useActiveSessions.ts` + `supabase/migrations/20260728110000_active_sessions_management.sql` :
- `get_my_active_sessions_secure()` : li `auth.sessions` **dirèkteman** (pa yon tab paralèl), `WHERE user_id = auth.uid()` — chak itilizatè wè sèlman **pwòp** sesyon li.
- `revoke_my_session_secure(_session_id)` : `DELETE FROM auth.sessions WHERE id = _session_id AND user_id = auth.uid()` — gad `AND user_id = auth.uid()` anpeche yon itilizatè revoke sesyon yon lòt moun (pa gen IDOR isit la). `DELETE` sou `auth.sessions` fè GoTrue rejte refresh token an nan pwochen itilizasyon li — vrè revokasyon, pa yon flag kosmetik.
- "Dekonekte tout lòt aparèy" : `supabase.auth.signOut({ scope: "others" })` — metòd ofisyèl SDK a, pa yon rekonstriksyon koutim.

**Limit konnen (dokimante nan pwòp migrasyon an, pa yon gap kache)** : token aksè (JWT) ki deja siyen an rete valid jiska pwòp `exp` li menm apre revokasyon sesyon an — konpòtman estanda pou nenpòt sistèm JWT san tab blocklist separe. Enpak reyèl la depann de dire `exp` (config Auth GoTrue, **pa nan fichye migrasyon**).

### Dire `exp` JWT + rotasyon/reuse detection — **KONFIME**, mizajou 2026-08-14

Verifye via Management API `GET /v1/projects/{ref}/config/auth` (lekti sèlman, otorize eksplisitteman dapre Règ A1), rezilta HTTP 200 :

```
jwt_exp: 3600
refresh_token_rotation_enabled: true
security_refresh_token_reuse_interval: 10
```

| Chèk | Rezilta | Klasifikasyon |
|---|---|---|
| Rotasyon refresh token | **aktive** (`true`) | ✅ |
| Reuse detection | **aktive** — dekoule dirèkteman de rotasyon aktive a, ak yon fenèt gras 10s pou ka konkirans/rekèt paralèl lejitim yo (konpòtman estanda GoTrue, pa yon dezaktivasyon) | ✅ |
| Dire `exp` JWT | `3600`s (1è) — **defo estanda Supabase, pa etann** | ✅ Nòt : pa `> 3600s`, donk pa gen jistifikasyon/redwiksyon nesesè |

**Konklizyon (dapre gid klasifikasyon Travay 2)** : **Rotasyon aktive + reuse detection aktive → KONFIME pwòp — fèmen.** Yon refresh token vòlè pa ka rete valid endefiniman — premye reyitilizasyon li apre rotasyon deklanche revokasyon tout fanmi tokens lan (konpòtman GoTrue estanda). **Okenn nouvo ID NKD.**

---

## 4. Rekiperasyon modpas (forgot-password)

**Site pa re-derive** (§0) : `docs/SECURITY_PERIMETER_AUDIT_2026-08-13.md` deja konfime flux la (`auth.forgot-password.tsx`/`auth.reset-password.tsx`) itilize `resetPasswordForEmail`/`updateUser` estanda Supabase, ak `check_auth_rate_limit_secure` **VERIFIED** aplike sou li. Anyen espesifik pou wòl (admin/restoran/livrè/kliyan) — menm flux pou tout moun (`docs/ADMIN_ACCESS_SECURITY_AUDIT.md:28`).

---

## 5. OTP

**Site pa re-derive** : "OTP" nan pwojè sa a se sèlman **TOTP admin step-up MFA** (`useTotpFactor.ts`, `useReauth.ts`, `admin-idle-lock.tsx`, `reauth-dialog.tsx`) + kòd sekou (`useBackupCodes.ts`) — tou de deja odite an detay pandan sesyon sa a (`docs/ADMIN_BACKUP_CODES_REPORT.md`, ak travay step-up MFA anvan). **Pa gen** OTP SMS/email pou login estanda kliyan/restoran/livrè (konfime Faz 2 : `mfa_phone_enroll_enabled: false`, pa gen Twilio). Okenn nouvo bagay pou odite isit la.

---

## 6. IDOR sou endpoint ki pran yon ID

Metodoloji : verifye RLS sou tab prensipal yo (`orders`, `deliveries`) olye eseye kouvri 117 RPC endividyèlman — RLS se dènye liy defans la kèlkeswa chemen kòd la (RPC oswa `.from()` dirèk), donk se la pwoteksyon reyèl la ye.

### `orders read` (dènye vèsyon, `20260709093000_fix_orders_deliveries_rls_recursion.sql:40+`)
**KONFIME** — 5 branch : kliyan (`customer_id = auth.uid()`), admin, pwopriyetè restoran (`r.owner_id = auth.uid()`), anplwaye restoran (`e.user_id = auth.uid() AND e.restaurant_id = orders.restaurant_id` — **byen ankre sou restoran espesifik la**, pa nenpòt restoran), ak `private.order_visible_to_driver()` pou livrè.

### `private.order_visible_to_driver` (menm fichye, liy 21-38)
**KONFIME, byen konsepsyon** — 2 ka :
1. Livrezon an deja **asiyen a menm livrè sa a espesifik** (`dr.user_id = auth.uid()`) — yon lòt livrè pa ka wè l.
2. Kòmand `ready`, **san livrezon asiyen ankò**, e itilizatè a se yon livrè `online` — sa se pisin kòmand ki disponib pou tout livrè an liy yo, **pa yon bug, se konsepsyon** (menm jan ak Uber Eats — yon moun dwe ka wè yon kòmand pou l ka reklame l).

Yon fwa yon lòt livrè reklame kòmand sa a (`claim_delivery_secure`, deja odite Faz 1/F-02), ka #2 la sispann aplike (gen deja yon `deliveries` ranje), donk sèlman livrè ki asiyen an ka toujou wè l apre sa.

### `deliveries read` (`20260721120000_order_items_deliveries_staff_driver_read.sql:37-43`)
**KONFIME** — menm modèl : admin, livrè asiyen an sèlman (`d.driver_id AND d.user_id = auth.uid()`), kliyan pwopriyetè, restoran/anplwaye pwopriyetè.

### `revoke_my_session_secure` (§3) — **KONFIME** gad `AND user_id = auth.uid()` anpeche revoke sesyon lòt moun.

**PA VERIFYE egzoustivman** : 117 RPC total — sa ki anwo a se tab ki pote done ki pi sansib (kòmand, livrezon, sesyon). Yon envantè konplè tout 117 pou chak youn ta mande yon pas separe dedye.

---

## 7. Isolasyon atravè 6 wòl yo (senaryo espesifik mande)

| Senaryo | Rezilta | Prèv |
|---|---|---|
| Yon `driver` wè kòmand yon lòt `driver` deja asiyen | **BLOKE** | `order_visible_to_driver` ka #1, ankre sou `dr.user_id = auth.uid()` |
| Yon `driver` wè pozisyon global yon lòt `driver` | **BLOKE** | Deja verifye Faz 2 §9 : `drivers.current_lat/lng` — "livrè a limenm + admin sèlman" |
| Yon `restaurant_staff` wè kòmand/done yon lòt restoran | **BLOKE** | `orders read`/`deliveries read` ankre `e.restaurant_id = orders.restaurant_id` — espesifik a restoran anplwaye a travay pou a, pa tout restoran |
| Yon itilizatè revoke sesyon yon lòt itilizatè | **BLOKE** | `revoke_my_session_secure` gad `user_id = auth.uid()` |

---

## 8. Rezime KONFIME / ESTIMASYON / PA VERIFYE

**KONFIME** :
- Okenn hachaj modpas koutim — 100% GoTrue.
- Sesyon kliyan `localStorage`, `persistSession`/`autoRefreshToken` estanda.
- Validasyon JWT sèvè a (`getClaims`) verifye siyati + ekspirasyon.
- Revokasyon sesyon reyèl (`DELETE FROM auth.sessions`), byen ankre sou pwòp itilizatè a.
- RLS `orders`/`deliveries` anpeche IDOR sou tout 4 senaryo mande yo (livrè-vs-livrè, anplwaye-vs-lòt-restoran).
- Forgot-password : rate-limited (site, pa re-derive).
- **(Ajoute 2026-08-14)** Rotasyon refresh token aktive, reuse detection aktive, JWT exp = 3600s (defo) — verifye via Management API, §3.

**ESTIMASYON** : okenn — chak KONFIME anwo a soti nan lekti dirèk kòd/migrasyon, pa yon sèl grep san kontèks.

**PA VERIFYE** :
- Envantè konplè 117 RPC pou IDOR (sa a se yon echantiyon sou tab ki pi sansib, pa 100%).

---

## 9. Kwazman ak backlog egzistan

Okenn chevochman ak NKD-001/002/003-B/004/007. Pa gen nouvo ID NKD kreye — tout sa ki jwenn se **KONFIME pozitif** (pa vilnerabilite) sof `exp` JWT la ki rete `PA VERIFYE`, pa yon finding an li menm.

---

Kanpe la. Ap tann `KONTINYE` pou Faz 5.
