# Référence API — NK Deliveri

NK Deliveri n'expose pas d'API REST/GraphQL applicative classique. La
« surface d'API » du projet, ce sont :

1. Les **fonctions RPC Postgres** exposées par Supabase (appelées via
   `supabase.rpc(name, args)`), qui portent toute la logique métier
   protégée.
2. Les **fonctions serveur TanStack Start** (`createServerFn`, fichiers
   `src/lib/*.functions.ts`), pour les effets de bord ne touchant pas
   directement RLS (push, e-mail, opérations `service_role`).
3. Deux **routes serveur brutes** (`/robots.txt`, `/sitemap.xml`).

Toutes les lectures de table simples (SELECT direct via `supabase-js`,
protégées par RLS) ne sont pas listées ici individuellement — voir
[DATABASE.md § RLS](./DATABASE.md#3-row-level-security-rls) pour qui peut
lire quoi.

## 1. Fonctions RPC Postgres

Convention d'erreur : les refus d'autorisation lèvent le SQLSTATE `42501`
(« Forbidden »/erreur Postgres générique côté client) ; les dépassements de
rate-limit lèvent `42901` avec un message utilisateur en kreyòl. Toute autre
erreur de validation lève une exception PL/pgSQL générique dont le message
est renvoyé tel quel par `supabase-js` dans `error.message`.

### Commandes

| RPC                           | Paramètres                                                                                                                     | Retour                     | Qui peut appeler                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_order_secure`         | `_restaurant_id uuid, _items jsonb, _delivery_address text, _contact_phone text, _delivery_notes text, _method payment_method` | `uuid` (id de la commande) | Tout utilisateur authentifié (crée pour lui-même). **Rate-limit** : 8/600s                                                                                              |
| `update_order_status_secure`  | `_order_id uuid, _new_status order_status`                                                                                     | `orders`                   | admin/super_admin (toute transition) ; owner/employé restaurant (pending→confirmed→preparing→ready + annulation) ; livreur assigné (ready→assigned→picked_up→delivered) |
| `claim_delivery_secure`       | `_order_id uuid`                                                                                                               | `deliveries`               | livreur `status='online'`, commande `ready` et non réclamée. **Rate-limit** : 20/300s                                                                                   |
| `submit_payment_proof_secure` | `_payment_id uuid, _file_url text, _transaction_ref text, _sender_phone text, _notes text`                                     | `payments`                 | propriétaire de la commande liée, paiement `awaiting_proof`/`pending`. **Rate-limit** : 5/600s                                                                          |

### Menu / produits / promotions

Toutes réservées à owner/admin, **ou** un employé avec `role` dans
(`staff`,`manager`,`supervisor`) via `private.is_restaurant_staff_or_manager`
— sauf mention contraire.

| RPC                           | Paramètres                                                                                                                                                                 | Retour                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `create_menu_category_secure` | `_restaurant_id uuid, _name text, _sort_order int = 0`                                                                                                                     | `menu_categories`                                                                            |
| `update_menu_category_secure` | `_category_id uuid, _name text, _sort_order int`                                                                                                                           | `menu_categories`                                                                            |
| `delete_menu_category_secure` | `_category_id uuid`                                                                                                                                                        | `void`                                                                                       |
| `create_product_secure`       | `_restaurant_id uuid, _category_id uuid, _name text, _description text, _price numeric, _image_url text, _dish_type text, _stock_quantity integer = NULL`                  | `products`                                                                                   |
| `update_product_secure`       | `_product_id uuid, _name text, _description text, _price numeric, _image_url text, _dish_type text, _category_id uuid, _available boolean, _stock_quantity integer = NULL` | `products`                                                                                   |
| `delete_product_secure`       | `_product_id uuid`                                                                                                                                                         | `void` (suppression logique : `archived_at`, `available=false`)                              |
| `create_promotion_secure`     | `_restaurant_id, _title, _description, _discount_type, _discount_value, _code, _starts_at, _ends_at`                                                                       | `promotions` — **owner/admin uniquement**, notifie les clients ayant le restaurant en favori |
| `update_promotion_secure`     | `_promotion_id, _title, _description, _discount_type, _discount_value, _code, _starts_at, _ends_at, _active boolean`                                                       | `promotions` — owner/admin                                                                   |
| `delete_promotion_secure`     | `_promotion_id uuid`                                                                                                                                                       | `void` — owner/admin                                                                         |

### Profil / paiement / commission restaurant

| RPC                                   | Paramètres                                                                                                     | Qui                                                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `update_restaurant_profile_secure`    | `_restaurant_id, _name, _description, _cuisine, _phone, _address, _logo_url, _cover_url`                       | owner/admin                                                                                                                   |
| `update_restaurant_hours_secure`      | `_restaurant_id uuid, _opening_hours jsonb`                                                                    | owner/admin                                                                                                                   |
| `update_restaurant_status_secure`     | `_restaurant_id uuid, _status restaurant_status`                                                               | **admin/super_admin uniquement**                                                                                              |
| `update_restaurant_payout_secure`     | `_restaurant_id, _payout_mode, _moncash_number, _moncash_account_name, _natcash_number, _natcash_account_name` | owner/admin                                                                                                                   |
| `update_restaurant_commission_secure` | `_restaurant_id uuid, _commission_type text, _commission_rate numeric, _monthly_commission_amount numeric`     | **admin/super_admin uniquement**                                                                                              |
| `get_restaurant_revenue_summary`      | `_restaurant_id uuid, _from date, _to date`                                                                    | owner/admin — retourne une `TABLE` de revenu/commission/net                                                                   |
| `get_restaurant_payout_public`        | `_restaurant_id uuid`                                                                                          | tout utilisateur authentifié si le restaurant est `approved`, sinon owner/admin — retourne les infos de réception de paiement |

### Livreurs

| RPC                           | Paramètres                                                                                                                | Qui                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `update_driver_status_secure` | `_driver_id uuid, _status driver_status`                                                                                  | admin/super_admin uniquement |
| `update_driver_payout_secure` | `_driver_id uuid, _moncash_number, _moncash_account_name, _natcash_number, _natcash_account_name, _payout_frequency text` | le livreur lui-même          |
| `get_driver_earnings_summary` | `_driver_id uuid, _from date, _to date`                                                                                   | le livreur lui-même ou admin |

### Administration

| RPC                                      | Paramètres                                                                       | Retour                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `get_customers_admin`                    | `_search text = NULL, _limit int = 50, _offset int = 0`                          | `TABLE(..., total_count bigint)`                                                                      |
| `get_all_users_admin`                    | `_search text = NULL, _limit int = 50, _offset int = 0, _role app_role = NULL`   | `TABLE(id, email, first_name, last_name, phone, created_at, roles text[], banned_until, total_count)` |
| `get_restaurants_admin`                  | `_limit int = 50, _offset int = 0`                                               | `TABLE(..., commission_type, commission_rate, monthly_commission_amount, total_count)`                |
| `add_user_role_secure`                   | `_user_id uuid, _role app_role`                                                  | accorder `admin`/`super_admin` exige `super_admin`                                                    |
| `remove_user_role_secure`                | `_user_id uuid, _role app_role`                                                  | ne peut pas retirer son propre rôle admin, ni le dernier `super_admin`                                |
| `get_platform_payout_public`             | (aucun)                                                                          | granted **anon + authenticated**                                                                      |
| `update_platform_payout_settings_secure` | `_moncash_number, _moncash_account_name, _natcash_number, _natcash_account_name` | admin/super_admin                                                                                     |

### Employés restaurant

| RPC                                      | Paramètres                                               | Qui                                                                                |
| ---------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `add_restaurant_employee_secure`         | `_restaurant_id uuid, _email text, _role text = 'staff'` | owner/admin. **Rate-limit** : 10/3600s                                             |
| `remove_restaurant_employee_secure`      | `_id uuid`                                               | owner/admin                                                                        |
| `update_restaurant_employee_role_secure` | `_id uuid, _role text`                                   | owner/admin                                                                        |
| `list_restaurant_employees_secure`       | `_restaurant_id uuid`                                    | owner/admin — `TABLE(id, user_id, email, first_name, last_name, role, created_at)` |

### Remboursements

| RPC                      | Paramètres                                                    | Qui                                                                                                         |
| ------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `request_refund_secure`  | `_order_id uuid, _reason text` (≥ 5 caractères)               | client de la commande. **Rate-limit** : 5/1800s                                                             |
| `review_refund_secure`   | `_refund_id uuid, _decision refund_status, _admin_notes text` | admin/super_admin, uniquement depuis `requested`                                                            |
| `complete_refund_secure` | `_refund_id uuid`                                             | admin/super_admin, uniquement depuis `approved` — seule étape qui bascule `payments`/`orders` en `refunded` |

### Litiges

| RPC                          | Paramètres                                                           | Qui                                                                                             |
| ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `open_dispute_secure`        | `_order_id uuid, _category text, _description text` (≥ 5 caractères) | client de la commande. **Rate-limit** : 5/1800s                                                 |
| `add_dispute_message_secure` | `_dispute_id uuid, _message text`                                    | toute partie prenante (client/owner ou employé/livreur assigné/admin). **Rate-limit** : 20/600s |
| `resolve_dispute_secure`     | `_dispute_id uuid, _resolution text` (≥ 3 caractères)                | admin/super_admin uniquement                                                                    |

### Rôles / rate-limiting (utilitaires)

| RPC                       | Paramètres                                                                      | Retour                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `has_role`                | `_user_id uuid, _role app_role`                                                 | `boolean` — granted anon/authenticated/service_role ; interroger le rôle d'un autre utilisateur exige d'être admin |
| `get_primary_role`        | `_user_id uuid`                                                                 | `text` — rôle le plus prioritaire (super_admin > admin > restaurant_owner > restaurant_staff > driver > customer)  |
| `check_rate_limit_secure` | `_action text, _max_hits int, _window_seconds int, _actor_override text = NULL` | `boolean` — compteur à fenêtre fixe dans `private.rate_limit_hits`                                                 |

Détail complet du schéma sous-jacent (tables, RLS, triggers) dans
[DATABASE.md](./DATABASE.md).

## 2. Fonctions serveur TanStack Start

Toutes `createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])`,
validées par un schéma Zod, appelables depuis le client comme des fonctions
async normales (le stub RPC HTTP est généré par TanStack Start).

| Fonction                        | Fichier                               | Entrée (Zod)                                                                                                                                                                                                | Autorisation                                                     | Erreurs notables                                                                                         |
| ------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `sendNewOrderPush`              | `send-order-push.functions.ts`        | `{ orderId: uuid }`                                                                                                                                                                                         | appelant doit être lié à la commande                             | —                                                                                                        |
| `sendDeliveryAssignedPush`      | `send-order-push.functions.ts`        | `{ orderId: uuid }`                                                                                                                                                                                         | idem                                                             | —                                                                                                        |
| `sendOrderDeliveredPush`        | `send-order-push.functions.ts`        | `{ orderId: uuid }`                                                                                                                                                                                         | idem                                                             | —                                                                                                        |
| `sendOrderStatusPush`           | `send-order-status-push.functions.ts` | `{ orderId: uuid }`                                                                                                                                                                                         | idem                                                             | —                                                                                                        |
| `sendPaymentReviewPush`         | `send-push.functions.ts`              | `{ paymentId: uuid }`                                                                                                                                                                                       | **admin uniquement** (`has_role` vérifié dans le handler)        | `"Forbidden"` si non-admin ; rate-limit 30/600s (`send_payment_review_push`) — message kreyòl si dépassé |
| `sendRefundStatusPush`          | `send-refund-push.functions.ts`       | `{ refundId: uuid }`                                                                                                                                                                                        | partie prenante du remboursement                                 | —                                                                                                        |
| `sendDisputeUpdatePush`         | `send-dispute-push.functions.ts`      | `{ disputeId: uuid }`                                                                                                                                                                                       | partie prenante du litige                                        | —                                                                                                        |
| `sendEmployeeEventPush`         | `send-employee-push.functions.ts`     | `{ employeeId: uuid }`                                                                                                                                                                                      | owner/admin du restaurant concerné                               | —                                                                                                        |
| `sendNewPromotionPush`          | `send-promotion-push.functions.ts`    | `{ promotionId: uuid }`                                                                                                                                                                                     | owner/admin du restaurant concerné                               | —                                                                                                        |
| `sendNewsletterBroadcast`       | `send-newsletter.functions.ts`        | `{ subject: string(1-200), html: string }`                                                                                                                                                                  | admin uniquement                                                 | —                                                                                                        |
| `finalizeRegistrationDocuments` | `register-documents.functions.ts`     | `{ userId: uuid, email: string, accountType: "restaurant"\|"driver", files: { logo?, cover?, idDoc?, license?, vehiclePhoto? } }` (chaque fichier : `{ name: string(≤200), type: string, base64: string }`) | l'utilisateur concerné (`userId` doit correspondre à l'appelant) | Upload vers les buckets Storage (`restaurant-assets`/`driver-documents`) via `supabaseAdmin`             |
| `suspendUserAccount`            | `manage-user.functions.ts`            | `{ userId: uuid }`                                                                                                                                                                                          | admin uniquement                                                 | Utilise l'API Admin Supabase Auth                                                                        |
| `reactivateUserAccount`         | `manage-user.functions.ts`            | `{ userId: uuid }`                                                                                                                                                                                          | admin uniquement                                                 | idem                                                                                                     |

Détail du dispatcher push partagé (`pushToUsers`) et de l'écart connu sur
`sendPaymentReviewPush` (n'utilise pas encore ce dispatcher) dans
[SERVICES.md](./SERVICES.md).

## 3. Routes serveur brutes

| Route              | Fichier                       | Réponse                                                                            |
| ------------------ | ----------------------------- | ---------------------------------------------------------------------------------- |
| `GET /robots.txt`  | `src/routes/robots[.]txt.ts`  | `text/plain`, généré statiquement                                                  |
| `GET /sitemap.xml` | `src/routes/sitemap[.]xml.ts` | `application/xml`, généré dynamiquement depuis les restaurants `status='approved'` |

## 4. Erreurs — conventions générales

- **Client Supabase (`supabase.rpc`/`.from()`)** : toute erreur RPC/RLS
  arrive dans `{ data, error }` — `error.message` porte le message
  PL/pgSQL brut (souvent en kreyòl pour les messages destinés à
  l'utilisateur final, en anglais pour les erreurs internes/de
  programmation comme `"Forbidden"`).
- **Fonctions serveur (`createServerFn`)** : un `throw new Error(...)` dans
  le handler devient une rejection de la Promise côté client — pas de code
  d'erreur structuré, seulement `error.message`.
- **Rate-limiting** : systématiquement un message utilisateur en kreyòl du
  type _"Twòp [action] nan yon ti tan. Tanpri eseye ankò pita."_ — à
  afficher tel quel dans l'UI (déjà traduit), pas à re-traduire.
