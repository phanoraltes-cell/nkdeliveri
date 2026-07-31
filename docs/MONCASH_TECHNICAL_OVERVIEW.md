# Documentation technique — Module MonCash

Vue d'ensemble et index. Chaque sujet a son propre document détaillé —
celui-ci relie l'architecture et pointe vers le bon endroit plutôt que
de dupliquer un contenu déjà écrit ailleurs.

## Architecture en une image

```
                    payout-pay-modal.tsx (UI admin)
                    Kanal peman : MonCash Automatik /
                    MonCash Manyèl / NatCash Manyèl
                              │
              ┌───────────────┴───────────────┐
     providerCode==="manual"          providerCode==="moncash_api"
              │                                │
   initiate_payout_secure          initiate-provider-payout.functions.ts
   (RPC, chemin manuel,                        │
    inchangé depuis toujours)      getPaymentProvider("moncash_api")
                                               │
                                    moncashProvider (moncash-provider.server.ts)
                                    direction:"disburse" → toujours refusé
                                               │
                                    moncash-client.server.ts
                                    (OAuth2, CreatePayment, Retrieve*,
                                     retry, timeout, journalisation)
                                               │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                    moncash_api_logs   create_pending_payout_secure   (Couche 2)
                    (odit complet)     complete/fail_pending_         moncash-reconcile.server.ts
                                       payout_secure                  (cron */5min, backoff
                                               │                       30s/2min/10min)
                                    private.notify_secure
                                    (bénéficiaire + admin)
                                               │
                                    POST /api/webhooks/moncash
                                    (moncash-webhook-handler.server.ts,
                                     signature + idempotence)
```

## Index des documents

### Provider MonCash

- [PAYMENT_PROVIDERS.md](./PAYMENT_PROVIDERS.md) — l'abstraction
  `PaymentProvider`, le connecteur HTTP, la gestion des secrets, le
  cycle de vie asynchrone `pending`→`paid`/`failed`, le tableau des 3
  canaux (MonCash Automatik/Manyèl, NatCash Manyèl).

### Webhooks

- [MONCASH_WEBHOOK_SECURITY.md](./MONCASH_WEBHOOK_SECURITY.md) —
  vérification de signature, idempotence, autorisation, rapport de
  sécurité dédié (score, constats classés).

### Monitoring

- `/dashboard/admin/moncash` — statut, historique, erreurs, journal
  d'appels API, KPI (paiements réussis/échoués/en attente, timeout,
  retries, webhooks reçus/rejetés, erreurs API, temps de réponse
  moyen, disponibilité), alertes automatiques (erreurs consécutives,
  webhook manquant, paiement bloqué, taux d'échec anormal).
- [MONCASH_FINANCIAL_AUDIT.md](./MONCASH_FINANCIAL_AUDIT.md) — le
  journal d'audit sous-jacent (`moncash_api_logs`), append-only,
  sanitization des secrets.

### Retry

- [MONCASH_RETRY_STRATEGY.md](./MONCASH_RETRY_STRATEGY.md) — les 2
  couches (retry immédiat dans `moncash-client.server.ts`,
  réconciliation à long horizon via `moncash-reconcile.server.ts` +
  Vercel Cron).

### Variables d'environnement

- [PAYMENT_PROVIDERS.md § Gestion des secrets MonCash](./PAYMENT_PROVIDERS.md#gestion-des-secrets-moncash)
  — les 5 `MONCASH_*`.
- [MONCASH_ENVIRONMENTS.md](./MONCASH_ENVIRONMENTS.md) — sandbox vs
  production, aucun changement de code requis.
- `.env.example` — `CRON_SECRET` (nouveau, protège le endpoint de
  réconciliation).

### Sécurité et audit

- [MONCASH_PRODUCTION_READINESS_AUDIT.md](./MONCASH_PRODUCTION_READINESS_AUDIT.md)
  — audit complet (Phase 1+2), risques classés, validation des 5
  migrations.
- [MONCASH_SECRETS_AUDIT.md](./MONCASH_SECRETS_AUDIT.md) — vérification
  ciblée des secrets (Git, Vercel, local, logs, notifications, bundle
  client).

### Tests

- [MONCASH_TEST_REPORT.md](./MONCASH_TEST_REPORT.md) — campagne
  initiale (32 tests unitaires + tests transactionnels contre le vrai
  schéma).
- [MONCASH_RESILIENCE_REPORT.md](./MONCASH_RESILIENCE_REPORT.md) — les
  10 scénarios de résilience + non-régression (paiements manuels,
  wallets, notifications, dashboard).
- [MONCASH_PERFORMANCE_REPORT.md](./MONCASH_PERFORMANCE_REPORT.md) —
  requêtes, index, taille de bundle.

### Exploitation

- [MONCASH_DEPLOYMENT_RUNBOOK.md](./MONCASH_DEPLOYMENT_RUNBOOK.md) —
  checklist de pré-déploiement + ordre exact d'application des
  migrations + contrôles post-déploiement.
- [MONCASH_ROLLBACK_PLAN.md](./MONCASH_ROLLBACK_PLAN.md) — par
  migration, Edge Functions (N/A), variables d'environnement,
  configuration.
- [MONCASH_OPERATIONS.md](./MONCASH_OPERATIONS.md) — surveillance au
  quotidien + résolution d'incident.

### Développeur

- [PAYMENT_PROVIDER_DEVELOPER_GUIDE.md](./PAYMENT_PROVIDER_DEVELOPER_GUIDE.md)
  — ajouter un nouveau fournisseur de paiement, conventions, bonnes
  pratiques établies par ce module.

## État actuel en une phrase

Le code est complet, testé (32 tests unitaires + tests transactionnels
contre le schéma live), et documenté ; le canal MonCash Automatik reste
**inerte en production** — aucun secret configuré, `is_active=false`, et
le décaissement B2C MonCash lui-même reste non confirmé par Digicel
(bloquant externe, pas un manque de préparation côté code). 4 migrations
restent à appliquer (voir le Runbook) avant que le reste (notifications,
journal d'audit, correctif de sécurité R1) ne devienne actif.
