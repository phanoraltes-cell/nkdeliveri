# Admin Finance Dashboard — Phase 1 Audit Report (Partie 6)

Code écrit et vérifié en direct (`npm run verify` vert, RPC validées
via script transactionnel `BEGIN…ROLLBACK` contre la base réelle).
**Rien appliqué, rien committé** — conformément à "Ne rien appliquer
avant validation. Ne rien committer."

## 1. Architecture

```
dashboard.admin.finance.tsx (8 onglets côté client)
  │
  ├── Vue globale ──────► get_admin_finance_overview_secure (NOUVEAU)
  ├── Istorik ───────────► get_admin_finance_history_secure (NOUVEAU)
  │        │                     │ clic sur une ligne (order_id)
  │        └── OrderFinancialTimelineDialog
  │                    └── get_order_financial_timeline_secure (NOUVEAU)
  ├── Revenus ───────────► get_commission_monthly_series (existant)
  │                        get_payouts_monthly_series (existant)
  │                        get_top_restaurants_by_commission (existant)
  │                        get_top_drivers_by_commission (existant)
  ├── Commissions ───────► lien vers /dashboard/admin/commissions
  ├── Décaissements ─────► get_restaurant_wallets_admin / get_driver_wallets_admin
  │                        (recherche rapide) + PayoutPayModal (existant,
  │                        preuve déjà supportée) + lien vers /dashboard/admin/payouts
  ├── Paiements ─────────► lien vers /dashboard/admin/payments
  ├── MonCash ───────────► lien vers /dashboard/admin/moncash
  └── Wallets ───────────► lien vers /dashboard/admin/payouts
```

**Principe directeur** : 3 nouvelles RPC en lecture seule (aucune
écriture, aucune modification d'objet existant) + composition de
composants déjà en production (`KpiCard`, `RevenueChart`, `DataTable`,
`PaginationControls`, `EmptyState`, `StatusBadge`, `PayoutPayModal`,
`downloadCSV`, le motif jsPDF+autoTable). Seuls 3 onglets (Vue globale,
Istorik, Décaissements) ajoutent du contenu réellement neuf ; les 4
autres finalisent l'expérience en reliant vers les pages déjà
construites plutôt qu'en les dupliquant — conforme à "l'objectif n'est
PAS de reconstruire le système."

### Fichiers

| Fichier                                                                                                                     | Rôle                                                          |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`20260731140000_admin_finance_dashboard_rpcs.sql`](../supabase/migrations/20260731140000_admin_finance_dashboard_rpcs.sql) | 3 RPC, aucun `ALTER`/`DROP`/`CREATE OR REPLACE`               |
| [`useAdminFinanceData.ts`](../src/hooks/useAdminFinanceData.ts)                                                             | react-query + `useRealtimeTableSync` pour les 3 RPC           |
| [`finance-overview-section.tsx`](../src/components/dashboard/admin/finance-overview-section.tsx)                            | 12 tuiles KPI                                                 |
| [`finance-history-table.tsx`](../src/components/dashboard/admin/finance-history-table.tsx)                                  | Historique unifié, filtres, export CSV/PDF                    |
| [`order-financial-timeline-dialog.tsx`](../src/components/dashboard/admin/order-financial-timeline-dialog.tsx)              | Drill-down par commande                                       |
| [`dashboard.admin.finance.tsx`](../src/routes/_authenticated/dashboard.admin.finance.tsx)                                   | Page/onglets, recherche rapide de bénéficiaire                |
| `nav-items.ts`, `dashboard.admin.index.tsx`                                                                                 | Navigation (nouvelle entrée "Finans", tuile "Rapò" réveillée) |

**Décisions de conception** (déjà validées avec l'utilisateur avant
implémentation, voir le plan) :

1. Historique complet = vue unifiée transversale (`UNION ALL` de
   `commission_ledger`/`payouts`/`payments`), pas un onglet par type.
2. Timeline = drill-down interactif réel par commande, pas un schéma
   statique.
