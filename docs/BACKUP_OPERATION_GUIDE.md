# NK Deliveri — Backup Operation Guide (v1.0)

**Portée de ce document** : stratégie opérationnelle uniquement — aucun code applicatif n'est modifié ici. Les scripts référencés (`scripts/backup-database.sh`, `scripts/restore-database.sh`) existent déjà et ne sont pas touchés. Ce guide décrit comment les exécuter, où stocker leur sortie, comment vérifier, et comment faire tourner (rotation) les copies dans le temps.

**Constat vérifié en direct le jour de rédaction** (`supabase --experimental backups list --project-ref dcsnmvbtsmdbwrwbutph`) : `{"pitr_enabled": false, "backups": []}`. Aucune sauvegarde automatique gérée par Supabase n'existe. Tant que ce n'est pas activé (décision de plan Supabase séparée, hors périmètre de ce document), la procédure ci-dessous est l'unique ligne de défense contre une perte de données.

**Règle absolue** : un dump ne va jamais dans Git. `backups/` est déjà gitignoré ; ne jamais forcer un `git add` dessus, ne jamais créer de branche/commit contenant un fichier `.sql` de dump. Un dump contient des données clients réelles (commandes, paiements, coordonnées).

---

## 1. Procédure de sauvegarde quotidienne

### 1.1 Commande

```bash
npm run db:backup
```

Équivalent direct : `bash scripts/backup-database.sh`, qui appelle `supabase db dump --schema public,private --data-only=false -f backups/full_<timestamp>.sql`. Produit un dump schéma + données complet, horodaté en UTC.

Variante schéma seul (structure uniquement, sans les lignes — utile pour un diff de schéma rapide, pas pour une restauration de données) :

```bash
npm run db:backup -- --schema-only
```

### 1.2 Automatisation recommandée

Le cron applicatif de ce projet (`vercel.json`) est déjà saturé à 1 exécution/jour (limite du plan Vercel Hobby, réservée à `moncash-reconcile`) — ne pas y ajouter la sauvegarde. Utiliser un déclencheur externe et indépendant, par exemple un workflow GitHub Actions planifié :

```yaml
# .github/workflows/backup.yml (à créer séparément, sur validation explicite —
# non créé par ce document, fourni ici comme référence prête à l'emploi)
name: Daily database backup
on:
  schedule:
    - cron: "0 6 * * *" # 06:00 UTC, avant les heures de pointe locales
  workflow_dispatch: {}
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: |
          supabase link --project-ref dcsnmvbtsmdbwrwbutph
          bash scripts/backup-database.sh
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      - name: Upload to external storage
        run: |
          # remplacer par la commande du stockage externe retenu (§ 1.3) —
          # ex. aws s3 cp backups/*.sql s3://nkdeliveri-backups/db/ --sse
          echo "upload step — à configurer selon le stockage choisi"
      - run: rm -rf backups/ # ne jamais laisser le dump sur le runner CI après upload
```

Ce fichier n'est **pas** créé par cette mission (Phase 3 est documentation uniquement) — il est fourni ici prêt à copier-coller lors d'une prochaine session explicitement autorisée à créer des fichiers de workflow.

### 1.3 Stockage externe (obligatoire — `backups/` local n'est pas durable)

Le fichier produit par `npm run db:backup` reste sur la machine qui l'a exécuté (ou le runner CI éphémère) — il doit être copié vers un stockage durable **indépendant du projet Supabase lui-même** (ne jamais stocker les backups DB dans un bucket Supabase Storage de ce même projet : un incident touchant le projet toucherait aussi ses propres sauvegardes).

Options, par ordre de préférence pour ce projet (petite équipe, budget contraint) :

1. **Bucket S3/Google Cloud Storage/Backblaze B2 dédié**, chiffrement au repos activé, accès restreint (clé IAM dédiée, pas les credentials admin).
2. **Stockage d'équipe partagé et chiffré** (a minima le temps de mettre en place l'option 1).

Convention de nommage déjà produite par le script : `full_<YYYYMMDDTHHMMSSZ>.sql` — conserver telle quelle pour un tri chronologique naturel.

---

## 2. Procédure de restauration

### 2.1 Commande

```bash
SUPABASE_DB_URL="postgres://postgres:<password>@<host>:5432/postgres" \
  npm run db:restore -- backups/full_<timestamp>.sql --confirm
```

`scripts/restore-database.sh` refuse de s'exécuter sans `SUPABASE_DB_URL` explicite (jamais de cible devinée) et affiche l'hôte cible avant d'agir, pour permettre une vérification visuelle que la cible n'est pas accidentellement la production quand ce n'est pas l'intention.

### 2.2 Avant de restaurer — checklist de sécurité

