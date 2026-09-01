# Phase 2 — Dashboard Financier — Rapport de Vérification

## Découverte préalable importante

Avant toute action, la validation transactionnelle habituelle (`BEGIN...ROLLBACK`) a échoué avec `ERROR: 42723: function "get_admin_finance_overview_secure" already exists` — **les 3 RPC existaient déjà en production**, avec des définitions **identiques au caractère près** au fichier `supabase/migrations/20260731140000_admin_finance_dashboard_rpcs.sql` (confirmé par comparaison directe du texte source). En revanche, cette version n'apparaissait pas dans `supabase_migrations.schema_migrations` (seules `20260731100000` et `20260731130000` y figuraient) — la migration avait donc été appliquée directement en base (méthode établie de ce projet, qui n'utilise jamais `supabase db push`) mais jamais enregistrée dans le suivi, et jamais commitée dans Git.

**Action prise** : réconciliation du suivi — insertion d'une ligne dans `supabase_migrations.schema_migrations` pour la version `20260731140000` (9 instructions, découpées et vérifiées statement par statement avant exécution), reflétant l'état réel déjà en place. Aucune fonction n'a été recréée ; aucune donnée modifiée.

## Vérifications effectuées

### Migration SQL

✅ Contenu confirmé identique entre le fichier local et l'état vivant de la production (lecture directe de `pg_get_functiondef` sur les 3 fonctions).

### RPC

✅ `get_admin_finance_overview_secure(NULL, NULL)` — exécuté en direct comme admin réel (`SET LOCAL role authenticated` + `request.jwt.claim.sub`), retourne les 12 colonnes attendues, valeurs à 0 cohérentes avec le volume de données actuel (échelle dev).
✅ `get_admin_finance_history_secure()` — exécuté, retourne 2 lignes (`total_count = 2`), cohérent avec le volume réel.
✅ `get_order_financial_timeline_secure(<première commande>)` — exécuté, retourne 2 lignes.

### Permissions

✅ `anon` **effectivement bloqué** — testé en direct (`SET LOCAL role anon` + appel réel, pas une simulation) : `ERROR: 42501: permission denied for function get_admin_finance_overview_secure`. Ces 3 fonctions font partie de la minorité (14/94) correctement verrouillées au niveau privilège DB (`REVOKE ALL ... FROM PUBLIC, anon` explicite dans le fichier), pas seulement protégées par la vérification de rôle interne.
✅ `authenticated` + rôle admin réel : fonctionne comme attendu.

### Index

✅ Toutes les colonnes de jointure/filtre principales sont déjà indexées : `commission_ledger(order_id, restaurant_id, driver_id, created_at)`, `payouts(restaurant_id, driver_id, created_at, status)`, `payout_commissions(commission_ledger_id, payout_id)`, `moncash_webhook_events(transaction_reference)`, `payments(order_id)`.
⚠️ **Observation, non bloquante** : `payments(method, status)` et `wallet_transactions(commission_ledger_id)` n'ont pas d'index dédié — sans impact au volume actuel (2 commandes en production), à surveiller si le volume augmente significativement. Non corrigé ici (hors périmètre : la migration déjà validée ne les prévoyait pas, et la mission demande des modifications minimales).

### RLS

✅ Cette migration ne touche aucune policy RLS (confirmé par lecture — aucune instruction `CREATE/ALTER POLICY`). Les 3 RPC sont `SECURITY DEFINER`, contournent RLS par conception et font leur propre vérification de rôle interne, cohérent avec le reste du projet.

### Realtime

✅ **Correction d'un constat antérieur** : l'audit précédent (`RELEASE_V1_AUDIT_REPORT.md` § 6/M-3) affirmait que le Dashboard Financier n'avait "pas de canal realtime, pas de refetchInterval". **C'est inexact** — vérifié en lisant `src/hooks/useAdminFinanceData.ts` : `useAdminFinanceOverview` et `useAdminFinanceHistory` utilisent toutes deux `useRealtimeTableSync` sur `wallets`, `payouts`, `payments` — un vrai canal Supabase Realtime (`postgres_changes`) qui invalide le cache React Query à chaque changement. Seul le drill-down par commande (`useOrderFinancialTimeline`) n'a pas de realtime (raisonnable : chargé à la demande, dialog ouvert ponctuellement). Le dashboard MonCash, lui, reste bien en pull-only comme précédemment documenté — cette correction concerne uniquement le Dashboard Financier.

### Permissions/Dashboard Admin, Restaurant, Livreur — non-régression

✅ Les 6 RPC pré-existantes utilisées par les pages commissions/décaissements restaurant, livreur et admin (`get_restaurant_commissions_secure`, `get_driver_commissions_secure`, `get_restaurant_wallets_admin`, `get_driver_wallets_admin`, `get_payouts_monthly_series`, `initiate_payout_secure`) sont toutes présentes et inchangées — confirmé par inspection directe en production. Cette migration n'a créé que 3 nouvelles fonctions, n'a modifié ni supprimé aucun objet existant (conforme à son propre commentaire d'en-tête).

## Tests fonctionnels

| Fonctionnalité      | Vérifié | Comment                                                                                                                                                       |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historique unifié   | ✅      | RPC testée en direct, 2 événements retournés                                                                                                                  |
| Commissions         | ✅      | RPC pré-existante confirmée intacte, incluse dans le flux history                                                                                             |
| Décaissements       | ✅      | RPC pré-existante confirmée intacte ; onglet "Peman" du dashboard financier réutilise `PayoutPayModal` (zéro nouveau code)                                    |
| Preuves de paiement | ✅      | Gérées par `PayoutPayModal` réutilisé tel quel — composant déjà éprouvé sur les pages restaurant/livreur, aucune nouvelle logique d'upload                    |
| Pagination          | ✅      | `PaginationControls` + `total_count` de la RPC (confirmé exact : 2)                                                                                           |
| Filtres             | ✅      | 9 filtres actifs dans `finance-history-table.tsx` (recherche, type, statut, méthode, tri, dates, montant min/max) — tous passés en paramètres RPC déjà testés |
| Export CSV          | ✅      | `downloadCSV`, colonnes mappées, code présent et compilé sans erreur                                                                                          |
| Export PDF          | ✅      | `jspdf` + `jspdf-autotable`, import dynamique, code présent et compilé sans erreur                                                                            |

## Régression

**Aucune détectée.** `npm run build` (build de production réel, pas E2E) exécuté après le correctif Phase 1 + la réconciliation de suivi de migration : succès complet, aucune erreur. `npm run typecheck` et `npm run check:migrations` : verts. Aucune fonction/table/policy pré-existante modifiée ou supprimée.

## État Git

Le code frontend (4 fichiers) et la migration restent **non commités** à ce stade — commit prévu à l'étape dédiée de cette mission (Commit 1, code uniquement), après la validation complète de toutes les phases.
