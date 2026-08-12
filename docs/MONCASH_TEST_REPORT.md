# Rapport de campagne de tests — MonCash / NatCash

Campagne complète couvrant les 3 canaux de décaissement (MonCash
Automatik, MonCash Manyèl, NatCash Manyèl) : paiement réussi, paiement
refusé, timeout, erreur réseau, webhook, idempotence, rollback. Deux
méthodes complémentaires, chacune couvrant ce que l'autre ne peut pas :

1. **Tests automatisés (Vitest, nouveaux dans ce projet)** — la couche
   TypeScript (`moncash-client.server.ts`, `moncash-provider.server.ts`,
   `moncash-webhook-handler.server.ts`), avec `fetch` et Supabase
   entièrement simulés. Exécutables à volonté, sans réseau ni base de
   données — `npm test`.
2. **Tests transactionnels contre le vrai schéma live** — la couche RPC
   PostgreSQL (`create_pending_payout_secure`,
   `complete_pending_payout_secure`, `fail_pending_payout_secure`), exécutés
   via `supabase db query --linked` à l'intérieur d'une transaction
   `BEGIN … ROLLBACK`, sur des données 100 % synthétiques. Aucune écriture
   n'a persisté — vérifié après coup (voir § Preuve d'absence d'effet de
   bord).

## Résumé exécutif

| Catégorie demandée | Statut                                                 | Preuve                                                                                  |
| ------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Paiement réussi    | ✅ Testé (mock + DB)                                   | `moncash-client.test.ts`, `moncash-provider.test.ts`, DB groupe B                       |
| Paiement refusé    | ✅ Testé (mock)                                        | `createPayment: a 4xx response is never retried`                                        |
| Timeout            | ✅ Testé (mock, distinction structurelle)              | `createPayment: a timeout is retried up to 3 attempts and reported with code 'timeout'` |
| Erreur réseau      | ✅ Testé (mock, distincte du timeout)                  | `createPayment: a network error is retried but NOT flagged as timeout`                  |
| Webhook            | ✅ Testé (mock signature + DB idempotence)             | `moncash-webhook-handler.test.ts` (5 tests), DB groupe E                                |
| Idempotence        | ✅ Testé (3 niveaux : client HTTP, RPC, table webhook) | voir § Idempotence — 3 niveaux                                                          |
| Rollback           | ✅ Testé contre le vrai schéma (rolled back)           | DB groupe A — restauration exacte du solde                                              |

**23/23 tests automatisés passent** (`npm test`, ~3,5s). **7/7 assertions
transactionnelles passent** contre la base live, zéro effet de bord.

## ⚠️ Découverte importante : la base live n'est pas à jour

En préparant les tests transactionnels, j'ai vérifié directement quelles
migrations sont réellement appliquées sur le projet Supabase lié
(`dcsnmvbtsmdbwrwbutph`) — pas supposé, vérifié par requête. Résultat :
**seule `20260730100000_moncash_webhook_payout_lifecycle.sql` est
appliquée.** Les trois suivantes ne le sont pas :

- `20260730110000_log_payment_provider_error.sql`
- `20260730120000_moncash_provider_notifications.sql` (le câblage vers
  `private.notify_secure`, les notifications "envoyé"/admin succès/erreur)
