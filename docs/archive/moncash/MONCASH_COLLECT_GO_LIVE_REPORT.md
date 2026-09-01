# MonCash Collect — Go Live Report

Séquence complète exécutée sans échec — migration appliquée, code
poussé sur `main`, déployé en production, vérifié en production.
Aucune étape n'a été ignorée ou contournée.

## 1. Vérifications préalables

- **Branche** : `main`
- **git status** : propre au sens fonctionnel — seuls les fichiers
  attendus du chantier Collect étaient en attente (voir §5)
- **Migrations locales** : `20260731130000_moncash_collect_payments.sql`
  confirmée comme unique migration en attente via
  `supabase migration list --linked` (`remote: ""` pour celle-ci
  seulement, toutes les précédentes déjà `local == remote`)
- **Backup** : tentative de dump frais échouée (Docker Desktop non
  démarré sur cette machine — le CLI Supabase a besoin d'un conteneur
  `pg_dump`). Backup complet valide déjà disponible :
  `backups/full_20260731T161758Z.sql` (354 Ko, 42 `CREATE TABLE`,
  intégrité vérifiée) — représentatif de l'état exact de la base, les
  scripts de validation Phase 2 exécutés entre-temps n'ayant laissé
  aucun effet permanent (confirmé par requête de contrôle post-`ROLLBACK`)

## 2. Migration appliquée

`supabase db push --linked --dry-run` a confirmé qu'une seule
migration serait poussée, puis `supabase db push --linked` l'a
appliquée sans erreur. Vérifié en direct après application :

| Élément                               | Résultat                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Table `payment_transactions`          | ✅ existe (`to_regclass` non NULL)                                                                          |
| Index                                 | ✅ 5 : `pkey`, `external_reference` (unique), `order_id`, `payment_id`, `created_at`                        |
| RLS                                   | ✅ activée, 2 policies `SELECT` (`admin read`, `own read`)                                                  |
| RPC `create_collect_payment_secure`   | ✅ existe, `authenticated`=EXECUTE oui, `service_role`=oui                                                  |
| RPC `complete_collect_payment_secure` | ✅ existe, `authenticated`=EXECUTE **non**, `service_role`=oui (conforme à la conception service_role-only) |
| Publication Realtime                  | ✅ `payments` présente aux côtés de `orders` dans `supabase_realtime`                                       |

## 3. `npm run verify`

Relancé intégralement après application de la migration :
**typecheck ✅ · lint ✅ · check:migrations ✅ · 47/47 tests ✅ · build ✅**
(exit code 0, build de production généré avec succès).

## 4. Tests fonctionnels (transactionnels, `BEGIN…ROLLBACK`, contre les vrais objets désormais appliqués)

