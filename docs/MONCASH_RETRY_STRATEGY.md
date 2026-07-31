# Stratégie de retry — MonCash

Deux couches indépendantes, à deux échelles de temps différentes. Aucune
des deux ne relance jamais une erreur métier (4xx) — un rejet de MonCash
(identifiants invalides, `orderId` déjà utilisé, requête malformée)
échouerait à l'identique en le renvoyant, donc ni l'une ni l'autre ne le
tente.

## Couche 1 — Retry immédiat (`moncash-client.server.ts`)

À l'intérieur d'un seul cycle requête/réponse HTTP (borné par le timeout
de la fonction Vercel) — déjà implémentée et testée avant ce chantier de
durcissement, décrite ici pour former le tableau complet.

| Déclencheur | Relancé ? |
|---|---|
| Timeout (`AbortController`) | ✅ |
| Erreur réseau (`TypeError`/échec DNS/connexion) | ✅ |
| HTTP 429 | ✅ |
| HTTP 5xx | ✅ |
| HTTP 4xx | ❌ jamais |

Jusqu'à 3 tentatives, backoff exponentiel 300ms → 900ms. Chaque
tentative individuelle est journalisée dans `moncash_api_logs`
(`attempt`, `duration_ms`, `error`, `is_timeout`) — voir
[MONCASH_FINANCIAL_AUDIT.md](./MONCASH_FINANCIAL_AUDIT.md). Testée par
6 des 9 tests de `moncash-client.test.ts` (succès, 4xx-jamais-relancé,
timeout, erreur réseau, retry-5xx-puis-succès) — voir
[MONCASH_TEST_REPORT.md](./MONCASH_TEST_REPORT.md).

## Couche 2 — Réconciliation à long horizon (nouveau)

Pour le cas que la Couche 1 ne peut pas couvrir : **le webhook
lui-même n'arrive jamais** (perdu en route, MonCash ne le renvoie pas,
incident réseau prolongé côté MonCash). Rien dans une requête/réponse
HTTP ne peut détecter ça — il faut revenir interroger MonCash plus tard.

```
create_pending_payout_secure (payout créé, status='pending')
        │
        ▼
   … webhook attendu …
        │
        ▼ (rien après 5 minutes)
Vercel Cron */5 * * * * → POST-équivalent GET /api/cron/moncash-reconcile
        │
        ▼
reconcilePendingMonCashPayouts()
        │
   pour chaque payout 'pending' assez ancien :
        │
        ▼
   Tentative 1 (30s après la précédente)
        ↓ toujours "pending" ?
   Tentative 2 (2min après la précédente)
        ↓ toujours "pending" ?
   Tentative 3 (10min après la précédente)
        ↓ toujours "pending" ?
   "needs_manual_review" — jamais un échec auto-décidé
```

**Chaque tentative appelle `moncashProvider.checkStatus()`, qui journalise
automatiquement dans `moncash_api_logs`** (même mécanisme que la Couche
1 — `checkStatus()` appelle `retrieveOrderPayment()`, déjà instrumenté).
C'est aussi ce journal qui fait avancer l'échéancier : le nombre de
tentatives déjà faites et la date de la dernière sont lus directement
depuis `moncash_api_logs` (`WHERE transaction_reference = ... AND
endpoint = '/v1/RetrieveOrderPayment'`), **aucun nouvel état à maintenir
ailleurs**.

**Ne jamais échouer automatiquement après épuisement de l'échéancier** —
contrairement à la Couche 1, où un échec après 3 tentatives est sûr (rien
n'a été engagé), ici un paiement pourrait très bien avoir réussi côté
MonCash sans que la confirmation soit encore arrivée. `needs_manual_review`
est un signal pour un humain, jamais un `fail_pending_payout_secure`
automatique.

### Fichiers

| Fichier | Rôle |
|---|---|
| `payment-providers/moncash-reconcile.server.ts` | La logique elle-même — 7 tests dédiés (succès, échec, toujours en attente, fenêtre de backoff respectée/expirée, échéancier épuisé) |
| `routes/api.cron.moncash-reconcile.ts` | Cible Vercel Cron, protégée par `CRON_SECRET` |
| `vercel.json` (`crons`) | `*/5 * * * *` — nécessite un plan Vercel supportant un intervalle de cron inférieur à 1/jour (Pro ou supérieur) ; sur Hobby, utiliser un déclencheur externe (GitHub Actions planifié, service de cron tiers) appelant le même endpoint avec le même `Authorization: Bearer <CRON_SECRET>` |

### Statut aujourd'hui

**Inerte, comme le reste de l'intégration.** `create_pending_payout_secure`
n'a aucun appelant vivant (décaissement MonCash toujours refusé — voir
PAYMENT_PROVIDERS.md) : aucune ligne `payouts` avec
`provider_code='moncash_api' AND status='pending'` ne peut exister en
production. Le cron tourne, ne trouve rien, répond
`{ "ok": true, "candidates": 0, "results": [] }` à chaque exécution —
vérifié par les 7 tests unitaires, pas par une exécution réelle contre
des données de production (il n'y en a pas).

### Journalisation

"Toutes les tentatives doivent être journalisées" — satisfait par
construction, pas par un ajout séparé : chaque appel `checkStatus()` de
la Couche 2 traverse le même chemin d'instrumentation que la Couche 1
(`moncash-client.server.ts`), donc chaque tentative de réconciliation
apparaît dans `moncash_api_logs` exactement comme un appel de paiement
normal — visible sur `/dashboard/admin/moncash` § "Jounal apèl API",
avec son `duration_ms`, son `http_status`, sa référence.
