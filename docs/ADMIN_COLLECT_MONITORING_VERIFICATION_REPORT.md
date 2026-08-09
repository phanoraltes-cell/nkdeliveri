# Rapport de vérification — Page admin "Peman Otomatik" (monitoring Collect unifié)

Date : 2026-08-06
Portée : Étape 1 du plan approuvé (`joyful-frolicking-allen.md`) — nouvelle page admin unifiée pour MonCash Otomatik / NatCash Otomatik / Kat Kredi (Stripe). **Étape 0 (Stripe) est déjà committée et poussée** (commit `532eb1c`) ; ce rapport couvre uniquement le second lot, pas encore committé.

---

## 1. Ce qui a été livré

| Fichier | Statut | Rôle |
|---|---|---|
| `src/routes/_authenticated/dashboard.admin.collect.tsx` | Nouveau | Page principale — 3 onglets, lecture seule, aucune mutation |
| `src/lib/get-plop-status.functions.ts` | Nouveau | Server fn admin-only exposant `isPlopConfigured()` |
| `src/lib/get-stripe-status.functions.ts` | Nouveau | Server fn admin-only exposant `isStripeConfigured()` |
| `src/components/dashboard/sidebar/nav-items.ts` | Modifié | Lien "Peman Otomatik" (icône `Zap`) ajouté aux tableaux `admin` et `super_admin`, section "Finans" |
| `e2e/admin/collect-monitoring.spec.ts` | Nouveau | 2 tests smoke : chargement onglet MonCash par défaut, bascule vers l'onglet Kat Kredi |
| `src/routeTree.gen.ts` | Régénéré | Effet de bord automatique de l'ajout de route (TanStack Router) |

Aucune migration requise — toutes les tables/colonnes/policies RLS lues existaient déjà.

## 2. Vérification RLS (relue directement dans les migrations, pas supposée)

| Table lue | Policy | Portée |
|---|---|---|
| `payment_transactions` | `payment_transactions admin read` | `admin`/`super_admin` uniquement (+ `own read` séparée pour les clients, sans effet ici) |
| `plop_api_logs` | `plop_api_logs admin read` | `admin`/`super_admin` uniquement, `REVOKE ALL FROM PUBLIC, anon, authenticated` en amont |
| `stripe_api_logs` | `stripe_api_logs admin read` | `admin`/`super_admin` uniquement, même verrouillage |
| `payment_provider_settings` | `payment_provider_settings public read` | Lecture publique (déjà utilisée par le checkout) — aucune donnée sensible |

La page elle-même n'ajoute aucun filtre de rôle côté client : elle hérite de la garde du layout parent `dashboard.admin.tsx`, et les policies RLS ci-dessus refusent de toute façon l'accès à quiconque n'est pas admin/super_admin, même en cas de contournement du layout.

## 3. Suite de vérification — résultats

| Commande | Résultat |
|---|---|
| `npm run typecheck` | ✅ Clean (aucune sortie d'erreur) |
| `npm run lint` | ✅ 0 erreur, 12 warnings pré-existants sans rapport (`react-refresh/only-export-components` sur des fichiers non touchés) |
| `npm run check:migrations` | ✅ 122 migrations scannées, aucun hazard non résolu |
| `npx vitest run` | ✅ 105/105 tests, 9 fichiers, 7.2s |
| `npx vite build` | ✅ Build production réussi, 256 entrées precache PWA (identique au dernier build vérifié) |
| `npm run build:e2e` | ✅ Build e2e réussi |
| `npx playwright test e2e/admin/collect-monitoring.spec.ts e2e/admin/moncash-monitoring.spec.ts e2e/admin/payment-providers.spec.ts` | ✅ 7/7 tests passés (2 nouveaux + 5 existants, aucune régression) |

## 4. Scope Git — confirmé sans dérive

```
 M src/components/dashboard/sidebar/nav-items.ts
 M src/routeTree.gen.ts
?? e2e/  (contient collect-monitoring.spec.ts + le chantier e2e pré-existant jamais committé)
?? src/lib/get-plop-status.functions.ts
?? src/lib/get-stripe-status.functions.ts
?? src/routes/_authenticated/dashboard.admin.collect.tsx
```

Les autres fichiers modifiés/non suivis (`.claude/settings.json`, `.gitignore`, `package.json`/`package-lock.json`, `supabase/.temp/cli-latest`, les anciens docs `DEPLOYMENT_REPORT.md`/`FINAL_IMPLEMENTATION_REPORT.md`/`MONCASH_AUTOMATIK_PHASE0_*`/`SITE_AUDIT_*`) sont des diffs pré-existants sans rapport avec cette étape — exclus comme à chaque commit précédent de cet engagement.

## 5. Limites connues, assumées par design (documentées dans le code)

- **Pas de KPI "webhooks reçus/rejetés"** sur aucun des 3 onglets — le webhook Stripe n'écrit aucune ligne de log dédiée et `payment_transactions.webhook_data` est alimenté par 3 chemins différents (webhook/poll/cron), donc impossible de l'attribuer honnêtement.
- **Seuil "peman bloke" différencié** : 24h pour MonCash/NatCash (seul filet de sécurité = cron quotidien), 2h pour Stripe (aucun cron de réconciliation Stripe).
- **Répartition des lignes `plop_api_logs` par wallet** faite via une correspondance `external_reference → payment_method_requested` construite depuis `payment_transactions` déjà chargé (et non via `request_summary.payment_method`, absent des appels `verifyPayment`, vérifié directement dans `plop-client.server.ts`). Une ligne sans correspondance s'affiche "—", jamais devinée.

## 6. Statut

Tous les contrôles prévus par le plan sont verts. **Aucun commit n'a été effectué** — en attente de votre validation explicite, comme convenu.
