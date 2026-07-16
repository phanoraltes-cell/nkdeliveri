# Guide des composants — NK Deliveri

Inventaire de `src/components/`, organisé par sous-dossier tel qu'il existe
réellement dans le code. Les primitives shadcn/ui (`src/components/ui/`) ne
sont pas détaillées une à une (ce sont des wrappers Radix UI standards) ;
tout le reste est décrit avec son rôle métier réel.

Voir aussi [HOOKS.md](./HOOKS.md) pour les hooks consommés par ces
composants, et [WORKFLOWS.md](./WORKFLOWS.md) pour le parcours complet dans
lequel chacun s'insère.

## Racine (`src/components/*.tsx`)

| Composant | Rôle |
|---|---|
| `site-header.tsx` | En-tête public (logo, nav, panier, connexion) — utilise `useAuth`/`useCart` |
| `site-footer.tsx` | Pied de page public (liens légaux, réseaux) |
| `bottom-nav.tsx` | Barre de navigation mobile fixe (accueil/restaurants/panier/compte) |
| `breadcrumb.tsx` | Fil d'Ariane générique réutilisable |
| `install-prompt.tsx` | Invite d'installation PWA (`beforeinstallprompt`) — voir [PWA.md](./PWA.md) |
| `push-toggle.tsx` | Bascule d'abonnement aux notifications push (utilisée sur `/notifications`) |
| `change-password-form.tsx` | Formulaire de changement de mot de passe (profil) |
| `address-manager.tsx` | CRUD des adresses de livraison du client (table `addresses`) |
| `proof-thumb.tsx` | Vignette d'aperçu d'une preuve de paiement (image/PDF) |
| `driver-location-reporter.tsx` | Monte le hook `useDriverLocation` en tâche de fond sur le dashboard livreur — aucun rendu visible propre |

## `dashboard/` (racine du dossier)

| Composant | Rôle |
|---|---|
| `dashboard-shortcut-grid.tsx` | Grille de raccourcis affichée sur l'accueil de chaque dashboard (extrait en Phase 4 pour éliminer une duplication entre admin/restaurant/driver) |
| `status-badge.tsx` | Badge coloré générique pour un statut (commande/paiement/livraison/remboursement/litige) |
| `pagination-controls.tsx` | Contrôles de pagination réutilisés par les listes admin (utilisateurs, restaurants, clients) |

### `dashboard/cards/`

| Composant | Rôle |
|---|---|
| `kpi-card.tsx` | Carte d'indicateur chiffré (ex. revenu du jour, commandes actives) |
| `empty-state.tsx` | État vide générique (icône + message) pour les listes sans résultat |

### `dashboard/charts/`

| Composant | Rôle |
|---|---|
| `revenue-chart.tsx` | Graphique de revenu hebdomadaire, alimenté par le hook `useWeeklySeries` |

### `dashboard/tables/`

| Composant | Rôle |
|---|---|
| `data-table.tsx` | Table générique réutilisée par les listes admin/restaurant |

### `dashboard/navbar/`, `dashboard/sidebar/`, `dashboard/drawer/`

