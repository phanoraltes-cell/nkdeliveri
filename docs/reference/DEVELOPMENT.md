# Guide de développement — NK Deliveri

## Prérequis

- Node.js **22** (voir `.nvmrc` — utiliser `nvm use` si disponible ; la CI
  utilise exactement cette version).
- Un compte Supabase avec un projet créé (ou la CLI Supabase pour un stack
  100% local — voir [SUPABASE.md](./SUPABASE.md)).
- La [Supabase CLI](https://supabase.com/docs/guides/cli) si vous comptez
  lancer la base en local ou rejouer les migrations (`supabase start`).

## Installation

```bash
git clone <url-du-dépôt>
cd nkdeliveri
npm run setup        # = npm ci — installation reproductible depuis package-lock.json
cp .env.example .env.local
```

Remplir `.env.local` avec vos propres valeurs — voir
[`.env.example`](../../.env.example) (chaque variable y est documentée
individuellement) et [ENVIRONMENTS.md](./ENVIRONMENTS.md) pour le détail
complet par environnement. Au minimum pour démarrer : les quatre variables
Supabase (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).

## Lancer le projet en local

```bash
npm run dev       # vite dev — serveur de développement avec HMR
```

Pour un backend Supabase entièrement local (Postgres/Auth/Storage/Realtime
dans Docker, migrations rejouées automatiquement) plutôt que de pointer
vers un projet Supabase cloud, voir
[SUPABASE.md § Développement local](./SUPABASE.md#développement-local).

## Scripts disponibles (`package.json`)

| Script                     | Commande                                         | Rôle                                                                                       |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `npm run setup`            | `npm ci`                                         | Installation reproductible                                                                 |
| `npm run dev`              | `vite dev`                                       | Serveur de développement                                                                   |
| `npm run build`            | `vite build`                                     | Build de production (preset Nitro `vercel`)                                                |
| `npm run build:dev`        | `vite build --mode development`                  | Build en mode développement (non minifié)                                                  |
| `npm run preview`          | `vite preview`                                   | Sert le build de production en local                                                       |
| `npm run clean`            | `node scripts/clean.mjs`                         | Supprime `.output`, `.vercel/output`, `dist`, `dist-ssr`, caches Vite                      |
| `npm run lint`             | `eslint .`                                       | Lint (exclut `supabase/functions`, `.vercel`, `.output`, `.vinxi`, `dist`)                 |
| `npm run format`           | `prettier --write .`                             | Formatage automatique                                                                      |
| `npm run format:check`     | `prettier --check .`                             | Vérifie le formatage sans modifier                                                         |
| `npm run typecheck`        | `tsc --noEmit -p tsconfig.json`                  | Vérification TypeScript stricte                                                            |
| `npm run check:migrations` | `node scripts/check-migration-hazards.mjs`       | Détecte le piège de surcharge de fonction Postgres — voir [MIGRATIONS.md](./MIGRATIONS.md) |
| `npm run verify`           | `typecheck && lint && check:migrations && build` | Chaîne de vérification complète, identique à ce que la CI exécute                          |
| `npm run db:backup`        | `bash scripts/backup-database.sh`                | Sauvegarde de la base — voir [BACKUP_RESTORE.md](../runbooks/BACKUP_RESTORE.md)                      |
| `npm run db:restore`       | `bash scripts/restore-database.sh`               | Restauration — voir [BACKUP_RESTORE.md](../runbooks/BACKUP_RESTORE.md)                               |

**Avant toute Pull Request**, lancer `npm run verify` localement — c'est
exactement la chaîne que la CI exécute (voir [DEVOPS.md](./DEVOPS.md)), la
faire échouer en local coûte moins cher qu'un aller-retour CI.

## Où trouver quoi

| Je veux...                                         | Voir                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Ajouter une route                                  | [ROUTING.md](./ROUTING.md) pour la convention de nommage à points                          |
| Ajouter/modifier une table, une policy RLS, un RPC | [DATABASE.md](./DATABASE.md), puis [MIGRATIONS.md](./MIGRATIONS.md) pour la procédure      |
| Ajouter un composant                               | [COMPONENTS.md](./COMPONENTS.md) pour la convention de dossier                             |
| Ajouter un hook                                    | [HOOKS.md](./HOOKS.md) pour la convention camelCase                                        |
| Ajouter une notification push                      | [SERVICES.md § Notifications push](./SERVICES.md#notifications-push-send--pushfunctionsts) |
| Comprendre un parcours métier complet              | [WORKFLOWS.md](./WORKFLOWS.md)                                                             |
| Comprendre l'architecture générale                 | [ARCHITECTURE.md](./ARCHITECTURE.md)                                                       |

## Convention Git / workflow de contribution

Voir [CONTRIBUTING.md](../../CONTRIBUTING.md) (branches, format de commit,
revue de code, procédure de Pull Request).

## Tests

**Aucune suite de tests automatisés n'existe actuellement** dans ce
projet — le dossier `tests/` est présent mais vide et non suivi par git, et
`package.json` ne définit pas de script `test`. La vérification de
correction repose aujourd'hui sur :

1. `npm run verify` (typecheck + lint + validation des migrations + build).
2. Test manuel dans le navigateur pour tout changement UI (voir la
   consigne standard : tester le parcours nominal et les cas limites avant
   de considérer une fonctionnalité terminée).

Si une suite de tests est introduite un jour, ce document et
[DEVOPS.md](./DEVOPS.md) (pipeline CI) devront être mis à jour en
conséquence — ne pas présumer d'un framework de test avant qu'il
n'existe réellement dans le dépôt.

## Débogage courant

- **« Cannot find module »/erreurs liées aux imports `.client.`/`.server.`** —
  voir [ARCHITECTURE.md § Le plugin de protection d'imports de TanStack
  Start](./ARCHITECTURE.md#le-plugin-de-protection-dimports-de-tanstack-start) :
  ces deux suffixes de nom de fichier sont réservés, pas de simples
  conventions.
- **PWA/Service Worker qui ne se met pas à jour en local** — le Service
  Worker n'est enregistré qu'en production (`import.meta.env.PROD`) ; en
  développement, `npm run dev` ne l'active jamais. Utiliser `npm run build
&& npm run preview` pour tester le comportement PWA réel, ou l'URL avec
  `?sw=off` pour le désactiver explicitement (voir [PWA.md](./PWA.md)).
- **Erreur de surcharge de fonction Postgres après une migration** — voir
  [MIGRATIONS.md](./MIGRATIONS.md), c'est le piège le plus documenté de ce
  projet (`CREATE OR REPLACE FUNCTION` avec une signature différente crée
  une nouvelle surcharge au lieu de remplacer l'existante).
