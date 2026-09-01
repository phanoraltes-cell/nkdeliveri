# GO LIVE FINAL — Validation avant activation réelle de MonCash Automatik

## ⚠️ Constat qui doit primer sur tout le reste de ce rapport

La Section 1 demandée ("Paiement entrant client — création transaction
MonCash, appel API, réception webhook... mise à jour commande") décrit
un flux qui **n'existe pas dans ce codebase**. Vérifié par recherche de
code, pas supposé :

- `direction: "collect"` (le mode qui correspondrait à un client payant
  via MonCash) n'est référencé **nulle part dans le code applicatif** —
  seulement dans un commentaire ("a future checkout gateway") et dans
  mes propres tests unitaires.
- `getPaymentProvider`/`moncashProvider` ne sont appelés que depuis
  `payout-pay-modal.tsx` et `initiate-provider-payout.functions.ts` —
  **tous deux côté décaissement** (payer un restaurant/livreur), jamais
  côté encaissement (un client qui paie sa commande).
- Le paiement client par MonCash/NatCash qui existe réellement
  aujourd'hui (`create_order_secure`, `_method IN ('moncash',
'natcash')` → `payment_status = 'awaiting_proof'`) est le flux
  **manuel préexistant** : le client envoie l'argent lui-même depuis son
  application MonCash, uploade une preuve, le staff valide. Aucune
  connexion avec `moncash-client.server.ts`.

**Conséquence** : je ne peux pas "tester" un scénario de paiement
entrant automatique MonCash, parce qu'aucun code ne relie un checkout
client à `moncashProvider.initiatePayment()`. Ce n'est pas un bug à
corriger dans le cadre de cette mission ("ne pas modifier la logique
métier") — c'est une fonctionnalité qui n'a jamais été demandée ni
construite. Tout ce chantier, depuis son origine, a porté sur le
**décaissement** (payer restaurants/livreurs), jamais l'encaissement.
Le reste de ce rapport couvre donc les Sections 2 à 5 telles que
réellement applicables, plus une clarification de portée pour la
Section 3 ("paiement automatique" = décaissement automatique, le seul
sens qui corresponde à du code existant).

---

## Section 2 — Scénarios d'erreur

Tous testés et vérifiés, aucun changement depuis la dernière campagne —
reconfirmé en relançant la suite à l'instant : **32/32 tests passent**.

| Scénario                     | Résultat                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeout API                  | ✅ `code:"timeout"` distinct, structurel (pas un texte deviné)                                                                                                             |
| Erreur 4xx                   | ✅ Jamais réessayée (bonne pratique — un rejet métier ne se résout pas en répétant)                                                                                        |
| Erreur 5xx                   | ✅ Réessayée avec succès si une tentative ultérieure passe                                                                                                                 |
| Webhook invalide (signature) | ✅ `401`, aucune RPC appelée                                                                                                                                               |
| Webhook dupliqué             | ✅ `23505` (contrainte `UNIQUE`) → `200`, aucun retraitement — **vérifié aussi contre le vrai schéma live** (transaction repliée, zéro effet de bord), pas seulement mocké |

### Aucun double paiement / état incohérent / audit conservé

- **Idempotence à 3 niveaux indépendants** (client HTTP via unicité
  `orderId` MonCash, table `moncash_webhook_events` via
  `UNIQUE(event_id)`, RPC via `IF status <> 'pending' THEN RETURN`) —
  chacun testé séparément, aucun ne dépend des deux autres pour
  fonctionner.
- **Rollback réel vérifié** contre la base de production (transaction
  repliée) : `fail_pending_payout_secure` restitue le solde exact
  d'origine, aucune incohérence entre `available_balance` et
  `pending_balance`.
- **Audit conservé** : `moncash_api_logs` a ses triggers d'immutabilité
  **testés fonctionnellement en production** (`DELETE`/`UPDATE`
  réellement tentés et bloqués, pas juste vérifiés présents).

---

## Section 3 — Décaissement

**Clarification de portée** : "paiement automatique" ci-dessous
signifie décaissement automatique (MonCash Automatik payant un
restaurant/livreur), le seul flux MonCash automatisé qui existe dans ce
code.

| Élément                                                   | Statut                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commission restaurant/livreur                             | `commission_ledger` : 0 ligne en production aujourd'hui (plateforme sans données financières réelles pour l'instant) — moteur de commission lui-même **non touché** par tout le chantier MonCash, aucune régression possible par construction                                                                                                         |
| Création de payout                                        | `create_pending_payout_secure` — vérifié fonctionnellement (réservation `available_balance`→`pending_balance` confirmée par transaction repliée réelle)                                                                                                                                                                                               |
| **Paiement automatique (décaissement MonCash Automatik)** | **Toujours refusé par construction** — `moncashProvider.initiatePayment({direction:"disburse"})` échoue systématiquement, quelle que soit la configuration. Double verrou : `payment_providers.moncash_api.is_active = false` **et** ce refus au niveau code, indépendants l'un de l'autre. Confirmé à l'instant : `is_active = false` en production. |
| Fallback manuel                                           | ✅ Intact — `initiate_payout_secure`/`confirm_payout_secure`/`dispute_payout_secure`/`resolve_payout_dispute_secure` : les 4 présentes, permissions identiques à avant tout le chantier MonCash. C'est le **seul** chemin de décaissement réellement atteignable en production aujourd'hui, et il fonctionne comme avant.                             |

---

## Section 4 — Sécurité (reconfirmée à l'instant, pas réutilisée)

| Contrôle                    | Résultat                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secrets absents du frontend | Structurel — chaque module MonCash (`*.server.ts`) ne peut être importé que depuis un autre `.server.ts` ; le build échoue sinon. Aucun `MONCASH_*` sur Vercel de toute façon (confirmé à l'instant : 0 variable `MONCASH_*` en production).           |
| Permissions RPC             | `create_pending_payout_secure` : `authenticated`/`postgres`/`service_role` uniquement (`anon` retiré — correctif R1 confirmé toujours actif). `complete_pending_payout_secure`/`fail_pending_payout_secure` : `service_role` exclusivement.            |
| RLS                         | `moncash_api_logs`/`moncash_webhook_events` : lecture admin uniquement, écriture `service_role` uniquement.                                                                                                                                            |
| Logs sans données sensibles | `moncash_api_logs` : 0 ligne en production (aucune activité réelle) — le test dédié (`"never logs the Authorization header, client secret, or raw tokens"`) garantit qu'une future activité n'y introduira pas de secret, vérifié à chaque `npm test`. |

---

## Section 5 — Monitoring

| Contrôle          | Résultat                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard MonCash | `/dashboard/admin/moncash` répond `200` en production                                                                                                                                 |
| KPI               | Calculés depuis `payouts`/`moncash_api_logs`/`moncash_webhook_events` — actuellement tous à zéro (aucune activité réelle), cohérent et honnête, pas une erreur d'affichage            |
| Alertes           | 4 conditions automatiques codées (erreurs consécutives, webhook manquant, paiement bloqué, taux d'échec anormal) — aucune ne peut se déclencher aujourd'hui faute d'activité, correct |
| Logs              | Cron vérifié opérationnel (`0 3 * * *`, `CRON_SECRET` configuré et testé avec succès lors de la session précédente)                                                                   |

---

## Risques restants

| #   | Risque                                                                                                                                                                                                                         | Sévérité              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| 1   | **Aucun contrat B2C confirmé avec Digicel/MonCash** — bloquant externe, connu depuis le tout premier audit de ce chantier, inchangé                                                                                            | Bloquant              |
| 2   | **Aucun flux d'encaissement client automatique n'existe** (voir constat en tête de rapport) — si c'est un besoin réel, c'est un nouveau chantier à cadrer séparément, pas une extension de celui-ci                            | À clarifier avec vous |
| 3   | Cron limité à 1x/jour (plan Vercel Hobby) — acceptable tant que le décaissement automatique reste inactif, à revoir si activé un jour                                                                                          | Faible                |
| 4   | Aucune donnée financière réelle en production — chaque vérification de ce rapport porte sur un système vide ; un premier vrai flux (même manuel) mériterait une repasse de vérification une fois des données réelles présentes | Faible                |

---

## Recommandation finale

🔴 **NE PAS ACTIVER MonCash Automatik en décaissement réel** —
`payment_providers.moncash_api.is_active` doit rester `false`. Ce n'est
pas un problème de qualité ou de préparation du code (l'infrastructure
est testée, sécurisée, documentée, et déployée) — c'est que la
condition préalable externe (contrat B2C confirmé avec Digicel) n'a
jamais été remplie, exactement comme à chaque audit précédent de ce
chantier.

🟢 **L'infrastructure elle-même est prête et sûre à laisser en l'état**
— webhook, cron de réconciliation, journal d'audit, notifications,
dashboard : tous déployés, tous vérifiés, tous inertes par construction
tant que la condition ci-dessus n'est pas remplie. Rien à changer,
rien à activer avant cette confirmation externe.

🟡 **La Section 1 de cette mission suppose une fonctionnalité qui
n'existe pas** (encaissement client automatique) — recommandé de
clarifier avec vous si c'est un besoin réel avant de considérer ce
chantier "MonCash" comme complet dans son ensemble, ou si le périmètre
a toujours été, comme le code le montre, uniquement le décaissement.
