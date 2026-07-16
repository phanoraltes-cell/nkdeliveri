# Supabase — configuration et usage du projet

NK Deliveri utilise Supabase comme **unique backend** : Postgres, Auth,
Storage et Realtime. Ce document couvre la configuration du projet et la
façon dont l'application s'y connecte. Pour le détail du schéma (tables,
RLS, RPC, triggers, buckets), voir [DATABASE.md](./DATABASE.md). Pour la
procédure de migration, voir [MIGRATIONS.md](./MIGRATIONS.md).

## Projet

`supabase/config.toml` contient uniquement l'identifiant du projet :

```toml
project_id = "dcsnmvbtsmdbwrwbutph"
```

Toute autre configuration (URL, clés) provient des variables
d'environnement — voir [`.env.example`](../.env.example) et
[ENVIRONMENTS.md](./ENVIRONMENTS.md).

## Clients Supabase dans le code

Le dossier `src/integrations/supabase/` contient quatre fichiers annotés
« automatiquement généré — ne pas éditer directement » (générés par
l'outillage Lovable ; en pratique on les modifie tout de même quand le
besoin est réel, comme n'importe quel fichier du repo, mais on évite de les
régénérer par-dessus sans vérifier le diff) :

### `client.ts` — client navigateur (clé publique)

Exporte `supabase`, un client `@supabase/supabase-js` paresseux (créé au
premier accès via un `Proxy`, pas au chargement du module). Lit
`VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` côté navigateur
(`import.meta.env`) avec un repli sur `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`
(`process.env`) côté SSR — c'est donc le même fichier qui sert au rendu
serveur initial et à l'hydratation client. Session persistée dans
`localStorage`, `autoRefreshToken: true`.

Une fonction `createSupabaseFetch` enveloppe le `fetch` global pour gérer
les deux générations de clés API Supabase : les nouvelles clés
(`sb_publishable_...`/`sb_secret_...`) sont des chaînes opaques, pas des
JWT — si l'en-tête `Authorization` a été positionné par erreur à la même
valeur que la clé API, il est retiré pour ne garder que l'en-tête `apikey`.

### `client.server.ts` — client admin (clé service-role)

Exporte `supabaseAdmin`, même pattern de `Proxy` paresseux, mais authentifié
avec `SUPABASE_SERVICE_ROLE_KEY` — **contourne RLS**. Réservé aux
opérations serveur de confiance (jamais exposé au bundle client). Le
commentaire dans le fichier précise la règle d'usage : un import statique
en haut de fichier n'est sûr que dans un autre module `*.server.ts` ; dans
une route ou un `*.functions.ts` (qui partent tous les deux dans le bundle
client), il faut un `import()` dynamique à l'intérieur du handler serveur.

### `auth-middleware.ts` — `requireSupabaseAuth`

Middleware **serveur** TanStack Start (`createMiddleware({type:
"function"}).server(...)`), à chaîner sur tout `createServerFn()` qui doit
identifier l'utilisateur appelant. Étapes :

1. Lit l'en-tête `Authorization: Bearer <token>` de la requête entrante
   (`getRequest()`), rejette si absent, mal formé, ou si le token n'a pas
   la forme d'un JWT (3 segments séparés par des points).
2. Crée un client Supabase scoped à ce token (pas la clé service-role).
3. Vérifie le token via `supabase.auth.getClaims(token)`.
4. Injecte `{ supabase, userId, claims }` dans le contexte de la fonction
   serveur — `supabase` ici est **déjà authentifié comme l'utilisateur**,
   donc toute requête via ce client respecte RLS comme si elle venait du
   navigateur.

### `auth-attacher.ts` — `attachSupabaseAuth`

Le pendant **client** du middleware ci-dessus (`.client(...)`). Doit être
enregistré comme `functionMiddleware` global dans `src/start.ts` — sinon le
navigateur n'attache jamais le token bearer aux appels RPC serveur
(`createServerFn`). À chaque appel, il lit la session courante
(`supabase.auth.getSession()`) et ajoute l'en-tête `Authorization: Bearer
<access_token>` si une session existe (sinon aucun en-tête n'est ajouté —
la fonction serveur ciblée décide alors si elle exige l'auth ou non).

### `types.ts`

Types TypeScript générés depuis le schéma Postgres (table `Database`).
Regénéré via `supabase gen types typescript` après chaque migration qui
modifie le schéma — voir [MIGRATIONS.md](./MIGRATIONS.md).

## Modèle d'authentification en une phrase

Le navigateur porte le JWT de session ; `attachSupabaseAuth` l'attache à
chaque appel `createServerFn` ; `requireSupabaseAuth` le vérifie côté
serveur et fournit un client Supabase scoped à cet utilisateur — la même
politique RLS s'applique donc que la requête vienne directement du
navigateur (via `client.ts`) ou d'une fonction serveur TanStack Start (via
`requireSupabaseAuth`). Seul `client.server.ts`
(`supabaseAdmin`) contourne RLS, et seulement dans du code serveur de
confiance.

## Realtime

Les tables suivantes sont publiées sur `supabase_realtime` avec
`REPLICA IDENTITY FULL` : `orders`, `deliveries`, `notifications`,
`refunds`, `disputes`, `dispute_messages`. L'application s'y abonne via
`supabase.channel(...).on('postgres_changes', ...)` dans
`useLiveOrders`/`useOrderDelivery` (voir [HOOKS.md](./HOOKS.md)) pour
invalider le cache React Query dès qu'une ligne change, plutôt que de faire
du polling.

## Développement local

`supabase start` (CLI Supabase, installée via `supabase/setup-cli@v1` en
CI, ou localement en suivant [DEVELOPMENT.md](./DEVELOPMENT.md)) lance la
pile complète en local : Postgres, GoTrue (Auth), PostgREST, Realtime,
Storage, Studio. Toutes les migrations de `supabase/migrations/` sont
rejouées dans l'ordre chronologique de leur nom de fichier au démarrage.
C'est ce que fait le job `migrations-db` de la CI
(voir [DEVOPS.md](./DEVOPS.md)) pour vérifier que l'historique complet des
migrations s'applique sans erreur.

## Fonctions Edge (`supabase/functions/`)

Le dossier `supabase/functions/` contient des Edge Functions Deno,
distinctes de l'application TanStack Start (runtime différent, déployées
séparément via `supabase functions deploy`). Elles sont explicitement
exclues du lint/typecheck de l'application principale
(`eslint.config.js`, `tsconfig.json`) car il s'agit d'un projet Deno à part
entière. Voir le code source du dossier pour la liste actuelle des
fonctions — ce document ne les détaille pas pour éviter la dérive si elles
évoluent indépendamment du reste de l'app.

## Schéma `private`

Voir [DATABASE.md § Tables](./DATABASE.md#table-du-schéma-private) — le
schéma `private` n'est jamais exposé via l'API Data (PostgREST), configuré
ainsi pour que ses fonctions et tables (`private.rate_limit_hits`,
`private.has_role`, `private.create_order_secure`, etc.) ne soient
atteignables que depuis des fonctions `SECURITY DEFINER` du schéma
`public`, jamais directement depuis `supabase-js`.