| Composant | Rôle |
|---|---|
| `dashboard-header.tsx` | En-tête du dashboard (nom d'utilisateur, notifications, déconnexion) |
| `dashboard-sidebar.tsx` | Barre latérale desktop, dont les entrées viennent de `getNavItems(role, employeeRole?)` (`sidebar/nav-items.ts`) — varie selon le rôle **et**, pour le personnel restaurant, selon `employeeRole` (les rôles opérationnels cuisinier/préparateur/caissier voient une nav réduite sans accès au menu) |
| `mobile-drawer.tsx` | Équivalent mobile de la sidebar, même source `getNavItems` |

### `dashboard/admin/`

| Composant | Rôle |
|---|---|
| `pending-restaurants-section.tsx` | Liste des restaurants `status='pending'` avec actions d'approbation/rejet (`update_restaurant_status_secure`) |
| `pending-drivers-section.tsx` | Idem pour les livreurs (`update_driver_status_secure`) |
| `pending-payments-section.tsx` | File d'attente des paiements `under_review` (preuves à valider) |
| `payout-history.tsx` | Historique des versements traités |
| `delivery-route-fetcher.tsx` | Composant sans rendu (headless), une instance par livraison active — appelle `useRoute` pour peupler le tracé de chaque livraison sur la carte admin |
| `live-map-section.tsx` | Carte de supervision temps réel : jusqu'à `MAX_LIVE_ROUTES = 20` tracés simultanés + liste d'ETA par livraison, construite au-dessus de `LeafletMap` |

### `dashboard/driver/`

| Composant | Rôle |
|---|---|
| `active-deliveries-section.tsx` | Liste des livraisons en cours du livreur connecté |
| `delivery-route-info.tsx` | Détail d'itinéraire pour une livraison (distance, durée, prochain arrêt) — exporte les helpers `nextStopFor`/`formatDistance`/`formatDuration` réutilisés par la carte admin |

### `dashboard/restaurant/`

| Composant | Rôle |
|---|---|
| `category-manager.tsx` | CRUD des catégories de menu |
| `product-grid.tsx` | Grille des produits du restaurant (disponibilité, stock, archivage) |
| `product-form.tsx` | Formulaire de création/édition d'un produit |
| `order-kanban-board.tsx` | Tableau Kanban des commandes du restaurant — 7 colonnes (Nouvelle/Confirmée/En préparation/Prête/En livraison/Terminée/Annulée), glisser-déposer HTML5 natif, validation des transitions côté client (`isValidDrop`, miroir des règles serveur de `update_order_status_secure`) avant l'appel RPC |

## `order/`

Composants montés sur `/orders/$id`, chacun visible selon le statut/rôle
pertinent.

| Composant | Rôle |
|---|---|
| `star-rating.tsx` | Sélecteur d'étoiles réutilisable |
| `order-review-section.tsx` | Formulaire d'avis (restaurant + livreur) après livraison |
| `payment-proof-section.tsx` | Upload de preuve de paiement MonCash/NatCash → `submit_payment_proof_secure` |
| `delivery-tracking-section.tsx` | Suivi temps réel (carte + ETA) via `useOrderDelivery`/`useRoute`, aucun RPC — lecture directe des tables |
| `refund-section.tsx` | Demande de remboursement côté client (`request_refund_secure`) et affichage de son statut/historique |
| `dispute-section.tsx` | Ouverture d'un litige côté client (`open_dispute_secure`), rend ensuite `disputes/dispute-thread.tsx` |

## `disputes/`

| Composant | Rôle |
|---|---|
| `dispute-thread.tsx` | Fil de messages d'un litige, **partagé par les quatre rôles** (client/restaurant/livreur/admin) — utilise le hook `useDisputeMessages`, affiche `author_role` pour distinguer les intervenants, et un formulaire de résolution réservé à l'admin |

## `maps/`

| Composant | Rôle |
|---|---|
| `LeafletMap.tsx` | Wrapper Leaflet réutilisable. Accepte un `route` unique (usage historique, ex. suivi client) **et** un tableau `routes?: MapRoute[]` (multi-polylignes, ajouté en Phase 5 pour la carte de supervision admin) sans casser les appelants existants |

## `home/`

Sections de la page d'accueil publique (`/`), assemblées dans `index.tsx` :
`hero-section.tsx`, `how-it-works-section.tsx`,
`popular-restaurants-section.tsx` (utilise `useFavorites`),
`popular-dishes-section.tsx` (utilise `useCart`),
`restaurant-cta-banner.tsx` (appel à devenir partenaire),
`app-benefits-section.tsx` (arguments PWA/rapidité), `newsletter-section.tsx`
(insertion dans `newsletter_subscribers`).

## `ui/`

Primitives [shadcn/ui](https://ui.shadcn.com/) basées sur Radix UI :
`avatar`, `badge`, `button`, `card`, `dialog`, `dropdown-menu`, `input`,
`separator`, `sheet`, `skeleton`, `sonner` (toasts), `table`, `tabs`,
`tooltip`. Génériques et sans logique métier — consulter directement le
fichier concerné pour l'API des props, elle suit la convention shadcn
standard.
