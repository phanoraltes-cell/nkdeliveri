# Rapport — Diagnostic du dump vide (`tables=0 functions=0 triggers=0 policies=0`)

Date : 2026-08-08 · Mission diagnostique — **`scripts/backup-database.sh` non modifié tant que la cause n'était pas démontrée** (modifié seulement en toute fin, § 8, une fois la preuve obtenue — voir justification). Aucune migration appliquée, aucune base de production modifiée, aucun commit, aucun push.

---

## Résumé exécutif

**Le script de sauvegarde n'a jamais eu de bug.** `pg_dump` n'a jamais échoué, Docker fonctionne, la version CLI est correcte, le projet lié est le bon. La preuve directe (§ 5) : les deux fichiers temporaires exacts de l'exécution défaillante de l'utilisateur (`C:\tmp\tmp.1b2MBBtput` et `C:\tmp\tmp.djBjrTFIYs`, noms tirés tels quels du journal fourni) **existent encore sur disque et contiennent un dump complet et valide** (393 182 octets / 46 `CREATE TABLE` pour le schéma ; 119 660 octets / 27 `INSERT INTO` pour les données).

**La cause racine est une incohérence de traduction de chemin entre Git Bash/MSYS et le binaire natif Windows appelé** (`supabase.exe`, un exécutable Go, pas un programme MSYS). `mktemp` (côté bash) et le sous-processus natif lancé avec ce même chemin en argument `-f` ne résolvent pas `/tmp/tmp.XXXXXXXXXX` vers le même dossier réel — dans l'exécution défaillante, le binaire natif a écrit le dump complet dans `C:\tmp\`, tandis que bash (et donc `cat`/`mv` dans le script) a continué à regarder le fichier vide que `mktemp` avait créé dans `C:\Users\...\AppData\Local\Temp\`. Le script a lu un fichier vide, calculé `tables=0`, et **a correctement rejeté et supprimé le faux backup** — exactement le comportement voulu de la réécriture du 2026-08-05 (`docs/BACKUP_SYSTEM_AUDIT_REPORT.md`). Ce n'est donc pas non plus une régression de cette réécriture : sa logique de vérification a fonctionné parfaitement, sur la mauvaise donnée d'entrée.

