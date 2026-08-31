# Base de données — NK Deliveri

Ce document décrit l'état final du schéma Postgres/Supabase après les 55
migrations présentes dans `supabase/migrations/`, lues intégralement et
dans l'ordre chronologique. Il reflète l'état **cumulé** — quand une
migration ultérieure a modifié ou supprimé quelque chose, seule la forme
finale est documentée (avec une note sur l'évolution si utile).

Deux schémas contiennent des objets applicatifs :

- **`public`** — exposé via l'API PostgREST de Supabase (accessible depuis
  le client `supabase-js`).
- **`private`** — **jamais exposé** (voir `supabase/config.toml`) ; seules
  les fonctions `SECURITY DEFINER` de `public` peuvent l'atteindre. C'est là
  que vivent les implémentations sensibles ; de fines fonctions `public.*`
  délèguent au vrai travail dans `private.*`.

Aucun type `enum` n'a jamais été étendu après sa création
(`ALTER TYPE ... ADD VALUE`) — chaque liste de valeurs ci-dessous est
définitive depuis sa migration d'origine.

Voir aussi [SUPABASE.md](./SUPABASE.md) pour la configuration du projet
Supabase lui-même, et [API.md](./API.md) pour l'usage de chaque RPC côté
application.

## 1. Tables

### Utilisateurs / rôles / profils

**`public.profiles`** — un profil par utilisateur `auth.users`.

| Colonne                                           | Type        | Contraintes                                 |
| ------------------------------------------------- | ----------- | ------------------------------------------- |
| id                                                | uuid        | PK, FK → `auth.users(id)` ON DELETE CASCADE |
| first_name, last_name, phone, address, avatar_url | text        | nullable                                    |
| created_at, updated_at                            | timestamptz | NOT NULL default now()                      |

**`public.user_roles`** — rôles globaux (indépendants des rôles d'employé
de restaurant, voir plus bas).

| Colonne    | Type        | Contraintes                                       |
| ---------- | ----------- | ------------------------------------------------- |
| id         | uuid        | PK default gen_random_uuid()                      |
| user_id    | uuid        | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE |
| role       | `app_role`  | NOT NULL                                          |
| created_at | timestamptz | NOT NULL default now()                            |

UNIQUE `(user_id, role)`.

### Restaurants / menu

**`public.restaurants`**

| Colonne                                                   | Type                | Contraintes                                                                                         |
| --------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| id                                                        | uuid                | PK                                                                                                  |
| owner_id                                                  | uuid                | FK → `auth.users(id)` ON DELETE SET NULL                                                            |
| slug                                                      | text                | UNIQUE NOT NULL                                                                                     |
| name                                                      | text                | NOT NULL                                                                                            |
| description, logo_url, cover_url, address, phone, cuisine | text                | nullable                                                                                            |
| latitude, longitude                                       | numeric(10,7)       | nullable                                                                                            |
| lat, lng                                                  | numeric             | nullable (colonnes ajoutées plus tard, dupliquent latitude/longitude — voir la remarque ci-dessous) |
| opening_hours                                             | jsonb               | nullable                                                                                            |
| status                                                    | `restaurant_status` | NOT NULL default 'pending'                                                                          |
| commission_rate                                           | numeric(5,2)        | NOT NULL default 10.00 (**vestige**, voir remarque)                                                 |
| delivery_fee                                              | numeric(10,2)       | NOT NULL default 150.00                                                                             |
| min_order                                                 | numeric(10,2)       | NOT NULL default 0                                                                                  |
| avg_prep_time                                             | int                 | NOT NULL default 30                                                                                 |
| rating                                                    | numeric(3,2)        | default 0 (maintenu par trigger)                                                                    |
| created_at, updated_at                                    | timestamptz         | NOT NULL default now()                                                                              |

> **Remarque** : `commission_rate` existe toujours sur cette table mais est
> vestige — la configuration de commission réelle vit dans
> `restaurant_payout_details`. Des colonnes moncash/natcash/payout_mode ont
> brièvement existé sur `restaurants` avant d'être déplacées vers
> `restaurant_payout_details` dans une migration ultérieure.

**`public.menu_categories`**

| Colonne       | Type        | Contraintes                                        |
| ------------- | ----------- | -------------------------------------------------- |
| id            | uuid        | PK                                                 |
| restaurant_id | uuid        | NOT NULL, FK → `restaurants(id)` ON DELETE CASCADE |
| name          | text        | NOT NULL                                           |
| sort_order    | int         | NOT NULL default 0                                 |
| created_at    | timestamptz | NOT NULL default now()                             |

**`public.products`**

