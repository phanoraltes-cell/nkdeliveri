# NK Deliveri — Rapport de Déploiement (v1.0)

**Date** : 2026-08-02
**Commits déployés** : `2f959bb` (feat(finance): finalize financial dashboard for v1.0), `5503944` (docs(release): finalize go-live documentation)
**Déploiement** : automatique via l'intégration native Vercel ↔ GitHub, déclenché par `git push origin main`

---

## 🔴 Constat critique découvert pendant cette vérification (pré-existant, non causé par ce déploiement)

**`MONCASH_CLIENT_ID` est absent des variables d'environnement Vercel Production.** Confirmé par `vercel env ls` :

```
MONCASH_API_URL          Encrypted   Preview, Production   2j
MONCASH_WEBHOOK_SECRET   Encrypted   Preview, Production   2j
MONCASH_CLIENT_SECRET    Encrypted   Preview, Production   2j
MONCASH_MERCHANT_ID      Encrypted   Preview, Production   2j
```

4 des 5 variables requises par `isMonCashConfigured()` (`src/lib/payment-providers/moncash-config.server.ts:24-30`) sont présentes — **`MONCASH_CLIENT_ID` manque**. La vérification est un ET logique strict sur les 5 (`moncash-config.server.ts:36`) : `isConfigured()` retourne donc **`false`** en production, actuellement, en ce moment.

**Conséquence réelle** : `initiate-collect-payment.logic.ts:38-41` rejette immédiatement toute tentative de paiement MonCash Automatik avec `"MonCash Automatik pa konfigire toujou"` — le mode de paiement affiché par défaut sur `/checkout` (voir `docs/MONCASH_CONFIGURATION.md`) ne fonctionne pas actuellement.

**Impact client vérifié** : recherche de `payment_transactions` des 7 derniers jours → **0 ligne**. Aucun client n'a tenté de payer par ce canal récemment (cohérent avec le faible volume de production déjà documenté) — donc **aucun préjudice client confirmé à ce jour**, mais la fonctionnalité reste cassée pour la toute prochaine tentative réelle.

**Ce constat contredit un fait établi précédemment dans cette session** (`docs/MONCASH_CONFIGURATION.md`, `docs/GO_LIVE_DECISION_REPORT.md` § 2) qui affirmait "les 5 variables d'environnement sont présentes sur Vercel Production". Cela signifie que l'état a changé depuis cette vérification précédente (rotation de secret incomplète, suppression accidentelle, ou l'affirmation antérieure était déjà obsolète) — vérifié en direct aujourd'hui, pas supposé.

**Ce déploiement (footer WCAG + Dashboard Financier) n'a ni causé, ni aggravé, ni corrigé ce problème** — aucun des deux commits ne touche aux secrets Vercel ni à `moncash-config.server.ts`/`initiate-collect-payment.logic.ts` (fichiers explicitement exclus de cette mission, Phase 4). C'est une découverte indépendante faite pendant la vérification post-déploiement demandée.

**Action requise, hors périmètre de cette mission** : ajouter `MONCASH_CLIENT_ID` dans Vercel (Project Settings → Environment Variables → Production) avec la vraie valeur du compte MonCash Business. Cette action nécessite le secret réel, que je n'ai pas et ne dois pas inventer.

---

## 1. Build

| Vérification          | Résultat                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Déploiement déclenché | Automatique, push sur `main`                                                                                                  |
| Statut                | ● Ready                                                                                                                       |
| Environnement         | Production                                                                                                                    |
| Durée du build        | 27s                                                                                                                           |
| Commit déployé        | `5503944` — confirmé identique au commit local le plus récent (`git log -1`) via les logs de build Vercel (`Commit: 5503944`) |
| Alias                 | `www.nkdeliveri.com`, `nkdeliveri.com` — confirmés actifs sur ce déploiement                                                  |

## 2. Variables d'environnement

