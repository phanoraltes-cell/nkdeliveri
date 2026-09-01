# NK Deliveri — MonCash Automatik — Audit Phase 0

**Date** : 2026-08-03
**Portée** : audit uniquement. Aucun code, aucune migration écrite dans cette phase.
**Décisions déjà actées avec vous avant cet audit** (voir échange précédent) :

1. La documentation fournie (`c:\tmp\API.docx`, extraite et lue intégralement) décrit un **gateway tiers** — pas l'API MonCash Business officielle de Digicel — hébergé à `https://bouspam.net` (confirmé par vous comme l'URL correcte ; le document se contredisait avec `https://gateway.starbee.dev` dans son propre exemple Python).
2. Ce gateway **remplace** le backend de l'option "MonCash Automatik" déjà existante (intégration directe Digicel, actuellement non fonctionnelle en production — `MONCASH_CLIENT_ID` manquant, voir `docs/DEPLOYMENT_REPORT.md`), plutôt que de s'ajouter comme une 5ᵉ méthode.
3. L'infrastructure existante (table, RPCs, orchestration) doit être **réutilisée/adaptée**, pas dupliquée.

---

## 1. Documentation fournie — contenu intégral

```
Base URL: https://bouspam.net
merchant_id / secret_key requis

POST /api/merchant/token/
  → { merchant_id, secret_key } → { success, data: { token, expires_at } }

POST /api/merchant/payments/moncash/
  Authorization: Bearer <token>
  → { amount, reference_id, customer_email, customer_name, description }
  → { success, data: { id, reference_id, amount, status, redirect_url } }

GET /api/merchant/payments/moncash/verify/<transaction_id>/
  Authorization: Bearer <token>
  → { success, data: { transaction_id, status, amount } }
  status ∈ { pending, completed, failed }

Callback : redirection navigateur vers votre return_url
  https://your-site.com/callback?status=success&transaction_id=<uuid>
```

**Ce que la documentation ne dit PAS** (à traiter comme absent, jamais supposé) :

- Comment déclarer/passer le `return_url` au moment de la création du paiement (absent du corps de requête `POST /api/merchant/payments/moncash/` documenté — probablement une configuration au niveau du compte marchand sur bouspam.net, à confirmer avec le fournisseur avant l'implémentation).
- Aucun mécanisme de webhook serveur-à-serveur signé — uniquement une redirection navigateur (non fiable en soi, doit être re-vérifiée côté serveur via l'endpoint Verify, jamais faire confiance aux query params directement).
- Aucun schéma d'erreur détaillé (codes d'erreur, format des erreurs 4xx/5xx).
- Aucune politique de rate limiting, de retry, ni de fenêtre d'expiration du token au-delà du champ `expires_at`.
- Aucune mention d'idempotence (pas d'Idempotency-Key documenté — à vérifier avec le fournisseur si `reference_id` dupliqué est rejeté ou silencieusement accepté deux fois).

Ces zones grises sont listées explicitement en § 6 — **rien n'a été inventé pour les combler**, conformément à l'instruction reçue.

---

## 2. Ce qui existe déjà (inventaire complet, lu intégralement)

