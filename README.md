# NK Deliveri

Application de livraison de repas pour Gonaïves, Haïti — quatre publics
(Client, Restaurant, Livreur, Administrateur) servis par une seule
application web installable (PWA), en React 19 / TanStack Start, avec
Supabase comme unique backend.

> Dépôt privé et propriétaire — voir [LICENSE](./LICENSE).

## Fonctionnalités

- **Client** — recherche de restaurants, panier, commande, paiement
  (MonCash/NatCash/espèces), suivi de livraison en temps réel sur carte,
  avis, demande de remboursement, ouverture de litige.
- **Restaurant** — gestion du menu (catégories, produits, stock),
  vue Kanban des commandes, bons de cuisine imprimables, promotions
  (affichage marketing), gestion des employés à rôles multiples
  (Manager, Cuisinier, Préparateur, Caissier, Staff), suivi de revenu.
- **Livreur** — file des livraisons disponibles, navigation GPS en direct,
  historique, suivi des gains, configuration de paiement.
- **Administrateur** — supervision temps réel (carte multi-livraisons),
  gestion des utilisateurs/restaurants/livreurs, revue des paiements,
  arbitrage des remboursements et litiges, configuration de la
  plateforme, export clients, diffusion newsletter.
- **Transverse** — notifications in-app et push web, PWA installable avec
  support hors-ligne, interface en kreyòl.

Le détail complet de chaque parcours (étape par étape, avec les appels RPC
réels) est documenté dans [docs/reference/WORKFLOWS.md](./docs/reference/WORKFLOWS.md).

## Stack technique

TanStack Start (React 19) · TanStack Router/Query · Vite 8 + Nitro
(preset Vercel) · Tailwind CSS 4 + shadcn/ui · Supabase (Postgres, Auth,
Storage, Realtime) · Leaflet/OSRM · Web Push (VAPID) · Sentry · Vercel.

Détail complet : [docs/reference/ARCHITECTURE.md](./docs/reference/ARCHITECTURE.md).

## Démarrage rapide

```bash
npm run setup                  # npm ci
cp .env.example .env.local     # puis remplir les valeurs Supabase
npm run dev
```

Guide complet d'installation et de développement :
[docs/reference/DEVELOPMENT.md](./docs/reference/DEVELOPMENT.md).

## Documentation

Toute la documentation technique, métier et opérationnelle vit dans
[`docs/`](./docs/), vérifiée directement contre le code — voir la note en
tête de chaque document. Points d'entrée principaux :

| Je veux comprendre...                                              | Document                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| L'architecture générale et la frontière client/serveur             | [ARCHITECTURE.md](./docs/reference/ARCHITECTURE.md)                       |
| L'organisation des fichiers et les conventions de nommage          | [PROJECT_STRUCTURE.md](./docs/reference/PROJECT_STRUCTURE.md)             |
| Le routage (URLs, gardes de rôle)                                  | [ROUTING.md](./docs/reference/ROUTING.md)                                 |
| Le schéma de base de données (tables, RLS, RPC, triggers, buckets) | [DATABASE.md](./docs/reference/DATABASE.md)                               |
| La configuration et l'usage de Supabase                            | [SUPABASE.md](./docs/reference/SUPABASE.md)                               |
| La référence API (RPC + fonctions serveur)                         | [API.md](./docs/reference/API.md)                                         |
| Les parcours métier complets, étape par étape                      | [WORKFLOWS.md](./docs/reference/WORKFLOWS.md)                             |
| Les composants React                                               | [COMPONENTS.md](./docs/reference/COMPONENTS.md)                           |
| Les hooks personnalisés                                            | [HOOKS.md](./docs/reference/HOOKS.md)                                     |
| Les services et fonctions serveur                                  | [SERVICES.md](./docs/reference/SERVICES.md)                               |
| Comment installer et développer localement                         | [DEVELOPMENT.md](./docs/reference/DEVELOPMENT.md)                         |
| La PWA (Service Worker, manifest, push)                            | [PWA.md](./docs/reference/PWA.md)                                         |
| Les optimisations de performance                                   | [PERFORMANCE.md](./docs/reference/PERFORMANCE.md)                         |
| La sécurité applicative                                            | [SECURITY.md](./docs/reference/SECURITY.md)                               |
| La sécurité infrastructure (en-têtes, permissions, audit RLS)      | [SECURITY_INFRASTRUCTURE.md](./docs/reference/SECURITY_INFRASTRUCTURE.md) |
| Le pipeline CI/CD et l'automatisation                              | [DEVOPS.md](./docs/reference/DEVOPS.md)                                   |
| La procédure de migration Supabase                                 | [MIGRATIONS.md](./docs/reference/MIGRATIONS.md)                           |
| Les environnements (dev/preprod/prod)                              | [ENVIRONMENTS.md](./docs/reference/ENVIRONMENTS.md)                       |
| L'audit et la mise à jour des dépendances                          | [DEPENDENCIES.md](./docs/reference/DEPENDENCIES.md)                       |
| La sauvegarde et restauration de la base                           | [BACKUP_RESTORE.md](./docs/runbooks/BACKUP_RESTORE.md)                    |
| La procédure complète de mise en production                        | [DEPLOYMENT.md](./docs/reference/DEPLOYMENT.md)                           |

## Contribuer

Voir [CONTRIBUTING.md](./CONTRIBUTING.md) (workflow Git, format de commit,
procédure de Pull Request) et le [Code de conduite](./CODE_OF_CONDUCT.md).

## Historique

Voir [CHANGELOG.md](./CHANGELOG.md) pour les grandes étapes du projet, et
`git log` pour l'historique complet, commit par commit.

## Licence

Logiciel propriétaire — voir [LICENSE](./LICENSE).
