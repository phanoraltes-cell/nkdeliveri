# Prompt — Refonte des dashboards NK Deliveri (adapté au projet réel)

Agis comme un Senior UI/UX Designer, Product Designer et Expert Frontend (React 19, TanStack Start, TanStack Router, Tailwind CSS v4, Shadcn UI) avec plus de 15 ans d'expérience dans la conception d'applications de livraison comme Uber Eats, DoorDash, Glovo, Bolt Food et Deliveroo.

Ta mission : restructurer entièrement les dashboards de NK Deliveri pour obtenir une interface moderne, cohérente, responsive et évolutive — **sans casser les flux métier existants** (livraisons temps réel, preuves de paiement MonCash/NatCash, gestion des payouts).

## Contraintes techniques réelles du projet (à respecter impérativement)

- **Framework** : TanStack Start + TanStack Router (Vite), pas Next.js. Routing par fichiers **plats** dans `src/routes/` (convention par points : `dashboard.admin.customers.tsx` = enfant de `dashboard.admin.tsx`). Ne pas proposer d'arborescence `app/` ou `pages/`.
- **Shadcn UI** : `components.json` existe (style `new-york`, alias `@/components/ui`) mais seuls `dropdown-menu.tsx` et `sonner.tsx` sont générés. Il faut générer les composants manquants nécessaires : `button`, `card`, `table`, `sidebar`, `sheet` (base du Drawer), `dialog`, `input`, `badge`, `skeleton`, `dropdown-menu` (déjà là), `avatar`, `tabs`. Ajouter `class-variance-authority` (absent actuellement).
- **Librairies à ajouter** : `recharts` (pour les graphiques — les tokens CSS `--chart-1` à `--chart-5` existent déjà dans `src/styles.css` et sont prêts à l'emploi) + composant shadcn `table.tsx` pour les Data Tables (pas de `@tanstack/react-table`, rester léger).
- **Identité visuelle** : ne pas recréer de palette. Réutiliser les tokens existants dans `src/styles.css` (`--brand: #F97316`, `--brand-light`, `--brand-deep`, `--brand-soft`, `--cream`, `--ink`, `--ink-soft`, `--radius: 1.125rem` et son échelle, fonts `Bricolage Grotesque` + `Instrument Sans`). Le mode sombre existe mais reste générique (bleu-gris) — proposer une adaptation à la marque orange si pertinent.
- **Icônes** : `lucide-react` déjà installé, à utiliser exclusivement.
- **Langue de l'UI : créole haïtien**, cohérent avec le reste du site (public + dashboards existants). Tous les libellés de nav et de composants doivent être en créole. Le français reste uniquement la langue de rédaction de ce prompt/des specs.
- **Auth & rôles** : Supabase Auth, rôle récupéré via RPC `get_primary_role`, injecté dans le `routeContext` (`{ user, role }`), consommé via `Route.useRouteContext()`. Rôles réels : `customer`, `restaurant_owner`, `restaurant_staff`, `driver`, `admin`, `super_admin`. Prévoir une visibilité conditionnelle de certains items de nav selon le sous-rôle (ex. `restaurant_staff` ne voit pas forcément "Anplwaye"/Employés, `super_admin` voit des items que `admin` ne voit pas).

## Objectifs

- Uniformiser les 4 dashboards (admin, client, restaurant, livrè) sous un layout commun.
- Extraire la sidebar actuellement codée en dur dans `src/routes/_authenticated/dashboard.tsx` en un composant réutilisable **Sidebar fixe sur Desktop** (`src/components/dashboard/sidebar/`).
- Remplacer la nav horizontale scrollable mobile actuelle par un vrai **Drawer** (menu hamburger, basé sur le composant shadcn `sheet`) — c'est un changement de pattern, pas un ajustement.
- Réduire le nombre de clics, respecter les meilleures pratiques UX modernes, prévoir une architecture extensible.

## Layout global

### Desktop — Sidebar fixe 260px

Logo NK Deliveri, puis navigation par rôle (labels créoles, item entre parenthèses = équivalent français pour référence) :

- 🏠 Akèy (Dashboard)
- 📦 Kòmand (Commandes)
- ❤️ Favori (Favoris — client uniquement)
- 🍽 Restoran (Restaurants — admin/client)
- 🏍 Livrezon (Livraisons)
- 📍 Adrès (Adresses)
- 💳 Peman (Paiements)
- 👥 Itilizatè (Utilisateurs — admin)
- 📊 Estatistik (Statistiques)
- 💰 Revni (Revenus)
- 🔔 Notifikasyon
- ⭐ Avi (Avis)
- ⚙ Paramèt (Paramètres)

—

- 👤 Pwofil
- 🚪 Dekonekte

Note: Eviter les emoticones dans les dashbord juste des vrais icone ou des texte tout simple.

### Mobile — Drawer

Header : ☰ Menu · Logo · Notifikasyon · Avatar. Le Drawer coulissant remplace la nav horizontale actuelle.

### Responsive

- Desktop : sidebar fixe 260px.
- Tablette : sidebar réduite (icônes seules, tooltip au survol).
- Mobile : Drawer. Cartes empilées, tableaux → cartes, boutons accessibles au pouce (zone tactile ≥44px).

## Dashboard Admin

Routes existantes à conserver/enrichir : `dashboard.admin.index`, `.customers`, `.payments`, `.payout-settings`, `.restaurants`, `.users`.

Contenu attendu : KPI cards (kòmand jodi a, revni, restoran aktif, livrè aktif, nouvo kliyan), graphiques recharts (courbe commandes/revenus), dernières commandes, activité récente, notifications, actions rapides, gestion utilisateurs/restaurants/livreurs/paiements, paramètres système. La carte Leaflet temps réel déjà présente dans `dashboard.admin.index.tsx` est à conserver et intégrer dans le nouveau layout, pas à remplacer.

## Dashboard Client

**Refonte quasi complète** : le dashboard actuel (`dashboard.customer.tsx`) est une simple grille de 6 cartes sans sous-routes. À enrichir avec : commande en cours + suivi livraison, actions rapides (nouvelle commande, recommander), favoris, historique récent, promotions, restaurants populaires, notifications, accès pwofil/peman/adrès/avi. Décider si ces sections deviennent des sous-routes `dashboard.customer.*` (cohérent avec les autres dashboards) ou restent des cartes qui pointent vers les routes existantes (`/profile`, `/orders`).

## Dashboard Restaurant

Routes existantes : `.index`, `.employees`, `.menu`, `.orders`, `.payouts`, `.profile`, `.promotions`, `.revenue`. Contenu attendu : commandes du jour, revenus, plats populaires, commandes en attente/en préparation, historique, gestion menu/produits/catégories/promotions, horaires, avis clients, statistiques, notifications, profil. Vérifier si "catégories" et "avis clients" nécessitent une route dédiée ou restent intégrées à `.menu`/`.orders`.

## Dashboard Livrè (Driver)

Routes existantes : `.index`, `.available`, `.earnings`, `.history`, `.payouts`, `.profile`. Contenu attendu : disponible/hors ligne, livraison actuelle, carte (Leaflet déjà en place via `useDriverLocation`/`useRoute`), navigation, historique, revenus, nombre de livraisons, statistiques/performance, avis, notifications, profil, paramètres. Vérifier l'absence de garde de rôle explicite dans `dashboard.driver.tsx` — à sécuriser en cohérence avec les autres dashboards.

## Architecture (adaptée à TanStack Router)

```
src/
├── routes/                          # inchangé — routing plat TanStack Router
│   └── _authenticated/
│       ├── dashboard.tsx            # layout commun (à réécrire : sidebar + drawer extraits)
│       ├── dashboard.admin*.tsx
│       ├── dashboard.customer*.tsx
│       ├── dashboard.restaurant*.tsx
│       └── dashboard.driver*.tsx
├── components/
│   ├── ui/                          # shadcn (à compléter : sidebar, sheet, table, dialog, badge, skeleton...)
│   └── dashboard/                   # nouveau — nav réutilisable pour tous les rôles
│       ├── sidebar/
│       │   ├── dashboard-sidebar.tsx
│       │   └── nav-items.ts         # config des items de nav par rôle (source unique)
│       ├── drawer/
│       │   └── mobile-drawer.tsx
│       ├── navbar/
│       │   └── dashboard-header.tsx
│       ├── cards/
│       │   ├── kpi-card.tsx
│       │   └── empty-state.tsx
│       ├── tables/
│       │   └── data-table.tsx       # wrapper shadcn table + rendu carte sur mobile
│       └── charts/
│           └── revenue-chart.tsx    # wrapper recharts + tokens --chart-1..5
```

La config `nav-items.ts` centralise les items de menu par rôle/sous-rôle — source unique consommée par `dashboard-sidebar.tsx` et `mobile-drawer.tsx`, pour éviter la duplication observée aujourd'hui entre nav mobile et sidebar desktop dans `dashboard.tsx`.

## UI à utiliser

Cartes modernes, KPI Cards, Data Tables (shadcn `table.tsx`, rendu carte sur mobile), graphiques recharts, Badges, Timeline, Activity Feed, Notifications, Skeleton Loading, Empty States, Dialogs, Drawer (shadcn `sheet`), Dropdowns (déjà présent).

## UX

Toujours en premier : infos les plus importantes, actions rapides, notifications, tâches en attente. Préserver les flux existants de preuve de paiement (`payment_proofs`, `submit_payment_proof_secure`, composant `proof-thumb.tsx`) sans régression.

## Accessibilité & performance

ARIA sur le Drawer (`role="dialog"`, `aria-modal`, focus trap), navigation clavier complète sur la sidebar et les menus, contraste vérifié sur l'orange `#F97316` (attention aux textes blancs sur `--brand-light`), focus visible. Lazy-load des routes de dashboard déjà natif à TanStack Router — en profiter pour découper les gros composants (charts, tables) en chargement différé.

## Livrables attendus

1. Arborescence des composants `src/components/dashboard/` complète.
2. Liste des composants shadcn à générer (commande `npx shadcn add ...` pour chacun).
3. Wireframes Desktop et Mobile (sidebar/drawer + un dashboard type par rôle).
4. Config `nav-items.ts` avec tous les items par rôle/sous-rôle, labels en créole.
5. Palette et espacements — référence aux tokens existants dans `src/styles.css`, pas de nouvelles valeurs.
6. Recommandations d'accessibilité et de performance ci-dessus, appliquées concrètement aux composants listés.
