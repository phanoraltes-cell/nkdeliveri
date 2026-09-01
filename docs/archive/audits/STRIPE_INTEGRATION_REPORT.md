# Intégration Stripe (Kat Kredi) — Rapport d'implémentation

**Date** : 2026-08-05
**Portée** : nouveau moyen de paiement "Kat Kredi" via Stripe (Collect uniquement). **Aucune migration appliquée, aucun commit, aucun push.** Les clés API réelles seront configurées plus tard (demande explicite) — l'intégration est fonctionnelle mais reste inerte tant qu'elles ne sont pas définies.

## Statut

**🟡 PRÊT POUR VALIDATION — avec une réserve importante à trancher avant toute configuration réelle (voir § 1).**

---

## 1. ⚠️ Ce qu'il faut savoir avant de configurer de vraies clés Stripe

Découvert pendant ce chantier, jamais supposé silencieusement :

- **Haïti ne fait pas partie des ~46 pays où Stripe accepte l'ouverture d'un compte marchand.** Sans un montage alternatif (ex. une entité américaine — LLC + EIN + compte bancaire US), il n'est probablement pas possible d'obtenir de vraies clés Stripe directement en tant qu'entreprise haïtienne.
- **HTG (Gourde) n'est presque certainement pas une devise que Stripe règle directement** (non confirmé avec certitude dans un sens ou dans l'autre par la documentation publique consultée — jamais affirmé comme un fait ici). Chaque montant dans cette application est en HTG.

**Conséquence sur l'implémentation** : plutôt que de supposer une devise ou un taux de conversion (ce qui aurait pu sur-facturer ou sous-facturer chaque client), l'intégration est construite pour être **agnostique de la devise** :

- `STRIPE_PRESENTMENT_CURRENCY` (defaut `"usd"`) — la devise réellement facturée à Stripe.
- `STRIPE_HTG_CONVERSION_RATE` — **aucune valeur par défaut**, doit être définie explicitement (1 HTG = X unité de la devise choisie). Sans cette variable, `isStripeConfigured()` reste `false` et rien ne peut fonctionner.
- Ce taux est **manuel**, pas un flux de change en direct — à mettre à jour à la main périodiquement (limite connue, pas un flux de change réel).

**Ce que cela signifie concrètement pour vous** : avant d'activer ce moyen de paiement pour de vrai, il faudra probablement (a) confirmer comment vous comptez ouvrir un compte Stripe (entité étrangère ou solution alternative), et (b) définir/maintenir un taux de conversion HTG→devise choisie. Ce chantier ne tranche pas ces deux points — il les rend explicites et bloquants (rien ne fonctionne sans eux) plutôt que de les ignorer.

---

## 2. Ce qui a été construit

### 2.1 Fournisseur Stripe (Collect uniquement)

