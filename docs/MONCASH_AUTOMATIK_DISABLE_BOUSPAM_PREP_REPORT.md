# MonCash Automatik — Préparation Bouspam — Points d'extension

**Date** : 2026-08-03
**Portée** : identifier précisément où le futur code Bouspam s'insérera. **Aucun code Bouspam n'est écrit ici** — ce document complète, sans le dupliquer, `docs/MONCASH_AUTOMATIK_PHASE0_AUDIT.md` (inventaire complet) et `docs/MONCASH_AUTOMATIK_PHASE0_CLARIFICATIONS.md` (points bloquants restant à lever auprès du fournisseur avant toute implémentation réelle).

---

## 1. Authentification — où le nouveau client sera injecté

**Fichier à créer** (n'existe pas) : `src/lib/payment-providers/moncash-automatik-config.server.ts`, sur le modèle exact de `moncash-config.server.ts` — sauf que seuls **2 secrets** sont nécessaires (`merchant_id`, `secret_key`) contre 5 pour l'intégration Digicel actuelle.

**Fichier à créer** : `src/lib/payment-providers/moncash-automatik-client.server.ts`, sur le modèle de `moncash-client.server.ts` — la fonction `requestAccessToken()`/`getAccessToken()` (cache + renouvellement basé sur `expires_at`, lignes 235–313 du fichier actuel) est la partie la plus directement transposable : même structure (token en cache mémoire, requête concurrente partagée via `pendingTokenRequest`), corps de requête différent (`POST /api/merchant/token/` avec JSON `{merchant_id, secret_key}` au lieu de Basic Auth + `grant_type=client_credentials`).

## 2. Création de paiement — où elle sera remplacée

**Fichier à modifier** (existe déjà) : `src/lib/payment-providers/moncash-provider.server.ts` — la fonction `initiatePayment()` (lignes 108–154) reste la même signature d'interface (`PaymentProvider.initiatePayment`), seul son corps change : `createPayment(orderId, amount)` du client Digicel est remplacé par un appel au nouveau client Bouspam (`POST /api/merchant/payments/moncash/`). **Aucun appelant de `moncashProvider` n'a besoin de changer** — `initiate-collect-payment.logic.ts` (orchestration) reste identique, confirmé en Phase 0.

## 3. Vérification — où elle sera remplacée

Même fichier, fonction `checkStatus()` (lignes 156–172) — `retrieveOrderPayment()` du client Digicel remplacé par un appel `GET /api/merchant/payments/moncash/verify/<transaction_id>/` du nouveau client. Le format de retour (`status: pending|completed|failed`) est plus simple que celui de Digicel (`successful|failed|unknown` déduit d'un champ `message` texte) — la fonction `normalizeStatus()` correspondante côté Bouspam sera plus directe, pas une déduction heuristique.

## 4. Callback / Return URL — où il sera ajouté (composant qui n'existe pas aujourd'hui)

**Nouveau composant, pas un remplacement** : contrairement à l'authentification/création/vérification (qui remplacent du code Digicel existant), la route de retour utilisateur **n'a pas d'équivalent actuel** — l'intégration Digicel n'a jamais eu de route de retour dédiée (elle dépendait uniquement d'un webhook asynchrone, lui-même jamais confirmé par Digicel).

**Fichier à créer** (chemin exact non déterminé — dépend de la réponse à la question bloquante § 1 de `MONCASH_AUTOMATIK_PHASE0_CLARIFICATIONS.md`) : une route TanStack Start, ex. `src/routes/checkout.return.tsx` ou `src/routes/api.moncash-automatik.callback.ts`, dont la responsabilité sera : recevoir la redirection, ignorer le contenu de `?status=...` comme preuve, appeler `GET verify/<transaction_id>` côté serveur, puis suivre exactement le même chemin que `moncash-collect-webhook-handler.server.ts` aujourd'hui — reconstituer un appel à `complete_collect_payment_secure` (RPC existante, **inchangée**) à partir d'un résultat de vérification fiable plutôt que d'un webhook signé.

**Ce que ceci implique pour `moncash-provider.server.ts`** : la méthode `verifyWebhook()` de l'interface `PaymentProvider` (utilisée aujourd'hui par le webhook handler) n'aura probablement plus d'équivalent direct pour Bouspam, faute de webhook documenté — question ouverte déjà identifiée en Phase 0 (§ 6, point 4), non résolue ici.

## 5. Où le changement temporaire de cette mission sera défait

**Un seul point de retour en arrière** : `src/lib/payment-method-availability.ts`, objet `PAYMENT_METHOD_AVAILABILITY.moncash_auto` → `enabled: true` (et retrait du `maintenanceMessage`, ou conservation pour un futur usage similaire). Le fait que ce module soit la source unique de vérité (Phase 4) signifie que réactiver la méthode ne touche ni `checkout.tsx`, ni aucun composant — un seul changement de données.

## 6. Ce que cette préparation ne couvre pas (rappel)

Les 8 questions posées au fournisseur dans `docs/MONCASH_AUTOMATIK_PHASE0_CLARIFICATIONS.md` restent entières — en particulier le mécanisme de déclaration du `return_url` (point 1) et l'absence totale de signature sur le callback (point 7), qui conditionnent directement la conception exacte du point § 4 ci-dessus. Ce document identifie **où** le code ira, pas **ce qu'il fera exactement** tant que ces réponses ne sont pas obtenues.
