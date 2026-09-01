# NK Deliveri — Release Checklist (v1.0)

Référence : `docs/RELEASE_V1_AUDIT_REPORT.md`. À cocher dans l'ordre, avant de déclencher Commit → Push → Déploiement.

## 1. Décisions bloquantes (§ 19 de l'audit)

- [ ] Décision prise sur la sauvegarde/PITR (H-1 infra) — voir `BACKUP_CHECKLIST.md`
- [ ] Décision prise sur la sémantique de `moncash_api.is_active` (H-1 sécurité)
- [ ] Décision prise sur la migration Finance Dashboard (appliquer ou reporter)
- [ ] Décision prise sur le grant `anon` systémique (accepter le risque documenté ou remédier)
- [ ] Décision prise sur l'adoption du moteur de notifications (migrer les 32 sites restants ou accepter)

## 2. Code

- [ ] `npm run verify` vert (`typecheck` + `lint` + `check:migrations` + `test` + `build`)
- [ ] `git status` propre côté fichiers non intentionnels (pas de `.env*` réel, pas de `backups/`)
- [ ] Aucun `TODO`/`FIXME`/`console.log` réintroduit depuis le dernier audit (`grep -rn "TODO\|FIXME\|console\.log" src/ supabase/`)
- [ ] Chantiers en attente identifiés explicitement acceptés ou exclus : Finance Dashboard (4 fichiers front + 1 migration), suite E2E (`e2e/`, `playwright.config.ts`)

## 3. Base de données

- [ ] Sauvegarde manuelle prise juste avant toute application de migration (`npm run db:backup`)
- [ ] Migration(s) à appliquer listée(s) explicitement et validée(s) une par une (jamais de `supabase db push` en aveugle — voir mémoire projet "never push migrations")
- [ ] Script transactionnel `BEGIN...ROLLBACK` exécuté contre la prod pour toute migration non triviale avant application réelle
- [ ] `npm run check:migrations` vert après ajout de toute nouvelle migration

## 4. Secrets et configuration

- [ ] Toutes les variables `MONCASH_*` confirmées présentes (ou volontairement absentes) sur Vercel Production selon la décision § 19.2
- [ ] `CRON_SECRET` confirmé configuré sur Vercel (sinon le cron répond 500)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` confirmée non exposée côté client (jamais de préfixe `VITE_`)
- [ ] DSN Sentry confirmé configuré ou son absence explicitement actée (Monitoring § 12 de l'audit)

## 5. Tests

- [ ] Suite Vitest (`npm run test`) verte
- [ ] Si la suite E2E est incluse dans la release : `npm run build:e2e && npm run test:e2e` — chaque projet lancé isolément (contention de ressources documentée en full-suite, voir `docs/E2E_TEST_REPORT.md`)
- [ ] Test manuel du parcours MonCash Collect en conditions réelles si des secrets ont changé

## 6. Documentation

- [ ] `docs/RELEASE_V1_AUDIT_REPORT.md` lu et accepté
- [ ] `docs/RELEASE_NOTES_v1.0.md` et `docs/CHANGELOG.md` à jour avec le contenu réellement livré
- [ ] Ce checklist entièrement coché avant de passer à `GO_LIVE_CHECKLIST.md`

## 7. Autorisation finale

- [ ] Validation explicite de l'utilisateur obtenue pour chaque item de la section 1 avant tout commit/push
- [ ] Aucune action destructive (force-push, reset --hard, suppression de migration) envisagée sans confirmation séparée
