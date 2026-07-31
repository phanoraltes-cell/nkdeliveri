# Documentation d'exploitation — Module MonCash

## Déploiement

Voir [MONCASH_DEPLOYMENT_RUNBOOK.md](./MONCASH_DEPLOYMENT_RUNBOOK.md) —
pré-déploiement, ordre exact des 5 migrations restantes, tests entre
chaque étape, contrôles post-déploiement.

## Rollback

Voir [MONCASH_ROLLBACK_PLAN.md](./MONCASH_ROLLBACK_PLAN.md) — procédure
par migration, jamais un fichier modifié après coup, toujours une
nouvelle migration qui inverse.

## Surveillance au quotidien

`/dashboard/admin/moncash` — à consulter :

- **Après chaque déploiement des migrations restantes** (voir Runbook).
- **Si une alerte apparaît en haut de la page** (bandeau ambre) —
  4 conditions surveillées automatiquement, voir tableau ci-dessous.
- **Périodiquement une fois le canal actif** — KPI "Disponiblite API"
  et "Tan repons mwayèn" comme indicateurs de santé de premier niveau.

| Alerte affichée | Condition | Action attendue |
|---|---|---|
| "Plizyè erè youn apre lòt" | 5 derniers appels API tous en erreur | Vérifier `moncash_api_logs` § erreurs — panne MonCash probable, pas nécessairement un bug local |
| "Webhook pa jwenn" | Paiement `pending` depuis >15min sans webhook portant la même référence | Le mécanisme de réconciliation (Couche 2, cron */5min) devrait le résoudre automatiquement — si l'alerte persiste après 30min, voir § Résolution d'incident |
| "Peman bloke twò lontan" | Paiement `pending` depuis >30min | Idem — après épuisement de l'échéancier 30s/2min/10min, le paiement passe en `needs_manual_review` (visible dans les logs du cron, pas encore dans l'UI — voir § Limite connue) |
| "Ogmantasyon echèk sispèk" | ≥50% des 20 derniers appels en erreur | Panne MonCash étendue ou changement d'API côté MonCash — vérifier `docs/PAYMENT_PROVIDERS.md` pour toute évolution du contrat |

**Limite connue** : `needs_manual_review` (réconciliation épuisée) n'a
pas encore de représentation dédiée dans l'UI admin — actuellement
visible uniquement dans la réponse JSON du endpoint de cron
(`GET /api/cron/moncash-reconcile`) ou en interrogeant directement
`payouts WHERE status='pending'` filtré par ancienneté. Amélioration de
suivi recommandée, hors périmètre de ce chantier de durcissement (aucune
nouvelle fonctionnalité, seulement de la préparation production).

## Résolution d'incident

### "Le canal MonCash Automatik semble actif alors qu'il ne devrait pas l'être"

```sql
SELECT is_active FROM payment_providers WHERE code = 'moncash_api';
```

Si `true` par erreur : `UPDATE payment_providers SET is_active = false
WHERE code = 'moncash_api';` — coupe immédiatement le sélecteur admin,
aucun redéploiement nécessaire (voir MONCASH_ROLLBACK_PLAN.md § Rollback
de la configuration MonCash).

### "Des paiements restent bloqués en `pending`"

1. Vérifier que le cron tourne : Vercel Dashboard → Project → Cron Jobs
   → `moncash-reconcile` — dernière exécution, code de statut.
2. Le cron tourne aujourd'hui une fois par jour (`0 3 * * *`) — plan
   Vercel Hobby confirmé ne pas supporter un intervalle plus court (voir
   MONCASH_RETRY_STRATEGY.md). Pour une réconciliation plus fréquente
   avant un upgrade Pro, prévoir un déclencheur externe.
3. Appeler manuellement `GET /api/cron/moncash-reconcile` avec
   `Authorization: Bearer <CRON_SECRET>` pour forcer une passe
   immédiate.
4. Si un paiement reste `needs_manual_review` après 3 tentatives (~13min
   d'échéancier) : vérifier son statut réel directement chez MonCash
   (portail marchand) avant toute action manuelle sur la base — ne
   jamais appeler `complete_pending_payout_secure`/
   `fail_pending_payout_secure` à la main sans confirmation externe,
   ces RPC sont `service_role`-only précisément pour empêcher une
   correction manuelle non vérifiée.

### "Fuite de secret suspectée (`MONCASH_CLIENT_SECRET`/`MONCASH_WEBHOOK_SECRET`)"

1. Régénérer immédiatement côté portail MonCash (révoque l'ancienne
   valeur).
2. Mettre à jour Vercel **avant** de considérer l'ancienne valeur
   révoquée côté MonCash — éviter une fenêtre d'indisponibilité (voir
   PAYMENT_PROVIDERS.md § Rotation).
3. Consulter `moncash_api_logs`/`audit_log` pour toute activité
   anormale sur la période concernée — le journal étant append-only
   (triggers d'immutabilité), il fait foi.

### "Le webhook MonCash répond systématiquement 401"

- Vérifier `MONCASH_WEBHOOK_SECRET` sur Vercel — un secret absent ou
  désynchronisé du portail MonCash produit exactement ce symptôme.
- Rappel : le schéma de signature (nom d'en-tête, algorithme) est une
  convention générique non confirmée par MonCash (voir
  MONCASH_WEBHOOK_SECURITY.md, constat M2) — si MonCash confirme un
  schéma différent, c'est `moncash-provider.server.ts`
  (`SIGNATURE_HEADER`, `verifySignature`) qu'il faut ajuster, pas la
  configuration.

### "Un paiement dupliqué semble avoir eu lieu"

Structurellement improbable — 3 niveaux d'idempotence indépendants (voir
MONCASH_TEST_REPORT.md § Idempotence — 3 niveaux), chacun vérifié par
test. Si suspecté malgré tout :

```sql
SELECT * FROM wallet_transactions WHERE payout_id = '<id>' ORDER BY created_at;
```

Une seule ligne par étape (`payout_pending`, puis
`payout_provider_confirmed` OU `payout_provider_failed`) est le
comportement correct — plus d'une ligne du même type indiquerait un
vrai bug à investiguer immédiatement, jamais observé dans les tests de
ce chantier.
