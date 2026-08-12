# Rapport final — Go Live P0 : `create_collect_payment_secure`

Date : 2026-08-08 · Mission : reprise et exécution complète du Go Live, précédemment arrêté le 2026-08-07 faute de backup valide (`docs/PAYMENT_RPC_GO_LIVE_REPORT.md`).

---

## 1. Backup utilisé

`backups/full_20260808T180538Z.sql` (513 173 octets, SHA-256 `bfae517f…5b72c5868`) — produit par `scripts/backup-database.sh` après correction de son bug de résolution de chemin `/tmp` (`docs/BACKUP_EMPTY_DUMP_ROOT_CAUSE_REPORT.md`). Capture l'état de production **avant** cette migration (fonction `create_collect_payment_secure` encore à 5 paramètres, confirmé dans le dump).

## 2. Preuve de validation du backup

| Contrôle                               | Résultat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non vide                               | ✅ 513 173 octets                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Schéma + données + triggers + policies | ✅ 46 tables / 127 fonctions / 28 triggers / 67 policies / 27 lignes de données — recomptés indépendamment, identiques au rapport d'intégrité généré par le script                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| SHA-256                                | ✅ Recalculé (`sha256sum`) — identique à celui du `.report.md` généré au moment du dump : intégrité confirmée, aucune corruption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Test de restauration réel**          | ✅ **Exécuté pour de vrai** — restauré dans un Postgres 17 jetable (conteneur Docker dédié, jamais production), via `scripts/test-restore-backup.sh` lancé dans un conteneur avec `psql`. Stubs minimaux ajoutés pour les objets de plateforme Supabase non inclus dans le dump par conception (`auth.users`, `auth.uid()`, rôles `anon`/`authenticated`/`service_role`) — nécessaires uniquement parce que la cible est un Postgres nu, pas une vraie instance Supabase ; n'affecte pas la validité du dump lui-même. Résultat : restauration SQL sans erreur, `tables=46 functions=127 triggers=29 policies=67`, tous seuils dépassés. **Premier test de restauration réel et réussi de tout ce projet.** Conteneurs et réseau Docker détruits après usage. |

L'ancien fichier `backups/full_20260731T161758Z.sql` n'a **pas** été utilisé (schéma seul, 0 ligne de données, déjà disqualifié le 2026-08-05).

## 3. Migration appliquée

`supabase/migrations/20260805140000_stripe_collect_integration.sql` — **et uniquement celle-ci**. Confirmé avant application (`supabase migration list --linked`) : seule migration avec `"remote":""`, toutes les 122 précédentes déjà appliquées. Après application : 123/123 migrations synchronisées, 0 en attente.

## 4. Signature SQL avant/après

|                            | Avant                                                                              | Après                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Paramètres                 | `_payment_id, _external_reference, _status, _error, _payment_method_requested` (5) | `_payment_id, _external_reference, _status, _error, _payment_method_requested, _provider_transaction_id` (6) |
| Overloads                  | 1                                                                                  | **1** (aucune ambiguïté — confirmé via `pg_proc`)                                                            |
| `SECURITY DEFINER`         | `true`                                                                             | `true` (inchangé)                                                                                            |
| `search_path`              | `public`                                                                           | `public` (inchangé)                                                                                          |
| Owner                      | `postgres`                                                                         | `postgres` (inchangé)                                                                                        |
| Grants `EXECUTE`           | `authenticated`, `postgres`, `service_role`                                        | **identiques** (inchangés)                                                                                   |
| RLS `payment_transactions` | 2 policies (`admin read`, `own read`)                                              | **identiques**, aucune modification                                                                          |

Effets additionnels de la même migration, également vérifiés : table `stripe_api_logs` créée (1 policy admin-read), ligne `payment_provider_settings` pour `stripe` insérée avec `enabled=false` (comme prévu — clés Stripe pas encore configurées).

## 5. Vérification PostgREST

Appel reproduit avec exactement les paramètres utilisés par `initiate-collect-payment.logic.ts` (probe anonyme, sûr — la fonction refuse de toute façon tout appelant non authentifié) :

|          | Avant migration                                                         | Après migration (et re-testé après déploiement)                                                     |
| -------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Résultat | `404 PGRST202` — _"Could not find the function... in the schema cache"_ | `401` — `{"code":"42501","message":"permission denied for function create_collect_payment_secure"}` |

**PGRST202 a disparu.** L'erreur restante est une erreur métier/permission attendue et correcte (l'appelant anonyme n'a jamais eu le droit d'exécuter cette fonction — seul `authenticated` l'a) — clairement distincte d'une erreur de schema cache, conformément à la demande de la mission.

## 6. Tests transactionnels

Exécutés en une seule transaction `BEGIN; ... ROLLBACK;` (`supabase db query --linked`), en simulant un vrai client authentifié (`SET LOCAL request.jwt.claim.sub`, technique déjà établie sur ce projet) — **aucun débit réel, aucune donnée persistée** :

