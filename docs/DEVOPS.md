# DevOps — NK Deliveri

Vue d'ensemble de l'outillage CI/CD, des contrôles qualité et de leur
configuration. Voir aussi `docs/ENVIRONMENTS.md`, `docs/MIGRATIONS.md`,
`docs/BACKUP_RESTORE.md` et `docs/DEPLOYMENT.md`.

## CI (`.github/workflows/ci.yml`)

Se déclenche sur chaque pull request vers `main` et sur chaque push sur
`main`. Deux jobs, exécutés **en parallèle** (pas l'un après l'autre) pour
limiter le temps d'exécution total au plus lent des deux plutôt qu'à leur
somme :

| Job | Contenu | Pourquoi |
|---|---|---|
| `quality` | `npm ci` → lint → `prettier --check` → typecheck → `check:migrations` → build de production | Le build utilise le même preset Nitro (`vercel`, épinglé dans `vite.config.ts`) que le vrai déploiement — un échec ici signifie que le déploiement échouerait aussi |
| `migrations-db` | Boot d'une stack Supabase locale complète via la CLI officielle, application de toutes les migrations sur une base fraîche | La validation la plus réaliste possible sans identifiants du projet réel |

**Ce workflow ne déploie rien.** Vercel construit et déploie déjà ce même
commit indépendamment via son intégration GitHub native (production sur
`main`, un aperçu par PR) — dupliquer ce mécanisme en GitHub Actions créerait
deux systèmes se disputant le déploiement du même commit. Le rôle de ce
workflow est la porte de qualité que le déploiement Vercel, à lui seul,
n'offre pas.

## Règles de protection de branche recommandées pour `main`

**Non appliquées automatiquement par ce dépôt** — nécessite un accès
administrateur au dépôt GitHub, une action ponctuelle à faire volontairement
(voir la note en fin de section). Réglages recommandés (GitHub → Settings →
Branches → Branch protection rules → `main`) :

- ☑ **Require a pull request before merging** — aucun push direct sur `main`.
  - ☑ Require approvals: au moins 1.
- ☑ **Require status checks to pass before merging**
  - Statuts requis : `quality` et `migrations-db` (les deux jobs de
    `.github/workflows/ci.yml`).
  - ☑ Require branches to be up to date before merging.
- ☑ **Require conversation resolution before merging**.
- ☐ Ne pas cocher "Allow force pushes" ni "Allow deletions" pour `main`.

Équivalent en une commande, pour quelqu'un disposant des droits admin et de
la CLI `gh` authentifiée :

```bash
gh api repos/{owner}/{repo}/branches/main/protection -X PUT --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["quality", "migrations-db"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null
}
EOF
```

> Cette commande n'a **pas** été exécutée par l'agent qui a préparé cette
> phase — modifier les réglages de protection de branche affecte tout le
> monde sur le dépôt et a été laissé à une décision explicite de l'équipe.

## Secrets GitHub Actions

Le workflow CI actuel n'a besoin d'**aucun secret** : ni le build de
production (voir `docs/ENVIRONMENTS.md` — les identifiants Supabase ne sont
nécessaires qu'à l'exécution, pas à la compilation), ni la validation locale
des migrations (base Postgres locale, pas de projet Supabase réel) n'en
requièrent. Si un futur workflow en a besoin (ex. un job qui interroge le
vrai projet Supabase), les ajouter sous Settings → Secrets and variables →
Actions, jamais en clair dans un fichier de workflow.

## Dépendances

Voir `docs/DEPENDENCIES.md` pour l'audit complet (obsolescence, paquets
inutilisés, doublons, vulnérabilités connues) et la politique de mise à
jour.

## Résumé des contrôles qualité avant fusion

| Contrôle | Commande locale | Appliqué en CI |
|---|---|---|
| Lint (ESLint) | `npm run lint` | ✅ job `quality` |
| Formatage (Prettier) | `npm run format:check` | ✅ job `quality` |
| Typecheck (tsc) | `npm run typecheck` | ✅ job `quality` |
| Build de production | `npm run build` | ✅ job `quality` |
| Danger de surcharge RPC | `npm run check:migrations` | ✅ job `quality` |
| Migrations rejouées sur base fraîche | `npx supabase start` | ✅ job `migrations-db` |
| Tout en une commande | `npm run verify` | — (les jobs CI restent séparés pour un diagnostic plus clair) |
