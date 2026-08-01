# Phase 0 — Audit : MonCash Client Checkout (Collect)

Lecture seule — aucune modification effectuée. Tout ce qui suit est
vérifié directement dans le code/la base de production actuelle, pas
supposé. Objectif : cartographier ce qui existe déjà avant de concevoir
le nouveau flux d'encaissement automatique.

## 1. Architecture checkout actuelle

`src/routes/checkout.tsx` — 3 méthodes de paiement proposées au client,
toutes explicitement "manuelles" aujourd'hui :

| Méthode | Libellé actuel | Comportement |
|---|---|---|
| `moncash` | "MonCash — Peman manyèl ak prèv" | Le client envoie l'argent lui-même, upload une preuve |
| `natcash` | "NatCash — Peman manyèl ak prèv" | Idem |
| `kach` | "Kach nan livrezon" | Paiement à la livraison, double confirmation client+livreur (déjà existant, hors périmètre) |

Le numéro de réception affiché au client (`platformPayout.data.moncash_number`/
`moncash_account_name`) est celui **de la plateforme elle-même**
(compte marchand admin), pas celui d'un restaurant — cohérent avec
`receiver_type IN ('admin','merchant')` sur `payments`.

## 2. Table `orders`

Colonnes pertinentes confirmées : `id`, `order_number`, `customer_id`,
`restaurant_id`, `total`, `status`. `order_status` (enum) :
`pending, confirmed, preparing, ready, assigned, picked_up, delivered,
cancelled, refunded`. Aucun lien direct vers un provider de paiement —
tout passe par la table `payments` (relation 1-N via `payments.order_id`).

## 3. Système `payments` existant

Colonnes confirmées : `id`, `order_id`, `method`, `status`, `amount`,
`currency`, `stripe_payment_intent_id`, `stripe_session_id`,
`transaction_ref`, `sender_name`, `sender_phone`, `reviewed_by`,
`reviewed_at`, `review_notes`, `receiver_type`, `receiver_restaurant_id`,
`receiver_number`, `receiver_account_name`, `cash_confirmation_status`,
`customer_confirmed_at`, `driver_confirmed_at`, `created_at`,
`updated_at`.

**Découverte notable** : `stripe_payment_intent_id`/`stripe_session_id`
existent déjà — un provider de paiement automatisé (Stripe) a déjà été
anticipé structurellement dans ce schéma, jamais activé
(`payment_method` enum inclut `stripe`, aucun code Stripe trouvé
ailleurs). Précédent utile : la table `payments` a déjà été pensée pour
accueillir un provider automatisé sans refonte.

`payment_status` (enum) : `pending, awaiting_proof, under_review, paid,
failed, refunded`. Table liée : `payment_proofs` (preuves uploadées,
`payment_id`, `file_url`, `transaction_ref`, `sender_phone`, `notes`,
`uploaded_by`).

## 4. RPC de paiement manuel existantes

| RPC | Rôle | Appelant |
|---|---|---|
| `submit_payment_proof_secure(_payment_id, _file_url, _transaction_ref, _sender_phone, _notes)` | Client uploade sa preuve — insère `payment_proofs`, fait passer `payments.status` : `awaiting_proof`/`pending` → `under_review` | `authenticated` (le client, propriétaire de la commande) |
| `review_manual_payment_secure(_payment_id, _decision, _note)` | Admin décide `paid`/`failed` — refuse tout statut source autre que `awaiting_proof`/`under_review` (protection double-clic/double-onglet déjà en place) | `authenticated`, mais garde interne `has_role(admin\|super_admin)` |

**Aucune des deux n'est appelable par un processus serveur non
authentifié** (webhook) — la seconde exige explicitly un rôle admin
humain. Un nouveau RPC `SECURITY DEFINER`, `service_role`-only, sera
nécessaire pour le webhook automatique — **jamais** en réutilisant
`review_manual_payment_secure` tel quel (il exigerait de faire passer le
webhook pour un admin, un contournement d'authorization à ne jamais
faire).

## 5. Notifications — découverte majeure, change la conception

**Un trigger existe déjà et gère automatiquement les notifications
client + restaurant sur tout changement de `payments.status`** :
`trg_notify_payment_status` (`AFTER UPDATE OF status ON payments`,
fonction `notify_payment_status_change()`) :

- `status = 'paid'` → notifie le client ("Peman ou apwouve") **et** le
  propriétaire du restaurant ("Nouvo kòmand konfime").
- `status = 'failed'` → notifie le client ("Peman ou rejte") et le
  restaurant ("Peman rejte").
