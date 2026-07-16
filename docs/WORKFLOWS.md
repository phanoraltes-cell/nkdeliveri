# Workflows métier — NK Deliveri

Ce document trace, étape par étape, les huit parcours principaux de la
plateforme, avec les routes et les appels RPC/fonctions serveur réellement
impliqués — vérifié directement dans le code, pas décrit de mémoire.

## 1. Parcours Client

1. **Inscription** — `/auth/register` (type "customer") → `auth.signUp` Supabase.
2. **Navigation** — `/restaurants` → `/restaurants/$slug`, ajout d'articles au panier (`useCart`, stocké côté client).
3. **Commande** — `/checkout` → RPC `create_order_secure` → redirection vers `/orders/$id`. La fonction serveur `sendNewOrderPush` se déclenche ensuite (best-effort, non bloquant) pour notifier le restaurant.
4. **Paiement** — sur `/orders/$id`, le composant `PaymentProofSection` → RPC `submit_payment_proof_secure` pour MonCash/NatCash (le paiement en espèces ne nécessite pas de preuve).
5. **Suivi** — `/orders/$id`, `DeliveryTrackingSection` (hooks `useOrderDelivery`/`useRoute`, Realtime Supabase + carte Leaflet, aucun RPC — lecture directe des tables `deliveries`/`drivers`).
6. **Réception** — la commande passe à `delivered` quand le livreur met à jour son statut sur `/dashboard/driver/history`.
7. **Avis** — `OrderReviewSection` sur `/orders/$id` (écriture directe dans la table des avis, protégée par RLS).
8. **Remboursement** — `RefundSection` sur `/orders/$id` → RPC `request_refund_secure` ; traité par un admin sur `/dashboard/admin/refunds` (`review_refund_secure`, `complete_refund_secure`).

Un client peut aussi ouvrir un **litige** depuis `/orders/$id` (`DisputeSection` → RPC `open_dispute_secure`), avec des échanges ultérieurs via le hook `useDisputeMessages` → RPC `add_dispute_message_secure`.

## 2. Parcours Restaurant

1. **Inscription** — `/auth/register` (type "restaurant") + upload de documents (fonction serveur `finalizeRegistrationDocuments`) → approbation admin sur `/dashboard/admin/` (RPC `update_restaurant_status_secure`).
2. **Gestion du menu** — `/dashboard/restaurant/menu` : RPCs `create_menu_category_secure`, `update_menu_category_secure`, `delete_menu_category_secure`, `delete_product_secure`, `create_product_secure`, `update_product_secure`.
3. **Gestion des commandes** — `/dashboard/restaurant/orders` : RPC `update_order_status_secure` fait progresser `confirmed → preparing → ready` ; déclenche `sendOrderStatusPush`.
4. **Préparation** — impression du bon de cuisine (`printKitchenTicket`, entièrement côté client, aucun RPC) depuis la même page.
5. **Promotions** — `/dashboard/restaurant/promotions` : RPCs `create_promotion_secure`, `update_promotion_secure`, `delete_promotion_secure` ; déclenche `sendNewPromotionPush`. **Voir la section 8 — affichage uniquement, jamais appliqué au montant d'une commande.**
6. **Employés** — `/dashboard/restaurant/employees` : RPCs `list_restaurant_employees_secure`, `add_restaurant_employee_secure`, `remove_restaurant_employee_secure`, `update_restaurant_employee_role_secure`.
7. **Paiements** — `/dashboard/restaurant/payouts` (RPC `update_restaurant_payout_secure`) et `/dashboard/restaurant/revenue` (RPC `get_restaurant_revenue_summary`) pour le rapprochement.

## 3. Parcours Livreur

1. **Inscription** — `/auth/register` (type "driver") → approbation admin (RPC `update_driver_status_secure`).
2. **Passage en ligne** — bascule sur `/dashboard/driver/` → mise à jour directe `drivers.status = 'online'`.
3. **Réception des courses** — `/dashboard/driver/available` → RPC `claim_delivery_secure` → `sendDeliveryAssignedPush`.
4. **Navigation/GPS** — hook `useDriverLocation` : `navigator.geolocation.watchPosition`, throttlé toutes les 8 secondes, écrit directement dans `drivers.current_lat/current_lng` et `deliveries.driver_lat/driver_lng` (pas de RPC — écritures de table protégées par RLS).
5. **Validation de livraison** — `/dashboard/driver/history` : mise à jour directe `deliveries.status = 'picked_up'` puis `'delivered'` ; cette dernière déclenche `sendOrderDeliveredPush`.
6. **Paiements** — `/dashboard/driver/earnings` (RPC `get_driver_earnings_summary`), `/dashboard/driver/payouts` (RPC `update_driver_payout_secure`).

## 4. Parcours Administrateur

