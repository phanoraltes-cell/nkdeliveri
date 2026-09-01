# Checklist de mise en production — Module MonCash

Actions dans l'ordre. Chaque case correspond à un constat vérifié dans
[MONCASH_FINAL_PRODUCTION_VALIDATION.md](../archive/moncash/MONCASH_FINAL_PRODUCTION_VALIDATION.md).
Aucune de ces actions n'a été effectuée par cette session
(contraintes : pas de migration appliquée, pas de commit, pas de push).

## 0. Revue

- [ ] Relire `git diff` / les fichiers non commités listés en fin de
      session précédente — confirmer que chaque changement est voulu.
- [ ] Décider du sort de la recommandation #7 (18 fonctions hors
      MonCash sans `notify_secure`) — aucune action requise, mais à
      trancher explicitement pour ne pas revenir dessus par surprise.

## 1. Commit + push

- [ ] `git add`/`git commit` (exclure `.claude/settings.json`,
      `supabase/.temp/cli-latest`, convention déjà établie).
- [ ] `git push origin main`.

## 2. Secrets Vercel (avant ou en même temps que le déploiement)

- [ ] `CRON_SECRET` — générer (`openssl rand -hex 32`), ajouter en
      Production sur Vercel.
- [ ] `MONCASH_CLIENT_ID`/`MONCASH_CLIENT_SECRET`/`MONCASH_MERCHANT_ID`/
      `MONCASH_API_URL`/`MONCASH_WEBHOOK_SECRET` — **seulement une fois
      le contrat B2C confirmé avec Digicel** (bloquant externe,
      inchangé). Ne pas les ajouter avant, ça n'activerait rien mais
      autant respecter l'ordre logique.

## 3. Migrations (ordre strict, jamais en parallèle)

- [ ] `20260730110000_log_payment_provider_error.sql`
- [ ] `20260730120000_moncash_provider_notifications.sql`
- [ ] `20260730130000_moncash_financial_audit_log.sql`
- [ ] `20260731100000_revoke_anon_create_pending_payout.sql`

Après chaque migration : `npx supabase db push --linked --dry-run`
d'abord, confirmer le diff attendu, puis appliquer. Ne jamais appliquer
la suivante avant d'avoir confirmé la précédente (voir
MONCASH_DEPLOYMENT_RUNBOOK.md pour le détail).

**Ordre migrations vs déploiement code** : les migrations doivent être
appliquées **avant** que le code du dashboard étendu (qui interroge
`moncash_api_logs`) ne soit servi en production — sinon cette section
du dashboard échoue à l'exécution (constat Phase 7). Comme le push Git
(étape 1) déploie tout en une fois via Vercel, appliquer les migrations
**avant** l'étape 1 dans l'ordre réel d'exécution, ou accepter une
fenêtre où le dashboard affiche une erreur sur cette section précise
jusqu'à l'application des migrations.

## 4. Régénérer les types

- [ ] `npx supabase gen types typescript --linked --schema public,private > src/integrations/supabase/types.ts`
      — puis `npm run verify` pour confirmer qu'aucun écart entre le
      code et le schéma réel n'est apparu.

## 5. Vérification post-déploiement

- [ ] `GET /api/cron/moncash-reconcile` sans en-tête → attendre `401`
      (pas `404`).
- [ ] `POST /api/webhooks/moncash` avec un corps vide → toujours `401`.
- [ ] `/dashboard/admin/moncash` → la section "Jounal apèl API" doit se
      charger sans erreur (confirme que `moncash_api_logs` existe bien).
- [ ] Vercel Dashboard → Project → Cron Jobs → confirmer l'entrée
      `moncash-reconcile` apparaît avec le bon horaire.
- [ ] Re-exécuter le correctif R1 :
      `sql
SELECT grantee FROM information_schema.routine_privileges
WHERE routine_name = 'create_pending_payout_secure' AND grantee = 'anon';
`
      doit retourner **0 ligne** après l'étape 3.

## 6. Ce qui reste bloquant indépendamment de tout ce qui précède

- [ ] Confirmation écrite du contrat B2C MonCash avec Digicel — sans
      ça, `payment_providers.moncash_api.is_active` doit rester `false`
      quel que soit l'état des étapes 1-5 ci-dessus. Rien dans cette
      checklist ne doit être interprété comme une autorisation à
      l'activer.

## Ce que cette checklist ne couvre pas

- L'activation réelle de MonCash Automatik (`is_active = true`) —
  volontairement hors de cette checklist, geste séparé et délibéré
  décrit dans PAYMENT_PROVIDERS.md § Procédure de configuration,
  conditionné au point 6 ci-dessus.
- Toute vérification nécessitant un accès direct au dashboard Vercel
  (plan/quotas exacts) — non vérifiable depuis cette session, à
  confirmer manuellement.
