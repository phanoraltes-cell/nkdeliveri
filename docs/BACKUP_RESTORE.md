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
Un rapport d'intégrité `backups/<...>.report.md` est produit à côté (SHA-256,
taille, durée, nombre de tables/fonctions/triggers/policies).

**Depuis le 2026-08-05** (voir `docs/BACKUP_SYSTEM_AUDIT_REPORT.md` pour
l'audit complet des causes racines), ce script :

- effectue **deux passes** (schéma, puis données) et les concatène dans le
  bon ordre — la CLI Supabase installée n'a pas de mode combiné en un seul
  appel ; l'ancienne version de ce script produisait silencieusement un dump
  schéma-seul depuis le début ;
- **vérifie automatiquement le contenu** du dump produit : présence d'au
  moins un `CREATE TABLE`, `CREATE FUNCTION`, `CREATE TRIGGER`, `CREATE
POLICY`, et (en mode complet) d'au moins une ligne de données réelle —
  si l'un de ces éléments manque, **le fichier est supprimé automatiquement**
  et le script s'arrête avec un message expliquant précisément ce qui a
  manqué, jamais silencieusement ;
- compare aussi ces comptes à des **seuils minimums configurables**
  (`BACKUP_MIN_TABLES`, `BACKUP_MIN_FUNCTIONS`, `BACKUP_MIN_TRIGGERS`,
  `BACKUP_MIN_POLICIES`, `BACKUP_MIN_SIZE_BYTES` — variables d'environnement,
  valeurs par défaut raisonnables déjà dans le script) ;
- ne laisse **jamais** de fichier partiel ou vide sur disque, y compris si la
  commande sous-jacente échoue en cours de route (`trap` de nettoyage).

**Ce script ne fait que produire le fichier localement** — il faut ensuite le
copier vers un stockage durable (voir ci-dessous), et idéalement valider
qu'il est réellement restaurable (voir "Test de restauration automatisé").

### Où stocker les dumps manuels

`backups/` local n'est pas un stockage durable. Après chaque sauvegarde
manuelle importante, créer **au moins deux copies** vers des emplacements
distincts :

- Un disque externe (USB, NAS) ;
- Un coffre personnel/privé chiffré (OneDrive, Google Drive, Dropbox — usage
  privé, jamais un dossier partagé publiquement) ;
- Ou un bucket de stockage cloud dédié (S3, Google Cloud Storage, ou un
  bucket Supabase Storage séparé du projet lui-même, pour ne pas dépendre du
  système qu'on sauvegarde).

**Ne jamais publier un dump sur GitHub, même dans un dépôt privé** — il peut
contenir des données clients réelles (`backups/` est gitignoré précisément
pour empêcher ça par accident).

### Test de restauration automatisé

```bash
TEST_DB_URL="postgres://postgres:<password>@<hôte-temporaire>:5432/postgres" \
  npm run db:test-restore -- backups/full_20260101T000000Z.sql
```

`scripts/test-restore-backup.sh` restaure le dump dans la base pointée par
`TEST_DB_URL` (qui doit être une base **temporaire/jetable** — Postgres local
via Docker, `supabase start`, ou toute instance disposable) puis vérifie que
les tables/fonctions/triggers/policies restaurés dépassent les mêmes seuils
minimums que `backup-database.sh`. Il **refuse de s'exécuter** si
`TEST_DB_URL` correspond à l'hôte de production détecté dans `.env.local` —
ce script ne doit jamais toucher la vraie base. Produit un rapport
`<dump>.restore-test.md` à côté du dump testé.

Nécessite `psql` sur le poste qui l'exécute. **Non exécutable dans certains
environnements sandboxés sans Docker/psql** (voir
`docs/BACKUP_SYSTEM_AUDIT_REPORT.md`) — dans ce cas, lancer ce script depuis
un poste ou un job CI où ces outils sont disponibles.

### Restauration réelle (production)

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
  affiche seulement ce qu'il _aurait_ fait.

**Ne jamais exécuter une restauration directement contre la base de
production** sans avoir d'abord validé le dump via `db:test-restore`
ci-dessus sur un environnement de test/staging (voir `docs/ENVIRONMENTS.md`).

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
  ce fichier sert de sauvegarde _structurelle_ (quelles variables existent),
  jamais de leurs valeurs réelles.
- **Migrations SQL** : déjà versionnées dans `supabase/migrations/` — c'est
  leur sauvegarde par construction (l'historique Git). Voir
  `docs/MIGRATIONS.md` pour la procédure complète.
- **Configuration Vercel/GitHub** (branch protection, secrets GitHub Actions,
  intégration Vercel↔GitHub) : à documenter manuellement après toute
  modification dans `docs/DEVOPS.md`, ces réglages ne vivent dans aucun
  fichier versionné.

## Fréquence recommandée

| Donnée          | Sauvegarde automatique      | Sauvegarde manuelle recommandée        |
| --------------- | --------------------------- | -------------------------------------- |
| Base de données | Quotidienne (Supabase)      | Avant toute migration risquée          |
| Storage buckets | Durabilité infra (Supabase) | Mensuelle pour les documents sensibles |
| Configuration   | Git (migrations, code)      | À chaque changement de secret/variable |