1. **Supervision** — `/dashboard/admin/` : carte en temps réel de toutes les commandes actives (`useLiveOrders({admin:true})`), livreurs en ligne, graphique de revenus.
2. **Utilisateurs** — `/dashboard/admin/users` : RPCs `get_all_users_admin`, `add_user_role_secure`, `remove_user_role_secure` ; fonctions serveur `suspendUserAccount`/`reactivateUserAccount`.
3. **Restaurants** — `/dashboard/admin/restaurants` : RPC `get_restaurants_admin`, `update_restaurant_commission_secure` ; approbations également possibles depuis `/dashboard/admin/`.
4. **Paiements** — `/dashboard/admin/payments` : revue des preuves de paiement manuel, approbation/rejet, `sendPaymentReviewPush` ; `/dashboard/admin/payout-settings` pour la configuration plateforme.
5. **Remboursements** — `/dashboard/admin/refunds` : RPCs `review_refund_secure`, `complete_refund_secure`.
6. **Litiges** — `/dashboard/admin/disputes` : RPC `resolve_dispute_secure`.
7. **Clients** — `/dashboard/admin/customers` : RPC `get_customers_admin`, export CSV, diffusion newsletter (`sendNewsletterBroadcast`).
8. **Statistiques** — cartes KPI + graphique hebdomadaire sur `/dashboard/admin/` (requêtes directes, pas de RPC).

## 5. Workflow Paiement (MonCash / NatCash / espèces)

1. Sur `/checkout`, le client choisit une méthode ; RPCs `get_platform_payout_public` et `get_restaurant_payout_public` récupèrent le bon compte destinataire (mutualisé plateforme vs direct restaurant, selon `payout_mode`).
2. Commande créée via `create_order_secure` — statut `pending` pour MonCash/NatCash (preuve requise), traitement immédiat possible pour les espèces.
3. Le client téléverse une capture d'écran/référence sur `/orders/$id` → RPC `submit_payment_proof_secure` → notification créée côté serveur, admin alerté via `sendPaymentReviewPush`.
4. L'admin traite la demande sur `/dashboard/admin/payments` — approbation marque le paiement `paid` (la commande passe à `confirmed`), rejet marque `failed`.
5. Les comptes de réception plateforme (`/dashboard/admin/payout-settings`), restaurant (`/dashboard/restaurant/payouts`) et livreur (`/dashboard/driver/payouts`) sont configurés indépendamment.

## 6. Workflow Livraison

1. Le restaurant marque la commande `ready` sur `/dashboard/restaurant/orders`.
2. La commande devient visible dans `/dashboard/driver/available` (liste des livraisons non assignées).
3. Un livreur la réclame — RPC `claim_delivery_secure` → `sendDeliveryAssignedPush`.
4. Le hook `useDriverLocation` du livreur transmet sa position GPS en continu tant que le statut est `assigned`/`picked_up`/`en_route_pickup`/`en_route_dropoff`.
5. Le livreur fait progresser le statut `picked_up` puis `delivered` sur `/dashboard/driver/history` — cette dernière étape déclenche `sendOrderDeliveredPush`.
6. Le client suit tout cela en direct sur `/orders/$id` (Realtime + Leaflet), l'admin voit l'ensemble du système sur `/dashboard/admin/`.

## 7. Workflow Notifications

- **In-app** (table `notifications`) : peuplée **côté serveur, directement par les fonctions SQL**, pas par du code client — `update_order_status_secure` (changement de statut de commande), `add_restaurant_employee_secure` et `update_restaurant_employee_role_secure` (validation d'employé), `create_promotion_secure` (nouvelle promotion) insèrent chacune une ligne dans `public.notifications` (voir `supabase/migrations/20260714133000_notification_coverage.sql`). Lues sur `/notifications` (filtrées par RLS sur `auth.uid()`), avec un aperçu sur `/dashboard/customer`.
- **Push web** : envoyé via les fonctions serveur TanStack Start dans `src/lib/send-*.functions.ts` (`sendNewOrderPush`, `sendDeliveryAssignedPush`, `sendOrderStatusPush`, `sendOrderDeliveredPush`, `sendPaymentReviewPush`, `sendRefundStatusPush`, `sendDisputeUpdatePush`, `sendEmployeeEventPush`, `sendNewPromotionPush`, `sendNewsletterBroadcast`), qui appellent toutes `pushToUsers` (`src/lib/push-dispatch.server.ts`) juste après le succès du RPC déclencheur côté client. Opt-in via `PushToggle` sur `/notifications`.

## 8. Workflow Promotions

**Vérifié dans le code : les promotions sont un affichage uniquement, jamais déduites du montant d'une commande.**

- `checkout.tsx` ne contient **aucune** référence à une promo/remise, et son seul appel de création de commande est `create_order_secure(_restaurant_id, _items, _delivery_address, _contact_phone, _delivery_notes, _method)` — aucun paramètre de remise n'existe dans aucune version de cette fonction à travers l'historique des migrations.
- La table `promotions` n'est lue qu'à trois endroits : `/dashboard/restaurant/promotions` (création/édition, côté restaurant), `/dashboard/customer` (cartes informatives avec badge de code), et `/dashboard/restaurant/` (probablement un compteur/raccourci).
- Il n'existe **aucun** champ de saisie de code promo au moment du paiement, et **aucune** logique serveur qui réduit `orders.total` en fonction d'une promotion active.

**À documenter clairement pour toute personne travaillant sur ce projet** : une "promotion" créée aujourd'hui est une annonce marketing affichée aux clients, pas un moteur de remise fonctionnel. Si une réduction réelle au paiement est un besoin métier, c'est une fonctionnalité à construire, pas un bug à corriger.
