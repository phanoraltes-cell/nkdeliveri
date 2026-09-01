# NK Deliveri — Configuration MonCash (référence canonique, v1.0)

**But de ce document** : lever, une fois pour toutes, l'ambiguïté sur ce que contrôle réellement `payment_providers.moncash_api.is_active`. C'est une clarification documentaire uniquement — **aucune ligne de code n'a été modifiée pour produire ce document**, ni `initiate-collect-payment.logic.ts`, ni `moncashProvider.isConfigured()`, ni aucun autre fichier de logique métier. Le comportement actuel du paiement MonCash en production reste strictement inchangé.

Ce projet a accumulé une trentaine de documents MonCash au fil des phases (contrat, webhook, sécurité, tests, go-live, activation...). Ce document ne les remplace pas — il tranche spécifiquement la question du flag, qui a été source de confusion répétée dans les audits de cette session.

---

## Le fait central, en une phrase

**Il y a deux flux MonCash entièrement indépendants dans cette application, et un seul des deux est gardé par `payment_providers.moncash_api.is_active`.**

|                              | Flux **Collect** (client → plateforme)                                        | Flux **Décaissement** (plateforme → restaurant/livreur)      |
| ---------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Où                           | `checkout.tsx` (page de paiement client)                                      | `payout-pay-modal.tsx` (modale admin)                        |
| Code serveur                 | `initiate-collect-payment.functions.ts` → `initiate-collect-payment.logic.ts` | `initiate-provider-payout.functions.ts`                      |
| Gardé par `is_active` ?      | **Non, jamais**                                                               | **Oui**                                                      |
| Gardé par `isConfigured()` ? | Oui, exclusivement                                                            | Oui, en plus de `is_active`                                  |
| Statut réel en production    | **Actif** (Go-Live confirmé, cette session)                                   | **Inactif** (voir § "Pourquoi le décaissement reste refusé") |

---

## Ce que `is_active` contrôle réellement

Une seule chose, précisément : **si `moncash_api` apparaît comme option sélectionnable dans le menu déroulant de `payout-pay-modal.tsx`**, la modale que l'admin utilise pour payer un restaurant ou un livreur.

Preuve dans le code (lu directement, pas supposé) :

- `src/lib/payment-providers/index.server.ts:26-28` — commentaire du registre : _"`payment_providers.is_active` (the DB row) is the actual gate the admin form respects."_
- `src/lib/initiate-provider-payout.functions.ts:42-46` — commentaire : _"attempting to select moncash_api in the payout form, which the UI already disables via `payment_providers.is_active`."_

C'est tout. Rien dans cette chaîne de code n'est jamais appelé depuis `checkout.tsx` ou depuis `initiate-collect-payment.logic.ts`.

## Ce que `is_active` ne contrôle PAS

Le paiement client (Collect). Preuve dans le code :

- `src/routes/checkout.tsx:24-39` — la méthode "MonCash Automatik" (`id: "moncash_auto"`) fait partie d'un tableau `METHODS` statique, affiché **sans aucune condition**, présélectionnée par défaut (`useState<CheckoutMethod>("moncash_auto")`).
- `src/lib/initiate-collect-payment.logic.ts:38-41` — la seule vérification avant d'appeler MonCash :
  ```ts
  const { moncashProvider } = await import("@/lib/payment-providers/moncash-provider.server");
  if (!moncashProvider.isConfigured()) {
    return { outcome: "failed", error: "MonCash Automatik pa konfigire toujou" };
  }
  ```
  Aucune lecture de `payment_providers.is_active` nulle part dans ce fichier, ni dans `initiate-collect-payment.functions.ts` qui l'appelle.

**Conséquence concrète, vérifiée en direct le 2026-08-01** : `payment_providers.moncash_api.is_active = false` en base de production aujourd'hui, et pourtant un client réel peut payer via MonCash Collect en ce moment même, parce que les 5 variables d'environnement `MONCASH_*` sont présentes sur Vercel Production. Le flag et le comportement réel du paiement client ne sont pas liés.

## Le piège de nommage

Les deux flux utilisent, indépendamment, le même libellé en kreyòl **"MonCash Automatik"** :

- Dans `checkout.tsx` : le mode de paiement client automatique — **en production**.
- Dans `payout-pay-modal.tsx` (via le tableau documenté dans `docs/PAYMENT_PROVIDERS.md` § "Dashboard admin") : l'option `provider_code = moncash_api` pour le décaissement admin — **inatteignable en production** (voir ci-dessous).

