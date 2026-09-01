# MonCash Client Checkout (Collect) — Phase 1 Implementation Report

Code écrit, testé (`npm run verify` vert), **rien commité, rien poussé,
aucune migration appliquée** — conformément à "aucune migration
appliquée sans validation" et à la pratique de tout ce chantier. Chaque
section ci-dessous couvre un livrable demandé.

## 1. Architecture finale

```
checkout.tsx — 4ᵉ option "MonCash Automatik"
        │
create_order_secure (INCHANGÉ — _method='moncash', même rail que le manuel)
        │
initiate-collect-payment.functions.ts
        │
moncashProvider.initiatePayment({direction:"collect"})  ← déjà existant, réutilisé tel quel
        │
create_collect_payment_secure(_status='pending')  → INSERT payment_transactions
        │
redirectUrl → le client quitte le site, paie sur la page MonCash
        │
        ▼ (webhook, asynchrone)
POST /api/webhooks/moncash/collect
        │
moncash-collect-webhook-handler.server.ts (signature, dispatch)
        │
complete_collect_payment_secure(_decision)
        │
   UPDATE payment_transactions.status
   UPDATE payments.status  ──────────────► trg_notify_payment_status (INCHANGÉ)
                                            → notifie client + restaurant automatiquement
        │
   IF failed → notify_secure(admins) — le seul code de notification neuf
```

## 2. Migration SQL

[`20260731130000_moncash_collect_payments.sql`](../../../supabase/migrations/20260731130000_moncash_collect_payments.sql)
— table `payment_transactions`, 2 RPC, RLS, index, et l'ajout de
`payments` à la publication realtime (nécessaire pour que la page
commande se mette à jour sans rechargement — `orders` seule ne
suffisait pas, voir commentaire dans le fichier). **Aucune migration
existante modifiée** — `payments`, `orders`, `update_order_status_secure`,
`notify_payment_status_change`, et toutes les tables/RPC de décaissement
restent exactement comme avant.

## 3. RPC

| RPC                                                                                | Rôle                                                                                                                                      | Appelant                                                                       |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `create_collect_payment_secure(_payment_id, _external_reference, _status, _error)` | Enregistre une tentative (succès d'initiation → `'pending'`, ou rejet immédiat → `'failed'` + notifie admin)                              | `authenticated`, le client propriétaire de la commande uniquement              |
| `complete_collect_payment_secure(_external_reference, _decision, ...)`             | Seul point qui finalise un paiement collect — `UPDATE payment_transactions` puis `UPDATE payments.status` (déclenche le trigger existant) | `service_role` **exclusivement** — jamais appelable depuis une session cliente |

**"Aucune confirmation frontend"** satisfait structurellement : rien
d'accessible au client ne peut jamais faire passer un paiement à
`'paid'` — seul `complete_collect_payment_secure`, verrouillé
`service_role`, appelé uniquement par le gestionnaire de webhook, peut
le faire.

**Idempotence** : `UPDATE ... WHERE status = 'pending'` — une livraison
répétée pour une transaction déjà décidée ne trouve aucune ligne à
modifier ; le RPC retourne alors la ligne telle qu'elle est déjà (même
résultat, aucun effet répété). Une référence réellement inconnue lève
une exception explicite plutôt qu'un faux succès silencieux — testé
(`"an unknown reference (RPC throws) surfaces as a 500, never a silent
success"`).

## 4. RLS

| Table                  | Policy                            | Portée                                                                                                                                                                                                       |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `payment_transactions` | `payment_transactions admin read` | Admin/super_admin, toutes les lignes                                                                                                                                                                         |
| `payment_transactions` | `payment_transactions own read`   | Client, uniquement les lignes de ses propres commandes (`orders.customer_id = auth.uid()`) — nécessaire pour que la page commande distingue "paiement automatique" de "paiement manuel" (voir § UI checkout) |

Aucun `INSERT`/`UPDATE`/`DELETE` accordé à `anon`/`authenticated` — les
deux seuls chemins d'écriture sont les 2 RPC ci-dessus.

## 5. Webhook

`POST /api/webhooks/moncash/collect` —
[`moncash-collect-webhook-handler.server.ts`](../../../src/lib/payment-providers/moncash-collect-webhook-handler.server.ts).
**Séparé du webhook de décaissement** (`/api/webhooks/moncash`) —
route différente, table différente, RPC différente, jamais partagées.

- **Validation signature** : réutilise `moncashProvider.verifyWebhook()`
  (HMAC-SHA256, déjà implémenté et testé côté décaissement — aucun code
  neuf).
- **Protection replay** : pas un mécanisme à base de nonce/horodatage
  (schéma MonCash non confirmé publiquement, honnêteté déjà documentée
  ailleurs) — l'idempotence du RPC (§3) rend un rejeu structurellement
  sans danger, ce qui est la protection réelle et suffisante ici.
- **Gestion des doublons** : testée explicitement — deux appels
  identiques produisent le même résultat, jamais un double effet.
- **Logs sécurisés** : `sanitizeWebhookPayload()` — liste blanche
  (`message`, `status`, `amount`, `transaction_id`, `order_id`)
  stockée dans `payment_transactions.webhook_data`, jamais le payload
  brut non filtré.

## 6. UI checkout

