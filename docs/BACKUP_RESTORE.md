# Sauvegarde et restauration — NK Deliveri

Ce document couvre la stratégie de sauvegarde pour les trois catégories de données
critiques du projet : la base de données Supabase (Postgres), les fichiers de
Storage (buckets), et les configurations critiques (variables d'environnement,
secrets).

## 1. Base de données (Postgres)

### Sauvegarde automatique (fournie par Supabase)

Tout projet Supabase sur un plan payant bénéficie de **sauvegardes automatiques
quotidiennes**, gérées par Supabase lui-même (Dashboard → Database → Backups),
avec un point-in-time recovery (PITR) selon le plan souscrit. C'est la ligne de
défense principale — vérifier dans le Dashboard Supabase du projet que ces
sauvegardes automatiques sont bien actives et que la rétention (nombre de jours)
correspond au besoin métier.

### Sauvegarde manuelle (ce dépôt)

En complément, `scripts/backup-database.sh` produit un dump local à la demande —
utile avant une migration risquée, avant une opération de maintenance, ou comme
copie indépendante de la sauvegarde gérée par Supabase.

```bash
# Schéma + données (par défaut)
npm run db:backup

# Schéma seul (structure des tables/fonctions, sans les lignes)
npm run db:backup -- --schema-only
```

Le fichier produit est écrit dans `backups/<schema|full>_<timestamp>.sql`
(répertoire gitignoré — jamais commité, peut contenir des données clients).
**Ce script ne fait que produire le fichier localement** — il faut ensuite le
copier vers un stockage durable (voir ci-dessous).

### Où stocker les dumps manuels

`backups/` local n'est pas un stockage durable. Après chaque sauvegarde
manuelle importante, copier le fichier vers :

- Un bucket de stockage cloud (S3, Google Cloud Storage, ou un bucket Supabase
  Storage dédié — hors du projet lui-même, pour ne pas dépendre du système
  qu'on sauvegarde) ;
- Ou, à minima, un espace de stockage d'équipe partagé et chiffré.

### Restauration

```bash
SUPABASE_DB_URL="postgres://postgres:<password>@<host>:5432/postgres" \
  npm run db:restore -- backups/full_20260101T000000Z.sql --confirm
```

Le script `scripts/restore-database.sh` :

- refuse de s'exécuter sans `SUPABASE_DB_URL` explicite (jamais de cible
  devinée) ;
- affiche l'hôte cible (jamais le mot de passe) avant d'agir, pour permettre
  une vérification visuelle ;
- exige le flag `--confirm` en second argument — sans lui, il s'arrête et
  affiche seulement ce qu'il *aurait* fait.

**Ne jamais exécuter une restauration directement contre la base de
production** sans validation préalable sur un environnement de test/staging
d'abord (voir `docs/ENVIRONMENTS.md`).

## 2. Fichiers de Storage (buckets Supabase)

Les buckets (`menu-photos`, `payment-proofs`, `driver-documents`, etc.) ne sont
**pas** couverts par les dumps `pg_dump`/`supabase db dump` ci-dessus (ceux-ci
ne couvrent que les métadonnées des objets dans `storage.objects`, pas les
fichiers binaires eux-mêmes).

- Supabase Storage est lui-même construit sur un stockage objet durable côté
  fournisseur (S3-compatible) — la durabilité des fichiers déjà uploadés est
  déjà assurée par l'infrastructure Supabase.
- Pour une copie de sauvegarde indépendante (protection contre une suppression
  accidentelle au niveau applicatif, pas contre une panne d'infrastructure),
  utiliser la Supabase CLI ou l'API Storage pour lister et télécharger le
  contenu des buckets périodiquement vers un stockage secondaire.
- Prioriser les buckets contenant des documents non regénérables
  (`driver-documents`, `payment-proofs`) — les photos de plats/logos
  restaurant sont réuploadables par les restaurateurs si perdues.

## 3. Configurations critiques

- **Variables d'environnement / secrets** : la source de vérité vit dans le
  Dashboard Vercel (Project → Settings → Environment Variables) et le
  Dashboard Supabase (API keys, service role key). Documenter systématiquement
  toute variable ajoutée dans `.env.example` (voir `docs/ENVIRONMENTS.md`) —
  ce fichier sert de sauvegarde *structurelle* (quelles variables existent),
  jamais de leurs valeurs réelles.
- **Migrations SQL** : déjà versionnées dans `supabase/migrations/` — c'est
  leur sauvegarde par construction (l'historique Git). Voir
  `docs/MIGRATIONS.md` pour la procédure complète.
- **Configuration Vercel/GitHub** (branch protection, secrets GitHub Actions,
  intégration Vercel↔GitHub) : à documenter manuellement après toute
  modification dans `docs/DEVOPS.md`, ces réglages ne vivent dans aucun
  fichier versionné.

## Fréquence recommandée

| Donnée | Sauvegarde automatique | Sauvegarde manuelle recommandée |
|---|---|---|
| Base de données | Quotidienne (Supabase) | Avant toute migration risquée |
| Storage buckets | Durabilité infra (Supabase) | Mensuelle pour les documents sensibles |
| Configuration | Git (migrations, code) | À chaque changement de secret/variable |
