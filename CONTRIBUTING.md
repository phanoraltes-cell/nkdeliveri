# Contribuer à NK Deliveri

Merci de vouloir contribuer. Ce guide couvre le flux de travail Git, les
conventions de commit et la procédure de Pull Request. Pour l'installation
et les commandes de développement, voir
[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## Avant de commencer

- Lisez [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) pour comprendre la
  frontière client/serveur et le modèle d'autorisation à trois niveaux —
  la plupart des erreurs de conception viennent d'un de ces deux points
  mal compris.
- Ce dépôt est **privé et propriétaire** (voir [LICENSE](./LICENSE)) — ne
  publiez pas de code, de captures d'écran contenant des données réelles,
  ou d'extraits de configuration en dehors des canaux autorisés par
  l'équipe.
- Respectez le [Code de conduite](./CODE_OF_CONDUCT.md).

## Guide Git

### Branches

- `main` est la branche protégée, toujours déployable — chaque push dessus
  déclenche un build + déploiement de production automatique (voir
  [docs/DEVOPS.md](./docs/DEVOPS.md)).
- Créez une branche de fonctionnalité depuis `main` :
  `type/description-courte` (ex. `feat/refund-history-export`,
  `fix/driver-location-throttle`, `docs/api-reference`). Les préfixes
  suivent la même liste que les commits (voir ci-dessous).

### Format de commit

Les commits de ce projet suivent depuis la Phase 4/5/6/7 un préfixe de
type explicite, cohérent avec `git log` :

```
<type>: <description au présent, impératif, courte>
```

| Type | Usage |
|---|---|
| `feat` | Nouvelle fonctionnalité |
| `fix` | Correction de bug |
| `refactor` | Changement de structure sans changement de comportement |
| `perf` | Optimisation de performance |
| `security` | Correctif ou renforcement de sécurité |
| `docs` | Documentation uniquement |
| `chore` | Maintenance (dépendances, config, scripts) |
| `style` | Formatage uniquement (ex. passage de Prettier) |

Exemples réels du projet : `fix: pin Nitro's Vercel preset, resolving the
Cloudflare/Vercel build ambiguity`, `feat: add customer refund request +
admin review workflow`, `security: add server-enforced rate limiting on
critical RPCs and notifications`.

Un commit doit représenter un changement cohérent et complet — préférez
plusieurs commits ciblés à un commit fourre-tout, mais ne fragmentez pas
non plus un changement logiquement unique en dépendances entre commits
qui ne compilent pas isolément.

### Avant de committer

```bash
npm run verify
```

Chaîne complète : typecheck → lint → validation des migrations → build —
exactement ce que la CI exécute (voir
[docs/DEVOPS.md](./docs/DEVOPS.md)). Un commit qui casse cette chaîne ne
doit jamais être poussé sur `main`.

### Pull Requests

1. Ouvrez la PR contre `main`, avec une description qui explique le
   **pourquoi**, pas seulement le quoi (le diff montre déjà le quoi).
2. La CI (`quality` + `migrations-db`, voir
   [docs/DEVOPS.md](./docs/DEVOPS.md)) doit être verte avant la revue.
3. Si la PR touche `supabase/migrations/` : voir
   [docs/MIGRATIONS.md](./docs/MIGRATIONS.md) impérativement avant
   d'écrire la migration — en particulier le piège de surcharge de
   fonction Postgres (`CREATE OR REPLACE FUNCTION` avec une signature
   différente crée une nouvelle surcharge au lieu de remplacer
   l'existante), détecté automatiquement par `npm run check:migrations`
   mais à comprendre en amont plutôt qu'à corriger après coup.
4. Ne jamais modifier une migration déjà mergée sur `main` — une migration
   déjà appliquée en production est immuable ; toute correction est une
   **nouvelle** migration.
5. Après merge, surveillez le déploiement automatique (voir
   [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)) et appliquez séparément les
   migrations Supabase en attente si la PR en contenait
   (`npx supabase db push` — jamais automatique, voir
   [docs/DEVOPS.md](./docs/DEVOPS.md) pour la raison de ce découplage
   volontaire).

## Principes de conception à respecter

- **La sécurité vit dans Postgres, pas dans React.** Toute nouvelle
  mutation doit passer par une fonction RPC `SECURITY DEFINER` qui
  vérifie elle-même l'autorisation — une garde de route côté client seule
  n'est jamais suffisante (voir
  [docs/SECURITY.md](./docs/SECURITY.md#modèle-dautorisation-défense-en-profondeur)).
- **Respectez les conventions de nommage** documentées dans
  [docs/PROJECT_STRUCTURE.md](./docs/PROJECT_STRUCTURE.md#conventions-de-nommage) —
  camelCase pour les hooks, kebab-case pour les composants, suffixes
  `.functions.ts`/`.server.ts` réservés (voir
  [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md#le-plugin-de-protection-dimports-de-tanstack-start)
  pour pourquoi ces deux derniers ne sont pas de simples conventions).
- **Ne documentez et n'implémentez que ce qui existe réellement.** Si vous
  mettez à jour un des documents de `docs/`, vérifiez le changement
  directement contre le code (grep, lecture du fichier concerné) plutôt
  que de le décrire de mémoire — c'est la règle qui a guidé la rédaction
  de toute la documentation actuelle.
