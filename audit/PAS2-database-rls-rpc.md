# PAS 2 — Database + RLS + RPC

**Estati aksè**: analiz statik SÈLMAN — 151 fichye migrasyon SQL, okenn koneksyon DB live. Tout finding runtime-behavior rete LIKELY sof kote yon lekti dirèk kòd SQL bay yon repons san anbigwite (CONFIRMED).

**Yon avètisman metodolojik onèt**: pandan pas sa a, plizyè premye pas gwo-echèl otomatik (grep/awk sou 151 fichye) te bay **fo-pozitif** akoz sentaks SQL miltip-liy ak fenèt kontèks two kout. Chak fwa, mwen te verifye MANYÈLMAN anvan m rapòte kòm yon finding — kèk ladan yo te vin disparèt apre verifikasyon (dokimante anba a kòm "verifye epi rejte").

## 1. Envantè tab

**54 tab** total (0 janm reyèlman DROP — 3 mansyon "DROP TABLE" jwenn nan kòmantè dokimantasyon sèlman, verifye pa lekti dirèk).

## 2. RLS — kouvèti jeneral

| Chèk | Rezilta | Prèv |
|---|---|---|
| Tab ki gen `ENABLE ROW LEVEL SECURITY` | **54/54** | Boucle sou tout tab, grep filtre kòmantè |
| Tab ki janm gen `DISABLE ROW LEVEL SECURITY` (reyèl, pa kòmantè) | **0** | `grep -hn "DISABLE ROW LEVEL SECURITY"` san rezilta |
| Tab ak RLS ON men 0 policy (kandida bug) | 5 jwenn, **5/5 verifye epi rezoud** | Gade §3 |
| Policy `USING (true)` (potansyèlman twò pèmisiv) | 12 okirans, **11 done piblik entansyonèl, 1 istorik korije** | Gade §4 |

## 3. Tab "zewo policy" — verifikasyon endividyèl