| Fichier                                                                               | Rôle actuel                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/payment-providers/types.ts`                                                  | Interface `PaymentProvider` générique (déjà abstraite du fournisseur réel)                                                                                                                                                    |
| `src/lib/payment-providers/index.server.ts`                                           | Registre `getPaymentProvider()` — `manual`, `moncash_api`, `natcash_api`                                                                                                                                                      |
| `src/lib/payment-providers/moncash-config.server.ts`                                  | Lecture validée des 5 secrets `MONCASH_*` (Digicel)                                                                                                                                                                           |
| `src/lib/payment-providers/moncash-client.server.ts`                                  | Client HTTP bas niveau Digicel (`/oauth/token`, `/v1/CreatePayment`, `/v1/RetrieveOrderPayment`, `/v1/RetrieveTransactionPayment`) — retry, timeout, cache de token, journalisation `moncash_api_logs`                        |
| `src/lib/payment-providers/moncash-provider.server.ts`                                | Implémentation de `PaymentProvider` pour Digicel — `initiatePayment`, `checkStatus`, `cancelPayment`, `verifyWebhook` (signature HMAC **non confirmée par Digicel**, explicitement documentée comme placeholder dans le code) |
| `src/lib/payment-providers/moncash-collect-webhook-handler.server.ts`                 | Orchestration du webhook Collect — vérifie signature, appelle `complete_collect_payment_secure`                                                                                                                               |
| `src/routes/api.webhooks.moncash.collect.ts`                                          | Route HTTP publique du webhook Collect                                                                                                                                                                                        |
| `src/lib/initiate-collect-payment.functions.ts` / `.logic.ts`                         | Orchestration métier — crée la tentative, appelle le provider, enregistre via RPC. **Ne connaît que l'interface `PaymentProvider`, aucun détail Digicel**                                                                     |
| `supabase/migrations/20260731130000_moncash_collect_payments.sql`                     | Table `payment_transactions` + RPC `create_collect_payment_secure` (authenticated) + `complete_collect_payment_secure` (service_role uniquement) + publication Realtime sur `payments`                                        |
| `src/routes/checkout.tsx`                                                             | UI — 4 méthodes (`moncash_auto`, `moncash`, `natcash`, `kach`), redirection plein-navigateur (`window.location.href`) pour `moncash_auto`                                                                                     |
| `src/routes/_authenticated/dashboard.admin.moncash.tsx` (567 lignes)                  | Dashboard admin — lit `moncash_api_logs`, `payment_providers`, `payouts` par `provider_code`                                                                                                                                  |
| `src/lib/payment-providers/__tests__/`                                                | 5 fichiers de tests (client, provider, webhook-handler, collect-webhook-handler, reconcile)                                                                                                                                   |
| `docs/PAYMENT_PROVIDERS.md`, `docs/MONCASH_CONFIGURATION.md`, ~28 autres docs MonCash | Documentation existante (Digicel-spécifique en grande partie)                                                                                                                                                                 |

**Constat clé** : l'architecture existante est **déjà correctement modulaire** — la séparation Auth / Payment / Verify / Callback / Orchestrator que la mission demande de construire **existe déjà quasiment telle quelle**, juste implémentée contre l'API Digicel plutôt que bouspam.net. Ce n'est donc pas une construction ex nihilo mais un remplacement ciblé de deux fichiers (`moncash-client.server.ts`, `moncash-config.server.ts`) et une adaptation de deux autres (`moncash-provider.server.ts`, le handler de callback).

---

## 3. Ce qui est réutilisable tel quel (aucune modification)

| Composant                                                                      | Pourquoi                                                                                                                                                      |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PaymentProvider` (interface, `types.ts`)                                      | Générique par conception — la nouvelle implémentation bouspam.net l'implémente comme n'importe quel autre provider                                            |
| `initiate-collect-payment.functions.ts` / `.logic.ts`                          | Ne connaît que `moncashProvider.isConfigured()` / `.initiatePayment()` — zéro détail Digicel visible ici, zéro changement requis                              |
| `index.server.ts` (registre)                                                   | `moncash_api` reste la clé — même provider logique, nouveau backend                                                                                           |
| `create_collect_payment_secure` (RPC)                                          | Enregistre une tentative par `payment_id` + `external_reference` — agnostique du fournisseur réel                                                             |
| `complete_collect_payment_secure` (RPC)                                        | Finalise via `_decision` (`paid`/`failed`) — agnostique, `service_role` uniquement (inchangé)                                                                 |
| Table `payment_transactions`                                                   | Colonnes déjà génériques (`external_reference`, `provider_transaction_id`, `status`, `webhook_data jsonb`) — voir § 5 pour l'unique ajustement mineur suggéré |
| Publication Realtime sur `payments`                                            | Le mécanisme de confirmation "sans recharger la page" (Phase 5 de la mission) fonctionne déjà par ce biais                                                    |
| `checkout.tsx` — les 4 boutons de méthode, le flux Cash/MonCash Manyèl/NatCash | **Zéro changement** — hors périmètre par instruction explicite                                                                                                |
| `dashboard.admin.moncash.tsx`                                                  | Lit par `provider_code`/`code = 'moncash_api'`, continue de fonctionner sans changement si le nouveau backend garde le même `code`                            |
| Moteur de notifications (`private.notify_secure`)                              | Déjà câblé sur le paiement Collect — réutilisé tel quel (Phase 6 de la mission)                                                                               |
| `moncash_api_logs` (table d'audit append-only)                                 | Réutilisable pour journaliser les appels vers bouspam.net — même schéma, juste un nouvel `endpoint` renseigné                                                 |

---

## 4. Ce qui doit être créé

| Élément                                                                                  | Détail                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nouveau module config (ex. `moncash-automatik-config.server.ts`)                         | 2 secrets seulement (`merchant_id`, `secret_key`) contre 5 pour Digicel — noms de variables d'env à définir en Phase 1                                                                                                                                                                                               |
| Nouveau client HTTP bas niveau (ex. `moncash-automatik-client.server.ts`)                | `POST /api/merchant/token/`, `POST /api/merchant/payments/moncash/`, `GET .../verify/<id>/` contre `https://bouspam.net` — cache de token basé sur `expires_at` (pas `expires_in`, différence avec l'OAuth2 Digicel actuel)                                                                                          |
| Nouvelle route de retour utilisateur (ex. `/checkout/return` ou `/api/moncash/callback`) | **N'existe pas aujourd'hui** — le flux Digicel actuel n'a jamais eu de route de retour dédiée. Doit : recevoir la redirection, **ne jamais faire confiance aux query params seuls**, rappeler `GET verify/<transaction_id>` côté serveur pour obtenir le statut réel, puis appeler `complete_collect_payment_secure` |
| Remplacement du corps de `moncash-provider.server.ts`                                    | Mêmes signatures d'interface (`initiatePayment`, `checkStatus`, `cancelPayment`), nouvelle implémentation interne. `verifyWebhook` n'a plus d'équivalent direct côté serveur-à-serveur (pas de webhook documenté) — question ouverte, voir § 6                                                                       |
| Nouveaux tests                                                                           | Le format de réponse (`{success, data: {...}}`) diffère structurellement de Digicel — tests existants non réutilisables tels quels, mais leur structure (mock HTTP, cas succès/échec/timeout) sert de gabarit                                                                                                        |
| Documentation                                                                            | Remplacer les sections Digicel-spécifiques de `docs/PAYMENT_PROVIDERS.md`/`docs/MONCASH_CONFIGURATION.md` concernant le Collect, sans toucher aux sections décaissement (qui restent Digicel, hors périmètre)                                                                                                        |

---

## 5. Ajustement mineur suggéré (à valider, pas encore fait)

La colonne `payment_transactions.provider` a une valeur par défaut `'moncash_api'` (`supabase/migrations/20260731130000_moncash_collect_payments.sql:29`) — cohérente avec le remplacement de backend sous le même `provider_code`. Aucun changement de schéma n'est nécessaire pour accueillir bouspam.net : `external_reference` porte déjà notre `reference_id`, `provider_transaction_id` portera le `transaction_id` de bouspam.net, `webhook_data` peut porter la réponse `verify` complète (renommage de colonne non nécessaire, juste une réinterprétation du contenu JSON).

---

## 6. Questions ouvertes — à trancher avant la Phase 1 (rien supposé)

1. **`return_url`** : comment est-il déclaré ? Champ optionnel non documenté dans `POST /api/merchant/payments/moncash/`, configuration fixe côté compte marchand bouspam.net, ou autre ? **Bloquant pour concevoir la route de retour tant que non confirmé.**
2. **Idempotence de `reference_id`** : un `reference_id` réutilisé est-il rejeté (comme le comportement `orderId` de Digicel, dont `moncash-provider.server.ts` dépend explicitement pour sa réconciliation après timeout) ou silencieusement dupliqué ? Non documenté.
3. **Erreurs** : quel est le format d'un corps de réponse en erreur (401 token invalide, 400 validation, 500) ? Non documenté — `moncash-client.server.ts` actuel gère ça finement pour Digicel (retry sur 429/5xx uniquement), même granularité impossible à concevoir sans le savoir pour bouspam.net.
4. **`verifyWebhook` de l'interface `PaymentProvider`** : cette méthode n'a plus de sens direct puisqu'il n'y a pas de webhook signé — à traiter en Phase 1 (soit la méthode devient un no-op documenté pour ce provider, soit l'interface elle-même a besoin d'un axe "callback par redirection" distinct, à trancher explicitement plutôt que de forcer une méthode existante à faire autre chose que ce que son nom promet).
5. **Statut `pending` prolongé** : `GET verify` peut-il être appelé en polling (ex. si l'utilisateur ferme l'onglet avant la redirection) ? Le cron `moncash-reconcile` existant réconcilie aujourd'hui les décaissements Digicel — faut-il un mécanisme de réconciliation équivalent côté Collect pour bouspam.net (actuellement, le Collect Digicel n'en a pas non plus, il dépend du webhook) ?
6. **Compte réel bouspam.net** : `merchant_id`/`secret_key` réels — jamais demandés ni vus dans cet audit, à fournir uniquement au moment de la configuration (jamais en clair dans le chat/les fichiers du dépôt).

---

## 7. Ce qui ne doit surtout pas être modifié (rappel explicite)

- `manual-provider.server.ts`, `natcash-provider.server.ts` — Cash et NatCash Manuel, intacts.
- Le flux `moncash`/`natcash` manuel dans `checkout.tsx` (preuve de paiement, confirmation admin) — intact.
- `payment_providers` (table), `payments`, `orders`, `create_order_secure`, `update_order_status_secure` — aucune raison d'y toucher.
- Les fichiers de décaissement Digicel (`moncash-webhook-handler.server.ts`, `api.webhooks.moncash.ts`, `initiate-provider-payout.functions.ts`) — **distincts du Collect**, non concernés par ce remplacement (le décaissement reste, pour l'instant, sur Digicel — aucune décision prise ici pour en changer).
- RLS existantes, triggers validés, permissions déjà accordées ailleurs — aucun audit de sécurité global relancé ici (hors périmètre, déjà couvert par `docs/RELEASE_V1_AUDIT_REPORT.md`).

---

## 8. Recommandation

Procéder à la Phase 1 (architecture détaillée) **uniquement après réponse aux 6 questions ouvertes de § 6**, en priorité la question du `return_url` qui conditionne la conception de la nouvelle route de retour. Le remplacement est un changement ciblé et bien circonscrit — pas une reconstruction — grâce à l'abstraction déjà en place. Risque principal identifié : construire une hypothèse fausse sur le `return_url` ou le format d'erreur sans confirmation du fournisseur bouspam.net.

**Aucun code n'a été écrit. Aucune migration n'a été créée. En attente de votre validation avant la Phase 1.**