| Catégorie                                  | Résultat                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Supabase (URL, clé publique, service role) | ✅ Présentes (Production)                                                              |
| `CRON_SECRET`                              | ✅ Présente (Production uniquement, cohérent avec son usage)                           |
| `RESEND_API_KEY`                           | ✅ Présente                                                                            |
| Google Maps (browser key, tracking ID)     | ✅ Présentes                                                                           |
| MonCash (5 attendues)                      | 🔴 **4/5 présentes — `MONCASH_CLIENT_ID` manquante** (voir constat critique ci-dessus) |

## 3. Cron

```
curl https://www.nkdeliveri.com/api/cron/moncash-reconcile
→ 401 (sans en-tête Authorization)
```

✅ Correctement sécurisé — rejette toute requête sans le bon `CRON_SECRET` en bearer auth, cohérent avec l'implémentation vérifiée dans l'audit précédent.

## 4. Routes API

| Route                                                   | Résultat                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                     | 200                                                                                                                                                                                                                                                                                                                                                 |
| `/restaurants`                                          | 200                                                                                                                                                                                                                                                                                                                                                 |
| `/sitemap.xml`                                          | 200                                                                                                                                                                                                                                                                                                                                                 |
| `/robots.txt`                                           | 200                                                                                                                                                                                                                                                                                                                                                 |
| `/api/cron/moncash-reconcile` (sans secret)             | 401 ✅                                                                                                                                                                                                                                                                                                                                              |
| `/api/webhooks/moncash/collect` (sans signature valide) | 401 ✅                                                                                                                                                                                                                                                                                                                                              |
| `/dashboard/admin/finance` (sans session)               | 200 — coquille SSR uniquement, `<title>Dashboard — NK Deliveri</title>`, **aucune donnée financière dans le HTML brut** ; le garde-fou réel (redirection si session absente) est côté client après hydratation, cohérent avec le pattern déjà établi de `_authenticated/route.tsx`. Vérifié en inspectant le corps brut de la réponse, pas supposé. |
| `/dashboard/admin/moncash` (sans session)               | 200 — même comportement, cohérent                                                                                                                                                                                                                                                                                                                   |

## 5. Realtime

Non testable de bout en bout sans session authentifiée réelle (aucun identifiant de test n'existe pour ce projet — convention déjà établie dans cette session). Vérifié indirectement :

- Le CSP de production autorise explicitement `wss://*.supabase.co` dans `connect-src` (confirmé par `curl -I`) — la connexion WebSocket Realtime n'est pas bloquée par les en-têtes de sécurité.
- Le nouveau hook `useRealtimeTableSync` utilisé par le Dashboard Financier (`wallets`/`payouts`/`payments`) a été vérifié au niveau code (canal `postgres_changes` authentique, voir `docs/PHASE2_FINANCE_DASHBOARD_VERIFICATION.md`) et compile/build sans erreur dans ce déploiement.

## 6. MonCash

- Page `/dashboard/admin/moncash` : charge (200), coquille SSR correcte.
- **Fonctionnel** : voir constat critique en tête de ce document — Collect actuellement non fonctionnel (secret manquant), Décaissement toujours inactif par conception (`is_active = false`, cohérent et documenté).

## 7. Dashboard

- `/dashboard/admin/finance` : route déployée, charge correctement (coquille SSR), migration confirmée appliquée en production (voir `docs/PHASE2_FINANCE_DASHBOARD_VERIFICATION.md`).
- En-têtes de sécurité production vérifiés : CSP stricte avec nonce, `Strict-Transport-Security` (HSTS preload), `X-Frame-Options: DENY` — tous présents et corrects.

---

## Verdict de ce déploiement

**Le déploiement lui-même a réussi sans régression** : build vert, commit exact confirmé, toutes les routes touchées par ce travail répondent correctement, sécurité inchangée et vérifiée. Le footer WCAG et le Dashboard Financier sont désormais en production.

**Un blocage indépendant, pré-existant, a été découvert pendant la vérification** (MonCash Collect non fonctionnel par secret manquant) — voir `docs/FINAL_IMPLEMENTATION_REPORT.md` pour le verdict Go-Live global qui en tient compte.