| Fichier                                                                       | Rôle                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stripe-config.server.ts`                                                     | Accès validé aux secrets (`STRIPE_SECRET_KEY`/`PUBLISHABLE_KEY`/`WEBHOOK_SECRET`/`PRESENTMENT_CURRENCY`/`HTG_CONVERSION_RATE`) — mêmes conventions que `plop-config.server.ts`                                                                                       |
| `stripe-client.server.ts`                                                     | Wrapper autour du **SDK officiel `stripe`** (v22, installé — `npm install stripe@22`) — Checkout Sessions (création, récupération par ID), vérification de signature webhook via `stripe.webhooks.constructEvent` (jamais une comparaison HMAC réinventée à la main) |
| `stripe-provider.server.ts`                                                   | Implémentation de l'interface `PaymentProvider` partagée — Collect uniquement, refuse `direction: "disburse"` comme tous les autres fournisseurs                                                                                                                     |
| `stripe-collect-webhook-handler.server.ts` + `api.webhooks.stripe.collect.ts` | Webhook réel (contrairement à PLOP qui n'en a aucun) — Stripe recommande ce mécanisme comme principal ; mêmes patrons que `moncash-collect-webhook-handler.server.ts`                                                                                                |

**Flux choisi** : Stripe Checkout Sessions (page hébergée, redirection) — même forme que le flux PLOP déjà en production (clic → redirection → retour → confirmation automatique), ce qui permet de réutiliser telles quelles l'infrastructure de polling existante (`useCollectPaymentPoll`) et les RPC (`create_collect_payment_secure`/`complete_collect_payment_secure`).

### 2.2 Écart de conception découvert et corrigé en cours de route

**Stripe n'offre aucun moyen de retrouver une session par une référence arbitraire** (contrairement à PLOP, dont l'API de vérification accepte directement notre propre référence). Seule une recherche par l'identifiant de session propre à Stripe fonctionne. Corrigé en :

- Ajoutant un paramètre `_provider_transaction_id` (optionnel) à `create_collect_payment_secure`, pour stocker l'ID de session Stripe **immédiatement** à la création.
- Faisant en sorte que `poll-collect-payment.logic.ts` regarde la colonne `provider` de la transaction pour savoir quelle valeur transmettre à quel fournisseur (la référence externe pour PLOP, l'ID de session Stripe pour Stripe) — jamais supposé silencieusement.

Un deuxième bug potentiel a été trouvé et corrigé avant même d'être écrit dans le code final : `stripeProvider.initiatePayment()` utilisait initialement la **référence de paiement** pour construire l'URL de retour Stripe, alors que la route `/orders/:id` attend l'**identifiant de commande**. Corrigé en ajoutant un champ `returnUrl?: string` à l'interface partagée `InitiatePaymentInput`, calculé par `initiate-collect-payment.logic.ts` (qui connaît l'order_id) et transmis à travers.

### 2.3 Base de données (migration `20260805140000_stripe_collect_integration.sql`, non appliquée)

- Nouvelle table `stripe_api_logs` (schéma identique à `plop_api_logs`/`moncash_api_logs`, append-only, lecture admin uniquement).
- Nouvelle ligne `payment_provider_settings` : `('stripe', true, false, false, ...)` — **désactivée par défaut**, même précaution que `moncash_auto`/`natcash_auto` à l'origine.
- `create_collect_payment_secure` — **changement de signature** (nouveau `_provider_transaction_id`), `DROP FUNCTION` puis `CREATE FUNCTION` selon la convention du projet ; élargit la liste de méthodes acceptées et la vérification de fournisseur activé pour inclure `stripe`.
- `complete_collect_payment_secure` — signature inchangée, seul le message de notification admin devient conscient du wallet (MonCash Otomatik / NatCash Otomatik / Kat Kredi).

### 2.4 Interface UI

- Nouveau bouton "Kat Kredi" dans `checkout.tsx`, logo générique `public/stripe-card-logo.svg` (un badge indigo avec une icône de carte — **pas** une reproduction du logo Stripe réel, dont ce projet n'a aucun fichier sous licence ; même principe que le logo générique créé précédemment pour "Payment Global").
- Encart explicatif dédié, distinct visuellement (couleur indigo différente de MonCash/NatCash) pour rester facilement différentiable.
- `dashboard.admin.payment-providers.tsx` : libellé "Kat Kredi (Stripe)".

### 2.5 Logo

`public/stripe-card-logo.svg` — badge générique (dégradé indigo/violet, carte + puce + bande magnétique), aucune forme copiée d'un logo de marque existant.

---

## 3. Tests

| Commande                   | Résultat                                                 |
| -------------------------- | -------------------------------------------------------- |
| `npm run typecheck`        | ✅ Propre                                                |
| `npm run lint`             | ✅ 0 erreur (12 avertissements préexistants)             |
| `npm run check:migrations` | ✅ "122 migrations scanned, 0 unresolved hazards"        |
| `npx vitest run`           | ✅ **105/105 tests** (15 nouveaux tests Stripe/dispatch) |
| `npx vite build`           | ✅ Réussi, 253 entrées precache PWA                      |

### Tests unitaires clés ajoutés

- **Dispatch correct** : un paiement `stripe` appelle exclusivement `stripeProvider`, jamais `plopProvider` (et vice-versa) — vérifié explicitement des deux côtés.
- **`returnUrl` construit correctement** depuis `order_id`, jamais depuis la référence de paiement.
- **`_provider_transaction_id` persisté** dès la création, avec la valeur exacte retournée par le "fournisseur".
- **Indépendance des 3 méthodes automatiques** : désactiver `stripe` ne bloque ni MonCash ni NatCash Otomatik, et désactiver `moncash_auto` ne bloque pas Stripe — preuve directe qu'il n'y a pas de verrou partagé par erreur (le bug que la NatCash/Stripe generalization visait justement à éviter).
- **Message d'erreur spécifique** ("Kat Kredi pa disponib pou kounye a.") quand Stripe est désactivé.
- **`isConfigured()` de PLOP jamais interrogé** pour un paiement Stripe, et vice-versa.

### Ce qui n'a PAS été testé (honnêteté)

- Aucun appel réel à l'API Stripe (aucune clé configurée, par design de cette mission).
- Le webhook n'a pas été testé avec un événement Stripe réel — sa logique suit fidèlement le SDK officiel (`stripe.webhooks.constructEvent`) et le patron déjà éprouvé du webhook MonCash Collect, mais ceci reste à valider en sandbox une fois des clés de test configurées.

---

## 4. Sécurité

| Contrôle                                                   | Résultat                                                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`/`WEBHOOK_SECRET` hors du bundle client | ✅ Vérifié directement sur la sortie du build (`.vercel/output/static`) — aucune trace                                                                    |
| Vérification de signature webhook                          | ✅ Via le SDK officiel (`stripe.webhooks.constructEvent`), jamais une comparaison HMAC réimplémentée à la main                                            |
| `.server.ts` sur chaque fichier sensible                   | ✅ Le build échoue si un composant les importe directement                                                                                                |
| RLS sur `stripe_api_logs`                                  | ✅ Lecture admin uniquement, écriture service_role uniquement, triggers append-only (réutilise `private.prevent_log_mutation()`)                          |
| Grants RPC                                                 | ✅ Inchangés pour les rôles déjà en place — `create_collect_payment_secure` reste `authenticated`, `complete_collect_payment_secure` reste `service_role` |