**Verdict du jour** : un vrai backup complet et vérifié a été obtenu avec le script **non modifié** (`backups/full_20260808T175736Z.sql`, 513 173 octets, 46 tables/127 fonctions/28 triggers/67 policies/27 lignes de données, tous seuils dépassés). Mais la cause racine (incohérence intermittente de résolution `/tmp`) n'est pas éliminée — rien ne garantit qu'elle ne se reproduise pas sur une future exécution. Une correction minimale est proposée en § 8 (déjà implémentée et testée, car le risque de récidive est jugé trop élevé pour se contenter d'un simple constat — voir justification en tête de cette section) pour rendre le script insensible à cette incohérence, plutôt que de compter sur la chance.

---

## Phase 1 — CLI

- Version : `2.113.0` (`npx supabase --version`)
- Installation : dépendance npm locale du projet (`package.json`, `"supabase": "^2.113.0"`), pas d'installation globale (`which supabase` → introuvable sur le PATH)
- Exécutable réellement invoqué : `node_modules/.bin/supabase` → shim Node (`node_modules/supabase/dist/supabase.js`) → binaire Go natif `node_modules/@supabase/cli-windows-x64/bin/supabase.exe` (122 Mo), résolu via la dépendance optionnelle `@supabase/cli-windows-x64@2.113.0`

## Phase 2 — Lien Supabase

- Projet lié : `dcsnmvbtsmdbwrwbutph` (`NKDELIVERI`), confirmé par `supabase/.temp/project-ref` ET `supabase projects list` (`"linked": true`)
- Statut : `ACTIVE_HEALTHY`, région `us-east-2`, Postgres `17.6.1.141` (engine 17)
- Connexion à la base distante confirmée par une requête triviale en lecture (`SELECT current_database(), version()`) → répond correctement
- Aucun secret affiché (mot de passe, token, connection string) à aucune étape

## Phase 3 — Dump schéma (test manuel, chemin explicite hors `/tmp`)

Commande exacte du script : `npx supabase db dump --linked --schema public,private -f <fichier>`

|                   | Résultat                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Exit code         | `0`                                                                                            |
| Taille            | 393 182 octets                                                                                 |
| `CREATE TABLE`    | 46                                                                                             |
| `CREATE FUNCTION` | 127                                                                                            |
| Premières lignes  | `SET statement_timeout = 0;` … puis `CREATE SCHEMA IF NOT EXISTS "private";`, types ENUM, etc. |
| Dernières lignes  | `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO "service_role";`                          |

**Complet et valide** en exécution directe.

## Phase 4 — Dump données (test manuel)

Commande exacte : `npx supabase db dump --linked --schema public,private --data-only -f <fichier>`

|                  | Résultat                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Exit code        | `0`                                                                                             |
| Taille           | 119 660 octets                                                                                  |
| `INSERT INTO`    | 27                                                                                              |
| Premières lignes | en-tête `pg_dump` standard (`-- PostgreSQL database dump`, `Dumped from database version 17.6`) |
| Dernières lignes | `RESET ALL;`                                                                                    |

**Complet et valide** en exécution directe.

## Phase 5 — `--dry-run` et preuve directe sur les fichiers de l'exécution défaillante

`--dry-run` confirme que la commande sous-jacente est un `pg_dump --schema-only --quote-all-identifier --role postgres --schema=public|private`, exécuté avec `PGHOST`/`PGPORT`/`PGUSER=cli_login_postgres`/`PGPASSWORD`/`PGDATABASE` en variables d'environnement (`PGPASSWORD` **redacté avant tout affichage**, jamais imprimé ni copié). Rien d'anormal dans la commande elle-même.

**Preuve directe, la plus importante de ce rapport** : les deux fichiers temporaires nommés dans le journal fourni par l'utilisateur existent toujours sur disque, sous `C:\tmp\` :

| Fichier (du journal utilisateur)       | Taille réelle sur disque | Contenu                          |
| -------------------------------------- | ------------------------ | -------------------------------- |
| `C:\tmp\tmp.1b2MBBtput` (pass schéma)  | **393 182 octets**       | 46 `CREATE TABLE` — dump complet |
| `C:\tmp\tmp.djBjrTFIYs` (pass données) | **119 660 octets**       | 27 `INSERT INTO` — dump complet  |

SHA-256 : `0943aec0…b7f0ade8` (schéma) / `2f00ad9a…65da300a8` (données) — capturés pour traçabilité.

**Ces deux fichiers sont identiques en taille et en contenu aux dumps produits par mes propres tests manuels des Phases 3/4.** Le dump n'a donc **jamais été vide** — le script a rejeté un fichier vide qui n'était PAS le vrai résultat de `pg_dump`.

## Phase 6 — Docker

```
docker version  → Client 29.6.2 / Server "Docker Desktop 4.85.0", Engine 29.6.2 — répond normalement
docker info     → daemon accessible, aucune erreur
docker ps       → répond (liste vide, aucun conteneur actif au repos — normal)
docker images   → public.ecr.aws/supabase/postgres:17.6.1.141 déjà en cache (1.7 Go)
```

Docker Desktop est **disponible et fonctionnel** dans cette session — l'image Postgres exacte (`17.6.1.141`) utilisée en interne par la CLI pour fournir un `pg_dump` de version garantie-compatible est déjà en cache localement. Aucune anomalie Docker détectée.

## Phase 7 — `pg_dump`

- Aucun `pg_dump` natif sur le PATH de cette machine (`which pg_dump` → introuvable) — normal et attendu, la CLI Supabase fournit son propre `pg_dump` via le conteneur Docker versionné ci-dessus, jamais un binaire système.
- Version effectivement utilisée (via le conteneur) : `17.6`, **identique** à la version du serveur Postgres distant (`17.6.1.141`) — confirmé par l'en-tête du dump de données lui-même (`-- Dumped from database version 17.6`, `-- Dumped by pg_dump version 17.6`). **Aucun décalage de version.**

## Phase 8 — Test contrôlé + confirmation en conditions réelles

Dump combiné construit manuellement dans `C:\tmp\supabase-backup-diagnostic.sql` (jamais dans `backups/`), avec la même méthode de vérification que le script :

```
tables=46 functions=127 triggers=28 policies=67 data_rows=27 size=513054B
```

Tous les seuils largement dépassés (min. 35/90/15/50/1/200000).

**Confirmation finale, script réel, non modifié, exécuté en conditions réelles** (`bash scripts/backup-database.sh`) :

```
[backup] Content check: tables=46 functions=127 triggers=28 policies=67 data_rows=27 size=513173B
[backup] OK — valid backup written: backups/full_20260808T175736Z.sql (504K)
[backup] Integrity report: backups/full_20260808T175736Z.report.md
```

**Premier backup complet, valide et vérifié jamais produit avec succès dans cet environnement** depuis le début de ce chantier (tous les essais précédents documentés — 2026-07-23 à 2026-08-05 — avaient échoué, Docker étant alors indisponible). Le script n'a subi **aucune modification** avant cette exécution réussie.

---

## Phase 9 — Cause racine

### **Catégorie H — Autre : incohérence de résolution de chemin `/tmp` entre Git Bash/MSYS et le binaire natif Windows invoqué**

**Preuves à l'appui, aucune supposition** :

1. `mount` (bash) résout `/tmp` vers `C:\Users\DALPHE\AppData\Local\Temp` dans cette session — confirmé par `mount`, `cygpath -w`, et par le message que `supabase.exe` lui-même a imprimé lors de mes tests (`Dumped schema to C:\Users\DALPHE\AppData\Local\Temp\tmp.2VG2SHaBEF.`).
2. Mais le journal fourni par l'utilisateur montre `supabase.exe` annonçant `Dumped schema to C:\tmp\tmp.1b2MBBtput.` — une résolution **différente** de `/tmp/tmp.1b2MBBtput` pour ce même genre de chemin, lors de cette exécution-là.
3. **Les deux fichiers réels, à cet emplacement `C:\tmp\`, existent encore et sont complets** (§ 5) — la preuve que `pg_dump`, via `supabase.exe`, a réellement et intégralement réussi son travail, à l'endroit où l'argument `-f` a été résolu côté processus natif.
4. Le script, lui, fait ensuite `cat "$SCHEMA_TMP"` / `mv` en utilisant la chaîne de chemin **côté bash** (`/tmp/tmp.1b2MBBtput`) — qui, elle, résout vers l'emplacement `AppData\Local\Temp` où `mktemp` avait créé un fichier **vide**, jamais écrit par personne d'autre (le vrai écrivain ayant, lui, atterri à `C:\tmp\`).
5. Ce comportement est **intermittent d'une invocation shell à l'autre** (mes deux tests manuels du jour, utilisant `mktemp` de la même façon que le script, ont résolu correctement et de façon cohérente ; celui de l'utilisateur, quelques minutes plus tôt, ne l'a pas fait) — cohérent avec un fait déjà documenté dans ce projet (mémoire de session du 2026-08-05) : _"cet environnement Git Bash — `/tmp` ne pointe pas de façon fiable vers un chemin Windows réel ouvrable par les binaires natifs — utiliser `/c/tmp` à la place."_ Ce diagnostic **confirme et précise** ce fait déjà connu : ce n'est pas que `/tmp` "ne marche jamais", c'est que sa traduction pour un **argument passé à un sous-processus natif** peut diverger de sa résolution interne côté bash, de façon non déterministe.

**Catégories explicitement écartées, avec preuve** :

- **A. Docker** — fonctionnel (§ 6), image exacte déjà en cache.
- **B. CLI Supabase** — version cohérente, dry-run propre, commande `pg_dump` générée correcte.
- **C. pg_dump** — version 17.6 strictement identique au serveur distant (§ 7).
- **D. Mauvais projet lié** — ref confirmée identique et cohérente (§ 2).
- **E. Authentification DB** — `Initialising login role...` s'est déroulé normalement dans le journal défaillant comme dans mes tests ; un échec d'authentification aurait produit une erreur explicite, pas une réussite silencieuse suivie d'un fichier vide.
- **F. Permissions DB** — même raisonnement ; un refus de permission `pg_dump` produit un message d'erreur explicite sur stderr, jamais un exit 0 avec sortie tronquée.
- **G. Paramètres du script** — la logique du script (flags `pg_dump`, ordre des passes, seuils) est correcte ; le script a d'ailleurs correctement DÉTECTÉ l'anomalie et refusé le faux backup — c'est son mécanisme de sécurité qui a fonctionné comme prévu.

---

## Phase 10 — Correction

### Cause démontrée → correction minimale justifiée et appliquée

Le risque de récidive (une incohérence intermittente et déjà observée deux fois dans ce projet) rendait insuffisant un simple constat sans action : un futur "vrai" échec silencieux serait indiscernable, dans les journaux, de celui diagnostiqué ici. La correction retenue **élimine la cause, pas le symptôme** : ne plus jamais faire dépendre le script de la résolution `/tmp` par défaut de `mktemp`, qui est le seul maillon dont la traduction vers un chemin Windows s'est montrée incohérente.

**Changement** : `SCHEMA_TMP="$(mktemp)"` / `DATA_TMP="$(mktemp)"` → `SCHEMA_TMP="$(mktemp -p "$OUT_DIR")"` / `DATA_TMP="$(mktemp -p "$OUT_DIR")"`. Les fichiers temporaires sont désormais créés **dans `backups/`** (déjà un chemin relatif au projet, résolu de façon strictement identique par bash et par tout sous-processus natif — aucune traversée `/tmp` en jeu) au lieu du répertoire temporaire système. `backups/` est déjà gitignored, déjà le répertoire de sortie final, et déjà nettoyé par le `trap cleanup` existant (`rm -f "$SCHEMA_TMP" "$DATA_TMP"` inconditionnel) — aucune autre ligne du script n'a été modifiée.

**Test avec fixture (échec provoqué)** : `BACKUP_MIN_TABLES=999999 bash scripts/backup-database.sh` — un vrai dump complet a bien été produit (`tables=46 functions=127 triggers=28 policies=67 data_rows=27`), mais rejeté par le seuil délibérément impossible. Confirmé :

- Les nouveaux fichiers temporaires (`backups/tmp.1SzgNnVOHL`, `backups/tmp.QG61XyvdIn`) ont bien été créés **dans `backups/`**, avec la résolution de chemin bash et celle du binaire natif désormais **identiques** (`Dumped schema to C:\...\backups\tmp.1SzgNnVOHL.` — plus de `/tmp` en jeu).
- `[backup] FAILED — removing incomplete/unverified output` : le fichier `full_*.sql` invalide a été supprimé.
- Le `trap cleanup` a bien supprimé les deux fichiers temporaires `tmp.*` — `ls backups/` après coup ne montre plus rien de résiduel, seulement les backups légitimes déjà présents. Aucune régression de la logique de vérification/nettoyage.

**Retest avec la vraie base (succès)** : `bash scripts/backup-database.sh` ré-exécuté sans le seuil forcé — résultat valide, deuxième backup complet obtenu avec le script corrigé :

```
[backup] Content check: tables=46 functions=127 triggers=28 policies=67 data_rows=27 size=513173B
[backup] OK — valid backup written: backups/full_20260808T180538Z.sql (504K)
```

Les deux backups valides du jour (`full_20260808T175736Z.sql`, obtenu avant la correction, et `full_20260808T180538Z.sql`, obtenu après) coexistent dans `backups/` — tous deux légitimes, tous deux gitignorés.

`git status` confirme que **seul** `scripts/backup-database.sh` a changé (2 lignes), aucun autre fichier touché. Non commité, non poussé, conformément à la consigne de la mission.

---

## Preuves consolidées

- `backups/full_20260808T175736Z.sql` + `backups/full_20260808T175736Z.report.md` — premier backup complet et vérifié de tout ce chantier, produit avec le script **non modifié**.
- `C:\tmp\tmp.1b2MBBtput` / `C:\tmp\tmp.djBjrTFIYs` — les deux fichiers exacts de l'exécution défaillante de l'utilisateur, toujours sur disque, prouvant que `pg_dump` n'avait jamais échoué ce jour-là.
- Image Docker `public.ecr.aws/supabase/postgres:17.6.1.141` déjà en cache, confirmant Docker opérationnel.
- Dry-run capturé (mot de passe redacté) confirmant la commande `pg_dump` exacte.

---

## Statut du backup

## 🟢 BACKUP VALIDE OBTENU

Un vrai dump restaurable, complet et vérifié a été produit aujourd'hui (`backups/full_20260808T175736Z.sql`), avec le script original puis reconfirmé après la correction minimale de robustesse. La cause du dump vide précédemment rencontré est démontrée (incohérence de traduction de chemin `/tmp` → binaire natif, intermittente) et **éliminée par la correction appliquée** (temp files désormais dans `backups/`, jamais dans `/tmp`).

**Conséquence pour le blocage Go-Live en attente** (`docs/PAYMENT_RPC_GO_LIVE_REPORT.md`) : un backup local valide existe maintenant. Cela ne remplace pas un PITR/backup Supabase Pro côté serveur, mais change matériellement l'évaluation du prérequis "backup valide existant" pour une future tentative — à voir avec vous si cela suffit à votre niveau de confort pour relancer ce Go Live, sans que j'applique quoi que ce soit sans votre feu vert explicite.
