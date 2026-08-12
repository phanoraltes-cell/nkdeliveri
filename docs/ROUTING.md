# Routage — NK Deliveri

TanStack Start utilise un routage basé sur les fichiers (`src/routes/`) avec
une convention à points : `dashboard.admin.users.tsx` devient l'URL
`/dashboard/admin/users`. Un dossier `_authenticated/` est une **layout route
sans segment d'URL propre** (pathless layout) — tout fichier à l'intérieur
hérite de son `beforeLoad` sans que `/authenticated` n'apparaisse jamais dans
l'URL. Un fichier `$param.tsx` (ex. `orders.$id.tsx`) capture un segment
dynamique.

Le fichier généré `src/routeTree.gen.ts` (ne jamais l'éditer à la main) est
reconstruit automatiquement à chaque build ou lancement de `npm run dev`.

## Layouts

| Fichier                               | Rôle                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/routes/__root.tsx`               | Layout racine unique. `<html>`/`<body>`, `QueryClientProvider`, `Toaster`, `BottomNav`, `InstallPrompt`, init Sentry, `NotFoundComponent`/`ErrorComponent` partagés.                                                                                                                                                                                   |
| `src/routes/_authenticated/route.tsx` | Layout sans URL propre — enveloppe tout ce qui est sous `_authenticated/` (donc tout `/dashboard/*` et `/notifications`). Son `beforeLoad` exige une session Supabase active (`redirect` vers `/auth` sinon) et résout le rôle via le RPC `get_primary_role`, attaché au contexte de route (`{ user, role }`) pour tous les descendants. `ssr: false`. |
| `dashboard.tsx`                       | Chrome du dashboard (en-tête + barre latérale adaptée au rôle) — parent de tout `/dashboard/*`.                                                                                                                                                                                                                                                        |
| `dashboard.admin.tsx`                 | Garde de rôle (`admin`, `super_admin`) + `<Outlet/>` pour les enfants `dashboard.admin.*`.                                                                                                                                                                                                                                                             |
| `dashboard.restaurant.tsx`            | Garde de rôle (`restaurant_owner`, `restaurant_staff`, `admin`, `super_admin`) + `<Outlet/>` pour les enfants `dashboard.restaurant.*`.                                                                                                                                                                                                                |
| `dashboard.driver.tsx`                | `<Outlet/>` simple — **aucune garde de rôle à ce niveau** (voir la section "Écart connu" ci-dessous).                                                                                                                                                                                                                                                  |

Les pages hors `_authenticated/` (marketing, `/auth/*`, `/checkout`,
`/orders`, `/orders/$id`, `/profile`, `/restaurants*`) ne partagent pas de
layout intermédiaire — chacune inclut son propre `<SiteHeader/>`/`<SiteFooter/>`.

## Table complète des routes

### Public (aucune authentification)

| Route                   | Fichier                    | Description                                                                                                                          |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                     | `index.tsx`                | Accueil : héro, restaurants/plats populaires, newsletter                                                                             |
| `/about`                | `about.tsx`                | Page statique "À propos"                                                                                                             |
| `/contact`              | `contact.tsx`              | Coordonnées de contact                                                                                                               |
| `/faq`                  | `faq.tsx`                  | FAQ (avec schéma JSON-LD)                                                                                                            |
| `/privacy`              | `privacy.tsx`              | Politique de confidentialité                                                                                                         |
| `/terms`                | `terms.tsx`                | Conditions d'utilisation                                                                                                             |
| `/robots.txt`           | `robots[.]txt.ts`          | Route serveur générant `robots.txt`                                                                                                  |
| `/sitemap.xml`          | `sitemap[.]xml.ts`         | Sitemap XML généré depuis les restaurants approuvés                                                                                  |
| `/restaurants`          | `restaurants.index.tsx`    | Annuaire des restaurants (recherche + pagination)                                                                                    |
| `/restaurants/$slug`    | `restaurants.$slug.tsx`    | Page restaurant : menu, ajout au panier, favoris                                                                                     |
| `/auth`                 | `auth.index.tsx`           | Connexion (email/mot de passe + Google OAuth)                                                                                        |
| `/auth/register`        | `auth.register.tsx`        | Inscription (client/restaurant/livreur) + upload de documents                                                                        |
| `/auth/forgot-password` | `auth.forgot-password.tsx` | Envoi d'email de réinitialisation                                                                                                    |
| `/auth/reset-password`  | `auth.reset-password.tsx`  | Définition d'un nouveau mot de passe                                                                                                 |
| `/checkout`             | `checkout.tsx`             | Panier/paiement — consultable sans compte, la soumission redirige vers `/auth` si non connecté (garde côté client, pas `beforeLoad`) |
| `/orders`               | `orders.tsx`               | Historique des commandes — **aucune garde `beforeLoad`**, protégé uniquement côté client via `useAuth()`                             |
| `/profile`              | `profile.tsx`              | Profil client — même remarque que `/orders`                                                                                          |

### Authentifié, sans rôle spécifique

| Route                 | Fichier                  | Garde                                                                                       |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------- |
| `/orders/$id`         | `orders.$id.tsx`         | Session requise (`beforeLoad`), aucun contrôle de rôle                                      |
| `/dashboard`          | `dashboard.index.tsx`    | Redirige vers l'accueil du rôle (`/dashboard/customer`, `/restaurant`, `/driver`, `/admin`) |
| `/dashboard/customer` | `dashboard.customer.tsx` | Aucune garde de rôle propre — accessible à tout utilisateur connecté                        |
| `/notifications`      | `notifications.tsx`      | Aucune garde de rôle propre — par conception (notifications personnelles, filtrées par RLS) |

### Restaurant (`restaurant_owner`, `restaurant_staff`, sauf mention contraire)

| Route                              | Fichier                               | Rôles autorisés                                        |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `/dashboard/restaurant/`           | `dashboard.restaurant.index.tsx`      | owner, staff, admin, super_admin                       |
| `/dashboard/restaurant/menu`       | `dashboard.restaurant.menu.tsx`       | owner, staff, admin, super_admin                       |
| `/dashboard/restaurant/orders`     | `dashboard.restaurant.orders.tsx`     | owner, staff, admin, super_admin                       |
| `/dashboard/restaurant/disputes`   | `dashboard.restaurant.disputes.tsx`   | owner, staff, admin, super_admin                       |
| `/dashboard/restaurant/employees`  | `dashboard.restaurant.employees.tsx`  | **owner uniquement** (staff exclu), admin, super_admin |
| `/dashboard/restaurant/promotions` | `dashboard.restaurant.promotions.tsx` | owner, admin, super_admin                              |
| `/dashboard/restaurant/payouts`    | `dashboard.restaurant.payouts.tsx`    | owner, admin, super_admin                              |
| `/dashboard/restaurant/profile`    | `dashboard.restaurant.profile.tsx`    | owner, admin, super_admin                              |
| `/dashboard/restaurant/revenue`    | `dashboard.restaurant.revenue.tsx`    | owner, admin, super_admin                              |

### Livreur (`driver`, sauf mention contraire)

| Route                         | Fichier                          | Rôles autorisés                       |
| ----------------------------- | -------------------------------- | ------------------------------------- |
| `/dashboard/driver/`          | `dashboard.driver.index.tsx`     | **Aucune garde** — voir "Écart connu" |
| `/dashboard/driver/available` | `dashboard.driver.available.tsx` | driver, admin, super_admin            |
| `/dashboard/driver/history`   | `dashboard.driver.history.tsx`   | driver, admin, super_admin            |
| `/dashboard/driver/earnings`  | `dashboard.driver.earnings.tsx`  | driver, admin, super_admin            |
| `/dashboard/driver/payouts`   | `dashboard.driver.payouts.tsx`   | driver, admin, super_admin            |
| `/dashboard/driver/profile`   | `dashboard.driver.profile.tsx`   | **Aucune garde** — voir "Écart connu" |
| `/dashboard/driver/disputes`  | `dashboard.driver.disputes.tsx`  | driver, admin, super_admin            |

### Administrateur (`admin`, `super_admin`)

| Route                              | Fichier                               |
| ---------------------------------- | ------------------------------------- |
| `/dashboard/admin/`                | `dashboard.admin.index.tsx`           |
| `/dashboard/admin/users`           | `dashboard.admin.users.tsx`           |
| `/dashboard/admin/restaurants`     | `dashboard.admin.restaurants.tsx`     |
| `/dashboard/admin/customers`       | `dashboard.admin.customers.tsx`       |
| `/dashboard/admin/payments`        | `dashboard.admin.payments.tsx`        |
| `/dashboard/admin/payout-settings` | `dashboard.admin.payout-settings.tsx` |
| `/dashboard/admin/refunds`         | `dashboard.admin.refunds.tsx`         |
| `/dashboard/admin/disputes`        | `dashboard.admin.disputes.tsx`        |

## ⚠️ Écart connu : garde de rôle manquante sur `/dashboard/driver/` et `/dashboard/driver/profile`

Contrairement à tous leurs routes sœurs (`available`, `history`, `earnings`,
`payouts`, `disputes`, qui vérifient chacune `role === "driver" || "admin" ||
"super_admin"`) et contrairement au layout `dashboard.restaurant.tsx` (qui
centralise sa garde une seule fois), `dashboard.driver.tsx` n'a **aucune**
garde de rôle, et ni `dashboard.driver.index.tsx` ni
`dashboard.driver.profile.tsx` n'en ajoutent une elles-mêmes. En pratique,
n'importe quel utilisateur authentifié (un client, par exemple) peut
naviguer vers ces deux pages et voir la coquille du dashboard livreur — les
requêtes à l'intérieur renverront simplement des résultats vides (aucune
ligne `drivers` pour un `user_id` qui n'est pas livreur), donc ce n'est pas
une fuite de données, mais c'est une incohérence par rapport au reste du
projet, à corriger en ajoutant le même `beforeLoad` que les autres routes
`dashboard.driver.*`.

## Routes serveur (non-React)

`robots[.]txt.ts` et `sitemap[.]xml.ts` utilisent la convention TanStack
Start pour définir des routes serveur qui renvoient une réponse brute (texte
brut / XML) plutôt qu'un composant React — les crochets `[.]` échappent le
point pour qu'il ne soit pas interprété comme un séparateur de segment.
