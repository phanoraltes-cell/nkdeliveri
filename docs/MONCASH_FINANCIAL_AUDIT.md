# Audit financier complet — MonCash

Ce document couvre le journal d'audit complet des interactions MonCash :
appels API sortants (`moncash-client.server.ts`) et livraisons webhook
entrantes (`moncash-webhook-handler.server.ts`). Pour l'architecture
générale, voir [PAYMENT_PROVIDERS.md](./PAYMENT_PROVIDERS.md) ; pour
l'audit de sécurité du webhook spécifiquement, voir
[MONCASH_WEBHOOK_SECURITY.md](./MONCASH_WEBHOOK_SECURITY.md).

## Ce qui est journalisé, et où

| Exigence | Table | Colonne(s) |
|---|---|---|
| Requêtes API | `moncash_api_logs` | `endpoint`, `method`, `attempt`, `request_summary` |
| Réponses | `moncash_api_logs` | `http_status`, `response_summary` |
| Erreurs | `moncash_api_logs` | `error`, `is_timeout` |
| Délais | `moncash_api_logs` | `duration_ms` |
| Webhooks | `moncash_webhook_events` | tout (déjà en place — voir MONCASH_WEBHOOK_SECURITY.md) |
| Références MonCash | `moncash_api_logs` + `moncash_webhook_events` | `transaction_reference`, `provider_transaction_id` |

**Une ligne par tentative HTTP**, pas par appel logique — le connecteur
réessaie automatiquement (timeout, 429, 5xx ; voir PAYMENT_PROVIDERS.md
§ le connecteur), et chaque tentative individuelle est journalisée
séparément (`attempt` 1, 2, 3…), avec son propre délai et son propre
résultat. C'est délibéré : un `/v1/CreatePayment` qui échoue à la
tentative 1 (timeout) puis réussit à la tentative 2 produit deux lignes
distinctes — l'historique complet de fiabilité de MonCash reste visible,
pas seulement le résultat final.

## Ce qui n'est PAS journalisé (par sécurité, délibérément)

`moncash-client.server.ts` construit `request_summary`/`response_summary`
**à la main, endpoint par endpoint** — jamais un dump brut de la requête
ou de la réponse. C'est une liste blanche, pas une liste noire : chaque
champ journalisé a été explicitement décidé sûr, plutôt que de faire
confiance à un filtre générique pour deviner quoi masquer.

- **Jamais l'en-tête `Authorization`** (`Basic base64(clientId:clientSecret)`
  pour `/oauth/token`, `Bearer <token>` pour tous les autres appels).
- **Jamais `access_token`** — `/oauth/token` ne journalise que
  `has_access_token: true/false`, `expires_in`, `token_type`.
- **Jamais un `payment_token` complet** — `/v1/CreatePayment` journalise
  une version tronquée (`redactToken()` : 4 premiers + 4 derniers
  caractères, ex. `a1b2…y8z9`), assez pour corréler visuellement deux
  lignes de log entre elles, pas assez pour réutiliser le jeton.
- **`MONCASH_CLIENT_SECRET`/`MONCASH_WEBHOOK_SECRET`** n'apparaissent
  dans aucune requête journalisée — ils ne sont jamais placés dans un
  corps de requête, seulement dans l'en-tête `Authorization` (exclu
  ci-dessus) ou utilisés pour signer/vérifier une signature.

Vérifié après build : aucun de ces éléments n'apparaît dans le bundle
client statique (la logique de journalisation vit entièrement dans
`moncash-client.server.ts`, jamais importé statiquement hors d'un autre
`.server.ts`).

## "Ne jamais supprimer les logs" — une garantie, pas une convention

`moncash_api_logs` et `moncash_webhook_events` ont chacune un trigger
Postgres `BEFORE DELETE`/`BEFORE TRUNCATE` (`private.prevent_log_mutation()`,
[20260730130000_moncash_financial_audit_log.sql](../supabase/migrations/20260730130000_moncash_financial_audit_log.sql))
qui lève une exception inconditionnellement — pour **tout** rôle, y
compris `service_role`. Ailleurs dans ce schéma, "ne jamais supprimer"
est une règle de convention (RLS + code applicatif qui n'écrit jamais de
`DELETE`) ; ici, c'est une garantie au niveau base de données qu'aucun
bug applicatif futur, aucune action admin via `supabaseAdmin`, ne peut
contourner sans qu'un superutilisateur désactive explicitement le
trigger. `moncash_api_logs` est en plus protégée contre l'`UPDATE` (elle
n'en a jamais besoin — une ligne capture une tentative complète en un
seul `INSERT`) ; `moncash_webhook_events` autorise toujours `UPDATE`
(nécessaire pour son cycle `processing` → `processed`/`failed`), seul
`DELETE`/`TRUNCATE` y est bloqué.

## Accès et confidentialité

RLS : lecture seule pour `admin`/`super_admin` (`authenticated`), aucun
accès pour `anon`/`PUBLIC`. Écriture : `moncash-client.server.ts`
uniquement, via `supabaseAdmin` (service role) — jamais une session
utilisateur, jamais un composant. La page admin
`/dashboard/admin/moncash` (section "Jounal apèl API (odit finansye)")
donne une vue lisible de ce journal ; aucune donnée qu'il contient n'est
exposée par une autre page ou API.

## Limite connue

Une entrée de log qui échoue à s'écrire (ex. panne DB transitoire) est
avalée en `console.warn` — la journalisation ne doit jamais faire
échouer un vrai paiement. Cela signifie qu'un trou dans le journal est
possible dans ce cas précis, mais uniquement pour une panne déjà visible
ailleurs (le paiement lui-même aurait aussi échoué ou été retenté), jamais
silencieusement pour un appel qui a réellement affecté de l'argent.
