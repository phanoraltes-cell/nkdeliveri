# Architecture — NK Deliveri

## Vue d'ensemble

NK Deliveri est une application de livraison de repas pour Haïti (ville
principale : Gonaïves), à quatre publics — Client, Restaurant, Livreur,
Administrateur — servis par une **seule** base de code React. Il n'y a pas
de backend applicatif séparé : Supabase (Postgres + Auth + Storage +
Realtime) est l'unique backend, et TanStack Start ne fournit qu'une couche
de rendu serveur (SSR) et quelques fonctions serveur ponctuelles
(notifications push, e-mails, opérations nécessitant la clé service-role).

```
Navigateur (React 19)
   │  supabase-js (RLS)            │  createServerFn (TanStack Start)
   ▼                                ▼
Supabase Postgres/Auth/Storage   Fonctions serveur (Node, Vercel)
   (RLS + RPC SECURITY DEFINER)     └─ supabaseAdmin (clé service-role,
                                        contourne RLS, usage restreint)
```

## Stack technique

| Couche | Choix | Version (voir `package.json`) |
|---|---|---|
| Framework | TanStack Start (React 19) | `@tanstack/react-start` ^1.168 |
| Routage | TanStack Router, basé fichiers | `@tanstack/react-router` ^1.170 |
| État serveur | TanStack Query | `@tanstack/react-query` ^5.101 |
| Build/dev | Vite 8 + Nitro (preset `vercel`) | `vite` ^8, `nitro` 3.0.260603-beta |
| Style | Tailwind CSS 4 + shadcn/ui (Radix) | `tailwindcss` ^4.2 |
| Backend | Supabase (Postgres, Auth, Storage, Realtime) | `@supabase/supabase-js` ^2.110 |
| Cartographie | Leaflet + react-leaflet, routage OSRM | `leaflet` ^1.9 |
| PWA | vite-plugin-pwa (Workbox) | `vite-plugin-pwa` ^1.3 |
| Push web | `@block65/webcrypto-web-push` (VAPID) | ^1.0 |
| Observabilité | Sentry (`@sentry/react` + `@sentry/node`) | ^10.65 |
| PDF | jsPDF (bons de cuisine) | `jspdf` ^4.2 |
| Validation | Zod | ^3.24 |
| Déploiement | Vercel (intégration GitHub native) | — |

Le wrapper `@lovable.dev/vite-tanstack-config` assemble TanStack Start,
Vite React, Tailwind, `vite-tsconfig-paths` et Nitro dans `vite.config.ts` ;
voir la remarque sur le preset Nitro plus bas.

## Frontière client / serveur

Trois façons pour du code de s'exécuter côté serveur :

1. **SSR de route** — chaque route TanStack Start est rendue une première
   fois côté serveur (sauf celles avec `ssr: false`, comme le layout
   `_authenticated/route.tsx`, qui dépend de l'état d'auth du navigateur).
2. **Fonctions serveur** (`createServerFn`, fichiers `*.functions.ts`) —
   exécutées uniquement côté serveur mais **importables depuis du code
   client** (TanStack Start génère un stub RPC côté navigateur qui appelle
   la vraie fonction via HTTP). Utilisées pour l'envoi de notifications
   push, la finalisation d'upload de documents, les actions admin
   nécessitant `supabaseAdmin`.
3. **Modules `*.server.ts`** — jamais envoyés au bundle client du tout,
   importables uniquement depuis d'autres modules serveur ou dynamiquement
   (`await import(...)`) depuis une fonction serveur.

### Le plugin de protection d'imports de TanStack Start

