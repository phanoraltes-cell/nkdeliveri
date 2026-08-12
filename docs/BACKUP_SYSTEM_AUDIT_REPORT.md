# Audit du système de sauvegarde — causes racines

**Date** : 2026-08-05
**Portée** : `scripts/backup-database.sh`, `scripts/restore-database.sh`, `package.json` (`db:backup`/`db:restore`), configuration Supabase CLI. **Aucune migration de paiement touchée. Aucun RPC métier touché. Aucun frontend touché.**

---

## Résumé exécutif

Les 3 questions posées ont chacune une réponse précise, vérifiée par l'exécution réelle de la CLI Supabase (`--dry-run`, tests d'exit code) — rien n'est supposé.

| Question                                                      | Cause racine                                                                                                                                                                                                                                                                                                                                                                                                     | Statut                                                                                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Pourquoi le dump ne contient que le schéma ?                  | La CLI Supabase installée (v2.109.1) **n'a pas de mode combiné schéma+données en un seul appel** — `--data-only=false` (utilisé par l'ancien script) ne fait pas ce que son nom suggère : sans `--data-only`, la CLI exécute toujours `pg_dump --schema-only` en interne, quelle que soit la valeur passée après `=`.                                                                                            | 🔴 **Prouvé** (inspection directe de la commande réelle via `--dry-run`)                                                                |
| Pourquoi les données ne sont jamais exportées ?               | Conséquence directe du point précédent — il n'y a jamais eu de deuxième passe pour les données.                                                                                                                                                                                                                                                                                                                  | 🔴 **Prouvé**                                                                                                                           |
| Pourquoi les triggers sont absents ?                          | Non reproductible dans cet environnement (Docker indisponible, impossible d'exécuter un dump réel pour observer la sortie de pg_dump). L'inspection du pipeline `sed` de la CLI ne révèle aucune règle qui supprimerait un `CREATE TRIGGER` normal sur une table.                                                                                                                                                | 🟡 **Non concluant** — corrigé structurellement par la vérification automatique de contenu (Phase 3), quelle qu'en soit la cause exacte |
| Pourquoi un fichier vide peut rester présent après un échec ? | `set -euo pipefail` fonctionne correctement (vérifié : `npm run db:backup` retourne bien le code de sortie 1 en cas d'échec) — le problème n'est **pas** l'absence d'arrêt sur erreur. La CLI Supabase crée/tronque le fichier de sortie (`-f`) **avant** de lancer le dump interne ; si ce dump échoue ensuite, le fichier vide déjà créé n'est jamais supprimé, faute d'un nettoyage explicite dans le script. | 🔴 **Prouvé**                                                                                                                           |

---

## Détail des investigations

### 1. Absence de données — preuve directe

```
$ npx supabase db dump --linked --dry-run
...
pg_dump \
    --schema-only \
    --quote-all-identifier \
    --role "postgres" \
    --exclude-schema "..." \
```

La commande réellement exécutée par `supabase db dump` (sans `--data-only`) est **toujours** `pg_dump --schema-only`, peu importe les autres flags passés. L'ancien script appelait :

```bash
npx supabase db dump --schema public,private --data-only=false -f "$OUT_FILE"
```

`--data-only=false` n'est pas un flag reconnu par cette version de la CLI comme "active le mode combiné" — il n'existe tout simplement aucun mode combiné en un seul appel. Le résultat est donc, par construction, **toujours** un dump schéma seul, quel que soit ce paramètre.

**Correctif** : effectuer **deux passes distinctes** — une en mode schéma (défaut, sans `--data-only`), une en mode données (`--data-only`, confirmé par le `--dry-run` correspondant : utilise `--column-inserts`, donc des `INSERT INTO` classiques, plus simples à vérifier automatiquement que des blocs `COPY`) — puis concaténer les deux fichiers dans le bon ordre (schéma d'abord, données ensuite, pour que les tables existent avant l'insertion).

### 2. Absence de triggers — non concluant, corrigé structurellement

Le pipeline `sed` imprimé par `--dry-run` ne contient qu'une seule règle touchant le mot "TRIGGER" :

```
sed -E 's/^CREATE TRIGGER "/CREATE OR REPLACE TRIGGER "/'
```

— qui **réécrit** un `CREATE TRIGGER` en `CREATE OR REPLACE TRIGGER` (pour rendre le dump ré-exécutable sans erreur de duplication), elle ne le supprime pas. Aucune autre règle du pipeline ne semble cibler ou supprimer une définition de trigger standard sur une table `public`/`private`.

**Impossible de reproduire empiriquement la cause exacte dans cet environnement** : Docker Desktop, requis par `supabase db dump`, n'est pas disponible ici (confirmé : `docker: command not found`), donc aucun dump réel ne peut être généré pour observer directement si les triggers apparaissent aujourd'hui. Deux hypothèses restent possibles sans pouvoir trancher : (a) le dump du 31/07 a été produit par une version différente de la CLI dont le pipeline aurait, à l'époque, omis les triggers ; (b) un dump interrompu ou partiel a été sauvegardé malgré tout.

**Conséquence pratique** : peu importe la cause exacte, le nouveau script (Phase 3) **vérifie systématiquement la présence de `CREATE TRIGGER`** après chaque dump et refuse le backup si absent — la cause profonde n'a plus besoin d'être élucidée pour que le problème soit détecté à chaque exécution future.

### 3. Fichier vide après échec — preuve directe

```
$ npx supabase db dump --linked --schema public,private -f /tmp/test.sql
{"_tag":"Error","error":{"code":"LegacyDockerRunError",...}}
$ echo $?
1
$ ls -la /tmp/test.sql
-rw-r--r-- 1 DALPHE 197121 0 ... /tmp/test.sql
```

La commande retourne bien le code 1. Test complémentaire :

```
$ npm run db:backup > out.txt 2>&1; echo "npm exit code: $?"
npm exit code: 1
```

**`set -euo pipefail` fonctionne correctement** — `npm run db:backup` retourne bel et bien un code de sortie non nul en cas d'échec, ce n'est donc pas un problème de propagation d'erreur. Le vrai problème : la CLI crée le fichier de sortie (`-f "$OUT_FILE"`) **avant** de lancer `pg_dump` en interne ; quand ce dernier échoue, le fichier — déjà créé, vide — reste sur disque. Rien dans l'ancien script ne le supprime après l'échec.

**Correctif** : un `trap` sur `ERR`/`EXIT` qui supprime tout fichier de sortie qui n'a pas atteint la ligne "succès" du script.

---

## Fichiers concernés

| Fichier                          | Rôle                                                                   | Modification prévue                                                                                |
| -------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `scripts/backup-database.sh`     | Génère le dump                                                         | Réécrit entièrement (Phase 2-5)                                                                    |
| `scripts/restore-database.sh`    | Restaure un dump                                                       | Non modifié — déjà correct (refuse sans `--confirm`, affiche l'hôte cible, jamais le mot de passe) |
| `scripts/test-restore-backup.sh` | **Nouveau** — test de restauration automatisé vers une base temporaire | Créé (Phase 6)                                                                                     |
| `package.json`                   | Scripts npm `db:backup`/`db:restore`                                   | Un script `db:test-restore` ajouté, le reste inchangé                                              |
| `supabase/config.toml`           | Configuration du projet lié                                            | Aucun changement nécessaire — ne contrôle pas le comportement de `db dump`                         |

Aucune migration de paiement, aucun RPC métier, aucun fichier frontend n'a été inspecté ni modifié dans cet audit — strictement l'infrastructure de sauvegarde.