3. Upload de preuve = réutilisation intégrale de `PayoutPayModal`
   (déjà 100% fonctionnel, PNG/JPEG/WEBP/HEIC/HEIF/PDF déjà supportés
   par le bucket `payout-proofs`) — **zéro nouveau code d'upload**.

## 2. Rapport sécurité

| Contrôle                          | Résultat                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Garde admin/super_admin           | Les 3 RPC vérifient `private.has_role(auth.uid(),'admin') OR ...'super_admin'` en première instruction — testé en direct : un appel non-admin lève `42501`                                                                                                                |
| Lecture seule                     | Les 3 RPC sont `STABLE`, aucune écriture ; `get_order_financial_timeline_secure` et `get_admin_finance_history_secure` ne touchent que des `SELECT`/`UNION ALL`                                                                                                           |
| Permissions                       | `REVOKE ALL FROM PUBLIC, anon` + `GRANT EXECUTE TO authenticated` sur les 3 — la garde applicative reste la seule barrière réelle (comme toutes les RPC admin existantes), pas de RLS à contourner puisqu'aucune table n'est modifiée                                     |
| Pas d'énumération d'information   | Comme `create_collect_payment_secure` avant elle, `get_order_financial_timeline_secure` retourne un ensemble vide pour un `_order_id` inexistant plutôt qu'une erreur distincte — aucune fuite sur l'existence d'une commande                                             |
| Aucun secret exposé               | Zéro fichier `.server.ts` dans ce chantier — tout passe par le client Supabase public avec RLS/RPC, comme les pages `dashboard.admin.payouts.tsx`/`commissions.tsx` déjà en production. Rien à vérifier côté bundle serveur/client puisqu'il n'y a pas de secret impliqué |
| Réutilisation de `PayoutPayModal` | Composant déjà audité (upload de preuve, `initiate_payout_secure`) — monté tel quel dans le nouvel onglet Décaissements, mêmes `invalidateKeys` adaptées à ce contexte, aucune logique dupliquée                                                                          |
| Aucune régression                 | La migration ne contient que 3 `CREATE FUNCTION` — confirmé par lecture directe du fichier, aucune signature de RPC existante touchée                                                                                                                                     |

## 3. Rapport performance

- **`get_admin_finance_overview_secure`** : agrégats simples sur des
  tables déjà indexées par les migrations existantes (`wallets`,
  `commission_ledger`, `payouts`, `payments`) — aucun nouvel index
  nécessaire, les prédicats de date/method/status portent sur des
  colonnes déjà filtrées ailleurs dans le code.
- **`get_admin_finance_history_secure`** : `UNION ALL` de 3 branches
  avec `count(*) OVER()` — même profil de coût que
  `get_restaurant_wallets_admin` (déjà en production, déjà rapide sur
  le volume actuel). Paginé (`_limit`/`_offset`, plafonné à 500),
  jamais un fetch complet côté client.
- **`get_order_financial_timeline_secure`** : borné par construction —
  une seule commande, jamais plus qu'une poignée de lignes par
  branche. Aucune pagination nécessaire.
- **Frontend** : `RevenueChart` (recharts, ~350KB) reste `lazy()` +
  `Suspense`/`Skeleton`, chargé seulement quand l'onglet "Revenus" est
  monté — même discipline que `dashboard.admin.payouts.tsx`. L'export
  PDF (jsPDF + jspdf-autotable + dépendances transitives ~1.3MB) est
  chargé dynamiquement au clic uniquement, jamais dans le bundle
  principal. Confirmé dans la sortie de build : `dashboard.admin
.finance-*.mjs` (43.69 kB) est un chunk séparé, chargé seulement à
  la navigation vers cette page.
- **Realtime** : 3 souscriptions (`wallets`/`payouts`/`payments`,
  déjà toutes dans `supabase_realtime`) par onglet actif — même coût
  que `dashboard.admin.payouts.tsx`, aucun nouveau canal exotique.

## 4. Tests

