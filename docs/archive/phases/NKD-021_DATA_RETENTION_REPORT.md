# NKD-021 — Otomatizasyon retansyon done

**Dat :** 19 Out 2026
**Estati :** Ekri — **PA APLIKE sou pwodiksyon, PA POUSE**, an atant tès + otorizasyon (Règ A6/A5).

## Envantè + desizyon pwopriyetè (KANPE EPI MANDE)

Konfime (Faz 11) : 0 otomatizasyon retansyon egziste, `pg_cron` pa menm parèt. Pwojè a deja gen
Vercel Cron k ap fonksyone (`vercel.json`, `CRON_SECRET`, 1 fwa/jou) — menm patran an swiv, pa yon
dezyèm mekanis.

| Kesyon                    | Repons                                          |
| ------------------------- | ----------------------------------------------- |
| `private.rate_limit_hits` | 7 jou                                           |
| `notifications`           | 90 jou                                          |
| Frekans                   | Chak jou, 4h AM — **men gade avètisman anba a** |

**Avètisman jwenn pandan ekriti a, korije anvan aplikasyon** : Vercel plan Hobby limite yon
pwojè a **2 Cron Jobs total**, pa sèlman yon frekans — pwojè a deja gen 2
(`moncash-reconcile`, `plop-reconcile`). Yon 3yèm wout dedye ta ka refize nan pwochen deplwaman
an. **Repons pwopriyetè** : konbine retansyon an nan wout `plop-reconcile` ki egziste deja a, pa
kreye yon nouvo antre `vercel.json`. Rezilta: retansyon an kounye a kouri **3h15 AM** (menm lè ak
plop-reconcile), pa 4h AM jan premye plan an te di.

## Sa ki chanje (`fichye:liy`)

| Chanjman                                                                | Fichye                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| RPC `run_data_retention_cleanup_secure()` (service_role sèlman)         | [supabase/migrations/20260819120000_nkd021_data_retention.sql](../../../supabase/migrations/20260819120000_nkd021_data_retention.sql) |
| Wrapper sèvè                                                            | [src/lib/data-retention-cleanup.server.ts](../../../src/lib/data-retention-cleanup.server.ts) (nouvo)                                 |
| Entegre nan cron `plop-reconcile` ki egziste deja a, `try/catch` separe | [src/routes/api.cron.plop-reconcile.ts](../../../src/routes/api.cron.plop-reconcile.ts)                                               |
| `/privacy` Sek 4 mete ajou (2yèm eksepsyon: notifikasyon 90 jou)        | [src/routes/privacy.tsx](../../../src/routes/privacy.tsx)                                                                             |
| Tip Supabase (`run_data_retention_cleanup_secure`)                      | [src/integrations/supabase/types.ts](../../../src/integrations/supabase/types.ts)                                                     |

**Poukisa `/privacy` pa mande yon nouvo vèsyon/re-akseptasyon (NKD-022)** : chanjman an sèlman
**ajoute** yon garanti anplis (kounye a gen otomatizasyon reyèl pou notifikasyon, kote anvan sa te
di "pa gen") — pa retire okenn dwa, pa chanje pwomès prensipal la sou `orders`/kont. Yon
klarifikasyon, pa yon reyèl chanjman politik.

**Pòte limite (menm rezònman ak NKD-020)** : `orders`/`payments`/`disputes`/`refunds`/`reviews`/
`audit_log` **pa touche ditou** pa otomatizasyon sa a — done finansye/odit rete pou tout tan
jiskaske yon efasman manyèl (NKD-020, kont kliyan sèlman) fèt.

## Tès (Règ A10)

Fichye : [docs/NKD021_DATA_RETENTION_TEST.sql](../sql-tests/NKD021_DATA_RETENTION_TEST.sql).

| Tès | Verifye                                                                            |
| --- | ---------------------------------------------------------------------------------- |
| T1  | Wòl `authenticated` rejte (`permission denied`, pa yon `RAISE` — GRANT/REVOKE pi») |
| T2  | `service_role` reyisi, `rows_deleted=1` pou `rate_limit_hits` (sèlman liy 8-jou a) |
| T3  | Eta tab la konfime: liy vye a disparèt, liy fre a rete                             |
| T4  | Menm bagay pou `notifications` (91 jou disparèt, 1 jou rete)                       |
| T5  | Dezyèm kouri: `rows_deleted=0` (idompotan, anyen ankò pou efase)                   |

**⚠️ Pa gen ankò rezilta reyèl — fichye a ekri, tès la poko kouri.**

## Pwochen etap

1. Kouri [NKD021_DATA_RETENTION_TEST.sql](../sql-tests/NKD021_DATA_RETENTION_TEST.sql), konfime rezilta a.
2. Otorizasyon eksplisit pou aplike migrasyon an.
3. `npm run verify` vèt, otorizasyon pou pouse — cron `plop-reconcile` ki mete ajou a **pa mande**
   migrasyon an aplike anvan pou l pa kraze (RPC a fèt echwe gracefully nan pwòp `try/catch` li,
   jiskaske migrasyon an aplike), men pi bon lòd rete: migrasyon anvan, kòd apre, menm konvansyon.