`checkout.tsx` — 4ᵉ bouton "MonCash Automatik" (nouveau défaut),
**MonCash Manyèl/NatCash/Kach conservés sans modification de
comportement**. `_method` envoyé à `create_order_secure` reste
`'moncash'`/`'natcash'`/`'kach'` — la distinction automatique/manuel
n'existe qu'au niveau de l'écran de paiement, jamais dans le schéma
`payment_method`.

`orders.$id.tsx` — la présence d'une ligne `payment_transactions`
(visible au client via la nouvelle policy RLS) distingue désormais un
paiement automatique d'un paiement manuel, pour ne **jamais** afficher
l'invite "envoyer une preuve" à un client qui a choisi le flux
automatique. États affichés : `pending` ("N ap tann konfimasyon
MonCash"), `paid`/`failed` (réutilise l'affichage de statut déjà
existant, `PAY_STATUS_LABEL`). Mise à jour automatique de la page via
`useRealtimeTableSync("payments", ...)` (nouveau — nécessitait d'ajouter
`payments` à la publication realtime, § Migration).

## 7. Tests

**39/39 tests passent** (32 précédents + 7 nouveaux pour le webhook
collect), `npm run verify` intégralement vert.

| Scénario demandé | Couverture                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Succès           | ✅ `"a valid success event calls complete_collect_payment_secure with decision 'paid'"`                                                                                         |
| Refus            | ✅ `"a valid failed event calls complete_collect_payment_secure with decision 'failed'"`                                                                                        |
| Timeout          | ✅ Couvert au niveau du connecteur (`moncash-client.test.ts`, déjà existant, réutilisé sans changement — `direction:"collect"` passe par le même `createPayment()` instrumenté) |
| Webhook invalide | ✅ `"rejects an invalid signature with 401 and never calls an RPC"`                                                                                                             |
| Webhook doublé   | ✅ `"a replayed delivery for an already-decided transaction is idempotent, not an error"`                                                                                       |
| Retry            | ✅ Couvert au niveau du connecteur (backoff exponentiel déjà testé, générique à toute direction)                                                                                |

**Non testé unitairement, par cohérence avec le reste du projet** :
`initiate-collect-payment.functions.ts` (la fonction serveur
d'orchestration) — même limite déjà documentée pour son équivalent côté
décaissement (`initiate-provider-payout.functions.ts`, jamais testé
unitairement non plus) : `createServerFn` s'invoque mal isolément dans
un test, la logique qu'elle orchestre (le connecteur, le RPC) est déjà
couverte séparément.

**Non vérifiable en conditions réelles** : `payment_transactions`
n'existe pas encore en production (migration non appliquée) — aucun
test transactionnel en direct n'a été possible cette fois-ci,
contrairement à la campagne précédente sur le décaissement. Recommandé
une fois la migration appliquée : rejouer le même type de script
`BEGIN…ROLLBACK` que pour `create/complete_pending_payout_secure`.

## 8. Rapport sécurité

| Contrôle                    | Résultat                                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets absents du frontend | Structurel — `moncash-provider.server.ts`/`moncash-client.server.ts` réutilisés tels quels, mêmes garanties `.server.ts` déjà en place                                                                               |
| RLS                         | Client limité à ses propres lignes ; `service_role` seul peut écrire une décision terminale                                                                                                                          |
| Permissions RPC             | `create_collect_payment_secure` : `authenticated` avec vérification `orders.customer_id = auth.uid()` interne ; `complete_collect_payment_secure` : `service_role` exclusivement, aucun accès `authenticated`/`anon` |
| Logs nettoyés               | `webhook_data` filtré par liste blanche, jamais le payload brut                                                                                                                                                      |
| Rate limiting               | `create_collect_payment_secure` : `check_rate_limit_secure('create_collect_payment', 10, 600)` — nouveau, cohérent avec le reste du projet                                                                           |
| Confirmation frontend       | Structurellement impossible — voir §3                                                                                                                                                                                |

## 9. Rapport performance

- Requêtes bornées, 3 nouveaux index (`order_id`, `payment_id`,
  `created_at`).
- Aucun appel réseau supplémentaire à MonCash par rapport à ce qui
  existait déjà (le connecteur, le retry, le cache du jeton OAuth2 sont
  tous partagés avec le décaissement, zéro duplication).
- Realtime : un canal par commande ouverte (`orders.$id.tsx`), même
  coût que les canaux déjà utilisés ailleurs dans l'app (chat, GPS).
- Aucune donnée réelle pour mesurer une latence bout-en-bout — comme
  toujours dans ce chantier, seule la conception est vérifiable sans
  identifiants MonCash réels.

## Ce qui n'a pas été touché (vérifié, pas seulement promis)

`payouts`, `wallet_transactions`, `commission_ledger`,
`moncash_webhook_events`, `moncash_api_logs`,
`initiate_payout_secure`/`confirm_payout_secure`/
`dispute_payout_secure`/`resolve_payout_dispute_secure`,
`trg_notify_payment_status`, `submit_payment_proof_secure`,
`review_manual_payment_secure` — aucun de ces fichiers/objets
n'apparaît dans le diff de ce chantier.

## Avant de committer/pousser

Cette implémentation n'a pas été vérifiée contre une vraie base (la
migration n'est pas appliquée) ni contre un vrai compte MonCash (aucun
identifiant n'existe). Recommandé avant activation réelle : appliquer
la migration, rejouer un test transactionnel en direct comme pour le
décaissement, puis un vrai test bout-en-bout une fois un environnement
sandbox MonCash disponible.
