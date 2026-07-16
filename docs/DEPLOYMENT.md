# Procédure de mise en production — NK Deliveri

Déploiement applicatif (Vercel) et déploiement de base de données
(Supabase) sont **deux actes séparés et volontairement découplés** dans ce
projet — voir `docs/DEVOPS.md`. Cette procédure couvre les deux, dans
l'ordre où ils doivent se produire.

## 1. Checklist avant déploiement

- [ ] La PR est mergée sur `main`, la CI (`quality` + `migrations-db` dans
      `.github/workflows/ci.yml`) est verte.
- [ ] `npm run verify` repasse en local sans erreur (typecheck, lint,
      vérification des migrations, build).
- [ ] Si la PR contient des migrations Supabase : elles ont été validées
      avec `npx supabase start` (voir `docs/MIGRATIONS.md`) et une
      sauvegarde de la base de production a été prise
      (`npm run db:backup` — voir `docs/BACKUP_RESTORE.md`) si la
      migration touche des données existantes, pas seulement du schéma.
- [ ] Les nouvelles variables d'environnement (le cas échéant) sont
      définies dans Vercel Project Settings → Environment Variables, dans
      les bonnes portées (Production/Preview) — voir `.env.example` et
      `docs/ENVIRONMENTS.md`.

## 2. Validation du build

Déjà couverte par la CI, mais reproductible en local avant de merger :

```bash
npm run verify
```

Confirme que le build produit exactement l'artefact Vercel attendu
(`.vercel/output/functions/__server.func`, `.vercel/output/static/`) — voir
`vite.config.ts` pour le détail du preset Nitro épinglé.

## 3. Sauvegarde préalable

Requise avant toute migration touchant des données existantes (pas
seulement un ajout de colonne/fonction) :

```bash
npm run db:backup
```

Voir `docs/BACKUP_RESTORE.md` pour la procédure complète et où stocker le
fichier produit.

## 4. Déploiement

### Application (Vercel)

Automatique : chaque push sur `main` déclenche un build + déploiement de
production via l'intégration GitHub native de Vercel. Rien à faire
manuellement dans le cas nominal — surveiller le déploiement dans le
tableau de bord Vercel (Deployments) jusqu'à son statut "Ready".

### Base de données (Supabase)

Manuel, volontairement séparé du déploiement applicatif :

```bash
npx supabase link --project-ref <ref-du-projet>   # une seule fois par machine
npx supabase db push
```

**Ordre recommandé** : appliquer les migrations Supabase **avant** que le
déploiement Vercel correspondant ne devienne actif si le nouveau code
suppose un nouveau schéma (colonne, fonction) — sinon, en cas de nouvelle
fonctionnalité purement additive, l'ordre importe peu. En cas de doute,
migrer la base d'abord : un ancien code qui ignore une nouvelle colonne est
presque toujours sûr ; un nouveau code qui appelle une fonction qui n'existe
pas encore ne l'est jamais.

## 5. Vérifications post-déploiement

- [ ] La page d'accueil (`/`) charge et affiche les restaurants.
- [ ] Connexion (`/auth`) fonctionne pour un compte de test.
- [ ] Chaque tableau de bord charge sans erreur : `/dashboard/admin`,
      `/dashboard/restaurant`, `/dashboard/driver`.
- [ ] Une commande de test peut être passée de bout en bout (si un
      environnement de test le permet sans impacter de vraies données).
- [ ] Le Service Worker s'enregistre et l'app reste installable (PWA) —
      vérifier via les DevTools → Application → Service Workers.
- [ ] Si `SENTRY_DSN`/`VITE_SENTRY_DSN` sont configurés : déclencher une
      erreur de test et confirmer qu'elle apparaît dans le tableau de bord
      Sentry sous quelques minutes.
- [ ] Les en-têtes de sécurité sont bien présents (`curl -I
      https://<domaine-prod>` — vérifier `content-security-policy`,
      `strict-transport-security`).

## 6. Procédure de rollback

### Application (Vercel) — quasi-instantané

Vercel conserve chaque déploiement précédent. En cas de problème détecté
après mise en production :

1. Tableau de bord Vercel → Deployments.
2. Sélectionner le dernier déploiement **connu comme sain** (avant le
   déploiement problématique).
3. "..." → **Promote to Production** (ou `vercel rollback` en CLI).

Ceci ne touche que le code servi — pas la base de données. Si le
déploiement problématique a aussi appliqué une migration incompatible avec
l'ancien code, un rollback applicatif seul ne suffit pas (voir ci-dessous).

### Base de données (Supabase)

Pas de rollback automatique — voir la section "Procédure — rollback" de
`docs/MIGRATIONS.md` pour le détail complet. En résumé :

- Erreur de schéma pure → nouvelle migration corrective (jamais modifier
  un fichier déjà mergé).
- Données corrompues → restauration depuis la sauvegarde prise à l'étape 3
  (`scripts/restore-database.sh`, voir `docs/BACKUP_RESTORE.md`).

### Ordre en cas de rollback complet

1. Rollback applicatif Vercel (instantané, fait en premier pour arrêter
   l'hémorragie côté utilisateur).
2. Évaluer si la base de données a besoin d'un correctif/restauration
   séparé — l'ancien code redéployé doit rester compatible avec le schéma
   actuel de la base (c'est pour cela que l'ordre de déploiement à l'étape
   4 recommande de migrer la base *avant* de déployer du code qui en
   dépend : ça garantit qu'un rollback applicatif seul reste toujours
   compatible avec la base telle qu'elle est).
