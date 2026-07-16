# Performance — NK Deliveri

Ce document couvre les optimisations de performance réellement en place
dans le code — pas une checklist générique.

## Découpage de bundle (`vite.config.ts`)

`rollupOptions.output.manualChunks` sépare le code fournisseur volatil
(routes/composants, redéployés à chaque livraison) du code fournisseur
stable (librairies tierces, changent rarement) en chunks nommés et
long-terme cacheables :

| Chunk | Contenu |
|---|---|
| `vendor-leaflet` | `leaflet`, `react-leaflet` |
| `vendor-charts` | `recharts` et ses dépendances D3/Victory |
| `vendor-pdf` | `jspdf`, `html2canvas`, `canvg`, `dompurify` |
| `vendor-motion` | `framer-motion` |
| `vendor-react` | `react`, `react-dom`, `scheduler` |
| `vendor-tanstack` | tous les packages `@tanstack/*` |
| `vendor-supabase` | `@supabase/*` |

Le découpage est volontairement **grossier** (une poignée de chunks
stables) plutôt qu'un chunk par package — un chunk par package évite les
re-téléchargements inutiles mais multiplie les requêtes HTTP, ce qui a un
coût propre ; ce projet a choisi un compromis délibéré entre les deux.

## Chargement différé

- **jsPDF** (`src/lib/kitchen-ticket.ts`) — importé dynamiquement
  (`await import("jspdf")`) uniquement au moment d'imprimer un bon de
  cuisine, jamais dans le bundle initial.
- **Sentry côté serveur** — les captures d'exception passent par
  `captureExceptionServer`, qui n'engage `@sentry/node` que si `SENTRY_DSN`
  est défini (no-op sinon, pas de coût si l'observabilité n'est pas
  configurée).
- **workbox-window** (`src/lib/pwa-register.ts`) — importé dynamiquement,
  uniquement en production et côté client.
- **`@block65/webcrypto-web-push`** et `supabaseAdmin` — importés
  dynamiquement à l'intérieur des handlers de fonctions serveur
  (`await import(...)`), jamais statiquement, pour ne jamais finir dans un
  bundle envoyé au navigateur.

## Cache réseau applicatif

- **TanStack Query** — `staleTime` global de 30 secondes
  (`src/router.tsx`), documenté dans le code comme un compromis délibéré :
  les données réellement temps réel (`orders`, `deliveries`, positions
  livreur, notifications) sont de toute façon invalidées immédiatement par
  les abonnements Realtime Supabase (`useLiveOrders`/`useOrderDelivery`,
  voir [HOOKS.md](./HOOKS.md)) et par les `onSuccess` de mutation — le
  `staleTime` ne réduit donc que les refetch de fond redondants (ex.
  revenir sur un onglet dashboard déjà chargé), pas la fraîcheur des
  données réellement critiques.
- **`useRoute`** (itinéraire OSRM) — cache mémoire côté service
  (`src/services/routing.ts`) avec TTL 5 minutes et une clé arrondie à une
  grille ~50m, pour que le bruit GPS entre deux positions consécutives
  d'un livreur réutilise le même itinéraire au lieu de le
  recalculer/re-requêter à chaque tick.
- **Service Worker** (`src/sw.ts`) — `CacheFirst` pour les assets
  statiques (200 entrées, 30 jours), `NetworkFirst` pour les pages HTML
  (timeout réseau 5s) — voir [PWA.md](./PWA.md).

## Base de données

- **Index explicites** sur toutes les colonnes de clé étrangère
  fréquemment filtrées (`orders.customer_id`, `orders.restaurant_id`,
  `deliveries.driver_id`, etc.) — voir la liste complète dans
  [DATABASE.md § Index](./DATABASE.md#6-index-explicites-au-delà-des-pkunique-automatiques).
- **Index partiel** sur `newsletter_subscribers` (`WHERE unsubscribed_at
  IS NULL`) — évite d'indexer les lignes désabonnées, jamais interrogées
  par la diffusion.
- **Pagination côté serveur** sur les listes admin volumineuses
  (`get_customers_admin`, `get_all_users_admin`, `get_restaurants_admin`) —
  `_limit`/`_offset` avec `total_count` renvoyé dans chaque ligne plutôt
  qu'une requête `COUNT` séparée.
- **RPC agrégées côté serveur** (`get_restaurant_revenue_summary`,
  `get_driver_earnings_summary`) — le calcul des totaux/moyennes se fait en
  SQL, pas en re-téléchargeant toutes les lignes brutes vers le client pour
  les agréger en JavaScript.

## PWA / réseaux lents

Le contexte du projet (connectivité mobile haïtienne, potentiellement
instable) motive plusieurs choix déjà couverts ailleurs :
`NetworkFirst`/`CacheFirst` avec repli offline (voir [PWA.md](./PWA.md)),
et le format de bon de cuisine imprimable localement sans dépendance
réseau une fois le PDF généré.

## Ce qui n'est pas (encore) mesuré

Il n'existe actuellement aucun budget de performance automatisé (pas de
Lighthouse CI, pas de bundle-size-check dans la CI — voir
[DEVOPS.md](./DEVOPS.md) pour le contenu réel du pipeline). Toute
régression de performance doit aujourd'hui être détectée manuellement.
