# Runbook de déploiement — Module MonCash

Guide opérationnel pour appliquer les 4 migrations MonCash restantes
(`20260730110000`, `20260730120000`, `20260730130000`,
`20260731100000`) en production. Suit exactement les conventions déjà
établies dans [MIGRATIONS.md](./MIGRATIONS.md) et
[BACKUP_RESTORE.md](./BACKUP_RESTORE.md) — rien de nouveau n'est
inventé ici, ce document assemble ces procédures existantes dans l'ordre
spécifique à ce module. Voir
[MONCASH_PRODUCTION_READINESS_AUDIT.md](./MONCASH_PRODUCTION_READINESS_AUDIT.md)
pour le constat qui motive ce runbook (état réel de la base vérifié le
2026-07-31).

**Ce runbook ne couvre que le schéma/RPC.** Aucune des 4 migrations
n'active le canal MonCash Automatik lui-même — cela reste un geste
séparé, volontaire, documenté en fin de ce runbook (§ Après déploiement)
et dans [PAYMENT_PROVIDERS.md](./PAYMENT_PROVIDERS.md).

## Pré-déploiement

### 1. Sauvegarde

```bash
npm run db:backup   # schéma + données, voir docs/BACKUP_RESTORE.md
```

Copier immédiatement le fichier produit (`backups/full_<timestamp>.sql`)
vers un stockage durable — `backups/` local n'en est pas un. Avec
0 ligne dans `wallets`/`payouts` aujourd'hui (vérifié dans l'audit), le
risque de perte de données réelles est nul actuellement, mais **cette
étape reste obligatoire par principe** : elle protège aussi contre une
erreur affectant `notifications`/`audit_log`, qui contiennent, eux,
de vraies données.

### 2. Vérification Supabase

- [ ] Confirmer le projet lié : `npx supabase status` (ou
  `npx supabase link --project-ref dcsnmvbtsmdbwrwbutph` si nécessaire).
- [ ] Confirmer que les sauvegardes automatiques Supabase sont actives
  (Dashboard → Database → Backups) — ligne de défense principale, voir
  BACKUP_RESTORE.md.
- [ ] `npx supabase db query --linked "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"`
  — confirmer que la dernière version connue est bien `20260730100000`
  avant de commencer (sinon, cet audit et ce runbook sont potentiellement
  obsolètes — refaire l'audit § 1.1 d'abord).

### 3. Vérification Vercel

- [ ] Confirmer que le dernier déploiement Production correspond au
  commit `main` attendu (Vercel Dashboard → Deployments).