| Colonne                | Type          | Contraintes                                                             |
| ---------------------- | ------------- | ----------------------------------------------------------------------- |
| id                     | uuid          | PK                                                                      |
| restaurant_id          | uuid          | NOT NULL, FK → `restaurants(id)` ON DELETE CASCADE                      |
| category_id            | uuid          | FK → `menu_categories(id)` ON DELETE SET NULL                           |
| name                   | text          | NOT NULL                                                                |
| description            | text          | nullable                                                                |
| price                  | numeric(10,2) | NOT NULL, CHECK (price >= 0)                                            |
| image_url              | text          | nullable                                                                |
| available              | boolean       | NOT NULL default true                                                   |
| popular                | boolean       | NOT NULL default false                                                  |
| dish_type              | text          | nullable                                                                |
| archived_at            | timestamptz   | nullable — marqueur de suppression logique                              |
| sort_order             | int           | NOT NULL default 0                                                      |
| stock_quantity         | integer       | nullable ; CHECK (`NULL` ou `>= 0`) ; `NULL` = stock non suivi/illimité |
| created_at, updated_at | timestamptz   | NOT NULL default now()                                                  |

**`public.promotions`**

| Colonne                | Type          | Contraintes                                        |
| ---------------------- | ------------- | -------------------------------------------------- |
| id                     | uuid          | PK                                                 |
| restaurant_id          | uuid          | NOT NULL, FK → `restaurants(id)` ON DELETE CASCADE |
| title                  | text          | NOT NULL                                           |
| description            | text          | nullable                                           |
| discount_type          | text          | NOT NULL, CHECK IN ('percentage','fixed')          |
| discount_value         | numeric(10,2) | NOT NULL, CHECK (> 0)                              |
| code                   | text          | nullable                                           |
| starts_at, ends_at     | timestamptz   | nullable                                           |
| active                 | boolean       | NOT NULL default true                              |
| created_at, updated_at | timestamptz   | NOT NULL default now()                             |

CHECK table : `ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at`.
CHECK table : `discount_type <> 'percentage' OR discount_value <= 100`.

