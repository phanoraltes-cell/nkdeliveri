# Structure du projet — NK Deliveri

Arborescence réelle du dépôt (dossiers/fichiers pertinents pour un
développeur ; les artefacts de build (`.output/`, `.vercel/`, `dist/`),
`node_modules/`, et les fichiers de scratch personnels ne sont pas listés).

```
nkdeliveri/
├── .github/workflows/ci.yml     # Pipeline CI — voir DEVOPS.md
├── .nvmrc                       # Version Node pinnée (22) pour CI/local
├── docs/                        # Documentation technique — voir "Organisation de docs/" plus bas
├── public/                      # Assets statiques servis tels quels (icônes PWA, manifest, offline.html, images marketing)
├── scripts/                     # Scripts d'automatisation Node/bash — voir DEVOPS.md
│   ├── clean.mjs
│   ├── check-migration-hazards.mjs
│   ├── backup-database.sh
│   └── restore-database.sh
├── supabase/
│   ├── config.toml              # project_id uniquement
│   ├── migrations/               # 169+ fichiers SQL, un par changement de schéma — voir MIGRATIONS.md
│   ├── tests/                     # Tests de régression sécurité SQL (ex. c01_user_roles_security.sql)
│   └── functions/                # Edge Functions Deno, projet à part — voir SUPABASE.md
├── src/
│   ├── routes/                   # Routage TanStack Start basé fichiers — voir ROUTING.md
│   │   └── _authenticated/       # Layout sans URL propre, garde de session — voir ROUTING.md
│   ├── components/                # Composants React — voir COMPONENTS.md
│   ├── hooks/                     # Hooks personnalisés — voir HOOKS.md
│   ├── lib/                       # Utilitaires + fonctions serveur `*.functions.ts` — voir SERVICES.md
│   ├── services/                  # Services externes (routage OSRM) — voir SERVICES.md
│   ├── integrations/supabase/     # Clients Supabase (navigateur/serveur/admin) + middlewares auth — voir SUPABASE.md
│   ├── assets/                    # Images/SVG importés par le bundler
│   ├── styles.css                 # Point d'entrée Tailwind
│   ├── router.tsx                 # Fabrique du router TanStack + QueryClient (staleTime global 30s)
│   ├── start.ts                   # Config TanStack Start : middleware d'auth global + capture d'erreur serveur
│   ├── server.ts                  # Point d'entrée du serveur Nitro (init Sentry, gestion d'erreur h3)
│   ├── sw.ts                      # Source du Service Worker (injecté par vite-plugin-pwa) — voir PWA.md
│   └── routeTree.gen.ts           # Généré automatiquement — NE JAMAIS ÉDITER À LA MAIN
├── tests/                         # Dossier hérité, vide — voir "Tests" plus bas pour l'emplacement réel
├── e2e/                           # Suite Playwright réelle (34 specs) — voir "Tests" plus bas
├── vite.config.ts                 # Config Vite/Nitro/PWA/Tailwind — voir ARCHITECTURE.md, DEPLOYMENT.md
├── vercel.json                    # En-têtes HTTP de sécurité (CSP, HSTS, etc.) — voir SECURITY.md
├── eslint.config.js                # Règles ESLint (exclut supabase/functions, .vercel — runtime différent)
├── components.json                 # Config shadcn/ui (génération de composants)
├── .env.example                    # Toutes les variables d'environnement documentées — voir ENVIRONMENTS.md
├── LICENSE, CODE_OF_CONDUCT.md, CONTRIBUTING.md, CHANGELOG.md, README.md
└── package.json
```

## Conventions de nommage

- **Routes** (`src/routes/`) : notation à points, `dashboard.admin.users.tsx`
  → `/dashboard/admin/users`. `$param` pour un segment dynamique
  (`orders.$id.tsx`). `_prefix/` pour un dossier de layout sans URL propre.
  Détail complet : [ROUTING.md](./ROUTING.md).
- **Hooks** (`src/hooks/`) : camelCase, `useNomDuHook.ts`. Détail complet :
  [HOOKS.md](./HOOKS.md).
