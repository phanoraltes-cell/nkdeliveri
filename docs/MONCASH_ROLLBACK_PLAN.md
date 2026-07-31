# Plan de rollback — Module MonCash

Suit la stratégie déjà établie dans
[MIGRATIONS.md § Procédure — rollback](./MIGRATIONS.md#procédure--rollback) :
**jamais modifier ou supprimer un fichier de migration déjà mergé sur
`main`** — un rollback de schéma s'écrit toujours comme une **nouvelle**
migration qui inverse le changement. L'historique reste un journal
linéaire et véridique de ce qui a réellement tourné en production.

## Rollback par migration

### `20260730110000` — `log_payment_provider_error_secure`

- **Impact** : ajout pur d'une fonction. Aucune donnée créée par cette
  fonction n'est ailleurs que dans `audit_log` (table déjà existante,
  déjà utilisée par des dizaines d'autres évènements).
- **Procédure de rollback** : nouvelle migration —
  ```sql
  DROP FUNCTION IF EXISTS public.log_payment_provider_error_secure(text, text, uuid, uuid, numeric, text, text);
  ```
  (signature à 7 arguments si le rollback intervient après Migration 2 ;
  à 6 arguments si intervient juste après celle-ci et avant Migration 2 —
  vérifier `pg_get_function_identity_arguments` avant d'écrire le `DROP`).
- **Données à restaurer** : aucune. Les lignes déjà écrites dans
  `audit_log` par cette fonction avant le rollback restent en place —
  elles sont un historique légitime, pas une corruption.
- **Risque du rollback lui-même** : aucun appelant vivant sauf le
  chemin d'échec synchrone de `initiate-provider-payout.functions.ts`
  (le seul réellement atteignable aujourd'hui) — après rollback, ce
  chemin échouerait à journaliser l'erreur (`console.warn`, jamais
  bloquant pour la réponse à l'utilisateur, voir le code de
  `logProviderError`) plutôt que de planter. Dégradation silencieuse
  acceptable, pas une régression fonctionnelle visible.

### `20260730120000` — notify_secure + `log_payment_provider_error_secure` +1 paramètre

- **Impact** : remplace le **corps** de 3 fonctions déjà en production
  (`create/complete/fail_pending_payout_secure`) et la signature de
  `log_payment_provider_error_secure`. C'est la migration la plus
  délicate à annuler — pas un simple `DROP`, ces 3 fonctions doivent
  continuer d'exister (elles portent tout le cycle de vie asynchrone).
- **Procédure de rollback** : nouvelle migration réappliquant le corps
  *exact* de la version `20260730100000` pour les 3 fonctions
  (`CREATE OR REPLACE`, signature inchangée donc pas de `DROP`
  nécessaire pour celles-ci) — copier-coller le corps original de ce
  fichier, disponible dans l'historique Git
  (`git show 20260730100000_moncash_webhook_payout_lifecycle.sql`).
  Pour `log_payment_provider_error_secure`, `DROP FUNCTION` de la
  version à 7 arguments puis `CREATE FUNCTION` de la version à 6
  (celle de `20260730110000`).
- **Données à restaurer** : aucune perte de données — les notifications
  déjà créées via `private.notify_secure` avant le rollback restent
  valides (même table `notifications`, mêmes colonnes). Seul le
  **mécanisme d'écriture futur** revient à l'ancien (`INSERT` brut).
- **Risque du rollback lui-même** : si des lignes `payouts` avec
  `status='pending'` existent au moment du rollback (peu probable —
  aucun appelant vivant aujourd'hui, mais à vérifier :
  `SELECT count(*) FROM payouts WHERE status='pending';` avant
  d'agir), leur confirmation/échec ultérieur utilisera le comportement
  restauré (notification simple, sans le fan-out admin ajouté par cette
  migration) — cohérent, pas une corruption, juste une perte de
  fonctionnalité temporaire le temps de recorriger.

### `20260730130000` — `moncash_api_logs` + triggers d'immutabilité

- **Impact** : ajoute une table et 4 triggers. La table
  `moncash_webhook_events` (préexistante) gagne 2 triggers bloquant
  `DELETE`/`TRUNCATE`.
- **Procédure de rollback** : nouvelle migration —
  ```sql
  DROP TRIGGER IF EXISTS moncash_webhook_events_no_delete ON public.moncash_webhook_events;
  DROP TRIGGER IF EXISTS moncash_webhook_events_no_truncate ON public.moncash_webhook_events;
  DROP TABLE IF EXISTS public.moncash_api_logs;
  -- private.prevent_log_mutation() : laissé en place (fonction générique,
  -- inoffensive si plus rien ne l'utilise) sauf si un rollback complet
  -- de la fonction elle-même est explicitement souhaité.
  ```
- **Données à restaurer** : **perte définitive** de tout ce qui a été
  journalisé dans `moncash_api_logs` depuis son activation — c'est
  pourquoi une sauvegarde (`npm run db:backup`) avant ce rollback est
  **obligatoire** si la table contient des lignes au moment de la
  décision (contrairement aux deux migrations précédentes, ici il y a
  une vraie perte possible).
- **Risque du rollback lui-même** : `moncash-client.server.ts`
  continuerait d'essayer d'écrire vers `moncash_api_logs` après ce
  rollback (le code applicatif n'a pas changé) — chaque tentative
  échouerait proprement (`console.warn`, voir
  docs/MONCASH_FINANCIAL_AUDIT.md § Limite connue), jamais bloquant pour
  un paiement réel. Dégradation silencieuse acceptable en urgence,
  à corriger rapidement (redéployer le code sans l'appel, ou
  réappliquer la migration).

### `20260731100000` — Correctif R1 (`REVOKE ... FROM anon`)

- **Impact** : retire un privilège. Réversible trivialement.
- **Procédure de rollback** :
  ```sql
  GRANT EXECUTE ON FUNCTION public.create_pending_payout_secure(uuid, uuid, numeric, text, text, text, text) TO anon;
  ```
- **Données à restaurer** : aucune.
- **Risque du rollback lui-même** : réintroduit le gap R1 documenté
  dans l'audit — aucune raison légitime de le faire.

## Rollback des Edge Functions

**Non applicable.** Ce projet n'a aucune Supabase Edge Function
(`supabase/functions/` n'existe pas) — toute la logique serveur MonCash
vit dans des fonctions serveur TanStack Start déployées comme fonctions
Vercel. Leur "rollback" suit le mécanisme standard de Vercel : revenir
au déploiement précédent (Vercel Dashboard → Deployments →
"Promote to Production" sur le déploiement antérieur), aucune procédure
spécifique à MonCash à documenter au-delà de ça.

## Rollback des variables d'environnement

Aucune des 4 migrations ci-dessus n'introduit de nouvelle variable
d'environnement — rien à rollback à ce niveau pour ce déploiement
spécifique.

**Si le canal MonCash Automatik avait été activé séparément** (5
variables `MONCASH_*` + `payment_providers.moncash_api.is_active=true`,
voir PAYMENT_PROVIDERS.md) et devait être désactivé en urgence :

1. `UPDATE public.payment_providers SET is_active = false WHERE code = 'moncash_api';`
   — coupe immédiatement le sélecteur admin, sans toucher aux secrets.
   **C'est le geste d'urgence à privilégier**, réversible en une ligne,
   sans redéploiement.
2. Retirer les 5 variables `MONCASH_*` de Vercel (Project Settings →
   Environment Variables) seulement si une rotation de secret est aussi
   nécessaire (fuite suspectée) — sinon, l'étape 1 seule suffit et évite
   un redéploiement complet.

## Rollback de la configuration MonCash (au sens large)

- **`payment_providers.moncash_api.is_active`** : un simple `UPDATE`
  (ci-dessus), pas une migration — c'est une donnée, pas un schéma.
- **Le sélecteur de canal** (`payout-pay-modal.tsx`) : n'a pas besoin de
  rollback de code — il respecte déjà `is_active` dynamiquement (l'option
  redevient grisée "byento" dès que le flag repasse à `false`, sans
  redéploiement).

## Critère de sortie d'incident

Dans tous les cas, avant de considérer un rollback terminé :

- `npm run check:migrations` repasse au vert.
- `npx supabase db query --linked "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1;"`
  reflète la version réellement voulue.
- Les contrôles "Après déploiement" du
  [Runbook](./MONCASH_DEPLOYMENT_RUNBOOK.md#après-déploiement--contrôles)
  repassent tous au vert.
- Le canal manuel (MonCash Manyèl / NatCash Manyèl) fonctionne de bout
  en bout — critère non négociable, quel que soit l'incident en cours.
