# Rapport GO LIVE — Module MonCash

## 🔴 GO LIVE REFUSÉ

Arrêt à la **Phase 2 (Sauvegarde)**, conformément à la règle explicite de
cette mission : _"En cas d'échec : STOP immédiatement. Produire un
rapport détaillé. Ne jamais appliquer les étapes suivantes."_ Aucune
migration n'a été appliquée, aucun commit créé, aucun push effectué —
les Phases 3 à 13 n'ont pas été tentées.

---

## ⚠️ Incident de sécurité à traiter avant toute autre chose

En diagnostiquant pourquoi la sauvegarde échouait, la commande
`supabase db dump --dry-run` a affiché **le mot de passe réel de la
base de données de production en clair** dans la sortie de la commande
(comportement inattendu de l'outil — `--dry-run` était censé n'afficher
qu'un gabarit de script, pas les identifiants réels résolus). Cette
valeur est donc désormais visible dans l'historique de cette session.

**Recommandation immédiate, indépendante du reste de ce rapport** :
envisager de faire tourner le mot de passe de connexion Postgres de ce
projet Supabase (Dashboard → Project Settings → Database → Reset
database password). Cela ne casse aucune migration ni aucun code —
Supabase et cette application utilisent des clés API distinctes de ce
mot de passe pour leurs connexions applicatives normales. Je n'ai ni
répété ni réutilisé cette valeur ailleurs dans cette session.

---

## Phase 1 — Vérification finale

**Statut : ✅ OK, reconfirmé.** Spot-check effectué en début de cette
session (HEAD Git, statut des migrations) — identique en tout point à
la validation complète de la session précédente
([MONCASH_FINAL_PRODUCTION_VALIDATION.md](./MONCASH_FINAL_PRODUCTION_VALIDATION.md)),
aucune dérive détectée :

| Élément                                      | État                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Branche locale / distante                    | `dc780ea` des deux côtés — identiques                                                                                   |
| Dépôt                                        | 25 fichiers non commités (inchangé depuis la session précédente)                                                        |
| Migrations locales vs Supabase               | 4 migrations toujours non appliquées (`110000`, `120000`, `130000`, `20260731100000`)                                   |
| Edge Functions / Cron / Webhooks / Dashboard | Inchangés — voir le rapport précédent pour le détail complet (toujours valide, rien n'a changé entre les deux sessions) |

---

## Phase 2 — Sauvegarde : **ÉCHEC CRITIQUE**

### Ce qui a été tenté

1. `bash scripts/backup-database.sh` (le script de sauvegarde déjà
   existant dans ce projet, `supabase db dump --schema public,private`)
   → **échec** : `LegacyDockerRunError — Docker Desktop est un
prérequis`. Docker n'est pas disponible dans cet environnement
   d'exécution (déjà confirmé indisponible lors des sessions
   précédentes — `docker --version` échoue).
2. Recherche d'une alternative sans Docker :
   `npx supabase backups list --project-ref dcsnmvbtsmdbwrwbutph`
   (n'utilise pas Docker — appel direct à l'API de gestion Supabase) →
   a fonctionné, résultat :
   ```json
   {
     "region": "us-east-2",
     "walg_enabled": true,
     "pitr_enabled": false,
     "backups": [],
     "physical_backup_data": {}
   }
   ```

### Constat

- **`pitr_enabled: false`** — la récupération à un point dans le temps
  (Point-in-Time-Recovery) n'est **pas activée** sur ce projet.
- **`backups: []`** — **aucune sauvegarde physique n'existe** pour ce
  projet à ce jour, ni automatique ni manuelle.
- Impossible de produire une sauvegarde locale (`pg_dump`) faute de
  Docker dans cet environnement.

**Complément vérifié** : le dossier local `backups/` (gitignored)
contient 2 autres fichiers `full_*.sql` antérieurs (23 et 28 juillet),
également **vides (0 octet)** — ce script échoue donc pour la même
raison (absence de Docker) depuis plusieurs jours dans cet
environnement, pas seulement aujourd'hui. Il contient en revanche
`pre_reset_backup_20260728.json` (133 Ko, contenu réel, non vide) — une
sauvegarde faite différemment le 28 juillet, avant un évènement
"reset" antérieur à tout le chantier MonCash. Ce n'est pas un substitut
valable à une sauvegarde fraîche immédiatement avant d'appliquer les 4
migrations restantes (3 jours et de nombreux changements séparent les
deux), mais sa présence confirme qu'une méthode de sauvegarde
alternative a déjà été utilisée sur ce projet par le passé — à
considérer parmi les options de la Recommandation #2 ci-dessous.

**Conclusion : il n'existe aujourd'hui aucun filet de sécurité pour
restaurer cette base de données en cas de problème pendant
l'application des migrations.** Ce n'est pas une question de risque
perçu comme faible (les migrations restantes sont additives — nouvelles
tables/fonctions/triggers, sans `DROP COLUMN` ni `DELETE`) : la règle de
cette mission est explicite et ne conditionne pas la sauvegarde au
niveau de risque estimé. Je ne me substitue pas à cette règle.

### Procédure de restauration — ne peut pas être documentée maintenant

Impossible de documenter une procédure de restauration précise tant
qu'aucune sauvegarde n'existe pour ce projet. Une fois une sauvegarde
obtenue (voir Recommandations), la procédure de restauration standard
Supabase s'applique :

- Sauvegarde physique (PITR) : `supabase backups restore --project-ref <ref> --timestamp <t>`.
- Dump logique (`pg_dump`) : restauration via `psql`/`supabase db reset`
  suivi d'un rejeu du fichier — voir
  [BACKUP_RESTORE.md](../../runbooks/BACKUP_RESTORE.md) (document déjà existant dans
  ce projet, décrivant la procédure générale — à valider contre une
  vraie sauvegarde une fois disponible, pas encore fait).

---

## Phases 3 à 13 — Non exécutées

Conformément à la règle de cette mission, aucune des phases suivantes
n'a été tentée :

- Phase 3 (migrations) — **non appliquée**.
- Phase 4 (Edge Functions) — rien déployé.
- Phase 5 (Cron) — rien déployé.
- Phase 6 (validation fonctionnelle bout-en-bout) — non exécutée (rien
  n'étant déployé, valider un système non déployé n'aurait aucun sens).
- Phase 7 à 10 (notifications, monitoring, résilience, sécurité en
  production) — non exécutées pour la même raison.
- Phase 11 (synchronisation Git) — état inchangé, déjà documenté en
  Phase 1.
- Phase 12 (commit) — **aucun commit créé**.
- Phase 13 (push) — **aucun push effectué**.

---

## Recommandations — actions correctives avant de relancer ce GO LIVE

| #   | Action                                                                                                                                                                                                                                                                                            | Qui                             | Bloquant ?                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| 1   | Faire tourner le mot de passe Postgres (incident ci-dessus)                                                                                                                                                                                                                                       | Vous, via le Dashboard Supabase | Non-bloquant pour la suite technique, mais recommandé sans délai |
| 2   | Obtenir une sauvegarde réelle de la base — deux options : (a) activer PITR sur ce projet Supabase (peut nécessiter un changement de plan tarifaire — à vérifier), ou (b) exécuter `bash scripts/backup-database.sh` depuis un poste où Docker est disponible (votre machine locale, un runner CI) | Vous                            | **Oui — bloquant, condition de la Phase 2**                      |
| 3   | Une fois une sauvegarde obtenue, relancer cette mission GO LIVE depuis la Phase 3                                                                                                                                                                                                                 | Moi, sur votre confirmation     | —                                                                |

**Aucune migration n'a été appliquée, aucun commit n'a été créé, aucun
push n'a été effectué.** L'état du dépôt et de la base de production
est strictement identique à celui d'avant cette session.
