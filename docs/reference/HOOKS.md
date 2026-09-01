# Guide des Hooks — NK Deliveri

Tous les hooks personnalisés vivent dans `src/hooks/*.ts`, en camelCase
(`useNomDuHook.ts`). Chacun ci-dessous est vérifié directement dans le code
— signature, retour, et usage réel.

## `useAuth()`

`src/hooks/useAuth.ts` — aucun paramètre.

Retourne `{ session, user, loading, role }`. S'abonne à
`supabase.auth.onAuthStateChange` et récupère la session initiale ; résout
`role` via le RPC `get_primary_role` dès qu'un utilisateur est présent.
C'est le hook central "qui est connecté" de toute l'application — utilisé
dans `site-header.tsx`, `bottom-nav.tsx`, `useFavorites.ts`, et dans les
routes d'authentification/dashboard.

## `useCart()`

`src/hooks/useCart.ts` — aucun paramètre.

Retourne `{ items, add, setQty, remove, clear, count, subtotal }`. Panier
100% côté client, stocké dans `localStorage` (clé `nk-cart-v1`), synchronisé
entre onglets/composants via un événement `nk-cart-changed` personnalisé et
l'événement natif `storage`. `add()` **remplace tout le panier** si
l'article ajouté vient d'un restaurant différent (règle "un seul restaurant
par panier"). Utilisé par `site-header.tsx`, `bottom-nav.tsx`,
`popular-dishes-section.tsx`, les routes de commande.

## `useDisputeMessages(disputeId)`

`src/hooks/useDisputeMessages.ts` — `disputeId: string | undefined`.

Retourne `{ messages, send }` (deux résultats React Query). `messages` lit
`dispute_messages` triés par `created_at` ; `send` poste via le RPC
`add_dispute_message_secure` puis appelle en best-effort la fonction serveur
`sendDisputeUpdatePush` et invalide la requête. Alimente
`components/disputes/dispute-thread.tsx`, partagé par tous les dashboards
litiges (client/restaurant/livreur/admin).

## `useDriverLocation(driverId)`

`src/hooks/useDriverLocation.ts` — `driverId: string`.

Retourne `{ active, last, error, start, stop }`. Encapsule
`navigator.geolocation.watchPosition`, throttlé à une écriture toutes les 8
secondes, mettant à jour à la fois `drivers.current_lat/lng` et
`deliveries.driver_lat/lng/driver_heading/location_updated_at` pour les
livraisons actives du livreur (`assigned`/`picked_up`/`en_route_pickup`/
`en_route_dropoff`). Utilisé par `components/driver-location-reporter.tsx`
sur le dashboard livreur.

## `useFavorites()`

`src/hooks/useFavorites.ts` — aucun paramètre.

Retourne `{ favoriteIds, isFavorite(id), toggleFavorite(id), isLoggedIn }`.
Lit/écrit la table `favorites` selon l'utilisateur courant (`useAuth()`) ;
`toggleFavorite` insère ou supprime une ligne et invalide la requête. Utilisé
par `popular-restaurants-section.tsx` et les pages de listing restaurant.

## `useLiveOrders` (deux exports)

`src/hooks/useLiveOrders.ts`

- **`useLiveOrders(scope: { driverId?; customerId?; admin? }): ActiveDelivery[]`**
  — requête `deliveries` jointe à `orders`/`restaurants`/`drivers`, filtrée
  aux statuts actifs, pilotée par un abonnement Realtime Supabase
  (`postgres_changes` sur `deliveries`) qui invalide le cache React Query à
  chaque changement. Alimente la carte en temps réel admin, la section
  livraisons actives du livreur, et les listes de commandes client.
- **`useOrderDelivery(orderId: string | undefined): ActiveDelivery | null`**
  — même forme, limitée à une seule commande, avec son propre canal
  realtime filtré par `order_id`. Utilisé sur la page détail commande client
  (`delivery-tracking-section.tsx`).

## `useMyRestaurant(userId)`

`src/hooks/useMyRestaurant.ts` — `userId: string | undefined`.

Retourne une `useQuery` pour `MyRestaurant | null`
(`{ id, name, status, isOwner, employeeRole }`). Essaie d'abord une
correspondance `restaurants.owner_id`, puis se rabat sur une jointure
`restaurant_employees`. Résout "à quel restaurant cet utilisateur
appartient-il" pour toutes les routes du dashboard restaurant, que
l'utilisateur soit propriétaire ou employé.

## `useRoute(from, to)`

`src/hooks/useRoute.ts` — `from`/`to: RoutePoint | undefined`.

Retourne une `useQuery` encapsulant `services/routing.getRoute` (itinéraire
routier OSRM : polyligne + distance + durée). La clé de requête arrondit les
coordonnées à une grille ~50m pour que le bruit GPS réutilise le cache ;
`staleTime: 60 000`. Utilisé par `delivery-route-info.tsx`,
`delivery-route-fetcher.tsx`, `delivery-tracking-section.tsx` pour l'ETA/le
tracé en temps réel sur les cartes.

## `useWeeklySeries(queryKey, fetchRows, toDateAndValue, options?)`

`src/hooks/useWeeklySeries.ts` — générique.

Wrapper `useQuery` générique qui regroupe des lignes arbitraires en une
série glissante de 7 jours avec des étiquettes de jour en kreyòl (helpers
internes `bucketWeeklySeries`/`startOfTrailingWeek`, basés sur
`lib/creole.ts`). Extrait d'une logique de regroupement dupliquée dans
`dashboard.admin/driver/restaurant.index.tsx` ; alimente
`dashboard/charts/revenue-chart.tsx`.

## Convention

Tous les hooks utilisent le camelCase (`useNomDuHook.ts`), cohérent depuis
la Phase 4 de remédiation (deux hooks en kebab-case, `use-auth.ts` et
`use-cart.ts`, ont été renommés en `useAuth.ts`/`useCart.ts` pour uniformiser
la convention).
