# NK Deliveri — Guide Développeur (v1.0)

## Stack

TanStack Start (React 19, SSR via Nitro `preset: "vercel"`) + TanStack Router (file-based, `src/routes/`) + TanStack Query + Supabase (Postgres + Auth + Storage + Realtime) + Tailwind CSS 4 + shadcn/ui + Radix. Zéro Supabase Edge Function — toute la logique serveur est en Server Functions (`.server.ts`) ou RPC Postgres.

## Démarrer

```bash
npm ci
npm run dev          # http://localhost:3000 (par défaut Vite)
```

Copier `.env.example` → `.env.local` et renseigner les vraies valeurs (Supabase URL/clé publique, jamais la clé service_role côté client).

## Conventions établies (à respecter, pas à redécouvrir)

- **`.server.ts` est appliqué par le compilateur** pour garder les secrets hors du bundle client — ne jamais importer statiquement un `.server.ts` depuis un fichier de route ; utiliser un import dynamique si besoin depuis une route.
- **Toute mutation passe par une RPC `SECURITY DEFINER`** + vérification de rôle interne (`private.has_role()` ou vérification de propriété) + `REVOKE`/`GRANT` explicites. Ne jamais faire confiance à RLS seule pour une opération sensible — RLS filtre les lignes, pas la logique métier (ex. calcul de commission).
- **Migrations strictement append-only** — jamais modifier une migration déjà appliquée à la production. Un correctif est une nouvelle migration.
- **Jamais appliquer une migration sans validation transactionnelle préalable** (`BEGIN...ROLLBACK` contre la production réelle, avec assertions) — voir `RUNBOOK.md` § "Appliquer une migration". Ne jamais `supabase db push` sans confirmation explicite préalable par fichier.
- **`console.warn`/`console.error` uniquement** — jamais `console.log` (convention respectée à 100% dans le code actuel, vérifié par grep).
- **Pas de `TODO`/`FIXME`** laissés dans le code — soit c'est fait, soit ce n'est pas mergé.

## Structure

```
src/
  routes/                  fichiers de route TanStack Router (file-based)
  routes/_authenticated/   layout + toutes les routes dashboard (session requise)
  components/              composants React, groupés par domaine
  components/ui/           primitives shadcn/ui (18 composants)
  hooks/                   hooks partagés (useAuth, useLiveOrders, useCustomerLocation, ...)
  lib/                     helpers, config, intégrations (payment-providers/, seo.ts, ...)
  integrations/supabase/   client Supabase + types générés/étendus manuellement
supabase/
  migrations/              113 fichiers SQL, append-only
e2e/                       suite Playwright (mock réseau complet, jamais le vrai backend)
scripts/                   backup-database.sh, restore-database.sh, check-migration-hazards.mjs
```

## Ajouter une nouvelle route

1. Créer le fichier dans `src/routes/` (convention TanStack Router : `dashboard.admin.nouvelle-page.tsx` → `/dashboard/admin/nouvelle-page`).
2. `createFileRoute()` avec `component:`.
3. Si la page est privée : placer sous `_authenticated/`, et si un rôle spécifique est requis, appeler `requireRole([...])` dans le layout parent ou la route elle-même (voir `dashboard.restaurant.*.tsx` pour l'exemple owner/admin-only).
4. Ajouter l'entrée correspondante dans `src/components/dashboard/sidebar/nav-items.ts` si elle doit apparaître dans la navigation (sinon documenter pourquoi, comme `payout-migration`).
5. Ajouter `pageMeta()` (public, indexable) ou `noIndexMeta()` (privé) — sauf si la route hérite déjà d'un parent `_authenticated/route.tsx`.
6. `npm run build` une fois pour régénérer `src/routeTree.gen.ts` avant que le typecheck reconnaisse la nouvelle route.

## Ajouter une nouvelle RPC

1. Écrire dans une nouvelle migration (jamais modifier une existante).
2. `SECURITY DEFINER`, `SET search_path`, vérification de rôle/propriété en première ligne du corps.
3. `REVOKE EXECUTE ... FROM PUBLIC` puis `GRANT EXECUTE ... TO authenticated` (ou le rôle strictement nécessaire) — ne pas laisser le grant par défaut `anon` si la fonction n'a aucune raison d'être publique (voir audit § M-1, pattern à éviter, pas à reproduire).
4. Valider en transactionnel avant application (voir `RUNBOOK.md`).
5. Ajouter la signature dans `src/integrations/supabase/types.ts` (actuellement maintenu à la main pour les RPC — pas de génération automatique confirmée pour ce projet).

## Tests

```bash
npm run test          # Vitest, unitaire
npm run verify         # tout : typecheck + lint + check:migrations + test + build
npm run build:e2e && npm run test:e2e   # E2E Playwright, mock complet — jamais contre la vraie prod
```

La suite E2E redirige `VITE_SUPABASE_URL` vers un serveur mock local au build (`.env.e2e` à la racine, pas dans `e2e/`) — SSR et navigateur ciblent donc automatiquement le mock, sans changement de code applicatif. Voir `docs/E2E_TEST_REPORT.md` pour l'architecture complète du harnais.

## Pièges connus (déjà rencontrés dans ce projet, ne pas les redécouvrir)

- `ORDER BY <alias> ASC` sur un `UNION ALL` brut échoue en Postgres si l'alias n'est pas dans la première branche — utiliser une référence positionnelle (`ORDER BY 2`).
- `REVOKE ALL ... FROM PUBLIC` ne retire **pas** un grant fait nommément à `anon`/`authenticated` — il faut un `REVOKE EXECUTE ... FROM anon` explicite.
- `npm run preview` ne fonctionne pas avec le `nitro.preset: "vercel"` de ce projet (layout de sortie Build Output API v3) — pour un serveur de preview local fonctionnel, voir `e2e/mocks/preview-server.ts`.
- Le `ORDER BY`/l'ambiguïté de colonne dans les fonctions de commission (`restaurant_id`) a déjà causé un incident corrigé — préfixer explicitement les colonnes dans toute nouvelle fonction touchant plusieurs tables avec des noms de colonnes qui se recoupent.

## Avant tout commit

Respecter le mandat de ce projet (`CLAUDE.md`) : relire le code, vérifier imports/types/interfaces/hooks/dépendances/états/appels API/RLS/permissions, corriger automatiquement, puis `npm run verify` vert avant de proposer un commit.
