# NK Deliveri — Runbook (v1.0)

Procédures opérationnelles courantes. Pour l'architecture, voir `ARCHITECTURE_V1.md` ; pour un incident, voir `INCIDENT_RESPONSE.md`.

## Déploiement

```bash
npm run verify          # typecheck + lint + check:migrations + test + build
git push origin main    # déclenche le déploiement Vercel automatique
```

Voir `RELEASE_CHECKLIST.md` et `GO_LIVE_CHECKLIST.md` pour la procédure complète encadrée.

## Appliquer une migration

**Jamais en aveugle.** Convention établie de ce projet :

1. Écrire la migration dans `supabase/migrations/<timestamp>_<nom>.sql` (append-only, jamais modifier une migration déjà appliquée).
2. Valider en transactionnel contre la production, sans effet permanent :
   ```sql
   BEGIN;
   -- coller le SQL de la migration ici
   -- puis des assertions de contrôle dans une table temporaire _test_results
   ROLLBACK;  -- jamais COMMIT dans ce script de validation
   ```
3. Uniquement après confirmation explicite de l'utilisateur, appliquer réellement (Dashboard Supabase SQL Editor, ou `supabase db push` **jamais sans validation préalable par fichier**).
4. Si la migration ajoute une RPC : mettre à jour `src/integrations/supabase/types.ts` et relancer `npm run typecheck`.

## Interroger la base de production en lecture seule

```bash
supabase db query --file <fichier.sql> --linked -o json
```

`--linked` cible le projet lié (`dcsnmvbtsmdbwrwbutph`) — vérifier `supabase projects list` en cas de doute sur le projet actif.

## Sauvegarde manuelle

```bash
npm run db:backup                    # schéma + données
npm run db:backup -- --schema-only   # schéma seul
```

Fichier produit dans `backups/` (gitignoré) — copier vers un stockage durable après toute sauvegarde importante. Voir `BACKUP_CHECKLIST.md`.

## Restauration

```bash
SUPABASE_DB_URL="postgres://postgres:<password>@<host>:5432/postgres" \
  npm run db:restore -- backups/full_<timestamp>.sql --confirm
```

Ne jamais exécuter contre la production sans confirmation explicite préalable — écrase les données survenues depuis le dump.

## Vérifier l'état MonCash

- Dashboard : `/dashboard/admin/moncash` (statut, historique, erreurs, événements webhook).
- Requête directe (lecture seule) :
  ```sql
  select provider_code, status, count(*)
  from payment_transactions
  where created_at > now() - interval '24 hours'
  group by 1, 2;
  ```

## Vérifier le cron de réconciliation MonCash

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://www.nkdeliveri.com/api/cron/moncash-reconcile
```

Réponse attendue tant que le décaissement MonCash n'est pas activé : `{"candidates": 0}`.

## Lancer la suite de tests

```bash
npm run test              # Vitest, unitaire
npm run typecheck
npm run lint
npm run check:migrations  # détecte les hazards de migration (ex. DROP sans garde)
```

## Lancer la suite E2E (jamais contre la production — mock complet du réseau)

```bash
npm run build:e2e
npm run test:e2e            # tous les projets — contention de ressources possible, voir E2E_TEST_REPORT.md
npx playwright test --project=client   # un projet isolé, 100% fiable
npm run test:e2e:report
```

## Gérer les rôles d'un utilisateur

Jamais de `UPDATE user_roles` direct en dehors du RPC dédié :

```sql
select public.has_role('<user_id>'::uuid, 'admin'::app_role);  -- vérifier avant d'agir
```

Attribution/retrait de rôle : passer par l'UI admin (`/dashboard/admin/users`) qui appelle les RPC dédiées — elles portent la journalisation d'audit (`private.log_audit_event`) qu'un `UPDATE` direct ne produirait pas.

## Nettoyage local

```bash
npm run clean   # scripts/clean.mjs
```