- **Composants** (`src/components/`) : kebab-case, `nom-du-composant.tsx`
  (à l'exception de `maps/LeafletMap.tsx`, en PascalCase). Organisés en
  sous-dossiers par domaine (`dashboard/admin/`, `order/`, `home/`, etc.).
- **Fonctions serveur** (`src/lib/`) : suffixe `.functions.ts` — signale
  qu'un fichier exporte des `createServerFn(...)` appelables depuis le
  client. Suffixe `.server.ts` — signale un module strictement
  serveur-only, jamais envoyé au bundle client (voir la section sur le
  plugin de protection d'imports dans
  [ARCHITECTURE.md](./ARCHITECTURE.md#le-plugin-de-protection-dimports-de-tanstack-start)).
- **Migrations** (`supabase/migrations/`) : `YYYYMMDDHHMMSS_description.sql`
  — l'ordre d'application est l'ordre alphabétique/chronologique du nom de
  fichier. Détail complet : [MIGRATIONS.md](./MIGRATIONS.md).

## Fichiers d'entrée clés

| Fichier                | Rôle                                                                                                                                                                                                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/router.tsx`       | Crée le `QueryClient` (staleTime 30s par défaut — volontairement non nul, les données réellement temps réel comme `orders`/`deliveries` sont invalidées explicitement via Realtime, pas par ce staleTime) et le router TanStack à partir de `routeTree.gen.ts`          |
| `src/start.ts`         | Enregistre `attachSupabaseAuth` comme middleware client global (nécessaire pour que le bearer token soit attaché à chaque appel `createServerFn`) et un middleware d'erreur serveur qui rend une page HTML de secours (`renderErrorPage`) sur toute exception non gérée |
| `src/server.ts`        | Point d'entrée Nitro ; initialise Sentry côté serveur et capture les erreurs échappées à h3                                                                                                                                                                             |
| `src/sw.ts`            | Source du Service Worker PWA (précache + stratégies d'offline) — voir [PWA.md](./PWA.md)                                                                                                                                                                                |
| `src/routeTree.gen.ts` | Régénéré à chaque `npm run dev`/`npm run build` par le plugin de routage TanStack — ne jamais l'éditer, il sera écrasé                                                                                                                                                  |

## Tests

Corrigé (2026-08-31, odit tout baz la) — la phrase précédente ("aucune
suite de tests automatisés") était fausse et n'a pas été mise à jour depuis
la création de ce document :

- `tests/` (racine du dépôt) existe toujours et est bien **vide** —
  c'est un dossier hérité, pas l'emplacement réel des tests.
- Les tests unitaires vivent **à côté de leur code source**, suffixe
  `*.test.ts(x)` (23 fichiers dans `src/` à ce jour) — `npm run test`
  (= `vitest run`).
- Les tests end-to-end vivent dans **`e2e/`** (34 specs Playwright à ce
  jour), incluant accessibilité (`@axe-core/playwright`) et performance
  (`playwright-lighthouse`) — `npm run test:e2e`.
- `supabase/tests/` contient des tests de régression sécurité SQL
  (ex. `c01_user_roles_security.sql`), exécutés en CI contre une réplique
  Postgres locale (`supabase start`).

Voir [DEVELOPMENT.md](./DEVELOPMENT.md) pour la stratégie de vérification
complète (test + lint + format + typecheck + validation des migrations +
build + e2e, voir aussi `.github/workflows/ci.yml`).

## Organisation de `docs/`

Réorganisé le 2026-08-31 (odit tout baz la, Faz 4/7) — 206 fichiers vivaient
à plat dans `docs/`, mélangeant documentation vivante et rapports d'audit
ponctuels déjà clos, rendant difficile de retrouver la référence actuelle
sur un sujet donné. Tous les fichiers ont été déplacés (`git mv`, historique
préservé), aucun contenu modifié, tous les liens internes et externes
(commentaires de code, autres docs, `audit/`) mis à jour en conséquence :

```
docs/
├── reference/       # Vivant, mis à jour en continu — architecture, sécurité,
│                     #   routing, hooks, composants, services, Supabase,
│                     #   environnements, migrations, API, dépendances...
├── runbooks/         # Vivant, procédural — checklists de déploiement/backup/
│                     #   rollback/incident, guides d'exploitation
└── archive/          # Clos — jamais mis à jour après coup, valeur historique
    ├── phases/         # Rapports "PHASE*"/"NKD-*" (remédiations phase par phase)
    ├── moncash/         # Audits/rapports spécifiques à l'intégration MonCash
    ├── plop/            # Audits/rapports spécifiques à l'intégration PLOP
    ├── payments/        # Audits/rapports paiement génériques (hors MonCash/PLOP)
    ├── audits/          # Audits/rapports transverses (sécurité, frontend, admin...)
    ├── sql-tests/       # Scripts .sql de vérification ponctuelle (pas la suite
    │                     #   de tests réelle — voir "Tests" plus haut)
    └── misc/            # Le reste (notes de release, prompts de refonte...)
```

Règle pour tout nouveau document : un rapport d'audit/remédiation ponctuel
va dans `archive/<catégorie>/` dès sa création ; seul un document destiné à
rester à jour (architecture, convention, runbook) va dans `reference/` ou
`runbooks/`.
