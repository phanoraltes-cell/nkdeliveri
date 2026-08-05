# Validation de la sauvegarde de production — état après remédiation

**Date** : 2026-08-05 (mise à jour — remplace la version précédente de ce rapport, qui documentait l'ancien script défaillant)
**Statut** : 🟡 **Outillage corrigé et prouvé correct ; aucun dump de production réel généré dans cet environnement (toujours sans Docker).**

---

## Résumé exécutif

`scripts/backup-database.sh` a été entièrement réécrit (voir
`docs/BACKUP_SYSTEM_AUDIT_REPORT.md` pour l'audit des causes racines). Le
nouveau script a été **prouvé correct par des tests de bout en bout** avec des
fixtures synthétiques reproduisant exactement les deux défauts historiques :

- un dump sans donnée (le bug qui affectait `full_20260731T161758Z.sql`) → **rejeté et supprimé automatiquement**, code de sortie non nul, message explicite ;
- un dump sans trigger (le même défaut historique) → **rejeté et supprimé automatiquement**, code de sortie non nul, message explicite ;
- un dump complet respectant tous les seuils → **accepté, rapport d'intégrité généré**.

**Ce qui reste bloqué, honnêtement** : cet environnement d'exécution ne dispose toujours pas de Docker (requis par `supabase db dump`), donc **aucun dump réel de la base de production n'a pu être généré ni validé end-to-end ici** — seule la logique du script a été vérifiée, via des fixtures fabriquées, pas via une vraie connexion à la base. Idem pour `scripts/test-restore-backup.sh` : sa garde de sécurité (refus de cibler l'hôte de production) a été prouvée, mais un test de restauration réel nécessite `psql`, absent ici aussi.

---

## Ancien dump — statut inchangé (référence historique)

`backups/full_20260731T161758Z.sql` reste tel que documenté dans la version précédente de ce rapport : 354 308 octets, SHA-256 `feb7cdf2799605c300a817451d34f6fde7469d23c61f77a218be3c5937c61ef1`, 42 tables/119 fonctions/62 policies mais **0 donnée et 0 trigger** — toujours structurellement incomplet, non utilisé, non supprimé (conservé comme référence pour les tests de non-régression ci-dessous).

---

## Preuves — tests de bout en bout du script corrigé

Trois scénarios testés avec un faux `npx supabase db dump` (fixtures fabriquées, aucune connexion réelle à Supabase) :

### Scénario 1 — dump valide (2 tables, 2 fonctions, 1 trigger, 1 policy, 2 lignes de données)

```
[backup] Content check: tables=2 functions=2 triggers=1 policies=1 data_rows=2 size=984B
[backup] OK — valid backup written: backups/full_20260805T181354Z.sql (4.0K)
[backup] Integrity report: backups/full_20260805T181354Z.report.md
EXIT CODE: 0
```
✅ Fichier conservé, rapport généré, aucune ligne de code de la fixture confondue avec des données réelles (le `INSERT INTO` présent *à l'intérieur* du corps de la fonction f1() n'a pas été compté comme une ligne de donnée — vérifié explicitement).

### Scénario 2 — reproduction exacte du bug historique n°1 (schéma correct, 0 ligne de donnée)

```
[backup] Content check: tables=2 functions=2 triggers=1 policies=1 data_rows=0 size=818B
[backup] ERROR: 0 data rows (INSERT) found in the data pass — this is exactly the defect
  that made every prior 'full' backup schema-only. Refusing to keep this file.
[backup] FAILED — removing incomplete/unverified output: backups/full_20260805T181431Z.sql
EXIT CODE: 1
```
✅ Fichier supprimé automatiquement, aucun fichier laissé sur disque (vérifié par `diff` avant/après), code de sortie 1.

### Scénario 3 — reproduction exacte du bug historique n°2 (0 trigger)

```
[backup] Content check: tables=2 functions=2 triggers=0 policies=1 data_rows=2 size=861B
[backup] ERROR: 0 CREATE TRIGGER found — this is exactly the defect that made the
  2026-07-31 backup unusable. Refusing to keep this file.
[backup] FAILED — removing incomplete/unverified output: backups/full_20260805T181446Z.sql
EXIT CODE: 1
```
✅ Même résultat : fichier supprimé, aucune trace laissée, code de sortie 1.

### Garde de sécurité de `test-restore-backup.sh`

```
$ TEST_DB_URL="postgres://postgres:...@db.dcsnmvbtsmdbwrwbutph.supabase.co:5432/postgres" \
  bash scripts/test-restore-backup.sh backups/xxx.sql
[test-restore] ERROR: TEST_DB_URL targets db.dcsnmvbtsmdbwrwbutph.supabase.co, which
  matches the production host in .env.local. Refusing to run.
EXIT: 1
```
✅ Confirmé : le script refuse de cibler la production, avant même de vérifier si `psql` est disponible.

```
$ TEST_DB_URL="postgres://postgres:...@127.0.0.1:5433/postgres" \
  bash scripts/test-restore-backup.sh backups/xxx.sql
[test-restore] ERROR: psql is not available on PATH in this environment...
EXIT: 1
```
✅ Confirmé : une cible non-production passe la garde de sécurité et échoue ensuite pour la vraie raison (outillage manquant), pas une fausse alerte de sécurité.

---

## Ce qui n'a PAS été vérifié dans cet environnement

- **Aucun dump réel de la base de production** n'a été généré (Docker requis par `supabase db dump`, indisponible ici — confirmé à nouveau : `docker: command not found`).
- **Aucune restauration réelle** testée (`psql` indisponible).
- Les seuils par défaut (`BACKUP_MIN_TABLES=35`, `BACKUP_MIN_FUNCTIONS=90`, `BACKUP_MIN_TRIGGERS=15`, `BACKUP_MIN_POLICIES=50`) sont calibrés à partir d'un comptage des migrations (`grep` sur `supabase/migrations/*.sql`, ~45 tables/~152 fonctions/~30 triggers/62 policies observées sur l'ancien dump schéma-seul) — **jamais confirmés contre un dump réellement complet**, puisqu'aucun n'a pu être produit ici. À revalider dès qu'un vrai dump complet existe.

---

## Recommandation pour obtenir une validation complète

1. Exécuter `npm run db:backup` depuis un poste où Docker fonctionne réellement (voir `docs/BACKUP_SYSTEM_AUDIT_REPORT.md`).
2. Si le script s'arrête avec une erreur de seuil (peu probable mais possible si les vraies valeurs diffèrent de mes estimations), ajuster les variables `BACKUP_MIN_*` en connaissance de cause plutôt que de les supprimer.
3. Exécuter `npm run db:test-restore` contre une base temporaire réelle (Docker Postgres local, `supabase start`, ou instance jetable) pour obtenir, cette fois, une preuve réelle de restaurabilité — pas seulement une preuve de la logique du script.
4. Une fois ces deux étapes réussies pour de vrai, ce rapport pourra passer à 🟢 et le Go Live des migrations de paiement (`docs/PAYMENT_POST_INCIDENT_GO_LIVE_REPORT.md`) pourra reprendre à la Phase 1 (vérification de sauvegarde).

---

## Verdict

**🟡 Outillage corrigé, prouvé correct par des tests synthétiques rigoureux — mais pas encore validé contre une vraie sauvegarde de production, faute de Docker/psql dans cet environnement.** Ne pas considérer ce point comme définitivement clos tant que l'Étape 1 ci-dessus n'a pas été rejouée avec succès sur un vrai dump.