- [ ] Aucune action Vercel n'est requise pour ces 4 migrations
  spécifiquement (elles ne touchent aucune variable d'environnement) —
  seulement s'assurer qu'aucun déploiement concurrent n'est en cours.

### 4. Variables d'environnement et secrets

Aucune des 4 migrations ne requiert de nouvelle variable
d'environnement. **Ne pas confondre avec l'activation du canal MonCash
Automatik** (5 variables `MONCASH_*`, voir
[PAYMENT_PROVIDERS.md](./PAYMENT_PROVIDERS.md#gestion-des-secrets-moncash))
— hors périmètre de ce déploiement, à traiter séparément et seulement
après confirmation du contrat B2C avec Digicel.

- [ ] `npx vercel env ls production | grep MONCASH` → doit rester vide
  (confirmé vide au moment de l'audit) ; si des valeurs apparaissent
  avant ce déploiement, s'assurer qu'elles ne changent pas le
  comportement attendu (`payment_providers.moncash_api.is_active` reste
  `false` tant que personne ne l'active manuellement — § Après
  déploiement).

## Déploiement

**Ordre exact — ne jamais permuter.** Voir
MONCASH_PRODUCTION_READINESS_AUDIT.md § 3 pour la justification de
dépendance de 110000→120000→130000 ; `20260731100000` (correctif R1)
est indépendante et peut être appliquée à n'importe quel moment de la
séquence, placée ici en dernier par simplicité.

```
Migration 1 : 20260730110000_log_payment_provider_error.sql
        ↓
   Tests (voir ci-dessous)
        ↓
Migration 2 : 20260730120000_moncash_provider_notifications.sql
        ↓
   Tests
        ↓
Migration 3 : 20260730130000_moncash_financial_audit_log.sql
        ↓
   Tests
        ↓
Migration 4 : 20260731100000_revoke_anon_create_pending_payout.sql
        ↓
   Tests
        ↓
   Validation finale
```

`supabase db push` n'a pas d'option pour cibler un seul fichier — il
applique toujours tout ce qui n'est pas encore dans
`supabase_migrations.schema_migrations` (vérifié : `--help` ne propose
que `--dry-run`/`--include-all`, rien de plus fin). Pour respecter
l'ordre migration-par-migration avec tests entre chaque, isoler
temporairement les fichiers pas encore voulus, plutôt que d'exécuter le
SQL hors du mécanisme de suivi (qui laisserait la table de suivi
incohérente avec la réalité) :

```bash
# Avant Migration 1 : déplacer temporairement 120000/130000/100000(R1)
# hors du dossier suivi
mkdir -p supabase/migrations-staging
mv supabase/migrations/20260730120000_moncash_provider_notifications.sql \
   supabase/migrations/20260730130000_moncash_financial_audit_log.sql \
   supabase/migrations/20260731100000_revoke_anon_create_pending_payout.sql \
   supabase/migrations-staging/

# Appliquer seulement 20260730110000 (le seul fichier restant dans migrations/)
npx supabase db push --linked --dry-run   # relire ce qui va s'exécuter
npx supabase db push --linked

# Vérifier immédiatement
npx supabase db query --linked "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1;"
# → doit afficher 20260730110000

# Tests (voir ci-dessous) — puis ramener le fichier suivant avant de répéter
mv supabase/migrations-staging/20260730120000_moncash_provider_notifications.sql supabase/migrations/
```

Répéter le cycle *ramener 1 fichier → `--dry-run` → `db push` → vérifier
la version → tests* pour chacune des 3 migrations restantes, dans
l'ordre. `supabase/migrations-staging/` ne doit jamais être commité —
purement un espace de manœuvre local pendant le déploiement, vide une
fois les 4 fichiers ramenés à leur place dans `supabase/migrations/`.

### Tests après Migration 1 (`log_payment_provider_error_secure`)

```bash
npm run check:migrations   # doit rester vert
```

- [ ] `npx supabase db query --linked "SELECT proname FROM pg_proc WHERE proname='log_payment_provider_error_secure';"` → 1 ligne.
- [ ] Test transactionnel rolled-back (voir gabarit
  `docs/MONCASH_TEST_REPORT.md` § Tests transactionnels) : appeler la
  fonction avec un compte admin simulé, confirmer l'écriture dans
  `audit_log`, `ROLLBACK`.

### Tests après Migration 2 (notify_secure + `log_payment_provider_error_secure` +1 param)

- [ ] Relire la définition live de `complete_pending_payout_secure` :
  `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='complete_pending_payout_secure';`
  — confirmer qu'elle appelle désormais `private.notify_secure`, plus
  `INSERT INTO notifications` brut.
- [ ] Rejouer les groupes A/B du script transactionnel de
  `MONCASH_TEST_REPORT.md`, en ajoutant une vérification sur le `type`
  de la notification créée (`payout_provider_sent`/
  `payout_provider_confirmed`/`payout_provider_admin_success` au lieu de
  `payout_paid`).
- [ ] `npm test` (suite Vitest, contre le code, indépendante de l'état
  de la base — doit rester vert avant/après, sert de garde-fou).

### Tests après Migration 3 (`moncash_api_logs` + triggers)

- [ ] `npx supabase db query --linked "SELECT count(*) FROM information_schema.tables WHERE table_name='moncash_api_logs';"` → 1.
- [ ] **Test critique** : dans une transaction rolled-back, insérer une
  ligne de test dans `moncash_api_logs`, puis tenter un `DELETE`/`UPDATE`
  dessus — confirmer que `private.prevent_log_mutation()` lève bien une
  exception (`ERRCODE 42501`) avant le `ROLLBACK`.
- [ ] Confirmer que `moncash_webhook_events` accepte toujours son
  `UPDATE` de cycle de vie (`processing`→`processed`) — ne doit **pas**
  être bloqué par le nouveau trigger (seul `DELETE`/`TRUNCATE` le sont).

### Tests après Migration 4 (correctif R1)

- [ ] `npx supabase db query --linked "SELECT grantee FROM information_schema.role_routine_grants WHERE routine_name='create_pending_payout_secure';"`
  → ne doit plus contenir `anon`.
- [ ] Confirmer que `authenticated` a toujours son `GRANT` (l'admin doit
  toujours pouvoir appeler la fonction).

### Validation finale

- [ ] `npm run verify` en local (typecheck + lint + check:migrations +
  test + build) — doit rester vert, confirme que le code déployé
  (`main`) reste cohérent avec le nouveau schéma.
- [ ] Régénérer les types : `npx supabase gen types typescript --linked --schema public,private > src/integrations/supabase/types.ts`
  puis `git diff` — le diff attendu doit être **vide ou quasi-vide**
  (les types ont déjà été mis à jour à la main dans le code présent sur
  `main`, en anticipation de cette application — voir la convention
  "jamais de `supabase db push`" du projet). Un diff non trivial signale
  un écart à investiguer avant de continuer.

## Après déploiement — contrôles

- [ ] **Wallets** : `SELECT count(*) FROM wallets;` — doit rester
  identique à avant (aucune des 4 migrations ne touche `wallets`).
- [ ] **Notifications** : créer une notification de test via une action
  bénigne existante (ex. déclencher un `payout_disputed` déjà en place)
  et confirmer qu'elle apparaît normalement dans `/notifications` — les
  ~15 sites d'appel préexistants ne sont touchés par aucune de ces
  migrations, donc aucune régression attendue, à vérifier une fois.
- [ ] **MonCash** : `/dashboard/admin/moncash` se charge sans erreur,
  affiche "Non" pour "Aktive nan sistèm nan" et "Non" pour "Konfigire
  sou sèvè a" (état attendu — rien n'a été activé).
- [ ] **Logs** : `moncash_api_logs` reste vide (aucun appel API n'a
  encore de raison de se produire) — confirme que le canal reste inerte,
  pas un signe d'échec.
- [ ] **Webhooks** : `curl -X POST https://www.nkdeliveri.com/api/webhooks/moncash -d '{}'`
  → doit répondre `401` (signature invalide/absente) — confirme que la
  route répond et rejette correctement, sans jamais avoir besoin d'un
  vrai webhook MonCash pour ce contrôle.
- [ ] **Dashboard Admin** : parcourir `/dashboard/admin/payouts`,
  ouvrir la modale de paiement sur un bénéficiaire test, confirmer que
  le sélecteur "Kanal peman" affiche toujours les 3 options (MonCash
  Automatik grisée "byento", MonCash Manyèl et NatCash Manyèl actives)
  et que le flux manuel fonctionne de bout en bout sans changement de
  comportement.
