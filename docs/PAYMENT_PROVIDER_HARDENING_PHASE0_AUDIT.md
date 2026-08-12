# Hardening Backend des fournisseurs de paiement — Phase 0 — Audit

**Date** : 2026-08-03
**Portée** : audit uniquement. Aucun fichier modifié, aucune migration écrite pour produire ce rapport.

---

## 1. Découverte structurante — deux tables "provider" existent déjà, pour deux concepts différents

Avant tout inventaire, un constat qui conditionne toute l'architecture des phases suivantes : `payment_providers` **existe déjà** en production.

```sql
-- Schéma live, vérifié aujourd'hui
code text PRIMARY KEY, label text NOT NULL, is_active boolean NOT NULL DEFAULT true, created_at timestamptz
-- 1 seule policy RLS : SELECT, roles={authenticated}, qual=true — aucune policy d'écriture (modification = service_role/RPC uniquement)
-- 3 lignes : manual (is_active=true), moncash_api (is_active=false), natcash_api (is_active=false)
```

**Ce que cette table gouverne aujourd'hui, exactement** : quel _moteur d'exécution_ traite un **décaissement** (paiement plateforme → restaurant/livreur) — `payout-pay-modal.tsx` filtre son menu déroulant sur `is_active`. Elle ne gouverne strictement rien côté **collecte** (paiement client → plateforme, le flux "MonCash Automatik" du checkout).

**Ce que la mission demande de créer** (`payment_provider_settings`, seed : Cash/NatCash Manuel/MonCash Manuel/MonCash Automatik) modélise un concept différent : les **4 méthodes de paiement affichées au checkout client** — `kach`/`moncash`/`natcash`/`moncash_auto`, pas les 3 moteurs d'exécution de décaissement (`manual`/`moncash_api`/`natcash_api`).

**Décision d'architecture qui en découle** (détaillée en Phase 1) : `payment_providers` reste **strictement inchangée** — aucune ligne, colonne, policy ni RPC associée n'est touchée. `payment_provider_settings` est une table **nouvelle et distincte**, pas un remplacement ni une extension. Les deux coexistent parce qu'elles répondent à deux questions différentes ("quel moteur pour un décaissement ?" vs "quelle méthode le client peut-il choisir au checkout ?"). Ceci est documenté explicitement pour qu'un futur lecteur ne les confonde pas et n'essaie pas de les fusionner par erreur.

## 2. Tous les points de sélection d'un fournisseur

| Point                            | Fichier                                                              | Portée                | Dans le périmètre de cette mission ?                            |
| -------------------------------- | -------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------- |
| Sélection méthode client         | `src/routes/checkout.tsx` + `src/lib/payment-method-availability.ts` | Checkout — 4 méthodes | **Oui** — Phase 7                                               |
| Sélection moteur de décaissement | `src/components/dashboard/payouts/payout-pay-modal.tsx`              | Admin décaissement    | **Non — "Décaissement" est explicitement exclu par la mission** |

## 3. Tous les RPC concernés (lus, aucun modifié)

