# Environnements — NK Deliveri

## Vue d'ensemble

| Environnement | Où il tourne | Déclenché par | Base de données |
|---|---|---|---|
| **Développement** | Poste local (`npm run dev`) | Manuel | `.env.local` — pointe vers le projet Supabase configuré par le développeur |
| **Aperçu (Preview)** | Vercel, une URL par PR | Chaque push sur une PR | Voir "Base de données partagée" ci-dessous |
| **Production** | Vercel, domaine de production | Chaque merge/push sur `main` | Projet Supabase de production |

Il n'existe pas d'environnement de "préproduction" distinct et durable — les
déploiements Preview de Vercel (un par pull request, recréé à chaque push)
en tiennent lieu : c'est là que valider une fonctionnalité avant fusion.

## ⚠️ Base de données partagée entre Preview et Production

**Point à vérifier avec l'équipe, non confirmé par ce dépôt seul** : les
variables `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` etc. sont définies une
seule fois par nom, mais Vercel permet d'assigner une valeur différente par
portée (Production / Preview / Development) dans Project Settings →
Environment Variables. Si ce n'est **pas** déjà fait, chaque déploiement
Preview (donc chaque pull request) pointe vers la **même base de données que
la production** — un test dans une PR pourrait alors créer de vraies
commandes, notifications push, ou lignes dans des tables sensibles
(`refunds`, `disputes`, `payments`) visibles par de vrais utilisateurs.

**Recommandation** : provisionner un second projet Supabase dédié aux
déploiements Preview (peut être un plan gratuit, les migrations sous
`supabase/migrations/` s'y appliquent à l'identique), et assigner ses
identifiants aux variables d'environnement Vercel sous la portée "Preview"
uniquement.

## Variables d'environnement

Voir `.env.example` à la racine du dépôt pour la liste complète, documentée
et groupée par catégorie (Supabase, Web Push, email transactionnel,
MonCash, monitoring, routage — voir
[PAYMENT_PROVIDERS.md](./PAYMENT_PROVIDERS.md) pour la procédure complète
des variables `MONCASH_*`). Règles générales :

- Une variable préfixée `VITE_` est injectée dans le bundle navigateur au
  moment du build — **jamais** y placer un secret réel.
- La variante sans préfixe est lue uniquement côté serveur
  (`process.env.*` — SSR, fonctions serveur TanStack Start).
- `SUPABASE_SERVICE_ROLE_KEY` et `VAPID_PRIVATE_JWK` n'ont **aucune**
  variante `VITE_*` — elles ne doivent jamais en avoir.

### Variables injectées automatiquement par Vercel

Ces variables existent dans tout déploiement Vercel sans configuration
manuelle (`VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_URL`, etc.) — voir
la [documentation Vercel](https://vercel.com/docs/environment-variables/system-environment-variables)
pour la liste complète. `src/lib/sentry.server.ts` les utilise pour étiqueter
les évènements par environnement (`production`/`preview`/`development`) et
par commit. Ne jamais les redéfinir manuellement dans `.env.local`.

## Différences de configuration par environnement

| Aspect | Développement | Preview | Production |
|---|---|---|---|
| Build Nitro | `preset: "vercel"` (voir `vite.config.ts`) | Idem | Idem |
| Sentry | Généralement désactivé (`SENTRY_DSN` non défini) | Recommandé activé, environnement `preview` | Activé, environnement `production` |
| Service Worker / PWA | `devOptions: { enabled: false }` — désactivé en dev | Actif | Actif |
| CSP (`vercel.json`) | N/A (headers Vercel non appliqués en local) | Appliqué | Appliqué |
| Migrations Supabase | Appliquées manuellement (`supabase db push`) ou via CI (`supabase start`, réplique locale) | Idem projet Preview | Appliquées manuellement suivant `docs/MIGRATIONS.md` |
| Rate limiting RPC | Actif (c'est une règle serveur, pas un flag d'environnement) | Actif | Actif |

## Checklist pour un nouveau développeur

1. `nvm use` (ou installer Node 22 — voir `.nvmrc`).
2. `cp .env.example .env.local`, remplir avec les identifiants d'un projet
   Supabase de développement (jamais ceux de production).
3. `npm run setup` (= `npm ci`).
4. `npm run dev`.
5. `npm run verify` avant tout commit important — regroupe typecheck, lint,
   vérification des migrations et build (voir `package.json`).
