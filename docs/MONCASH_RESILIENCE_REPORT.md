# Rapport de résilience et de non-régression — MonCash

Couvre les 10 scénarios demandés + la vérification de non-régression sur
les paiements manuels, les wallets, les notifications et le dashboard.
Chaque scénario est testé automatiquement (`npm test`, mocké — aucune
dépendance réseau) sauf mention contraire. Un vrai gap a été trouvé et
corrigé pendant cette phase (§ Correctif) — pas seulement vérifié.

## Les 10 scénarios

| # | Scénario | Statut | Preuve |
|---|---|---|---|
| 1 | Perte réseau | ✅ | `moncash-client.test.ts` — "a network error is retried but NOT flagged as timeout" |
| 2 | Timeout | ✅ | `moncash-client.test.ts` — "a timeout is retried up to 3 attempts and reported with code 'timeout'" |
| 3 | API indisponible | ✅ | `moncash-client.test.ts` — "MonCash entirely unavailable (every attempt 503) fails cleanly after exactly 3 tries" (nouveau, ajouté dans cette phase) |
| 4 | Réponse invalide | ✅ **gap trouvé et corrigé** | Voir § Correctif ci-dessous |
| 5 | Webhook en double | ✅ | `moncash-webhook-handler.test.ts` — duplicate `event_id` (23505) ; confirmé aussi contre le vrai schéma live (`MONCASH_TEST_REPORT.md` groupe E) |
| 6 | Webhook retardé | ✅ | Couvert par la Couche 2 de retry (`MONCASH_RETRY_STRATEGY.md`) — `reconcilePendingMonCashPayouts` va chercher activement le statut si le webhook n'arrive pas dans les 5 premières minutes ; testé via `moncash-reconcile.test.ts` |
| 7 | Webhook absent | ✅ | Même mécanisme — au-delà de 3 tentatives de réconciliation (30s/2min/10min), `needs_manual_review` plutôt qu'un abandon silencieux ; testé (`"flags for manual review once the schedule is exhausted"`) |
| 8 | Erreur MonCash (rejet métier) | ✅ | `moncash-client.test.ts` — "a 4xx response is never retried" ; `moncash-provider.test.ts` — réconciliation idempotente sur échec |
| 9 | Rollback | ✅ | Vérifié contre le **vrai schéma live**, pas seulement mocké — `MONCASH_TEST_REPORT.md` groupe A : `fail_pending_payout_secure` restitue exactement le solde d'origine |
| 10 | Reprise après incident | ✅ | La Couche 2 de retry (§6/§7 ci-dessus) *est* le mécanisme de reprise après incident — un payout ne reste jamais bloqué silencieusement indéfiniment |

## Correctif appliqué dans cette phase — réponse invalide (#4)

**Constat** : `requestAccessToken()`, `createPayment()`, et `retrieveBy()`
appelaient `response.json()` sans protection après avoir vérifié
`response.ok` — un `200 OK` avec un corps non-JSON (page d'erreur HTML
d'un proxy/gateway devant MonCash, réponse tronquée) aurait fait
remonter un `SyntaxError` brut au lieu du `MonCashApiError` propre
utilisé partout ailleurs dans ce fichier. Trouvé en construisant
spécifiquement ce scénario de test, pas par inspection statique seule.

**Correctif** : nouvelle fonction `parseJsonOrThrow(response, context)`
dans `moncash-client.server.ts`, utilisée aux 3 points d'appel — capture
l'échec de parsing et le convertit en `MonCashApiError` avec un message
clair identifiant l'endpoint concerné. **Pure robustesse technique,
aucune logique métier de paiement modifiée** — le comportement pour
toute réponse valide (le seul cas qui existait en pratique jusqu'ici,
`response.json()` réussissant toujours dans tous les tests précédents)
reste strictement identique.

**Test de régression** : `moncash-client.test.ts` — "a 200 response with
a malformed (non-JSON) body raises a clean MonCashApiError, not a raw
SyntaxError" — s'exécute à chaque `npm test`, empêche que ce gap ne
revienne silencieusement.

## Vérification de non-régression

### Paiements manuels

**Aucune modification du chemin manuel dans tout ce chantier.**
`initiate_payout_secure`/`confirm_payout_secure`/`dispute_payout_secure`/
`resolve_payout_dispute_secure` n'apparaissent dans **aucune** des
migrations écrites depuis le début du chantier MonCash (vérifié par
lecture directe de chaque fichier). `payout-pay-modal.tsx` route
toujours MonCash Manyèl/NatCash Manyèl vers le même appel RPC
`initiate_payout_secure` inchangé — le sélecteur unifié de canal
(`Kanal peman`) est une réorganisation de l'UI, jamais un changement du
chemin d'exécution manuel.

### Wallets

`wallets`/`wallet_transactions` : aucune migration de ce chantier ne
modifie leur structure (seuls de nouveaux `type` sont ajoutés à la liste
`CHECK` de `wallet_transactions.type` — additif, aucune valeur existante
retirée). 0 ligne réelle dans `wallets` en production aujourd'hui
(vérifié) — aucune donnée réelle en jeu.

### Notifications

Le moteur `private.notify_secure` lui-même n'est pas modifié — seuls de
nouveaux appelants (les 3 RPC MonCash) l'utilisent, suivant exactement
la convention déjà établie par le chat/GPS/annulation client. Les ~15
sites d'appel préexistants (`payout_disputed`, `order_status_changed`,
etc.) restent des `INSERT` directs inchangés, comme documenté depuis le
début (voir PAYMENT_PROVIDERS.md).

### Dashboard

`/dashboard/admin/payouts` (Payout Center existant) : aucun fichier de
cette page n'a été supprimé ni restructuré — seul `payout-pay-modal.tsx`
a gagné un sélecteur unifié (voir commit historique de ce chantier).
`npm run build` reste vert après chaque changement de ce chantier — la
page continue de compiler et de s'exporter normalement.
`/dashboard/admin/moncash` (nouvelle page) est additive, n'affecte
aucune route existante.

## Ce qui n'a pas pu être testé en conditions réelles

Comme documenté à chaque étape de ce chantier : aucun identifiant
MonCash réel n'existe (voir MONCASH_SECRETS_AUDIT.md), donc aucun de ces
10 scénarios n'a pu être observé contre le vrai serveur MonCash — chacun
est reproduit fidèlement via un `fetch` simulé dont le comportement
correspond aux cas documentés (codes HTTP, forme de réponse, comportement
d'`AbortController`). Le jour où un environnement sandbox MonCash réel
existe, la recommandation reste celle déjà formulée dans
MONCASH_TEST_REPORT.md : rejouer ces mêmes scénarios contre ce sandbox
avant toute activation en production.
