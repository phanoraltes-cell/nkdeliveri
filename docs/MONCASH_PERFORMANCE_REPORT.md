# Rapport de performance — MonCash

Pas de trafic réel à mesurer (0 paiement MonCash Automatik en
production — voir l'audit) ; ce rapport couvre donc ce qui est
vérifiable sans données réelles : conception des requêtes, index,
taille du bundle, et les optimisations déjà en place.

## Requêtes bornées, index en place

| Table | Requêtes admin (`/dashboard/admin/moncash`) | Index disponibles |
|---|---|---|
| `payouts` | `.eq("provider_code", ...).order(...).limit(50)` | `payouts_provider_reference_idx` (`provider_code, transaction_reference`), plus les index existants sur `restaurant_id`/`driver_id`/`status` |
| `moncash_api_logs` | `.order("created_at").limit(50)` (affichage), `.limit(200)` (agrégats KPI) | `moncash_api_logs_created_at_idx`, `_transaction_reference_idx`, `_endpoint_idx` — tous créés dans la migration d'origine, aucun ajout nécessaire |
| `moncash_webhook_events` | `.order("received_at").limit(200)` | `moncash_webhook_events_transaction_reference_idx`, `_received_at_idx` |

Aucune requête non bornée (`.limit()` systématique) — le dashboard ne
peut pas dégrader même si le volume de logs grossit fortement une fois
le canal actif.

## Optimisations déjà en place (pas nouvelles, confirmées pertinentes)

- **Cache du jeton OAuth2** (`getAccessToken()`,
  `moncash-client.server.ts`) : un jeton valide est réutilisé jusqu'à
  ~1 minute avant expiration — évite une requête `/oauth/token`
  supplémentaire à chaque appel. Des appels concurrents pendant un cache
  froid partagent une seule requête en vol (`pendingTokenRequest`) —
  testé (`"concurrent callers share a single in-flight token
  request"`).
- **Timeout à 15s par tentative** — borne le temps qu'une requête
  admin/webhook peut rester bloquée en attente de MonCash, évite
  l'épuisement de connexions concurrentes sous charge.
- **Réconciliation par lot, pas par payout individuel déclenché** — le
  cron `*/5 * * * *` traite tous les paiements en attente en une seule
  exécution plutôt que de programmer un timer par paiement (qui ne
  survivrait pas un redémarrage de fonction serverless de toute façon).

## Impact sur la taille du bundle client

Vérifié après chaque changement de ce chantier (voir historique) :
aucun fichier `.server.ts` de `payment-providers/` n'apparaît dans
`.vercel/output/static` — le connecteur MonCash, ses secrets, et sa
logique de journalisation ont un coût de bundle client strictement nul.
Le seul ajout côté client est la page admin
`/dashboard/admin/moncash` elle-même (une route de plus, chargée à la
demande comme toutes les routes de ce projet).

## Nouveau : dépendance de développement (Vitest)

`vitest` ajouté en `devDependency` uniquement (voir `package.json`) —
aucun impact sur le bundle de production, aucune vulnérabilité `npm
audit` en dehors de l'arbre de dépendances de test (`npm audit
--omit=dev` : 0 vulnérabilité, vérifié).

## Limite de ce rapport

Sans trafic réel, aucune mesure de latence bout-en-bout, de débit, ou de
comportement sous charge n'est possible aujourd'hui — seule la
**conception** est vérifiable. Recommandé : instrumenter une vraie
mesure (ex. p50/p95 de `duration_ms` dans `moncash_api_logs`, déjà
capturé par ligne) une fois le canal réellement actif, le
`/dashboard/admin/moncash` KPI "Tan repons mwayèn" donnant déjà cette
moyenne au fil de l'eau sans travail supplémentaire.