Lire "MonCash Automatik" sans préciser lequel des deux écrans est en question est la source directe de la confusion que ce document corrige. `docs/PAYMENT_PROVIDERS.md` a été mis à jour (2026-08-01) pour porter cet avertissement en tête de document.

---

## Pourquoi le décaissement reste refusé, indépendamment de `is_active`

Même si `is_active` passait à `true` aujourd'hui, un décaissement MonCash réel ne partirait toujours pas, à cause d'une troisième porte, dans le code du connecteur lui-même : `moncashProvider.initiatePayment()` vérifie explicitement `input.direction` et renvoie un échec clair pour `"disburse"` — jamais un succès inventé. Raison de fond (documentée dans `docs/PAYMENT_PROVIDERS.md` § "Ce qui n'est PAS fait") : l'API publique MonCash Business est une passerelle de **collecte** marchande, elle ne documente aucun point final pour envoyer de l'argent vers un numéro de téléphone arbitraire — ce qui est le besoin réel du décaissement. Activer réellement le décaissement nécessiterait un contrat B2C confirmé avec Digicel/MonCash, qui n'existe pas aujourd'hui.

Donc `is_active = false` aujourd'hui est **cohérent avec la réalité** (le décaissement n'a de toute façon aucun chemin réel), mais ce n'est pas _pour cette raison-là_ qu'il protège quoi que ce soit côté client — il ne l'a jamais fait.

---

## Pourquoi cette décision est conservée telle quelle pour la v1.0

Trois options ont été évaluées (voir `docs/GO_LIVE_DECISION_REPORT.md` § 2 pour l'analyse complète impact/risque/effort) :

- **Option retenue pour la v1.0 — ne rien changer au comportement, corriger uniquement la documentation.** Le Collect client est déjà en production, fonctionne correctement, et est gardé par le mécanisme réel (`isConfigured()`), pas par un flag mal nommé. Changer le comportement du paiement client dans la fenêtre resserrée d'un Go-Live, pour corriger un problème de _lisibilité_ plutôt qu'un problème _fonctionnel_, aurait introduit un risque réel (paiement en production) pour un bénéfice purement cosmétique.
- **Option non retenue (Option B, explicitement exclue de cette mission)** : faire vérifier `is_active` aussi par `initiate-collect-payment.logic.ts`, pour que le flag redevienne un vrai kill-switch global couvrant les deux flux. Techniquement simple (un appel RPC de plus), mais c'est un changement de comportement du paiement client réel — nécessite sa propre validation transactionnelle dédiée et sa propre fenêtre de déploiement, pas une correction de documentation. Reste une option valable pour une itération future, sur demande explicite séparée.
- **Option non retenue** : renommer le flag en base (`is_active` → quelque chose comme `payout_provider_enabled`). Rejetée pour la v1.0 car cela nécessite une migration de schéma pour un problème que la documentation suffit à résoudre.

**En résumé** : le comportement actuel est correct et sûr (chaque flux est gardé par le bon mécanisme), seule sa _description_ était ambiguë. C'est ce que ce document, et les deux correctifs apportés à `docs/PAYMENT_PROVIDERS.md`, résolvent.

---

## Référence rapide — les 5 variables d'environnement

(Détail complet, procédure de configuration, rotation : `docs/PAYMENT_PROVIDERS.md` § "Gestion des secrets MonCash" — non dupliqué ici.)

| Variable                                         | Contrôle                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `MONCASH_CLIENT_ID`                              | avec les 4 autres, détermine `isConfigured()` → active le Collect client                       |
| `MONCASH_CLIENT_SECRET`                          | idem                                                                                           |
| `MONCASH_MERCHANT_ID`                            | idem                                                                                           |
| `MONCASH_API_URL`                                | idem                                                                                           |
| `MONCASH_WEBHOOK_SECRET`                         | idem                                                                                           |
| `payment_providers.moncash_api.is_active` (base) | **uniquement** la visibilité de `moncash_api` dans `payout-pay-modal.tsx` (décaissement admin) |

Aucune de ces 6 valeurs n'a été modifiée par cette mission — l'état vérifié en direct le 2026-08-01 (5 variables présentes sur Vercel Production, `is_active = false` en base) reste inchangé après ce Phase 4.
