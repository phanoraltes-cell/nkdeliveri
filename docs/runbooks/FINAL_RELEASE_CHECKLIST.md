# NK Deliveri — Final Release Checklist (v1.0)

Statut post-implémentation des 4 décisions de `docs/GO_LIVE_DECISION_REPORT.md`. Pour la checklist de release complète (18 dimensions), voir `docs/RELEASE_CHECKLIST.md` ; pour la procédure de déploiement pas-à-pas, voir `docs/GO_LIVE_CHECKLIST.md`.

## 1. Backup strategy

- [x] Décision prise : documentation opérationnelle complète produite (`docs/BACKUP_OPERATION_GUIDE.md`) — procédures de sauvegarde quotidienne, restauration, vérification, rotation
- [x] Choix explicite : **documentation uniquement pour cette phase** — le workflow GitHub Actions d'automatisation est fourni en référence prête à l'emploi dans le guide, pas créé comme fichier réel (aucun code/config ajouté au dépôt, conformément à "ne pas modifier le code applicatif")
- [ ] Activation réelle de l'automatisation (créer `.github/workflows/backup.yml`, configurer les secrets) — **reste une action future, hors périmètre de cette mission**
- [ ] Upgrade de plan Supabase pour PITR — **non traité, décision séparée nécessaire**
- [x] État confirmé en direct au moment de la rédaction : `pitr_enabled: false`, `backups: []` — aucune régression, situation inchangée et correctement documentée

## 2. `payment_providers.moncash_api.is_active`

- [x] Option retenue : **A — documentation/libellé seul**, comme recommandé
- [x] `docs/MONCASH_CONFIGURATION.md` créé — référence canonique expliquant précisément ce que le flag contrôle (uniquement la visibilité de `moncash_api` dans `payout-pay-modal.tsx`) et ne contrôle pas (le Collect client, gardé exclusivement par `isConfigured()`)
- [x] `docs/PAYMENT_PROVIDERS.md` mis à jour avec un encart d'avertissement en tête, clarifiant les deux flux indépendants et le piège de nommage ("MonCash Automatik" désigne deux écrans différents)
- [x] **Option B non implémentée** — confirmé, `initiate-collect-payment.logic.ts` et `moncashProvider.isConfigured()` strictement inchangés (aucun diff sur ces fichiers)
- [x] Comportement du Collect client en production non modifié — vérifié

## 3. Footer WCAG

- [x] Décision prise : corriger avant Go-Live — **oui**
- [x] **Correctif réellement appliqué diffère de la proposition initiale** : `text-white/70`/`text-white/80` → `text-white/85` s'est avéré mathématiquement insuffisant (calcul de luminance WCAG : plafond réel ~2.8:1 pour du blanc plein sur `--brand`, quelle que soit l'opacité). Correctif corrigé et validé avec l'utilisateur avant application : bascule vers `text-ink` (token existant) sur les 5 éléments concernés (`src/components/site-footer.tsx` lignes 69, 81, 94, 106, 135 — les 4 labels de section + la ligne de copyright)
- [x] Re-vérification effectuée : suite `axe-core` isolée, passe de 3 pages en échec → 1 (la page restante échoue pour une cause hors périmètre déjà documentée, pas liée à ce correctif)
- [x] Aucune modification de la couleur de marque (`--brand` #F97316 strictement inchangé)
- [x] Lighthouse, responsive (9/9 sur 3 viewports), hover/focus (inchangés) tous vérifiés — voir `docs/PHASE1_FOOTER_WCAG_REPORT.md`

## 4. Finance Dashboard readiness

- [x] Décision prise : appliquer pour ce Go-Live — **oui**
- [x] **Découverte en cours de route** : la migration était déjà appliquée en production (les 3 fonctions existaient, définitions identiques au fichier), mais absente du suivi `supabase_migrations.schema_migrations` et jamais commitée — réconciliée (tracking inséré, aucune fonction recréée)
- [x] RPC vérifiées en direct comme un admin réel : `get_admin_finance_overview_secure` ✓, `get_admin_finance_history_secure` ✓ (2 lignes), `get_order_financial_timeline_secure` ✓ (2 lignes)
- [x] Permissions vérifiées : `anon` bloqué au niveau privilège DB (`42501`), confirmé par appel réel, pas simulé
- [x] Index vérifiés adéquats pour le volume actuel (2 observations mineures non bloquantes documentées, non corrigées — hors périmètre)
- [x] RLS confirmée non affectée (migration ne touche aucune policy)
- [x] **Correction d'un constat antérieur** : le Dashboard Financier a en réalité un vrai canal Realtime (`useRealtimeTableSync` sur wallets/payouts/payments) — l'audit précédent affirmant "aucun realtime" était inexact pour ce composant spécifiquement
- [x] Aucune collision avec les 6 RPC pré-existantes utilisées par restaurant/livreur/admin (commissions, wallets, payouts)
- [x] `npm run build` (production) vert après tous les changements cumulés (Phase 1 + Phase 2)
- [ ] Commit + push du code frontend (4 fichiers) + migration — **en attente de l'étape Commit dédiée de cette mission**
- [ ] Smoke test de `/dashboard/admin/finance` en production après déploiement — **en attente du déploiement**

Détail complet : `docs/PHASE2_FINANCE_DASHBOARD_VERIFICATION.md`.

## Clôture

- [x] Les 4 décisions ont chacune été implémentées selon l'option validée, rien appliqué sans validation préalable (la correction du plan footer a elle-même été re-validée avant application, voir § 3)
- [ ] Validation globale (`npm run verify` + smoke tests par rôle) — étape suivante de cette mission
- [ ] Commit (2 commits distincts : code, puis documentation) — étape suivante
- [ ] Push + déploiement Vercel — après validation complète
- [ ] Rapport Go-Live final ("Production Ready v1.0" ou blocage) — `docs/FINAL_IMPLEMENTATION_REPORT.md`