| Test                                        | Résultat                                                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Création paiement collect                   | ✅ ligne `payment_transactions` créée, `status='pending'`, montant correct                                                                                                         |
| Webhook (`complete_collect_payment_secure`) | ✅ `payment_transactions.status='paid'` **et** `payments.status='paid'`                                                                                                            |
| Confirmation commande                       | ✅ la condition qui bloque `update_order_status_secure` (restaurant, `pending`→`confirmed`) tant qu'un paiement moncash/natcash n'est pas `paid` est levée par le paiement collect |
| Notification client/restaurant              | ✅ `trg_notify_payment_status` (existant, non modifié) déclenché — 1 notification insérée                                                                                          |
| Notification admin sur échec                | ✅ `collect_payment_admin_error` insérée deux fois (échec d'initiation + échec webhook), comme conçu                                                                               |

**Absence de régression** — vérifiée directement, pas supposée :

- Signatures RPC de `submit_payment_proof_secure`, `review_manual_payment_secure`,
  `initiate_payout_secure`, `complete_pending_payout_secure`,
  `fail_pending_payout_secure`, `create_order_secure`,
  `update_order_status_secure` : **identiques** à avant la migration.
- Triggers sur `orders`/`payments` (`trg_generate_commission_on_delivery`,
  `trg_reverse_commission_on_refund`, `trg_notify_payment_status`,
  `trg_payment_paid_confirm_order`, etc.) : **tous présents, aucun
  modifié** — la migration ne contient que des `CREATE`, aucun `ALTER`/
  `DROP` sur un objet existant.
- Effets permanents des scripts de test : **zéro**, confirmé par
  requête de contrôle après chaque `ROLLBACK`.

## 5. Commit

Un seul commit, scope strictement limité au chantier Collect (exclut
`.claude/settings.json`, `supabase/.temp/cli-latest`, et 3 documents
`docs/MONCASH_*` pré-existants sans rapport avec ce chantier, restés
non commités) :

```
commit 20aa40cc69c7a03ddf3c7a0a404b5e8b1979b585
feat(payments): add MonCash automatic collect payment
```

15 fichiers modifiés/créés (5 modifiés, 10 nouveaux) — table, 2 RPC,
webhook, page checkout, page commande, tests, rapports Phase 1/Phase 2.

## 6. Push

```
6b986bf..20aa40c  main -> main
```

Confirmé sur `github.com/phanoraltes-cell/nkdeliveri`.

## 7. Déploiement Vercel

Auto-déclenché par le push GitHub (le correctif précédent du cron
Hobby-plan, déjà en place, laisse ce déclenchement fonctionner
normalement). Confirmé via les logs de build Vercel :

```
Cloning github.com/phanoraltes-cell/nkdeliveri (Branch: main, Commit: 20aa40c)
...
Status: ● Ready — Production
```

## 8. Tests en production

| Vérification                                                                     | Résultat                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `https://www.nkdeliveri.com/`                                                    | ✅ HTTP 200                                                                                                                                                                                                                                            |
| `https://www.nkdeliveri.com/checkout`                                            | ✅ HTTP 200                                                                                                                                                                                                                                            |
| Texte "MonCash Automatik" dans le bundle client déployé (`checkout-BA90f0_5.js`) | ✅ présent (confirme que la nouvelle option de paiement a bien été livrée — la page en elle-même affiche l'état "panier vide" pour une requête `curl` sans état client, donc vérifié directement dans le bundle plutôt que dans le HTML rendu serveur) |
| `POST /api/webhooks/moncash/collect` (nouvelle route)                            | ✅ HTTP 401 — rejette correctement une requête non signée, exactement le comportement attendu                                                                                                                                                          |
| `POST /api/webhooks/moncash` (route décaissement existante)                      | ✅ HTTP 401 — inchangée, aucune régression                                                                                                                                                                                                             |

Aucun test avec de vrais identifiants MonCash (webhook réel signé,
paiement réel) n'a été possible — toujours vrai, comme documenté en
Phase 1/2 : aucun compte sandbox MonCash n'existe pour ce projet.

## 9. Risques résiduels

- **Pas de test bout-en-bout avec un vrai compte MonCash** — le
  premier paiement collect réel sera le premier test avec de vrais
  identifiants. Surveiller `payment_transactions` et les logs de
  `moncash-collect-webhook-handler.server.ts` de près après les
  premières commandes.
- **Pas de bouton "réessayer" sur `orders.$id.tsx`** pour un paiement
  collect en état `failed` — déjà noté en Phase 2, non corrigé (hors
  périmètre "ne pas modifier l'architecture sauf bug critique").
- **Format exact des webhooks MonCash non confirmé publiquement** — la
  protection replay repose sur l'idempotence du RPC (solide, testée),
  pas sur un schéma nonce/horodatage propre au fournisseur.
- **Backup pré-migration non rafraîchi au moment exact de l'application**
  (Docker indisponible) — le backup utilisé date de plus tôt le même
  jour ; risque jugé négligeable car aucun changement de schéma n'a eu
  lieu entre les deux, mais à corriger (Docker Desktop) avant la
  prochaine migration si possible.

## 10. Statut final

**GO-LIVE RÉUSSI.** Toutes les étapes complétées sans échec, aucune
étape ignorée. Le module MonCash Collect est en production, actif,
vérifié structurellement et fonctionnellement de bout en bout — seule
la vérification avec un vrai compte marchand MonCash reste à faire
lors des premières commandes réelles.