- `status = 'under_review'` → notifie le client uniquement ("Prèv peman
  resevwa").

**Conséquence directe pour la conception** : si le nouveau flux
automatique fait passer `payments.status` à `paid`/`failed` de la même
manière que le flux manuel (via un `UPDATE`, pas un contournement), **ce
trigger se déclenche automatiquement** — les notifications "client :
paiement confirmé/échoué" et "restaurant : nouvelle commande payée"
demandées dans la mission sont **déjà couvertes, sans écrire une seule
ligne de notification neuve**, à condition que le nouveau RPC webhook
termine par un `UPDATE payments SET status = ...` classique (pas un
`INSERT`/upsert qui contournerait le trigger `AFTER UPDATE`). Seule
"Admin : monitoring erreurs paiement" est réellement nouvelle — même
patron que `log_payment_provider_error_secure` côté décaissement.

Ce trigger utilise un `INSERT INTO notifications` direct (pas
`private.notify_secure`) — cohérent avec la politique déjà établie
("~15 sites préexistants, jamais retrofités" — voir
docs/MONCASH_FINAL_PRODUCTION_VALIDATION.md § Phase 9). Le nouveau code
de ce chantier n'a pas besoin d'y toucher : le réutiliser tel quel est
la voie de moindre risque et la plus cohérente avec la trigger déjà
prouvée en production.

## 6. Statuts de commande — point d'intégration clé

`private.update_order_status_secure` **bloque déjà** la transition
`pending → confirmed` pour `moncash`/`natcash` tant que
`payments.status <> 'paid'` (un restaurant ne peut pas commencer à
préparer avant paiement vérifié ; admin garde un override manuel). Les
commandes `kach`/`stripe` ne sont pas concernées par ce verrou.

**Conséquence** : aucune modification de `update_order_status_secure`
n'est nécessaire pour ce chantier — le verrou existant fonctionnera
identiquement pour un paiement collect confirmé automatiquement,
puisqu'il ne regarde que `payments.status`, jamais *comment* ce statut a
été atteint.

## 7. Ce qui existe déjà côté connecteur MonCash (réutilisable tel quel)

`moncashProvider.initiatePayment({direction:"collect"})` — **déjà
implémenté et testé** (`moncash-client.server.ts` : `CreatePayment`,
`retrieveOrderPayment`) depuis le chantier de décaissement, mais **sans
aucun appelant** dans l'application. C'est la seule partie de ce
nouveau chantier qui n'est pas à écrire de zéro — `checkStatus()`,
`verifyWebhook()` (signature HMAC), timeout/retry/idempotence/journal
d'audit (`moncash_api_logs`) fonctionnent déjà indépendamment de la
direction. Reste à écrire : le RPC qui relie un `orderId` MonCash à une
ligne `payments`, la route webhook dédiée, et l'UI checkout.

---

## Points d'intégration identifiés

1. **Checkout** (`checkout.tsx`) — ajouter "MonCash Automatik" comme 4ᵉ
   option, appelant un nouveau server function qui crée le paiement
   MonCash puis redirige le client vers `redirectUrl` (déjà produit par
   `createPayment()`).
2. **Nouvelle table d'audit** `payment_transactions` (demandée
   explicitement, séparée des tables de décaissement) — trace chaque
   tentative provider pour le sens collect, liée à `payments.id`/
   `orders.id`.
3. **Nouveau RPC** `service_role`-only pour finaliser un paiement
   collect (`complete_collect_payment_secure`/
   `fail_collect_payment_secure`, ou équivalent) — termine par un
   `UPDATE payments SET status = ...` classique pour réutiliser le
   trigger de notification existant.
4. **Nouvelle route webhook** dédiée collect (`/api/webhooks/moncash-collect`
   ou un paramètre distinguant direction dans la route existante — à
   trancher) — **ne doit jamais partager `moncash_webhook_events`** (table
   du chantier décaissement) pour rester séparée comme demandé.
5. **UI checkout** — états "en attente/succès/échec/expiration" à
   afficher pendant que le client complète le paiement sur la page
   MonCash puis revient.

## Risques identifiés

| # | Risque | Sévérité |
|---|---|---|
| 1 | Le contrat MonCash Collect (CreatePayment/redirect) est documenté publiquement et déjà implémenté — **risque nettement plus faible que le décaissement**, mais toujours jamais testé contre un vrai compte marchand MonCash (aucun identifiant réel, inchangé depuis le tout premier audit) | Moyenne — bloquant pour un vrai test, pas pour écrire le code |
| 2 | Le trigger de notification existant (`notify_payment_status_change`) n'a **pas de branche `under_review`→notification pour le restaurant**, seulement le client — à confirmer si c'est voulu pour le flux automatique (probablement oui, `under_review` n'a pas vraiment de sens pour un paiement automatique qui passe direct `pending`→`paid`/`failed`) | Faible |
| 3 | `review_manual_payment_secure` interdit `_decision NOT IN ('paid','failed')` — le nouveau RPC automatique doit répliquer cette même restriction, pas l'étendre | Faible, à respecter en conception |
| 4 | Le webhook collect devra résoudre quelle commande/paiement correspond à un `orderId` MonCash — utiliser le même `payments.id` (ou un id dédié) comme référence, jamais deviner par montant/date | À concevoir soigneusement |

## Dépendances

- Aucune migration existante à modifier — tout est additif (nouvelle
  table, nouveaux RPC, aucun changement de `payments`/`orders`/
  `update_order_status_secure`/`notify_payment_status_change`).
- Dépend de `moncash-client.server.ts`/`moncash-config.server.ts`
  (déjà en place, réutilisés tels quels — mêmes 5 secrets `MONCASH_*`,
  toujours absents en production).
- Le webhook collect devra vérifier la signature via
  `moncashProvider.verifyWebhook()` — déjà implémenté, réutilisable
  sans modification.

---

## Ce qui n'est PAS touché (confirmé par cet audit, pas juste promis)

- `payouts`, `wallet_transactions`, `commission_ledger`,
  `moncash_webhook_events`, `moncash_api_logs` — aucune de ces tables du
  chantier décaissement n'a de raison d'être modifiée par ce nouveau
  chantier.
- `initiate_payout_secure`/`confirm_payout_secure`/
  `dispute_payout_secure`/`resolve_payout_dispute_secure` — non
  concernées.
- Paiement manuel MonCash/NatCash/Kach existant — le nouveau flux
  s'ajoute comme **4ᵉ option**, les 3 existantes restent inchangées
  dans `checkout.tsx`.

## Prochaine étape

Ce rapport clôt la Phase 0. Conformément à la contrainte "commencer par
audit" et à la pratique de tout ce chantier, **aucune ligne de code
n'a été écrite**. Sur votre confirmation, la suite (schéma
`payment_transactions`, RPC, route webhook, UI checkout, notifications
admin, tests) peut être conçue puis implémentée dans cet ordre.
