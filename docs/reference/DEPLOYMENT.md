# Procédure de mise en production — NK Deliveri

Déploiement applicatif (Vercel) et déploiement de base de données
(Supabase) sont **deux actes séparés et volontairement découplés** dans ce
projet — voir `docs/DEVOPS.md`. Cette procédure couvre l'ensemble du cycle
de vie production : installation, déploiement, vérification, rollback,
sauvegarde, monitoring, maintenance et mise à jour.

## 0. Installation (référence)

L'installation complète d'un environnement de développement (prérequis,
`npm run setup`, variables d'environnement) est documentée une seule fois
dans [DEVELOPMENT.md](./DEVELOPMENT.md#installation) pour éviter la
duplication — ce document se concentre sur le cycle de production. Pour un
environnement de préproduction/production, voir
[ENVIRONMENTS.md](./ENVIRONMENTS.md) pour les différences de configuration
par environnement.

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
   4 recommande de migrer la base _avant_ de déployer du code qui en
   dépend : ça garantit qu'un rollback applicatif seul reste toujours
   compatible avec la base telle qu'elle est).

## 7. Sauvegarde (référence)

Procédure complète (fréquence recommandée, contenu sauvegardé, restauration)
documentée une seule fois dans
[BACKUP_RESTORE.md](../runbooks/BACKUP_RESTORE.md) — pas dupliquée ici. Rappel du
seul point qui concerne directement le cycle de déploiement : une
sauvegarde (`npm run db:backup`) est requise à l'étape 3 avant toute
migration touchant des données existantes.

## 8. Monitoring

- **Erreurs applicatives** — Sentry (`SENTRY_DSN`/`VITE_SENTRY_DSN`), voir
  [SECURITY.md § Observabilité](./SECURITY.md#observabilité-et-confidentialité-sentry).
  En production, consulter le tableau de bord Sentry régulièrement (pas
  seulement au moment d'un déploiement) — un pic d'erreurs peut signaler
  une régression silencieuse (ex. une RPC qui échoue pour un rôle
  particulier) qui ne remonte pas forcément dans les vérifications
  post-déploiement manuelles ci-dessus.
- **Disponibilité** — Vercel fournit son propre tableau de bord de
  déploiements/fonctions (temps de réponse, erreurs 5xx) sous Project →
  Observability.
- **Base de données** — le tableau de bord Supabase (Database → Reports)
  expose l'utilisation CPU/mémoire/connexions et les requêtes lentes ; à
  consulter si des symptômes de lenteur apparaissent côté application.
- **Aucun système d'alerting automatique externe n'est configuré** à ce
  jour (pas de PagerDuty/Slack webhook) — la détection repose sur une
  vérification manuelle régulière des tableaux de bord ci-dessus tant
  qu'un tel système n'est pas mis en place.

## 9. Maintenance

Tâches récurrentes recommandées, sans fréquence imposée par l'outillage
actuel (à adapter selon la charge réelle de l'équipe) :

- **Dépendances** — `npm audit`, revue des mises à jour disponibles ; voir
  [DEPENDENCIES.md](./DEPENDENCIES.md) pour la procédure complète.
- **Migrations** — `npm run check:migrations` détecte le piège de
  surcharge de fonction Postgres à chaque exécution de `npm run verify` (y
  compris en CI) ; aucune action manuelle périodique n'est nécessaire tant
  que la CI reste verte.
- **Sauvegardes** — vérifier périodiquement qu'une sauvegarde récente est
  bien restaurable (pas seulement qu'elle existe) ; voir
  [BACKUP_RESTORE.md](../runbooks/BACKUP_RESTORE.md).
- **Rôles admin** — revue périodique de la liste réelle des comptes
  `admin`/`super_admin` en base (voir
  [SECURITY_INFRASTRUCTURE.md § Rôles administrateurs](./SECURITY_INFRASTRUCTURE.md#rôles-administrateurs---vérifié-mécanisme--liste-réelle-à-vérifier)),
  pour confirmer qu'elle correspond toujours aux personnes qui doivent
  l'avoir.
- **Rotation des secrets** — `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_JWK`,
  `RESEND_API_KEY` n'ont pas de politique de rotation automatisée ; envisager
  une rotation périodique documentée si le projet grandit (note déjà
  présente dans [SECURITY_INFRASTRUCTURE.md](./SECURITY_INFRASTRUCTURE.md)).

## 10. Mise à jour

- **Dépendances applicatives** (`package.json`) — suivre la procédure
  [DEPENDENCIES.md](./DEPENDENCIES.md) ; toujours faire passer `npm run
verify` après une mise à jour, avant de merger.
- **Version de Node** — pinnée dans `.nvmrc` (actuellement 22) et
  utilisée à l'identique par la CI (`.github/workflows/ci.yml`) ; toute
  mise à jour de version doit changer les deux ensemble, jamais l'un sans
  l'autre.
- **Schéma de base de données** — toute évolution passe par une nouvelle
  migration, jamais par une modification manuelle en production ; voir
  [MIGRATIONS.md](./MIGRATIONS.md) pour la procédure complète
  (création/validation/déploiement/rollback) et le piège de surcharge de
  fonction à éviter systématiquement.
- **Preset Nitro / cible de déploiement** — actuellement épinglé à
  `vercel` dans `vite.config.ts` (voir [ARCHITECTURE.md](./ARCHITECTURE.md)) ;
  ne changer qu'avec une vérification complète du build produit
  (`.vercel/output/...`) et une mise à jour correspondante des chemins
  `vite-plugin-pwa` (voir [PWA.md](./PWA.md)), les deux étant couplés.