TanStack Start embarque un plugin de build (`import-protection-plugin`,
interne à `@tanstack/start-plugin-core`) qui **bloque par nom de fichier**
(pas par analyse d'imports) : tout fichier `**/*.client.*` est exclu du
bundle serveur, et tout fichier `**/*.server.*` est exclu du bundle client.
C'est une règle strictement basée sur le motif du nom de fichier, pas sur
le contenu réel des imports.

**Piège vécu dans ce projet** : `src/lib/sentry.client.ts` (qui importait
`@sentry/react`) faisait échouer le build même avec un `import()` dynamique
dans un `useEffect` — parce que le nom de fichier seul suffisait à
déclencher le blocage, indépendamment de la façon dont il était importé. La
correction a été de renommer le fichier en `sentry-browser.ts` (qui ne
correspond à aucun des deux motifs interdits), pas de changer la façon de
l'importer. **Retenir la règle** : si un nouveau fichier doit être
strictement client-only ou strictement server-only sans utiliser les
suffixes réservés `.client.`/`.server.`, choisissez un autre nom — ces deux
suffixes ont une signification particulière pour le bundler, pas seulement
une convention de lisibilité.

### Authentification à travers la frontière

- Le navigateur porte le JWT Supabase (`supabase.auth.getSession()`).
- `attachSupabaseAuth` (middleware client, `src/integrations/supabase/auth-attacher.ts`)
  l'attache automatiquement à chaque appel `createServerFn`.
- `requireSupabaseAuth` (middleware serveur,
  `src/integrations/supabase/auth-middleware.ts`) le valide côté serveur et
  fournit un client Supabase **scoped à cet utilisateur** — RLS s'applique
  donc identiquement, que la requête vienne directement du navigateur ou
  d'une fonction serveur.
- `supabaseAdmin` (`client.server.ts`, clé service-role) est la seule
  exception qui contourne RLS ; réservé aux opérations serveur de
  confiance.

Détail complet dans [SUPABASE.md](./SUPABASE.md).

## Autorisation à trois niveaux

1. **RLS Postgres** — chaque table définit qui peut lire/écrire quelles
   lignes (voir [DATABASE.md](./DATABASE.md#3-row-level-security-rls)).
2. **RPC `SECURITY DEFINER`** — la plupart des écritures ne passent pas par
   des policies RLS d'écriture directes mais par des fonctions
   `..._secure()` qui vérifient l'autorisation en code PL/pgSQL puis
   exécutent l'opération avec les privilèges du propriétaire de la
   fonction. Convention : une fine fonction `public.*` délègue à une
   implémentation `private.*` (le schéma `private` n'est jamais exposé via
   l'API PostgREST).
3. **Garde de route côté client** — chaque route protégée vérifie le rôle
   résolu par `_authenticated/route.tsx` (RPC `get_primary_role`) dans son
   `beforeLoad`, avant même de monter le composant. C'est une protection
   d'expérience utilisateur, pas la ligne de défense réelle — RLS/RPC sont
   la véritable barrière de sécurité. Voir
   [ROUTING.md](./ROUTING.md#écart-connu--garde-de-rôle-manquante-sur-dashboarddriver-et-dashboarddriverprofile)
   pour un écart connu où cette garde manque sur deux routes livreur (sans
   impact sécurité réel, car les requêtes sous-jacentes restent protégées
   par RLS).

## Build et déploiement

Nitro est configuré explicitement avec `preset: "vercel"` dans
`vite.config.ts` — ce choix a été rendu **explicite** après qu'une
ambiguïté de configuration ait laissé le preset par défaut
(`cloudflare-module`) prendre le dessus dans certains contextes de build,
produisant une sortie incompatible avec le déploiement réel sur Vercel. Le
build produit `.vercel/output/functions/__server.func` (SSR) et
`.vercel/output/static/` (assets statiques, y compris le PWA precache).
Détail complet dans [DEPLOYMENT.md](./DEPLOYMENT.md) et
[DEVOPS.md](./DEVOPS.md).

## Realtime

`orders`, `deliveries`, `notifications`, `refunds`, `disputes`,
`dispute_messages` sont publiées sur `supabase_realtime`
(`REPLICA IDENTITY FULL`). Les hooks `useLiveOrders`/`useOrderDelivery`
s'y abonnent pour invalider le cache TanStack Query dès qu'une ligne
change — pas de polling. Voir [HOOKS.md](./HOOKS.md).

## Notifications

Deux canaux, tous deux déclenchés côté serveur :

- **In-app** — la table `notifications` est peuplée **directement dans les
  fonctions RPC SQL** (`update_order_status_secure`,
  `add_restaurant_employee_secure`, `create_promotion_secure`, etc.), pas
  par du code applicatif TypeScript.
- **Push web** — les fonctions serveur `send-*-push.functions.ts`
  (voir [SERVICES.md](./SERVICES.md)) sont appelées côté client juste après
  le succès du RPC déclencheur, et dispatchent via le VAPID/Web Push
  partagé `pushToUsers` (`push-dispatch.server.ts`).

## Historique de remédiation (résumé)

Ce projet a traversé plusieurs phases de remédiation/consolidation
documentées dans l'historique Git : décomposition de routes trop
volumineuses, uniformisation de la convention de nommage des hooks
(camelCase), industrialisation DevOps (CI, migrations, sauvegardes,
sécurité infra), puis cette documentation complète. Le
[CHANGELOG.md](../CHANGELOG.md) et les messages de commit restent la source
de vérité pour le détail historique — ce document décrit l'état actuel, pas
son évolution.