---

## 5. Compatibilité

Aucune régression identifiée : Cash, MonCash/NatCash Manyèl, MonCash/NatCash Otomatik, décaissements, dashboard financier — tous non touchés. Le registre partagé `index.server.ts` a dû recevoir une entrée `stripe_api` par obligation de complétude TypeScript (`Record<PaymentProviderCode, PaymentProvider>`), mais Collect n'y passe jamais (import direct, comme PLOP) et `stripeProvider` refuse tout `direction: "disburse"` de toute façon.

---

## 6. Ce qui reste à faire (sur votre validation)

1. **Décider comment ouvrir un vrai compte Stripe** depuis Haïti (§ 1) — un point business, pas technique.
2. **Définir `STRIPE_HTG_CONVERSION_RATE`** une fois cette décision prise, et un processus pour le maintenir à jour.
3. Configurer les 4 variables d'environnement (`.env.example` documente chacune).
4. Configurer l'URL de webhook dans le dashboard Stripe (`https://www.nkdeliveri.com/api/webhooks/stripe/collect`, événements `checkout.session.completed` et `checkout.session.expired`).
5. Appliquer la migration `20260805140000_stripe_collect_integration.sql`.
6. Activer `stripe` via le dashboard admin, puis tester en mode sandbox Stripe avant tout trafic réel.

---

## Verdict

**🟡 Implémentation complète et testée, mais avec une réserve business non résolue (compte Stripe + devise) à trancher avant toute configuration réelle.** Aucune migration appliquée, aucun commit créé.