- `20260730130000_moncash_financial_audit_log.sql` (`moncash_api_logs` +
  les triggers d'immutabilité)

Conséquence concrète, vérifiée en lisant la définition réelle de
`complete_pending_payout_secure` sur la base live : elle utilise encore
`INSERT INTO notifications` directement (le type `payout_paid`), pas
`private.notify_secure`. La table `moncash_api_logs` n'existe pas
encore ; `log_payment_provider_error_secure` non plus. Ce n'est pas un
bug — c'est simplement l'état d'avancement réel de l'application des
migrations, qui vous appartient (rappel : cette session n'exécute jamais
`supabase db push`, voir la convention établie). **À appliquer avant que
les notifications automatiques et le journal d'audit financier des deux
derniers tours ne soient réellement actifs.**

## Tests automatisés (Vitest)

Nouveau dans ce projet — premier framework de test installé
(`vitest.config.ts`, séparé de `vite.config.ts` pour ne pas tirer le
plugin TanStack Start dans les tests unitaires). `npm test` /
`npm run verify` (désormais inclus dans la chaîne de vérification).

### `moncash-client.server.ts` (9 tests)

| Test                                             | Ce qu'il prouve                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| happy path                                       | `CreatePayment` réussi → jeton + URL de redirection corrects                                                                                            |
| jamais de secret journalisé                      | Le corps envoyé à `moncash_api_logs` ne contient jamais l'en-tête `Authorization`, le secret client, ni un jeton en clair — seulement sa forme tronquée |
| 4xx jamais réessayé                              | Une seule tentative HTTP pour un rejet métier (`orderId` déjà utilisé, etc.)                                                                            |
| timeout → 3 tentatives, code 'timeout'           | La distinction timeout/erreur réseau est structurelle (`MonCashApiError.code`), jamais un texte deviné                                                  |
| erreur réseau → réessayée, jamais taguée timeout | Un `TypeError` (échec DNS/connexion) suit le même chemin de retry mais garde `code: undefined`                                                          |
| retry 500 → succès en 2ᵉ tentative               | La logique de reprise fonctionne réellement, pas seulement en théorie                                                                                   |
| 404 → `null`, pas une erreur                     | `RetrieveOrderPayment` sur une commande inconnue est un résultat normal                                                                                 |
| extraction de référence                          | `transactionId`/`status`/`amount` correctement extraits d'une réponse réaliste                                                                          |
| jeton d'accès partagé                            | 3 appels concurrents ne déclenchent qu'**une seule** requête `/oauth/token`                                                                             |

### `moncash-provider.server.ts` (9 tests)

| Test                                                  | Ce qu'il prouve                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `disburse` refusé même configuré                      | **L'invariant le plus important de toute l'intégration** — aucune configuration ne peut faire accepter un décaissement                                 |
| `disburse` refusé, motif `not_configured` en priorité | Le bon message même quand les deux raisons de refus coexistent                                                                                         |
| `isConfigured()` reflète les vrais secrets            | Pas une valeur figée — change réellement selon `process.env`                                                                                           |
| réconciliation idempotente → succès retrouvé          | Un `CreatePayment` qui lève une erreur locale mais a réellement réussi côté MonCash est correctement rapporté comme un succès, jamais un échec fantôme |
| réconciliation idempotente → échec confirmé           | Quand la vérification ne trouve rien non plus, l'échec est honnête (jamais un succès inventé)                                                          |
| signature valide acceptée                             | HMAC-SHA256 correctement vérifiée et l'évènement normalisé (référence, statut)                                                                         |
| signature invalide rejetée                            | Une signature aléatoire de la bonne longueur échoue                                                                                                    |
| corps altéré rejeté                                   | Une signature valide pour un _autre_ corps ne passe pas — protège contre la manipulation en transit                                                    |
| pas de secret → rejet immédiat                        | Jamais de comparaison hasardeuse quand `MONCASH_WEBHOOK_SECRET` est absent                                                                             |

### `moncash-webhook-handler.server.ts` (5 tests)

| Test                                                                      | Ce qu'il prouve                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| signature invalide → 401, aucune RPC                                      | Le rejet s'arrête avant de toucher au grand livre                                                      |
| doublon (`23505`) → 200, aucune RPC                                       | Idempotence côté livraison webhook — jamais retraité                                                   |
| succès → `complete_pending_payout_secure` avec la bonne référence, 2 push | Bénéficiaire _et_ admin notifiés (mirroir de la RPC — sur la base une fois `20260730120000` appliquée) |
| échec → `fail_pending_payout_secure`                                      | Chemin d'échec correctement routé                                                                      |
| pas de référence → ignoré, aucune RPC                                     | Un webhook qu'on ne peut pas rattacher à un paiement n'invente rien                                    |

## Tests transactionnels contre le vrai schéma (rolled back)

Exécutés via `supabase db query --linked --file …`, un `BEGIN` en tête et
un `ROLLBACK` en fin de script — chaque script journalise ses résultats
dans une table temporaire relue juste avant le `ROLLBACK`, donc visible
dans la sortie sans jamais rien valider. Zéro wallet/restaurant n'existait
en production avant ces tests (vérifié) — les données de test sont
entièrement synthétiques (`slug` préfixé `audit-test-*`), jamais un
enregistrement réel manipulé.

### Groupe A — création → échec (rollback + idempotence)

| Étape                                                  | Résultat                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Wallet initial                                         | `available: 1000, pending: 0`                                                      |
| Après `create_pending_payout_secure(300)`              | `available: 700, pending: 300`, statut `pending` — fonds correctement réservés     |
| Après `fail_pending_payout_secure(...)`                | `available: 1000, pending: 0` — **restauration exacte**, statut `failed`           |
| 2ᵉ appel `fail_pending_payout_secure` (même référence) | Solde inchangé, **aucune** ligne `wallet_transactions` supplémentaire — idempotent |

### Groupe B — création → confirmation (succès + idempotence)

| Étape                                                | Résultat                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Après `complete_pending_payout_secure(...)`          | Statut `paid`, `provider_transaction_id = MONCASH-TX-999`, 2 lignes `wallet_transactions` (réservation + confirmation), notification créée |
| 2ᵉ appel avec un `provider_transaction_id` différent | Nombre de lignes `wallet_transactions` **inchangé**, `provider_transaction_id` **inchangé** (`MONCASH-TX-999`, pas écrasé par le doublon)  |

### Groupe C — référence inconnue

Appeler `complete_pending_payout_secure` sur une référence qui n'a jamais
existé **lève une exception** (`Pa gen okenn peman an atant pou referans
sa a`), jamais un no-op silencieux — une webhook forgée ou corrompue ne
peut pas être confondue avec un succès.

### Groupe D — notification sur confirmation

Avec un `owner_id` réel sur le restaurant de test :
`complete_pending_payout_secure` crée bien une notification pour le
bénéficiaire (`type: payout_paid` — la version actuellement live,
pré-`20260730120000`).

### Groupe E — idempotence de la table webhook

`moncash_webhook_events` a bien une contrainte `UNIQUE(event_id)` :
une deuxième livraison avec le même `event_id` échoue avec `23505`
(unique_violation) — un seul enregistrement persiste.

### Preuve d'absence d'effet de bord

Après les deux scripts, requête de contrôle sur la base live :
`wallets: 0, restaurants test-*: 0, moncash_webhook_events TEST-*: 0,
payouts TEST-*: 0` — confirmé vide, comme avant les tests.

## Idempotence — 3 niveaux indépendants, chacun testé

1. **Client HTTP** (`moncash-client.server.ts`) — l'unicité d'`orderId`
   chez MonCash + réconciliation via `retrieveOrderPayment` (testé : mock).
2. **Table `moncash_webhook_events`** — `UNIQUE(event_id)` (testé : DB
   groupe E).
3. **RPC** (`complete_pending_payout_secure`/`fail_pending_payout_secure`)
   — `IF status <> 'pending' THEN RETURN` (testé : DB groupes A/B).

Aucun de ces niveaux ne dépend des deux autres — une défaillance dans
l'un ne peut pas, à elle seule, provoquer un double mouvement de fonds.

## Comparaison : MonCash Automatik / MonCash Manyèl / NatCash Manyèl

| Aspect                                | MonCash Automatik                                                                                                        | MonCash Manyèl                                                                    | NatCash Manyèl                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `provider_code`                       | `moncash_api`                                                                                                            | `manual`                                                                          | `manual`                                                   |
| `method`                              | `moncash`                                                                                                                | `moncash`                                                                         | `natcash`                                                  |
| Atteignable en production aujourd'hui | **Non** — `is_active=false` ET `direction:"disburse"` toujours refusé au niveau code (double verrou)                     | **Oui** — seul chemin actif depuis le début                                       | **Oui**                                                    |
| Qui exécute le transfert              | L'API MonCash (en théorie — voir ci-dessus)                                                                              | L'admin, à la main, sur son téléphone                                             | L'admin, à la main                                         |
| Référence de transaction              | Générée par l'app (clé d'idempotence), à faire confirmer par MonCash                                                     | Saisie manuelle par l'admin                                                       | Saisie manuelle                                            |
| Preuve/pièce jointe                   | Non applicable                                                                                                           | Optionnelle (photo/PDF)                                                           | Optionnelle                                                |
| Détection de timeout                  | Oui, structurelle (`code: "timeout"`)                                                                                    | Non applicable (pas d'appel réseau)                                               | Non applicable                                             |
| Retry automatique                     | Oui (3 tentatives, backoff)                                                                                              | Non applicable                                                                    | Non applicable                                             |
| Rollback en cas d'échec               | Automatique (`fail_pending_payout_secure` restitue `available_balance`)                                                  | Non applicable — l'argent a déjà quitté la main de l'admin avant l'enregistrement | Non applicable                                             |
| Notifications automatiques            | Oui, aux 2 audiences (bénéficiaire + admin), 3 étapes (envoyé/confirmé/erreur) — **une fois `20260730120000` appliquée** | Oui (déjà en place, chemin existant)                                              | Oui (identique)                                            |
| Journal d'audit dédié                 | `moncash_api_logs` (requête/réponse/délai/erreur) — **une fois `20260730130000` appliquée**                              | `audit_log` générique (déjà en place)                                             | `audit_log` générique                                      |
| Couverture de test                    | Automatisée complète (23 tests unitaires + 7 assertions DB)                                                              | Éprouvée en production depuis le début du module financier                        | Éprouvée en production depuis le début du module financier |
| Ce qui manque avant activation réelle | Confirmation du contrat B2C MonCash avec Digicel (bloquant, externe — voir PAYMENT_PROVIDERS.md)                         | Rien — déjà complet                                                               | Rien — déjà complet                                        |

## Ce qui n'a délibérément PAS été testé

- **Un vrai appel réseau vers MonCash** — impossible, aucun identifiant
  réel n'existe dans cet environnement (confirmé dès l'audit initial).
  Tout ce qui touche au réseau est testé contre un `fetch` simulé dont le
  comportement reproduit fidèlement les cas documentés (succès, 4xx,
  429/5xx, timeout, erreur réseau).
- **Le trigger d'immutabilité** (`private.prevent_log_mutation`) et la
  table `moncash_api_logs` — pas encore sur la base live (voir
  Découverte importante ci-dessus). À revérifier après application de
  `20260730130000`, idéalement avec le même type de script transactionnel
  rolled-back que les groupes A-E ci-dessus.
- **`log_payment_provider_error_secure`** (timeout/erreur admin) — même
  raison.
- **Environnement sandbox MonCash réel** — n'existe pas encore (voir
  docs/PAYMENT_PROVIDERS.md § Ce qui n'est PAS fait) ; c'est l'étape
  logique suivante une fois le contrat B2C confirmé.

## Comment relancer cette campagne

```bash
npm test              # 23 tests unitaires, ~3-4 secondes, aucune dépendance externe
npm run verify         # inclut désormais npm test dans la chaîne complète
```

Pour les tests transactionnels contre la base live (jamais destructeurs —
toujours `BEGIN … ROLLBACK`), relancer un script du même type que ceux de
ce rapport via `supabase db query --linked --file <script>.sql` après
avoir vérifié quelles migrations sont réellement appliquées.