**RPC validées en direct** (transactionnel, `BEGIN…ROLLBACK`, contre
la vraie base — zéro migration appliquée, zéro donnée permanente) :
un vrai flux commande → trigger de commission existant (non modifié)
→ `initiate_payout_secure` existant (non modifié) → les 3 nouvelles
RPC exercées sur cet état réel.

| Test                                                                              | Résultat                                                                                              |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Garde non-admin (`overview`)                                                      | ✅ `42501`                                                                                            |
| `get_admin_finance_overview_secure` — cohérence des 12 colonnes                   | ✅ `amount_to_disburse` = somme indépendante vérifiée ; volumes/compteurs corrects après le flux réel |
| `get_admin_finance_history_secure` — comptage croisé manuel                       | ✅ résultat RPC = comptage manuel sur `commission_ledger`+`payouts`+`payments`                        |
| `get_admin_finance_history_secure` — unicité `event_id`                           | ✅ 0 doublon sur 6 lignes toutes branches confondues                                                  |
| `get_admin_finance_history_secure` — filtre `_event_type`                         | ✅                                                                                                    |
| `get_order_financial_timeline_secure` — chaîne réelle                             | ✅ `order`/`commission`/`wallet_transaction`/`payout_coverage`/`payment` tous présents                |
| `get_order_financial_timeline_secure` — `payout_coverage.amount` jamais surestimé | ✅ `covered_amount` ≤ montant total du payout                                                         |
| `get_order_financial_timeline_secure` — commande inexistante                      | ✅ ensemble vide, pas d'erreur                                                                        |

**Bug réel trouvé et corrigé pendant cette validation** :
`ORDER BY event_time ASC` directement sur une chaîne `UNION ALL` (dans
`get_order_financial_timeline_secure`) échouait — Postgres n'accepte
un nom de colonne en fin de `UNION` que si la première branche
l'alias explicitement ainsi, ce qu'aucune des 7 branches ne fait (les
alias ne prennent effet qu'au niveau du `RETURNS TABLE` de la
fonction). Corrigé avec une référence positionnelle (`ORDER BY 2
ASC`), confirmé par re-exécution du script après correction.

**`npm run verify`** : vert — typecheck, lint (0 erreur après
correction Prettier automatique), `check:migrations`, **47/47 tests**
(aucune régression, aucun test préexistant cassé), build (le nouveau
chunk `dashboard.admin.finance` apparaît correctement séparé).

**Non testé unitairement (vitest)** : cette fonctionnalité n'introduit
aucune logique d'orchestration serveur comparable à
`initiate-collect-payment.logic.ts` — c'est de la composition
d'affichage sur des RPC en lecture seule déjà validées en direct. Même
limite déjà documentée pour `dashboard.admin.payouts.tsx` et les
autres pages admin existantes : la validation transactionnelle contre
la vraie base joue ce rôle pour les RPC, et les composants réutilisés
(`PayoutPayModal`, `DataTable`, `RevenueChart`...) sont déjà couverts
par leur propre historique de production.

## Ce qui n'a pas été touché (vérifié, pas seulement promis)

Aucune table, trigger, ou RPC existante n'apparaît dans le diff de ce
chantier — confirmé par lecture directe de la migration (3
`CREATE FUNCTION`, rien d'autre) et par relecture des fichiers modifiés
(`nav-items.ts`, `dashboard.admin.index.tsx` : ajouts uniquement,
aucune ligne existante supprimée en dehors du remplacement de
`to: null`).

## Avant d'appliquer/committer

1. Appliquer `supabase/migrations/20260731140000_admin_finance_dashboard_rpcs.sql` — sur confirmation explicite.
2. `npm run verify` une dernière fois après application (déjà vert avant, migration purement additive donc aucun changement de comportement attendu ailleurs).
3. Test manuel en navigateur admin (les 8 onglets, clic historique → dialog, exports CSV/PDF, `PayoutPayModal` depuis le nouvel onglet).
4. Committer et pousser (rapport fourni, comme requis par "aucun commit avant rapport").
