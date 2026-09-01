# NK Deliveri — Backup Checklist (v1.0)

**⚠️ Constat vérifié en direct le 2026-08-01** (`supabase --experimental backups list --project-ref dcsnmvbtsmdbwrwbutph`) :

```json
{ "pitr_enabled": false, "backups": [] }
```

**Aucun PITR et aucune sauvegarde automatique Supabase n'existe actuellement.** `docs/BACKUP_RESTORE.md` (existant) affirme que "tout projet Supabase sur un plan payant bénéficie de sauvegardes automatiques quotidiennes" — c'est vrai en général, mais **ne correspond pas à l'état réel de ce projet aujourd'hui**, confirmé par requête directe plutôt que supposé. Ce document doit être mis à jour ou le projet doit être passé sur un plan qui inclut PITR/backups avant que l'affirmation redevienne exacte. C'est le point Élevé le plus urgent de `RELEASE_V1_AUDIT_REPORT.md` § 6/§ 9.

## 1. État actuel (ne pas supposer, vérifier avant chaque action)

- [ ] Reconfirmer l'état PITR/backups avant le Go-Live : `supabase --experimental backups list --project-ref dcsnmvbtsmdbwrwbutph`
- [ ] Vérifier le plan Supabase actuel (Dashboard → Settings → Billing) — le PITR/backups automatiques nécessitent un plan payant avec l'add-on activé, pas seulement "payant"

## 2. Sauvegarde manuelle (ligne de défense actuelle, la seule qui existe)

- [ ] Avant **toute** migration non triviale : `npm run db:backup` (schéma + données, via `supabase db dump`)
- [ ] Avant toute opération de maintenance risquée (script de correction de données en masse, par exemple) : idem
- [ ] Le fichier produit (`backups/full_<timestamp>.sql`) est **local et gitignoré** — il doit être copié manuellement vers un stockage durable après chaque sauvegarde importante (S3/GCS/bucket dédié hors-projet — voir `docs/BACKUP_RESTORE.md` § "Où stocker les dumps manuels")
- [ ] Vérifier la taille du fichier produit n'est pas anormalement petite (dump vide = échec silencieux de connexion)

## 3. Storage (buckets)

Aucun mécanisme de sauvegarde automatique des 8 buckets Storage n'a été trouvé dans le code de ce projet (recherché : aucun script `backup` référençant `storage.objects` ou une API Storage). Les fichiers dans `payment-proofs`, `payout-proofs`, `driver-documents`, `dispute-attachments` sont des preuves potentiellement nécessaires en cas de litige — leur perte serait more grave que la perte de lignes DB recréables.

- [ ] Décision à prendre : mettre en place une réplication/sauvegarde des buckets (ex. `rclone` planifié vers un stockage externe) avant le Go-Live ou l'accepter comme risque résiduel documenté pour la v1.0
- [ ] À défaut de sauvegarde automatique, documenter qu'un incident de perte de Storage est actuellement irrécupérable

## 4. Configuration et secrets

- [ ] Les 113 migrations SQL constituent déjà la sauvegarde de schéma de référence (append-only, dans Git) — pas d'action requise ici, c'est déjà correct
- [ ] Les secrets Vercel (`MONCASH_*`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, VAPID) ne sont sauvegardés nulle part hors du Dashboard Vercel lui-même — recommandé : conserver une copie chiffrée hors-Vercel (coffre-fort d'équipe) pour ne pas dépendre uniquement de l'accès Vercel en cas d'incident de compte

## 5. Test de restauration (jamais fait à ce jour dans ce projet — recommandé avant Go-Live)

- [ ] Exécuter au moins une fois `scripts/restore-database.sh` contre une base de test (jamais contre la prod pour un test) pour confirmer que la procédure fonctionne réellement, pas seulement en théorie
- [ ] Documenter le temps réel de restauration observé (RTO) — actuellement non mesuré

## 6. Fréquence recommandée (jusqu'à activation du PITR)

- [ ] Sauvegarde manuelle quotidienne a minima tant qu'aucune automatisation n'existe (peut être planifiée via GitHub Actions puisque le cron applicatif Vercel est déjà saturé à 1 job/jour sur le plan Hobby)
- [ ] Sauvegarde manuelle systématique immédiatement avant tout Go-Live (voir `GO_LIVE_CHECKLIST.md` § T-60 min)
