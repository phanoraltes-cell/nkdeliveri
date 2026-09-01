# NK Deliveri — Rollback Checklist (v1.0)

Deux catégories de rollback, distinctes et à ne pas confondre : rollback **applicatif** (code/déploiement Vercel) et rollback **base de données** (migration). Le premier est réversible en quelques minutes ; le second ne l'est jamais complètement — voir § 2.

## 1. Rollback applicatif (Vercel)

Déclencheur : erreur 500 sur une route critique, régression visuelle bloquante, build cassé silencieusement passé en prod.

- [ ] Identifier le dernier déploiement `Ready` connu-bon dans le Dashboard Vercel (`nk-delivery/nkdelivery`)
- [ ] Utiliser "Promote to Production" sur ce déploiement précédent (Vercel conserve chaque déploiement immutable — pas besoin de revert Git pour un rollback rapide)
- [ ] Confirmer que le rollback n'implique aucune migration DB déjà appliquée qui serait incompatible avec l'ancien code (voir § 3, "Rollback partiel impossible")
- [ ] Re-exécuter les smoke tests de `GO_LIVE_CHECKLIST.md` § T+0 contre la version restaurée
- [ ] Une fois stabilisé, revert le commit fautif dans Git (`git revert`, jamais `git reset --hard` sur `main` partagé) pour que le prochain déploiement ne le réintroduise pas

## 2. Rollback base de données (migration)

**Ce projet n'a pas de migrations "down" — toutes les migrations sont append-only par convention établie.** Un rollback de schéma signifie systématiquement écrire et appliquer une **nouvelle** migration corrective, jamais annuler la précédente.

- [ ] Ne jamais `DROP`/modifier directement une migration déjà appliquée
- [ ] Écrire une migration corrective explicite (`supabase/migrations/<timestamp>_revert_<nom>.sql`)
- [ ] Si la migration fautive a déjà écrit des données de production (pas seulement du schéma) : évaluer si un correctif de données (`UPDATE`/`DELETE` ciblé, avec `WHERE` précis) suffit, ou si une restauration complète depuis sauvegarde est nécessaire (voir `BACKUP_CHECKLIST.md`)
- [ ] Toute migration corrective validée en transactionnel (`BEGIN...ROLLBACK`) contre la prod avant application réelle, comme toute migration normale
- [ ] Ne jamais restaurer un dump complet sans confirmation explicite de l'utilisateur — une restauration écrase les commandes/paiements survenus depuis le dump (voir `scripts/restore-database.sh`, refuse déjà de s'exécuter sans `SUPABASE_DB_URL` explicite)

## 3. Cas particulier — rollback pendant une fenêtre de paiement actif

Si un rollback est nécessaire pendant que des paiements MonCash sont en vol (statut `pending`) :

- [ ] **Ne jamais** rollback le code sans vérifier d'abord l'état des `payment_transactions`/`payouts` en `pending` — un rollback de code qui change la forme attendue d'un webhook peut faire échouer la confirmation d'un paiement déjà débité côté client
- [ ] Laisser les webhooks MonCash continuer à être traités (ne pas couper le endpoint) même pendant un rollback de l'UI
- [ ] Réconcilier manuellement après coup via `dashboard.admin.moncash.tsx` tout paiement resté en `pending` anormalement longtemps

## 4. Communication

- [ ] Toute décision de rollback en production est confirmée avec l'utilisateur avant exécution, sauf incident actif avec perte de données en cours (voir `INCIDENT_RESPONSE.md` pour le seuil d'urgence)
- [ ] Documenter le rollback (raison, heure, commit/migration concernés) dans un post-mortem court, même si l'incident est mineur