| Tab | Vèdik | Prèv |
|---|---|---|
| `admin_backup_codes` | **ENTANSYONÈL** — `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, aksè sèlman via 3 RPC (`generate/verify/get_status_admin_backup_codes_secure`) | [20260813100000_admin_backup_codes.sql:38-39](supabase/migrations/20260813100000_admin_backup_codes.sql#L38) |
| `admin_backup_code_state` | **ENTANSYONÈL** — menm patwon | Menm fichye, liy 63-64 |
| `platform_delivery_zones` | **ENTANSYONÈL** — sèl aksè via `private.create_order_secure` (SECURITY DEFINER, bypass RLS pa konsepsyon) | [20260816120000_nkd015_delivery_fee_config.sql](supabase/migrations/20260816120000_nkd015_delivery_fee_config.sql) |
| `platform_payout_settings` | **GRANT MÒ/KONFIZAN** (pa danjere, men initil) — gade DB-001 | — |
| `push_subscriptions` | **FO-POZITIF** — 2 policy reyèl egziste ("Users manage own push subs", "Admins can view all push subs"), gwoup otomatik mwen an te rate yo akoz sentaks CREATE POLICY sou plizyè liy | [20260703071050...sql](supabase/migrations/20260703071050_b45e82fb-88ee-4630-906c-a54ff8cce6c4.sql) |

## 4. `USING (true)` — envantè

11 okirans se done ki VLE di piblik pa konsepsyon (menu/pwodwi/avi restoran, konfigirasyon peman piblik, kategori). Sèl ka enteresan istorikman:

**`profiles`** — 3 jenerasyon:
1. `20260702234435`: "viewable by everyone" (`USING (true)`, tout moun, menм `anon`) — **koupab**
2. `20260703063224` (**pwochen jou**): restriksyone a `authenticated` sèlman, men toujou `USING (true)` — **toujou twò laj**
3. `20260703070152` (**menм jou**): "Users view own profile" — `auth.uid() = id OR has_role(admin) OR has_role(super_admin)` — **KORÈK, eta final, konfime pa okenn override apre**

**Konklizyon**: erè inisyal la te dire mwens pase 24è, epi rezoud pa ekip la menм. Eta aktyèl la **CONFIRMED byen restriksyone**.

## 5. Kolòn lajan — tip done

**0 match** pou `float`/`double precision`/`real` sou okenn kolòn ki gen non ki sanble ak lajan (amount/balance/fee/commission/price). Verifikasyon dirèk (`wallets.available_balance`, `payouts.amount`, `payout_commissions.gross/commission/net_amount`) montre `numeric(12,2)` avèk `CHECK (amount > 0)`. **CONFIRMED bon pratik.**

## 6. RPC / `SECURITY DEFINER` — `search_path`

11 fonksyon verifye MANYÈLMAN (pi kritik yo, chwazi selon itilizasyon reyèl nan kòd aplikasyon an, PAS 1):

| Fonksyon | `SECURITY` | `search_path` fikse | Chèk wòl anndan |
|---|---|---|---|
| `initiate_payout_secure` | DEFINER | ✅ | admin/super_admin + step-up STRICT |
| `complete_collect_payment_secure` | DEFINER | ✅ | (webhook-only, pa itilizatè dirèk) |
| `complete_pending_payout_secure` | DEFINER | ✅ | — |
| `fail_pending_payout_secure` | DEFINER | ✅ | — |
| `anonymize_customer_secure` | DEFINER | ✅ | admin/super_admin |
| `add_user_role_secure` | DEFINER | ✅ | step-up STRICT (dapre migrasyon) |
| `remove_user_role_secure` | DEFINER | ✅ | step-up STRICT |
| `has_role` (public) | **INVOKER** (pa konsepsyon) | ✅ | Anpeche yon itilizatè tcheke wòl yon LÒT moun sof si li menм admin |
| `check_rate_limit_secure` | DEFINER | ✅ | — |
| `check_auth_rate_limit_secure` | DEFINER | ✅ | — |
| `get_customers_admin` | DEFINER | ✅ (fo-pozitif otomatik korije) | admin/super_admin |
| `get_all_users_admin` | DEFINER | ✅ (fo-pozitif otomatik korije) | admin/super_admin + limit clamping (500 max) |

**11/11 CONFIRMED kòrèk.** Yon sweep otomatik konplè sou tout 151 fichye (fenèt 20-liy) te idantifye sèlman 2 lòt kandida ("manke search_path") — toude se `get_customers_admin`/`get_all_users_admin` yo menм, ki te deja verifye kòrèk manyèlman (fenèt 20-liy pa t ase long pou `RETURNS TABLE` ak plizyè kolòn).

**Limit**: ~140 lòt fonksyon nan baz kòd la (majorite `get_*_admin` li sèlman, dapre pwòp dokimantasyon migrasyon 20260811120000 ki site "47 admin-role-checking RPC" total) **PA VERIFYE endividyèlman** — echantiyon 11 a se sa ki pi kritik (touche lajan, wòl, done sansib), pa yon kouvèti egzospktif.

## 7. Wallets/Payouts — dwa aksè dirèk

`wallets`, `commission_ledger`, `payouts` gen **SÈLMAN yon policy SELECT** (via `payout_beneficiary_visible()`: admin/super_admin OSWA restoran/chofè pwopriyetè), **0 policy INSERT/UPDATE/DELETE** pou `authenticated`. Mitasyon balans posib SÈLMAN atravè RPC `SECURITY DEFINER` verifye. **CONFIRMED patwon "li dirèk, ekri sèlman via RPC odite" konsistan ak sa ki jwenn nan PAS 1.**

## Rezime severite PAS 2

- 🔴 0 CRITICAL
- 🟠 0 HIGH
- 🟡 0 MEDIUM
- 🔵 **1 LOW** (DB-001 — GRANT konfizan/mò, pa yon twou)
- Kouvèti RLS (54/54 tab), tip done lajan, ak chèk `search_path` sou fonksyon ki pi kritik yo — **tout CONFIRMED bon**

## Limit pas sa a (onèt)

- **Pa gen aksè `pg_policies` reyèl** — tout baze sou dènye vèsyon `CREATE POLICY` nan fichye migrasyon, sipoze yo aplike nan lòd san erè. Yon migrasyon ki echwe pou aplike sou DB reyèl la pa t ap parèt isit la.
- **~140 fonksyon `SECURITY DEFINER` PA verifye endividyèlman** (echantiyon 11 sèlman, chwazi pa risk).
- **Pa gen chèk endèks manke** (FK san endèks, kolòn filtè san endèks) — mande yon zouti EXPLAIN ANALYZE sou done reyèl, enposib san DB.
- **Pa gen tès done enkonsistan reyèl** (orphan records, doub) — mande yon requèt SELECT sou done reyèl, enposib san DB.
- Pa gen okenn tès *runtime* pou konfime yon policy vrèman blòk yon itilizatè B ki eseye li done itilizatè A — tout konklizyon baze sou lekti kondisyon SQL la, pa yon tès reyèl ak 2 kont.

---

**Èske mwen kontinye ak PAS 3 (Business logic + Peman/Wallet)?**
