# Journal des modifications — NK Deliveri

Ce projet n'utilise pas de versionnement sémantique publié (`package.json`
ne définit pas de champ `version` — voir [LICENSE](./LICENSE), le dépôt est
privé). Ce journal résume donc l'évolution par **grandes étapes**, pas par
version numérotée. Pour le détail commit par commit, `git log` reste la
source de vérité exhaustive — ce document n'en est pas un miroir complet,
seulement un résumé destiné à orienter un nouveau développeur.

## 2026-07-16 — Documentation complète et transfert de connaissances

Rédaction de l'ensemble de la documentation technique, métier et
développeur (ce dossier `docs/`, `README.md`, `CONTRIBUTING.md`,
`CODE_OF_CONDUCT.md`, `LICENSE`, ce fichier), vérifiée directement contre
l'état du code et des migrations à cette date plutôt que rédigée de
mémoire.

## 2026-07-13 → 2026-07-15 — Industrialisation DevOps et préparation production

- Preset Nitro `vercel` épinglé explicitement, résolvant une ambiguïté de
  build Cloudflare/Vercel (`df7ca82`).
- Pipeline CI GitHub Actions (lint/typecheck/build/validation des
  migrations), scripts d'automatisation (`clean`, `check:migrations`,
  `db:backup`, `db:restore`), linter maison détectant le piège de
  surcharge de fonction Postgres (`6c94257`).
- Monitoring d'erreurs Sentry, client et serveur, sans collecte de données
  personnelles (`3a4609a`).
- `.env.example` complet, correction d'un bug `.gitignore` qui bloquait
  silencieusement son suivi (`bc68ddc`).
- Documentation des procédures de migration, sauvegarde/restauration,
  environnements, dépendances, sécurité infrastructure, déploiement
  production (`5a0a163`, `10ea3b6`, `fa92637`, `56f1663`).

## 2026-07-14 — Finalisation fonctionnelle (remboursements, litiges, Kanban, etc.)

- Système de remboursement complet : demande client, revue admin,
  historique de statut (`99d48f1`).
- Résolution de litiges : signalement client, réponse restaurant/livreur,
  arbitrage admin, journal complet (`6360e7a`).
- Vue Kanban pour les commandes restaurant, 7 colonnes avec validation des
  transitions (`b82371a`).
- Bons de cuisine imprimables (PDF) (`840c15f`).
- Carte de suivi admin enrichie : tracés, distances, ETA en temps réel
  (`070d5ff`).
- Rôles d'employé restaurant étendus au-delà de « staff » (Manager,
  Cuisinier, Préparateur, Caissier, Responsable) (`1b2a290`).
- Couverture complète des notifications métier, in-app et push
  (`7eeb9f0`).

## 2026-07-14 — Refactorisation d'architecture

- Décomposition de six fichiers de route trop volumineux en
  sous-composants ciblés (`10ca3ad`, `01333df`, `00c504d`, `f74b326`,
  `67060aa`, `400edb4`).
- Élimination de duplications de code (export CSV, badge de statut, grille
  de raccourcis, constantes de jour, hook de série hebdomadaire)
  (`1cdd999`, `3f7c48f`, `35e308e`, `1cf8dbd`).
- Uniformisation de la convention de nommage des hooks en camelCase
  (`6fe3018`).

## 2026-07-09 → 2026-07-14 — Performance et sécurité applicative

- Correction critique : les layouts de dashboard n'avaient pas d'`<Outlet/>`
  (`45584e7`).
- Rate-limiting appliqué côté serveur sur les RPC critiques (`24ca756`).
- Pagination des listes admin volumineuses, index sur les colonnes de
  clé étrangère fréquemment filtrées, remplacement du polling par
  Realtime, lazy-loading de la carte et des graphiques, regroupement des
  dépendances tierces en chunks stables (`ef501e5`, `72301b3`, `b70be73`,
  `5389416`, `b7af48d`).
- Renforcement CSP, limites de buckets de stockage, validation
  d'upload (`784eda9`, `a14ee2c`).

## 2025 → mi-2026 — Construction initiale et stabilisation

Base du projet générée puis étendue via Lovable (voir la présence de
`@lovable.dev/vite-tanstack-config` dans `package.json`), suivie d'une
longue phase de stabilisation fonctionnelle : dashboards par rôle,
migration de la cartographie vers OpenStreetMap/Leaflet, fondations SEO,
responsive/PWA, gestion des employés restaurant, corrections de bugs RLS
critiques, suppression de dépendances Lovable non indispensables pour
rendre le projet autonome. Voir `git log` pour le détail — les messages de
commit de cette période sont en partie en kreyòl/français, en partie en
anglais, reflet de l'historique réel du projet plutôt qu'une convention
imposée rétroactivement.