| Test                                                                            | Résultat                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Création d'un collect payment (6 paramètres, `_provider_transaction_id` inclus) | ✅ `status=pending`, `provider=moncash_api` (dérivé correctement de `method=moncash`)                                                                                       |
| Association payment/order                                                       | ✅ `order_id` correctement lié à la commande du paiement testé                                                                                                              |
| `_provider_transaction_id`                                                      | ✅ persisté tel quel (`p0-test-provider-ref`)                                                                                                                               |
| Comportement idempotent                                                         | ✅ une 2ᵉ tentative sur le même paiement, pendant que la 1ʳᵉ est `pending`, est rejetée avec le message métier attendu (_"Yon tantativ peman deja an kou pou kòmand sa a"_) |
| Rollback                                                                        | ✅ confirmé après coup — `SELECT count(*) ... WHERE external_reference IN (...)` → `0` ligne résiduelle                                                                     |

## 7. `npm run verify`

| Étape              | Résultat                                             |
| ------------------ | ---------------------------------------------------- |
| `typecheck`        | ✅ Aucune erreur                                     |
| `lint`             | ✅ 0 erreur (12 warnings pré-existants sans rapport) |
| `check:migrations` | ✅ 122 migrations scannées, 0 hazard non résolu      |
| `test` (vitest)    | ✅ 105/105                                           |
| `build`            | ✅ Réussi (client + SSR + service worker PWA)        |

Aucun fichier frontend/RPC-source/PaymentProvider/PLOP/Stripe/MonCash/NatCash/polling/cron modifié dans cette mission — ce `npm run verify` confirme simplement qu'aucune régression n'a été introduite par l'application de la migration (le code applicatif était déjà 100 % identique avant/après).

## 8. Vercel

|                  |                                                                                                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commit poussé    | `af20a27` (`fix(payments): apply create_collect_payment_secure P0 RPC migration`) sur `main`, scope strict : uniquement `docs/PAYMENT_RPC_FIX_REPORT.md` + `docs/PAYMENT_RPC_GO_LIVE_REPORT.md` (aucun secret, aucun fichier de backup — gitignorés de toute façon, aucun rapport temporaire hors-sujet, aucune modification étrangère au P0) |
| Déploiement      | `dpl_FNgdtfciHTa8r1R4gLZieegJTxhY`, créé ~1 min après le push, statut **Ready**                                                                                                                                                                                                                                                               |
| Alias production | `www.nkdeliveri.com` pointe vers ce déploiement (confirmé via `vercel inspect`)                                                                                                                                                                                                                                                               |
| `/checkout`      | ✅ `HTTP 200`                                                                                                                                                                                                                                                                                                                                 |
| `/`              | ✅ `HTTP 200`                                                                                                                                                                                                                                                                                                                                 |

## 9. Test en production

- PGRST202 re-testé **après déploiement**, contre l'URL Supabase de production réelle → toujours absent (même résultat 401/42501 propre qu'en § 5).
- `vercel logs` sur le nouveau déploiement : seulement les 3 requêtes de ce test (`GET /`, `GET /checkout`, health check initial), toutes `200`, **aucune nouvelle erreur RPC**.
- Aucun paiement réel initié — conforme à l'interdiction explicite de la mission.

## 10. Risques résiduels

- **Aucun backup Supabase serveur (PITR/backups physiques)** n'existe encore — seul un backup local a été validé pour ce Go Live. Recommandé : activer PITR une fois l'abonnement Supabase Pro souscrit (déjà noté comme plan de l'utilisateur).
- La cause racine du bug de dump vide (`docs/BACKUP_EMPTY_DUMP_ROOT_CAUSE_REPORT.md`) — une incohérence intermittente de traduction de chemin `/tmp` dans Git Bash/MSYS — a été corrigée dans `scripts/backup-database.sh`, mais **ce correctif reste non commité** (hors du périmètre strict de cette mission P0) ; à committer séparément.
- `stripe_auto`/`stripe` reste `enabled=false` — Kat Kredi (Stripe) n'est pas encore activable en production tant que les vraies clés API Stripe ne sont pas configurées (attendu, non bloquant pour ce P0).
- Aucune régression fonctionnelle attendue : le changement est un ajout de paramètre optionnel (`DEFAULT NULL`) sur une fonction déjà `SECURITY DEFINER` avec la même logique métier — tous les appelants existants (avec ou sans le nouveau paramètre) restent compatibles.

---

## Verdict

## 🟢 P0 RÉSOLU — GO LIVE

Toutes les phases (1 à 9) ont été validées avec preuve directe, sans dérogation ni contournement. `create_collect_payment_secure` est maintenant à la signature à 6 paramètres en production, PostgREST la sert correctement, les paiements automatiques (MonCash Otomatik, NatCash Otomatik, Kat Kredi) peuvent de nouveau enregistrer leur ligne `payment_transactions` sans `PGRST202`. Déployé et vérifié en production.