> **Important** — comme documenté dans
> [WORKFLOWS.md § 8](./WORKFLOWS.md#8-workflow-promotions), cette table est
> **purement informative** : aucune fonction serveur ne déduit
> `discount_value` du total d'une commande. `code` n'est jamais lu au
> checkout.

### Personnel restaurant / configuration de paiement

**`public.restaurant_employees`**

| Colonne       | Type        | Contraintes                                                                                  |
| ------------- | ----------- | -------------------------------------------------------------------------------------------- |
| id            | uuid        | PK                                                                                           |
| restaurant_id | uuid        | NOT NULL, FK → `restaurants(id)` ON DELETE CASCADE                                           |
| user_id       | uuid        | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE                                            |
| role          | text        | NOT NULL default 'staff' ; CHECK IN ('staff','manager','cook','prep','cashier','supervisor') |
| created_at    | timestamptz | NOT NULL default now()                                                                       |

UNIQUE `(restaurant_id, user_id)`. Le CHECK sur `role` a été ajouté en
Phase 5 (gestion des employés multi-rôles) ; voir
[le guide des rôles employé](../src/lib/employee-roles.ts) pour le mapping
UI.

**`public.restaurant_payout_details`** — une ligne par restaurant, upsert.

| Colonne                                                                    | Type        | Contraintes                                  |
| -------------------------------------------------------------------------- | ----------- | -------------------------------------------- |
| restaurant_id                                                              | uuid        | PK, FK → `restaurants(id)` ON DELETE CASCADE |
| payout_mode                                                                | text        | NOT NULL default 'via_admin'                 |
| moncash_number, moncash_account_name, natcash_number, natcash_account_name | text        | nullable                                     |
| commission_type                                                            | text        | nullable                                     |
| commission_rate                                                            | numeric     | nullable                                     |
| monthly_commission_amount                                                  | numeric     | nullable                                     |
| created_at, updated_at                                                     | timestamptz | NOT NULL default now()                       |

Pas de CHECK ; la validation (mode valide, numéro requis en mode direct) se
fait dans `update_restaurant_payout_secure`.

**`public.platform_payout_settings`** — table singleton (une seule ligne).

| Colonne                                                                    | Type        | Contraintes                 |
| -------------------------------------------------------------------------- | ----------- | --------------------------- |
| id                                                                         | boolean     | PK default true, CHECK (id) |
| moncash_number, moncash_account_name, natcash_number, natcash_account_name | text        | nullable                    |
| updated_at                                                                 | timestamptz | NOT NULL default now()      |

### Livreurs

**`public.drivers`**

| Colonne                                                                    | Type            | Contraintes                                              |
| -------------------------------------------------------------------------- | --------------- | -------------------------------------------------------- |
| id                                                                         | uuid            | PK                                                       |
| user_id                                                                    | uuid            | NOT NULL UNIQUE, FK → `auth.users(id)` ON DELETE CASCADE |
| first_name, last_name, phone, address, vehicle_type, license_plate         | text            | nullable                                                 |
| id_doc_url, license_doc_url, vehicle_photo_url                             | text            | nullable                                                 |
| status                                                                     | `driver_status` | NOT NULL default 'pending'                               |
| current_lat, current_lng                                                   | numeric         | nullable                                                 |
| moncash_number, natcash_number, moncash_account_name, natcash_account_name | text            | nullable                                                 |
| payout_frequency                                                           | text            | NOT NULL default 'daily' ; CHECK IN ('daily','monthly')  |
| commission_rate                                                            | numeric(12,2)   | NOT NULL default 100                                     |
| created_at, updated_at                                                     | timestamptz     | NOT NULL default now()                                   |

### Commandes / paiements / livraison

**`public.addresses`**

| Colonne                | Type        | Contraintes                                       |
| ---------------------- | ----------- | ------------------------------------------------- |
| id                     | uuid        | PK                                                |
| user_id                | uuid        | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE |
| label, notes           | text        | nullable                                          |
| address_line           | text        | NOT NULL                                          |
| city                   | text        | NOT NULL default 'Gonaïves'                       |
| lat, lng               | numeric     | nullable                                          |
| is_default             | boolean     | NOT NULL default false                            |
| created_at, updated_at | timestamptz | NOT NULL default now()                            |

**`public.orders`**

| Colonne                                    | Type           | Contraintes                                                                            |
| ------------------------------------------ | -------------- | -------------------------------------------------------------------------------------- |
| id                                         | uuid           | PK                                                                                     |
| order_number                               | text           | NOT NULL UNIQUE, default `'NK-'\|\|to_char(now(),'YYMMDD')\|\|'-'\|\|substr(uuid,1,6)` |
| customer_id                                | uuid           | NOT NULL, FK → `auth.users(id)` ON DELETE RESTRICT                                     |
| restaurant_id                              | uuid           | NOT NULL, FK → `restaurants(id)` ON DELETE RESTRICT                                    |
| address_id                                 | uuid           | FK → `addresses(id)`                                                                   |
| delivery_address                           | text           | NOT NULL                                                                               |
| delivery_notes, contact_phone              | text           | nullable                                                                               |
| subtotal, delivery_fee, service_fee, total | numeric(10,2)  | NOT NULL default 0                                                                     |
| currency                                   | text           | NOT NULL default 'HTG'                                                                 |
| status                                     | `order_status` | NOT NULL default 'pending'                                                             |
| status_history                             | jsonb          | NOT NULL default '[]' — journal append-only des transitions                            |
| delivery_lat, delivery_lng                 | numeric        | nullable                                                                               |
| created_at, updated_at                     | timestamptz    | NOT NULL default now()                                                                 |

`REPLICA IDENTITY FULL`, publiée sur `supabase_realtime` (nécessaire pour
`useLiveOrders`/`useOrderDelivery`).

**`public.order_items`** (pas de `updated_at` — lignes immuables une fois
la commande créée)

| Colonne                | Type          | Contraintes                                     |
| ---------------------- | ------------- | ----------------------------------------------- |
| id                     | uuid          | PK                                              |
| order_id               | uuid          | NOT NULL, FK → `orders(id)` ON DELETE CASCADE   |
| product_id             | uuid          | FK → `products(id)`                             |
| product_name           | text          | NOT NULL (copie figée au moment de la commande) |
| unit_price, line_total | numeric(10,2) | NOT NULL                                        |
| quantity               | int           | NOT NULL, CHECK (> 0)                           |
| notes                  | text          | nullable                                        |
| created_at             | timestamptz   | NOT NULL default now()                          |

**`public.payments`**

| Colonne                                                      | Type             | Contraintes                                              |
| ------------------------------------------------------------ | ---------------- | -------------------------------------------------------- |
| id                                                           | uuid             | PK                                                       |
| order_id                                                     | uuid             | NOT NULL, FK → `orders(id)` ON DELETE CASCADE            |
| method                                                       | `payment_method` | NOT NULL                                                 |
| status                                                       | `payment_status` | NOT NULL default 'pending'                               |
| amount                                                       | numeric(10,2)    | NOT NULL                                                 |
| currency                                                     | text             | NOT NULL default 'HTG'                                   |
| stripe_payment_intent_id, stripe_session_id, transaction_ref | text             | nullable                                                 |
| sender_name, sender_phone                                    | text             | nullable                                                 |
| reviewed_by                                                  | uuid             | FK → `auth.users(id)`                                    |
| reviewed_at                                                  | timestamptz      | nullable                                                 |
| review_notes                                                 | text             | nullable                                                 |
| receiver_type                                                | text             | NOT NULL default 'admin' ; CHECK IN ('admin','merchant') |
| receiver_restaurant_id                                       | uuid             | FK → `restaurants(id)` ON DELETE SET NULL                |
| receiver_number, receiver_account_name                       | text             | nullable                                                 |
| created_at, updated_at                                       | timestamptz      | NOT NULL default now()                                   |

**`public.payment_proofs`**

| Colonne                              | Type        | Contraintes                                     |
| ------------------------------------ | ----------- | ----------------------------------------------- |
| id                                   | uuid        | PK                                              |
| payment_id                           | uuid        | NOT NULL, FK → `payments(id)` ON DELETE CASCADE |
| file_url                             | text        | NOT NULL                                        |
| transaction_ref, sender_phone, notes | text        | nullable                                        |
| uploaded_by                          | uuid        | NOT NULL, FK → `auth.users(id)`                 |
| created_at                           | timestamptz | NOT NULL default now()                          |

**`public.deliveries`**

| Colonne                                 | Type              | Contraintes                                          |
| --------------------------------------- | ----------------- | ---------------------------------------------------- |
| id                                      | uuid              | PK                                                   |
| order_id                                | uuid              | NOT NULL UNIQUE, FK → `orders(id)` ON DELETE CASCADE |
| driver_id                               | uuid              | FK → `drivers(id)` ON DELETE SET NULL                |
| status                                  | `delivery_status` | NOT NULL default 'assigned'                          |
| assigned_at, picked_up_at, delivered_at | timestamptz       | picked_up/delivered nullable                         |
| driver_notes                            | text              | nullable                                             |
| fee                                     | numeric(10,2)     | NOT NULL default 0                                   |
| driver_lat, driver_lng, driver_heading  | numeric           | nullable                                             |
| location_updated_at                     | timestamptz       | nullable                                             |
| created_at, updated_at                  | timestamptz       | NOT NULL default now()                               |

`REPLICA IDENTITY FULL`, publiée sur `supabase_realtime`.

### Avis / notifications / push / favoris / newsletter

**`public.reviews`**

| Colonne                          | Type        | Contraintes                                       |
| -------------------------------- | ----------- | ------------------------------------------------- |
| id                               | uuid        | PK                                                |
| order_id                         | uuid        | NOT NULL, FK → `orders(id)` ON DELETE CASCADE     |
| customer_id                      | uuid        | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE |
| restaurant_id                    | uuid        | FK → `restaurants(id)` ON DELETE CASCADE          |
| driver_id                        | uuid        | FK → `drivers(id)` ON DELETE SET NULL             |
| restaurant_rating, driver_rating | int         | CHECK BETWEEN 1 AND 5                             |
| comment                          | text        | nullable                                          |
| created_at                       | timestamptz | NOT NULL default now()                            |

UNIQUE `(order_id, customer_id)` — un seul avis par commande.

**`public.notifications`**

| Colonne    | Type        | Contraintes                                       |
| ---------- | ----------- | ------------------------------------------------- |
| id         | uuid        | PK                                                |
| user_id    | uuid        | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE |
| type       | text        | NOT NULL                                          |
| title      | text        | NOT NULL                                          |
| body       | text        | nullable                                          |
| data       | jsonb       | NOT NULL default '{}'                             |
| read_at    | timestamptz | nullable                                          |
| created_at | timestamptz | NOT NULL default now()                            |

`REPLICA IDENTITY FULL`, publiée sur `supabase_realtime`.

**`public.push_subscriptions`**

| Colonne                  | Type        | Contraintes                                       |
| ------------------------ | ----------- | ------------------------------------------------- |
| id                       | uuid        | PK                                                |
| user_id                  | uuid        | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE |
| endpoint                 | text        | NOT NULL UNIQUE                                   |
| p256dh, auth             | text        | NOT NULL                                          |
| user_agent               | text        | nullable                                          |
| created_at, last_used_at | timestamptz | NOT NULL default now()                            |

**`public.favorites`**

| Colonne       | Type        | Contraintes                                        |
| ------------- | ----------- | -------------------------------------------------- |
| id            | uuid        | PK                                                 |
| user_id       | uuid        | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE  |
| restaurant_id | uuid        | NOT NULL, FK → `restaurants(id)` ON DELETE CASCADE |
| created_at    | timestamptz | NOT NULL default now()                             |

UNIQUE `(user_id, restaurant_id)`.

**`public.newsletter_subscribers`**

| Colonne         | Type        | Contraintes                                               |
| --------------- | ----------- | --------------------------------------------------------- |
| id              | uuid        | PK                                                        |
| email           | text        | NOT NULL UNIQUE, CHECK regex `^[^@\s]+@[^@\s]+\.[^@\s]+$` |
| subscribed_at   | timestamptz | NOT NULL default now()                                    |
| unsubscribed_at | timestamptz | nullable                                                  |
| source          | text        | NOT NULL default 'homepage'                               |

### Remboursements / litiges

**`public.refunds`**

| Colonne                   | Type            | Contraintes                                        |
| ------------------------- | --------------- | -------------------------------------------------- |
| id                        | uuid            | PK                                                 |
| order_id                  | uuid            | NOT NULL, FK → `orders(id)` ON DELETE CASCADE      |
| payment_id                | uuid            | NOT NULL, FK → `payments(id)` ON DELETE CASCADE    |
| customer_id               | uuid            | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE  |
| restaurant_id             | uuid            | NOT NULL, FK → `restaurants(id)` ON DELETE CASCADE |
| amount                    | numeric(10,2)   | NOT NULL                                           |
| reason                    | text            | NOT NULL                                           |
| status                    | `refund_status` | NOT NULL default 'requested'                       |
| admin_notes               | text            | nullable                                           |
| reviewed_by               | uuid            | FK → `auth.users(id)`                              |
| reviewed_at, completed_at | timestamptz     | nullable                                           |
| status_history            | jsonb           | NOT NULL default '[]'                              |
| created_at, updated_at    | timestamptz     | NOT NULL default now()                             |

UNIQUE `refunds_order_unique_active(order_id)` — un seul remboursement actif
par commande. `REPLICA IDENTITY FULL`, publiée sur `supabase_realtime`.

**`public.disputes`**

| Colonne                | Type             | Contraintes                                        |
| ---------------------- | ---------------- | -------------------------------------------------- |
| id                     | uuid             | PK                                                 |
| order_id               | uuid             | NOT NULL, FK → `orders(id)` ON DELETE CASCADE      |
| customer_id            | uuid             | NOT NULL, FK → `auth.users(id)` ON DELETE CASCADE  |
| restaurant_id          | uuid             | NOT NULL, FK → `restaurants(id)` ON DELETE CASCADE |
| driver_id              | uuid             | FK → `drivers(id)` ON DELETE SET NULL              |
| category               | text             | NOT NULL                                           |
| status                 | `dispute_status` | NOT NULL default 'open'                            |
| resolution             | text             | nullable                                           |
| resolved_by            | uuid             | FK → `auth.users(id)`                              |
| resolved_at            | timestamptz      | nullable                                           |
| created_at, updated_at | timestamptz      | NOT NULL default now()                             |

UNIQUE `disputes_order_unique(order_id)`. `REPLICA IDENTITY FULL`, publiée
sur `supabase_realtime`.

**`public.dispute_messages`** — journal append-only.

| Colonne     | Type                  | Contraintes                                     |
| ----------- | --------------------- | ----------------------------------------------- |
| id          | uuid                  | PK                                              |
| dispute_id  | uuid                  | NOT NULL, FK → `disputes(id)` ON DELETE CASCADE |
| author_id   | uuid                  | NOT NULL, FK → `auth.users(id)`                 |
| author_role | `dispute_author_role` | NOT NULL                                        |
| message     | text                  | NOT NULL                                        |
| created_at  | timestamptz           | NOT NULL default now()                          |

`REPLICA IDENTITY FULL`, publiée sur `supabase_realtime`.

### Table du schéma `private`

**`private.rate_limit_hits`** — compteur à fenêtre fixe pour le
rate-limiting applicatif (voir `check_rate_limit_secure` dans
[API.md](./API.md)).

| Colonne      | Type                                    |
| ------------ | --------------------------------------- |
| rl_key       | text (NOT NULL, partie de la PK)        |
| window_start | timestamptz (NOT NULL, partie de la PK) |
| hit_count    | int NOT NULL default 0                  |

RLS activé, **aucune policy** — inaccessible sauf par les fonctions
`SECURITY DEFINER`.

## 2. Types énumérés (`enum`)

| Type                         | Valeurs                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `public.app_role`            | `customer`, `restaurant_owner`, `restaurant_staff`, `driver`, `admin`, `super_admin`                        |
| `public.restaurant_status`   | `pending`, `approved`, `suspended`, `rejected`                                                              |
| `public.driver_status`       | `pending`, `approved`, `suspended`, `rejected`, `offline`, `online`                                         |
| `public.order_status`        | `pending`, `confirmed`, `preparing`, `ready`, `assigned`, `picked_up`, `delivered`, `cancelled`, `refunded` |
| `public.payment_method`      | `stripe`, `moncash`, `natcash`, `kach`                                                                      |
| `public.payment_status`      | `pending`, `awaiting_proof`, `under_review`, `paid`, `failed`, `refunded`                                   |
| `public.delivery_status`     | `assigned`, `en_route_pickup`, `picked_up`, `en_route_dropoff`, `delivered`, `cancelled`                    |
| `public.refund_status`       | `requested`, `approved`, `rejected`, `completed`                                                            |
| `public.dispute_status`      | `open`, `resolved`                                                                                          |
| `public.dispute_author_role` | `customer`, `restaurant`, `driver`, `admin`                                                                 |

## 3. Row-Level Security (RLS)

Toutes les tables ont RLS activé. Ci-dessous, « admin » signifie
`has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin')` sauf
mention contraire. Le détail complet de chaque RPC référencée est dans
[API.md](./API.md).

> **⚠️ RÈGLE OBLIGATOIRE — `public.has_role` vs `private.has_role`**
> (incident 2026-08-30, migrations `20260830170000` et suivante) :
>
> - `public.has_role(_user_id, _role)` est un relais `SECURITY INVOKER`
>   (voir `20260704160000_47e8011e...sql`) — conçu **exprès** ainsi pour
>   empêcher un client PostgREST de sonder le rôle d'un **autre**
>   utilisateur. Il convient parfaitement dans une clause `USING`/`WITH
>   CHECK` de policy RLS (évaluée directement sous le rôle `authenticated`
>   qui fait la requête).
> - **Il ne faut JAMAIS l'appeler à l'intérieur du corps d'une fonction
>   `SECURITY DEFINER`** (un RPC `*_secure`, un trigger `protect_*`, etc.).
>   Le contexte de rôle actif dans ce cas n'est pas garanti équivalent à
>   la session de l'appelant, et la vérification peut silencieusement
>   retourner `false` pour un admin pourtant légitime — c'est exactement
>   ce qui a bloqué `get_admin_ai_traffic_stats_secure` (500 `Forbidden`)
>   et affectait au moins 37 autres fonctions découvertes par audit.
> - **La règle** : à l'intérieur d'une fonction `SECURITY DEFINER`,
>   toujours appeler `private.has_role(_user_id, _role)` directement (lui
>   aussi `SECURITY DEFINER`, sans ce piège). `public.has_role` reste
>   réservé aux clauses de policy RLS uniquement.

| Table                       | Policies (résumé)                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`                  | SELECT : soi-même ou admin · INSERT/UPDATE : soi-même uniquement                                                                                                                                                                      |
| `user_roles`                | SELECT : soi-même ou admin · ALL (gestion) : super_admin uniquement                                                                                                                                                                   |
| `restaurants`               | SELECT : `status='approved'` ou owner ou admin · DELETE : super_admin uniquement · écritures via RPC                                                                                                                                  |
| `menu_categories`           | SELECT : public (`true`) · écritures via RPC                                                                                                                                                                                          |
| `products`                  | SELECT : public (`true`) · écritures via RPC                                                                                                                                                                                          |
| `promotions`                | SELECT : actif et dans la fenêtre et restaurant approuvé, ou owner/admin · écritures via RPC                                                                                                                                          |
| `addresses`                 | ALL : propriétaire uniquement (`user_id = auth.uid()`)                                                                                                                                                                                |
| `orders`                    | SELECT : customer, admin, owner du restaurant, employé du restaurant, ou livreur (via fonction `private.order_visible_to_driver` — livreur assigné, ou livreur en ligne voyant une commande `ready` non réclamée) · écritures via RPC |
| `order_items`               | SELECT : commande visible par l'appelant · écriture uniquement via RPC (grants INSERT/UPDATE/DELETE révoqués)                                                                                                                         |
| `payments`                  | SELECT : customer, admin, owner du restaurant · UPDATE : admin uniquement · insert/delete révoqués                                                                                                                                    |
| `payment_proofs`            | SELECT : uploader ou admin · insertion uniquement via RPC                                                                                                                                                                             |
| `deliveries`                | SELECT : admin, livreur assigné, customer, owner du restaurant · UPDATE : admin (tout) ou livreur assigné (protégé en plus par trigger) · insert/delete révoqués                                                                      |
| `reviews`                   | SELECT : public (`true`) · INSERT/UPDATE : auteur uniquement (`customer_id = auth.uid()`)                                                                                                                                             |
| `notifications`             | ALL : propriétaire uniquement (`user_id = auth.uid()`)                                                                                                                                                                                |
| `push_subscriptions`        | ALL : propriétaire · SELECT additionnel : admin                                                                                                                                                                                       |
| `restaurant_employees`      | ALL : owner du restaurant ou admin · SELECT additionnel : l'employé lui-même                                                                                                                                                          |
| `drivers`                   | SELECT/UPDATE : soi-même ou admin · ALL : admin (statut/commission protégés en plus par trigger)                                                                                                                                      |
| `restaurant_payout_details` | SELECT/INSERT/UPDATE : owner · ALL : admin (colonnes de commission protégées en plus par trigger)                                                                                                                                     |
| `platform_payout_settings`  | SELECT : admin uniquement · écritures via RPC                                                                                                                                                                                         |
| `newsletter_subscribers`    | INSERT : public (anon inclus) · SELECT/UPDATE : admin                                                                                                                                                                                 |
| `favorites`                 | ALL : propriétaire uniquement                                                                                                                                                                                                         |
| `refunds`                   | SELECT : customer, admin, owner du restaurant, employé · écritures via RPC                                                                                                                                                            |
| `disputes`                  | SELECT : customer, admin, owner du restaurant, employé, livreur assigné · écritures via RPC                                                                                                                                           |
| `dispute_messages`          | SELECT : accès au litige parent (même règle) · écriture via RPC                                                                                                                                                                       |
| `private.rate_limit_hits`   | RLS activé, aucune policy — inatteignable hors fonctions `SECURITY DEFINER`                                                                                                                                                           |

## 4. Triggers

### Maintenance de `updated_at` (`BEFORE UPDATE` → `public.update_updated_at_column()`)

`profiles`, `restaurants`, `products`, `drivers`, `addresses`, `orders`,
`payments`, `deliveries`, `restaurant_payout_details`, `promotions`.

> `menu_categories`, `order_items`, `reviews`, `notifications`, `favorites`,
> `dispute_messages` n'ont pas de colonne/trigger `updated_at`. `refunds` et
> `disputes` ont une colonne `updated_at` mais elle est maintenue **dans les
> RPC elles-mêmes**, pas par un trigger.

### Triggers sur `auth.users`

- **`on_auth_user_created`** (AFTER INSERT) → `public.handle_new_user()` —
  crée le profil, le rôle global, et la ligne `restaurants`/`drivers`
  correspondante depuis les métadonnées d'inscription ; amorce un compte
  admin uniquement pour l'e-mail d'allowlist tant qu'aucun admin n'existe.
- **`on_auth_user_confirmed_grant_admin`** (AFTER UPDATE OF
  email_confirmed_at, WHEN confirmation vient d'avoir lieu) →
  `public.grant_admin_on_confirm()`.

### Triggers métier

| Trigger                                        | Table                     | Fonction                                        | Rôle                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trg_payment_paid_confirm_order`               | payments                  | `on_payment_paid_confirm_order()`               | Un paiement passé à `paid` confirme automatiquement une commande `pending`                                                                                              |
| `trg_notify_payment_status`                    | payments                  | `notify_payment_status_change()`                | Notifications client/marchand sur paid/failed/under_review                                                                                                              |
| `trg_protect_restaurant_commission` (+ `_ins`) | restaurant_payout_details | `protect_restaurant_commission()` / `_insert()` | Empêche un non-admin de modifier les champs de commission                                                                                                               |
| `trg_protect_driver_commission`                | drivers                   | `protect_driver_commission()`                   | Empêche un non-admin de modifier son propre taux de commission                                                                                                          |
| `trg_protect_driver_status`                    | drivers                   | `private.protect_driver_status_self_update()`   | Seul un admin change le statut d'approbation ; un livreur approuvé peut seulement basculer online/offline                                                               |
| `trg_protect_delivery_status`                  | deliveries                | `private.protect_delivery_status_transition()`  | Fait respecter les transitions de statut légales, horodate picked_up_at/delivered_at, garde `orders` synchronisé, verrouille driver_id/order_id/fee pour les non-admins |
| `trg_sync_restaurant_rating`                   | reviews                   | `sync_restaurant_rating()`                      | Recalcule `restaurants.rating` après chaque INSERT/UPDATE/DELETE                                                                                                        |

## 5. Buckets de stockage (Storage)

| Bucket              | Public  | Taille max | Types MIME autorisés                               |
| ------------------- | ------- | ---------- | -------------------------------------------------- |
| `restaurant-assets` | oui     | 5 Mo       | image/jpeg, image/png, image/webp                  |
| `menu-photos`       | oui     | 5 Mo       | image/jpeg, image/png, image/webp                  |
| `avatars`           | oui     | 3 Mo       | image/jpeg, image/png, image/webp                  |
| `driver-documents`  | **non** | 8 Mo       | image/jpeg, image/png, image/webp, application/pdf |
| `payment-proofs`    | **non** | 8 Mo       | image/jpeg, image/png, image/webp, application/pdf |

Chaque bucket a des policies `storage.objects` de lecture publique-ou-
propriétaire, et d'écriture réservée au propriétaire/admin (super_admin
inclus). `menu-photos` vérifie l'appartenance au restaurant via
`private.is_restaurant_staff_or_manager` sur le chemin du fichier ;
`avatars` restreint l'écriture au dossier `(storage.foldername(name))[1] =
auth.uid()` ; `payment-proofs` a deux générations de policies coexistantes
(dossier par utilisateur, puis par commande) — les deux sont actives.

> **Écart connu** : des policies `storage.objects` nommées `user_avatars_*`
> existent, mais **aucun bucket `user-avatars` n'est jamais créé** par une
> migration — une migration de nettoyage explique que ce bucket a
> délibérément été laissé de côté (la fonctionnalité utilise le bucket
> `avatars`). Ces policies sont donc mortes dans l'état final.

## 6. Index explicites (au-delà des PK/UNIQUE automatiques)

- `restaurants` : `idx_restaurants_status`, `idx_restaurants_owner`
- `menu_categories` : `idx_menu_categories_restaurant`
- `products` : `idx_products_restaurant`, `idx_products_category`, `products_dish_type_idx`
- `orders` : `idx_orders_customer`, `idx_orders_restaurant`, `idx_orders_status`
- `order_items` : `idx_order_items_order_id`, `idx_order_items_product_id`
- `payments` : `idx_payments_order_id`
- `payment_proofs` : `idx_payment_proofs_payment_id`
- `deliveries` : `idx_deliveries_driver_id`, `idx_deliveries_status`
- `reviews` : `idx_reviews_restaurant_id`, `idx_reviews_driver_id`, `idx_reviews_customer_id`
- `notifications` : `idx_notif_user (user_id, created_at DESC)`
- `push_subscriptions` : `push_subscriptions_user_idx`
- `addresses` : `idx_addresses_user_id`
- `favorites` : `idx_favorites_user`, `idx_favorites_restaurant_id`
- `restaurant_employees` : `idx_restaurant_employees_user_id`
- `promotions` : `idx_promotions_restaurant`
- `newsletter_subscribers` : `idx_newsletter_active` — **index partiel**, `(subscribed_at) WHERE unsubscribed_at IS NULL`
- `refunds` : `refunds_customer_id_idx`, `refunds_restaurant_id_idx`, `refunds_status_idx`
- `disputes` : `disputes_customer_id_idx`, `disputes_restaurant_id_idx`, `disputes_driver_id_idx`, `disputes_status_idx`
- `dispute_messages` : `dispute_messages_dispute_id_idx` (composite `(dispute_id, created_at)`)

## 7. Points de vigilance pour tout futur développeur

- **`create_order_secure` / `update_order_status_secure` / `claim_delivery_secure`**
  sont des enveloppes `public` minces au-dessus d'implémentations
  `private.*`. Pour comprendre la vraie logique, lire la fonction
  `private.*`, pas la wrapper `public.*`.
- **Risque de surcharge de fonction (« overload hazard »)** : plusieurs RPC
  (`create_product_secure`, `update_product_secure`,
  `update_driver_payout_secure`, `add_restaurant_employee_secure`,
  `get_all_users_admin`, `get_customers_admin`, `get_restaurants_admin`,
  `list_restaurant_employees_secure`) ont changé de signature au fil du
  temps ; chaque changement a nécessité un `DROP FUNCTION` explicite de
  l'ancienne signature avant de recréer la nouvelle. Voir
  [MIGRATIONS.md](./MIGRATIONS.md) pour la procédure à suivre — c'est le
  piège Postgres le plus documenté de ce projet
  (`CREATE OR REPLACE FUNCTION` avec une liste d'arguments différente crée
  une **nouvelle surcharge** au lieu de remplacer l'existante).
- `restaurant_payout_details` a des policies RLS d'écriture pour le
  propriétaire (INSERT/UPDATE) **et** les écritures passent en pratique par
  RPC (`update_restaurant_payout_secure`) — les deux coexistent
  intentionnellement, ce n'est pas une incohérence à corriger.
- Aucune migration n'a jamais utilisé `ALTER TYPE ... ADD VALUE` — toutes
  les listes d'enum ci-dessus sont complètes depuis leur création.
