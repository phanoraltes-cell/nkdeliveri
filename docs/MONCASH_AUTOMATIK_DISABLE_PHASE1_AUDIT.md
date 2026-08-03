# MonCash Automatik — Désactivation temporaire — Phase 1 — Audit

**Date** : 2026-08-03
**Portée** : identifier tout ce qui touche "MonCash Automatik" côté frontend, avant toute modification. Aucun fichier n'a été modifié pour produire ce rapport.

---

## 1. Recherche exhaustive — toutes les occurrences

Recherche de `moncash_auto` et `MonCash Automatik` dans tout `src/` :

```
src/routes/checkout.tsx                                  ← seul fichier client-facing
src/components/dashboard/payouts/payout-pay-modal.tsx    ← décaissement admin, sans rapport
src/routes/_authenticated/dashboard.admin.finance.tsx     ← texte descriptif de monitoring
src/routes/_authenticated/dashboard.admin.moncash.tsx     ← monitoring admin
src/lib/initiate-collect-payment.functions.ts             ← backend, orchestration
src/lib/initiate-collect-payment.logic.ts                 ← backend, orchestration
src/lib/payment-providers/moncash-reconcile.server.ts     ← backend, décaissement
src/routes/api.cron.moncash-reconcile.ts                  ← backend, cron
src/lib/__tests__/initiate-collect-payment.test.ts        ← test backend existant
```

## 2. Classification — un seul fichier client-facing concerné

| Fichier | Nature | Concerné par cette mission ? |
|---|---|---|
| `src/routes/checkout.tsx` | Page de checkout client, sélection de méthode de paiement | **Oui — seul fichier à modifier** |
| `src/components/dashboard/payouts/payout-pay-modal.tsx` | Modale admin de décaissement (paiement plateforme → restaurant/livreur) — un `provider_code: "moncash_api"` distinct, flux de **décaissement**, pas de **collecte** client | Non — hors périmètre (mission scope = "Checkout" client) |
| `dashboard.admin.finance.tsx`, `dashboard.admin.moncash.tsx` | Monitoring admin en lecture seule | Non — aucune action utilisateur, pas de sélection de méthode |
| `initiate-collect-payment.functions.ts` / `.logic.ts` | Backend — appelle `moncashProvider.isConfigured()` | Non — protection déjà en place, voir Phase 5 |
| `moncash-reconcile.server.ts`, `api.cron.moncash-reconcile.ts` | Backend — réconciliation décaissement | Non — flux distinct (décaissement, pas collecte) |
| `initiate-collect-payment.test.ts` | Test backend existant | Non modifié — testé en Phase 6 pour confirmer l'absence de régression |

**Conclusion : l'intégralité de la surface client-facing de "MonCash Automatik" tient dans un seul fichier, `src/routes/checkout.tsx`.**

## 3. `checkout.tsx` — détail exact des 5 occurrences

| Ligne | Code | Rôle |
|---|---|---|
| 24–39 | `const METHODS = [...]` | Tableau des 4 méthodes affichées — `moncash_auto` est le premier élément |
| 47 | `useState<CheckoutMethod>("moncash_auto")` | **État initial — méthode sélectionnée par défaut au chargement de la page** |
| 119 | `const orderMethod = method === "moncash_auto" ? "moncash" : method` | Traduit le choix UI vers l'énumération `payment_method` de la commande (`moncash`/`natcash`/`kach`) — `create_order_secure` ne connaît que ces 3 valeurs, jamais `moncash_auto` lui-même |
| 171–207 | `if (method === "moncash_auto") { ... }` | Bloc `submit()` — appelle `initiateCollect()`, gère redirection plein-navigateur |
| 404–420 | `{method === "moncash_auto" && (...)}` | Encart informatif affiché sous les boutons quand cette méthode est sélectionnée |

## 4. Validations concernées

Aucune validation Zod/serveur ne référence `moncash_auto` directement — la validation d'entrée de `initiate-collect-payment.functions.ts` (`InitiateCollectPaymentInputSchema`) porte sur un `paymentId` UUID, jamais sur le nom de la méthode. Le seul filtre de méthode a lieu dans `initiate-collect-payment.logic.ts:34` (`payment.method !== "moncash"` → refus) — c'est une protection **backend indépendante de l'UI**, déjà en place (voir Phase 5).

## 5. Appels React concernés

- `useState` pour `method` (état local, pas de state global/store).
- `useServerFn(initiateCollectPayment)` — le hook TanStack Start qui expose la fonction serveur ; **non appelé du tout si `method !== "moncash_auto"`**, donc le désactiver au niveau du bouton empêche déjà mécaniquement tout appel réseau vers cette fonction depuis l'UI normale.
- Aucun `useEffect`, aucune query React Query ne dépend de la méthode sélectionnée pour MonCash Automatik spécifiquement (les queries `platformPayout`/`restaurantFee`/`savedAddresses` sont indépendantes de `method`).

## 6. Dépendances

- `payment-providers/moncash-provider.server.ts` (`.server.ts`, jamais importé côté client — confirmé par la convention déjà en place dans ce projet, le build échoue sinon).
- Aucune dépendance npm nouvelle requise pour cette mission.
- Aucune dépendance vers `payment_providers` (table) depuis `checkout.tsx` aujourd'hui — **confirmé : il n'existe actuellement aucune vérification de disponibilité en direct dans l'UI checkout**, ni via `is_active`, ni via `isConfigured()`. C'est exactement le vide que la Phase 4 (architecture évolutive) est censée préparer, sans le combler définitivement dans cette mission.

## 7. Ce qui NE sera PAS touché (rappel, confirmé par cet audit)

- `PaymentProvider` (interface, implémentations) — zéro modification prévue.
- `create_collect_payment_secure`, `complete_collect_payment_secure` — zéro modification prévue.
- La table `payment_transactions` — zéro modification prévue.
- `moncashProvider.isConfigured()` / `moncash-config.server.ts` — zéro modification prévue.
- Le flux `payout-pay-modal.tsx` (décaissement admin) — distinct, non concerné.
- Toute commande déjà passée (aucune donnée existante n'est affectée par un changement purement présentationnel côté `checkout.tsx`).

---

**Conclusion de l'audit** : la mission est bien circonscrite à un seul fichier. Aucun élément inattendu, aucune dépendance cachée. Prêt pour la Phase 2.