- [ ] Confirmer la cible exacte (host affiché par le script) avant de valider
- [ ] Si la cible est la production : confirmation explicite de l'utilisateur obtenue, pas seulement du script lui-même — une restauration écrase tout ce qui s'est passé depuis le dump (commandes, paiements, comptes créés)
- [ ] Sauvegarde de l'état actuel prise juste avant la restauration, même en situation d'urgence (préserver l'état incident pour un post-mortem)
- [ ] Décaissements/paiements en vol vérifiés — voir `docs/ROLLBACK_CHECKLIST.md` § 3 pour le cas particulier d'un incident pendant une fenêtre de paiement actif

### 2.3 Après restauration

- [ ] Smoke test complet (voir `docs/GO_LIVE_CHECKLIST.md` § T+0) contre la base restaurée
- [ ] Vérifier que les migrations les plus récentes sont bien présentes (`supabase db query` sur `pg_proc`/`information_schema` pour confirmer que le dump restauré n'est pas antérieur à une migration critique)

---

## 3. Procédure de vérification

Une sauvegarde qui n'a jamais été testée n'est pas une sauvegarde, seulement une hypothèse.

### 3.1 Vérification immédiate après chaque dump (automatisable)

- [ ] Taille du fichier produit non anormalement petite — un dump vide (connexion échouée silencieusement) fait quelques Ko, un dump réel doit croître avec le volume réel de données
- [ ] Le fichier contient bien des instructions `INSERT`/`COPY` (pas seulement du DDL) si le mode est schéma + données :
  ```bash
  grep -c "^COPY\|^INSERT" backups/full_<timestamp>.sql
  ```
- [ ] Upload vers le stockage externe confirmé réussi (code retour de la commande d'upload vérifié, pas juste lancé)

### 3.2 Test de restauration périodique (recommandé mensuel, jamais contre la production)

- [ ] Provisionner une base Postgres jetable (ex. `supabase db start` local, ou une instance Postgres temporaire) — jamais la production comme cible de test
- [ ] Restaurer le dump le plus récent dessus
- [ ] Exécuter quelques requêtes de contrôle (comptage de lignes sur `orders`, `payments`, `payouts`, présence des dernières migrations)
- [ ] Mesurer et noter le temps réel écoulé (RTO — Recovery Time Objective) : actuellement non mesuré dans ce projet, à établir lors du premier test réel
- [ ] Détruire la base jetable après le test

### 3.3 Alerte sur échec

Tant qu'aucune automatisation CI n'est en place (§ 1.2), la vérification reste manuelle — ajouter cette étape à la routine de surveillance quotidienne déjà décrite dans `docs/MONITORING_CHECKLIST.md` § 4.

---

## 4. Procédure de rotation

Objectif : garder assez d'historique pour couvrir une erreur découverte tardivement, sans accumuler indéfiniment des dumps contenant des données personnelles.

### 4.1 Politique recommandée (à valider avec l'utilisateur — proposition de départ)

| Ancienneté  | Rétention                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| 0–14 jours  | Conserver chaque dump quotidien                                                                        |
| 15–90 jours | Conserver 1 dump par semaine (le plus récent de chaque semaine), supprimer les autres                  |
| 90+ jours   | Conserver 1 dump par mois, supprimer les autres                                                        |
| 1 an+       | Réévaluer selon obligation légale/comptable réelle (facturation, litiges) avant suppression définitive |

### 4.2 Mise en œuvre

- Locale (`backups/`) : jamais de rétention longue ici — ce répertoire est un tampon de travail, pas l'archive. Nettoyer après chaque upload réussi vers le stockage externe.
- Stockage externe : configurer une règle de cycle de vie native du service choisi (ex. S3 Lifecycle Rule) plutôt qu'un script de suppression manuel — moins de risque d'erreur humaine, exécution garantie même si personne n'y pense.

### 4.3 Ce qui ne doit jamais être automatiquement supprimé

- Le dump le plus récent (toujours garder au moins 1 copie valide, quelle que soit la politique de rotation)
- Tout dump pris immédiatement avant une migration à risque ou un Go-Live — marquer/étiqueter ces dumps-là séparément pour qu'une règle de rotation générique ne les efface pas prématurément

---

## 5. Checklist opérationnelle condensée

- [ ] Sauvegarde manuelle exécutée aujourd'hui (`npm run db:backup`)
- [ ] Fichier produit uploadé vers le stockage externe, upload confirmé réussi
- [ ] Fichier local supprimé après upload confirmé (ne pas laisser traîner sur la machine de travail)
- [ ] Aucun fichier `.sql` de dump présent dans `git status` avant tout commit
- [ ] Dernier test de restauration effectué il y a moins de 30 jours (sinon, en planifier un)
- [ ] Politique de rotation appliquée (pas d'accumulation illimitée sur le stockage externe)
- [ ] `docs/BACKUP_RESTORE.md` et `docs/BACKUP_CHECKLIST.md` toujours cohérents avec l'état réel (PITR toujours désactivé au moment de la rédaction — à vérifier avant de s'y fier)

Pour la checklist de sortie finale (avant Go-Live), voir `docs/FINAL_RELEASE_CHECKLIST.md`. Pour la procédure d'urgence en cas de perte de données, voir `docs/INCIDENT_RESPONSE.md`.
