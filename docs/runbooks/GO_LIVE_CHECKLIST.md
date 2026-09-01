# NK Deliveri — Go-Live Checklist (v1.0)

À exécuter le jour du déploiement, dans l'ordre. Chaque étape suppose que `RELEASE_CHECKLIST.md` est entièrement coché.

## T-60 min — Avant le déploiement

- [ ] Sauvegarde manuelle fraîche prise (`npm run db:backup`) et copiée hors de la machine locale (voir `BACKUP_CHECKLIST.md` — le script écrit uniquement en local, `backups/` est gitignoré)
- [ ] `supabase projects list` confirme le projet lié est bien `dcsnmvbtsmdbwrwbutph` (jamais un autre projet par erreur)
- [ ] Dernière build locale (`npm run build`) verte
- [ ] Vérifier l'état du cron MonCash (`GET /api/cron/moncash-reconcile` avec le bon `CRON_SECRET`) pour confirmer qu'il répond avant le déploiement

## T-30 min — Migrations (si applicable)

- [ ] Migration(s) validées appliquées une par une via le tableau de bord Supabase ou `supabase db push` **uniquement après confirmation explicite de l'utilisateur pour chaque fichier** (jamais en lot silencieux — cf. mémoire projet)
- [ ] Après chaque migration : requête de contrôle rapide confirmant que les nouvelles fonctions/tables existent et répondent (`SELECT proname FROM pg_proc WHERE proname = '...'`)
- [ ] `npm run typecheck` relancé si `src/integrations/supabase/types.ts` a été mis à jour manuellement en anticipation de la migration

## T-15 min — Déploiement

- [ ] `git push` vers `main` (déclenche le déploiement Vercel automatique — confirmer qu'aucun autre déploiement n'est en cours)
- [ ] Suivre le build Vercel jusqu'à `Ready`
- [ ] Confirmer que le commit déployé correspond exactement au commit poussé (`vercel ls` ou dashboard Vercel — hash de commit visible)

## T+0 — Smoke tests en production

- [ ] `https://www.nkdeliveri.com/` charge (200, pas d'erreur console bloquante)
- [ ] `https://www.nkdeliveri.com/restaurants` charge et liste au moins un restaurant approuvé
- [ ] Connexion réussie sur chacun des 4 rôles (client/restaurant/livreur/admin) avec un compte réel
- [ ] `/dashboard` redirige vers le bon dashboard par rôle
- [ ] Si MonCash Collect a changé : un paiement de test réel (petit montant) confirmé de bout en bout, webhook reçu, statut mis à jour
- [ ] `/api/cron/moncash-reconcile` répond toujours correctement après déploiement
- [ ] `/sitemap.xml` et `/robots.txt` répondent 200
- [ ] Service worker s'enregistre correctement (DevTools → Application → Service Workers, statut "activated")
- [ ] Aucune erreur nouvelle dans les logs Vercel dans les 10 minutes suivant le déploiement

## T+30 min — Surveillance rapprochée

- [ ] Dashboard admin principal ouvert et surveillé (commandes live)
- [ ] Dashboard MonCash ouvert et surveillé manuellement (pas d'alerting push, voir `MONITORING_CHECKLIST.md`)
- [ ] Aucune erreur 5xx anormale dans les logs Vercel

## Critères de rollback immédiat

Voir `ROLLBACK_CHECKLIST.md` — déclencher sans hésiter si : paiement MonCash cassé pour un utilisateur réel, erreur 500 sur une route critique (`/checkout`, `/auth`, `/dashboard/*`), migration ayant corrompu des données constatée.

## Clôture

- [ ] `docs/RELEASE_NOTES_v1.0.md` publié/partagé
- [ ] Rapport de Go-Live rédigé si un incident est survenu (même mineur) — voir `INCIDENT_RESPONSE.md`
