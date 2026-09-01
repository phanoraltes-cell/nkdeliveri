# Préparation application migrations — Rapport avant migration

## Constat principal, vérifié directement à l'instant

**Il n'y a aucune migration restante à appliquer.** Les 4 migrations
MonCash qui restaient (`110000`, `120000`, `130000`,
`20260731100000`) ont déjà été appliquées et vérifiées lors d'une
session précédente (Phase 3 du GO LIVE), **avant** la configuration du
Cron/`CRON_SECRET` — l'ordre chronologique réel a été : sauvegarde →
migrations → déploiement du code → configuration Cron, et non l'ordre
inverse. Reconfirmé par requête directe contre la base de production
il y a quelques instants, pas une réutilisation d'un résultat ancien.

Si l'intention était de préparer l'application de **nouvelles**
migrations pas encore écrites au moment de ce rapport, ce document
couvre l'état actuel (base parfaitement synchronisée avec
`supabase/migrations/`) comme point de départ — voir § Plan
d'exécution en fin de document.

---

## 1. Comparaison migrations locales vs Supabase production

| #   | Migration                                                                    | Dans le dépôt | Appliquée en production |
| --- | ---------------------------------------------------------------------------- | ------------- | ----------------------- |
| ... | (106 migrations antérieures, toutes déjà appliquées, hors périmètre MonCash) | ✅            | ✅                      |
| 103 | `20260730100000_moncash_webhook_payout_lifecycle.sql`                        | ✅            | ✅                      |
| 104 | `20260730110000_log_payment_provider_error.sql`                              | ✅            | ✅                      |
| 105 | `20260730120000_moncash_provider_notifications.sql`                          | ✅            | ✅                      |
| 106 | `20260730130000_moncash_financial_audit_log.sql`                             | ✅            | ✅                      |
| 107 | `20260731100000_revoke_anon_create_pending_payout.sql`                       | ✅            | ✅                      |

**Migrations manquantes : aucune.** `supabase/migrations/` contient 111
fichiers ; `supabase_migrations.schema_migrations` (côté production)
contient l'enregistrement de chacun d'entre eux, jusqu'au plus récent
(`20260731100000`) inclus — vérifié par requête `WHERE version >=
'20260722000000' ORDER BY version` retournant la séquence complète et
continue, sans trou.

**Ordre d'exécution** : sans objet, rien à exécuter. L'ordre qui a été
suivi lors de l'application réelle (documenté pour référence si une
future migration devait s'ajouter à cette même chaîne) :
`110000 → 120000 → 130000 → 20260731100000` — `120000` dépend de
`110000` (elle fait un `DROP FUNCTION` sur une signature à 6 arguments
qui n'existe que si `110000` a déjà tourné), les deux autres sont
indépendantes.

---

## 2. Vérification technique par migration (reconfirmée aujourd'hui)

| Élément               | Vérifié                                                 | Résultat                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables créées         | `moncash_api_logs`                                      | 1 table, 9 colonnes attendues, présente                                                                                                                                                                                                                                             |
| RPC modifiées         | `create/complete/fail_pending_payout_secure`            | Corps réel relu (`pg_proc.prosrc`) : les 3 utilisent `private.notify_secure`, zéro `INSERT INTO notifications` direct restant                                                                                                                                                       |
| RPC créée             | `log_payment_provider_error_secure`                     | 7 arguments (`_code` inclus), une seule définition (pas de surcharge orpheline)                                                                                                                                                                                                     |
| Triggers              | 4 triggers d'immutabilité                               | Présents (`moncash_api_logs_no_update_delete`, `_no_truncate`, `moncash_webhook_events_no_delete`, `_no_truncate`) — **comportement déjà testé fonctionnellement** (DELETE/UPDATE réellement tentés et bloqués dans une transaction repliée, voir MONCASH_GO_LIVE_PHASE3_REPORT.md) |
| RLS                   | `moncash_api_logs admin read`                           | Policy présente, lecture admin uniquement                                                                                                                                                                                                                                           |
| Index                 | 8 index sur `moncash_api_logs`/`moncash_webhook_events` | Tous présents                                                                                                                                                                                                                                                                       |
| Dépendances           | `120000` → `110000`                                     | Ordre respecté lors de l'application réelle, aucune anomalie                                                                                                                                                                                                                        |
| Correctif sécurité R1 | `create_pending_payout_secure` grants                   | `anon` absent, `authenticated`/`postgres`/`service_role` présents — reconfirmé à l'instant                                                                                                                                                                                          |

---

## 3. Vérifications de sécurité des données — reconfirmées à l'instant

| Contrôle demandé                          | Résultat vérifié                                                                                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aucune suppression de données             | Les 4 migrations sont additives (nouvelles tables/fonctions/triggers) ou des remplacements de **corps** de fonction (`CREATE OR REPLACE`, signature inchangée) — aucun `DROP TABLE`, `DROP COLUMN`, ni `DELETE` dans leur contenu (relu) |
| Wallets non modifiés dangereusement       | `wallets` : 9 colonnes (structure inchangée), 0 ligne — aucune migration MonCash ne touche cette table                                                                                                                                   |
| Paiements manuels MonCash/NatCash intacts | `initiate_payout_secure`, `confirm_payout_secure`, `dispute_payout_secure`, `resolve_payout_dispute_secure` : les 4 présentes, grants identiques à avant tout le chantier MonCash                                                        |
| Notifications existantes non cassées      | 19 lignes dans `notifications`, inchangé ; le moteur `private.notify_secure` lui-même n'a jamais été modifié par ce chantier — seuls de nouveaux appelants l'utilisent                                                                   |

---

## 4. Plan d'exécution

**Rien à exécuter aujourd'hui** — l'état cible (base alignée avec
`main`) est déjà atteint. Si de nouvelles migrations sont écrites à
l'avenir, la procédure déjà établie et éprouvée reste :

1. Sauvegarde fraîche (`bash scripts/backup-database.sh`, nécessite
   Docker — indisponible dans cet environnement, à exécuter depuis un
   poste qui le supporte).
2. Isoler chaque migration (déplacer temporairement les suivantes hors
   de `supabase/migrations/`), `supabase db push --linked --dry-run`
   puis application réelle, une par une.
3. Vérification post-migration systématique : existence + comportement
   réel (pas seulement la présence) des tables/RPC/triggers/RLS/index
   créés ou modifiés, plus un contrôle de non-régression sur les
   données existantes (comptages avant/après).
4. Régénération de `src/integrations/supabase/types.ts` +
   `npm run verify` complet.

Comme toujours dans ce projet : aucune migration n'est appliquée
automatiquement sans confirmation explicite au moment de l'exécuter.