| RPC                                                                                                                      | Rôle                                                                                                                                                                | Concernée ?                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `create_collect_payment_secure(_payment_id, _external_reference, _status, _error)`                                       | Enregistre une tentative de paiement Collect, y compris un échec sans jamais appeler le fournisseur                                                                 | **Oui — sera réutilisée telle quelle** (voir § 5)         |
| `complete_collect_payment_secure`                                                                                        | Finalise un paiement Collect (`service_role` uniquement)                                                                                                            | Non modifiée, sans lien direct avec la disponibilité      |
| `create_pending_payout_secure`, `initiate_payout_secure`, `complete_pending_payout_secure`, `fail_pending_payout_secure` | Décaissement                                                                                                                                                        | **Non — "Décaissement" explicitement exclu**              |
| `log_payment_provider_error_secure`                                                                                      | Journalise un échec de **décaissement** (paramètres `_restaurant_id`/`_driver_id`, structurellement incompatibles avec un flux Collect qui n'a pas de bénéficiaire) | Non réutilisable telle quelle pour Collect — voir § 5     |
| `has_role`, `private.has_role`                                                                                           | Vérification de rôle admin, déjà utilisée partout                                                                                                                   | Réutilisée telle quelle pour les nouvelles RPC de gestion |

**Aucune RPC existante ne sera modifiée.** Les nouvelles RPC nécessaires (Phase 1/6) sont additives.

## 4. Tous les appels `PaymentProvider` / `isConfigured()`

Recherche exhaustive dans `src/` :

| Fichier:ligne                                          | Contexte                                                                                                   | Dans le périmètre ?                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `initiate-collect-payment.logic.ts:39`                 | `if (!moncashProvider.isConfigured())` — **le seul point d'entrée réel d'un paiement Collect automatique** | **Oui — Phase 4, le point d'application central** |
| `initiate-provider-payout.functions.ts:55`             | `if (!provider                                                                                             |                                                   | !provider.isConfigured())` — décaissement | **Non — Décaissement exclu** |
| `payment-providers/types.ts:74`                        | Déclaration de l'interface                                                                                 | Lue, non modifiée                                 |
| `payment-providers/__tests__/moncash-provider.test.ts` | Tests existants du provider                                                                                | Non modifiés                                      |

**Confirmation clé** : il n'existe **qu'un seul appelant réel** de `moncashProvider.initiatePayment()` côté collecte dans toute l'application — `initiate-collect-payment.logic.ts`. C'est donc le seul et unique point où Phase 4 doit intervenir pour que "le backend devienne la seule source de vérité" côté Collect.

## 5. Journalisation des tentatives refusées — mécanisme déjà existant, réutilisable

`initiate-collect-payment.logic.ts` (lignes 54–64, code actuel) journalise déjà tout échec du fournisseur en appelant `create_collect_payment_secure` avec `_status: "failed"` et `_error: <message>` — **avant même que le provider ait été appelé avec succès**. Cette RPC écrit dans `payment_transactions`, déjà visible dans le dashboard admin MonCash.

**Conséquence pour Phase 5** : refuser une tentative parce que `enabled = false` (avant même de vérifier `isConfigured()` ou d'appeler le provider) peut suivre **exactement le même chemin** — un appel à `create_collect_payment_secure` avec un message clair, sans RPC ni table de journalisation supplémentaire. Pas de duplication de logique, pas de nouvelle infrastructure d'audit à construire.

## 6. Frontend — ce qui existe déjà et sera remplacé (pas dupliqué)

`src/lib/payment-method-availability.ts` (créé lors de la mission précédente) contient aujourd'hui une configuration **statique, codée en dur**, avec ce commentaire explicite dans son propre code :

> "a `payment_provider_settings` table ... is the natural next step and this shape mirrors it exactly — but adding a migration wasn't justified for a temporary, easily revertible measure."

**C'est exactement le point d'extension prévu.** Phase 7 remplace le contenu de ce module (la constante statique) par une lecture de la nouvelle table, **sans changer sa forme exportée** (`getPaymentMethodAvailability()`, `getDefaultPaymentMethod()`) — `checkout.tsx`, qui consomme déjà ces deux fonctions, n'a donc **rien à changer dans sa logique de rendu**, seulement à gérer un état de chargement (la donnée n'est plus disponible de façon synchrone).

## 7. Ce qui ne doit surtout pas être modifié (rappel, confirmé par cet audit)

- `payment_providers` (table existante) — intacte, § 1.
- Tout ce qui touche au décaissement : `initiate-provider-payout.functions.ts`, `payout-pay-modal.tsx`, `create_pending_payout_secure`/`initiate_payout_secure`/`complete_pending_payout_secure`/`fail_pending_payout_secure`, `log_payment_provider_error_secure`.
- `moncashProvider`, `natcashProvider`, `manualProvider`, l'interface `PaymentProvider` elle-même.
- `payment_transactions` (schéma inchangé — seulement de nouvelles lignes, comme aujourd'hui).
- Wallet, Commission, Notifications, Chat, GPS, Realtime — aucun de ces sous-systèmes n'apparaît dans aucun des fichiers listés ci-dessus, confirmé par cet audit.

## 8. Conclusion de l'audit

Le périmètre réel est plus étroit que la lecture initiale de la mission pourrait le suggérer : **un seul fichier métier à modifier** (`initiate-collect-payment.logic.ts`, ajout d'une vérification avant l'appel existant à `isConfigured()`), **un seul fichier frontend à adapter** (`payment-method-availability.ts`, changement de source de données sans changement de forme), plus la nouvelle table/RPC/UI admin. Le décaissement, `payment_providers`, et tout le reste de la plateforme restent hors de portée, confirmé explicitement par cet audit avant toute écriture de code.
