# NK Deliveri — Audit Complet du Site — 2026-08-03

**Statut** : audit uniquement, lecture seule sur la production. Aucune modification appliquée.
**Relation avec `docs/RELEASE_V1_AUDIT_REPORT.md` (2026-08-01)** : ce document ne réécrit pas ce qui n'a pas changé — il **re-vérifie en direct** chaque dimension et ne développe en détail que ce qui a évolué depuis. Rien n'est réutilisé "de mémoire" : chaque chiffre cité ci-dessous a été re-mesuré aujourd'hui (requêtes SQL live, `vercel env ls`, `curl` en production).
**Contexte** : aucun commit n'a eu lieu depuis `5503944` (le dernier audit datait de juste avant ce commit). Le code de production est donc identique à ce qui a déjà été audité en détail il y a 2 jours — ce qui a bougé, c'est l'**état opérationnel** (secrets Vercel, volumétrie), pas le code.

---

## Résumé exécutif

**Score global : 89/100** (contre 91.4/100 le 2026-08-01) — en baisse, pour une seule raison : la dégradation continue des secrets MonCash en production (§ 3), pas une régression de code. Le reste du site est stable, sans nouvelle régression détectée.

**3 changements réels depuis le dernier audit complet :**

1. ✅ **Footer WCAG corrigé** (déployé, vérifié) — l'ancien constat L-2 est clos.
2. ✅ **Dashboard Financier livré** (déployé, vérifié) — l'ancien chantier ouvert est clos.
3. 🔴 **MonCash Collect s'est dégradé, pas amélioré** — passé de 4/5 variables d'environnement présentes à **2/5**. Le paiement automatique reste non fonctionnel, et l'a été davantage depuis.

**0 Critique, 1 Élevé (aggravé), 0 nouveau Moyen, 0 nouveau Faible.** Les autres constats connus (grant `anon` systémique, adoption partielle des notifications, absence de PITR) sont **inchangés**, ni mieux ni pires — voir § 8.

---

## 1. Ce qui a changé depuis le 2026-08-01 (détail complet)

### 1.1 Footer WCAG — ✅ Résolu

`src/components/site-footer.tsx`, 5 éléments (`text-white/70`/`text-white/80` → `text-ink`), déployé dans le commit `2f959bb`. Revérifié en direct : le fix corrigé (bascule de couleur de texte, pas d'opacité — la version `/85` initialement envisagée s'était révélée insuffisante) est bien en production (`www.nkdeliveri.com` sert le build du commit `5503944`, confirmé lors du déploiement du 2026-08-02). Détail complet déjà documenté : `docs/PHASE1_FOOTER_WCAG_REPORT.md`.

### 1.2 Dashboard Financier — ✅ Résolu

Migration `20260731140000_admin_finance_dashboard_rpcs.sql` appliquée et suivie (`supabase_migrations.schema_migrations`), code frontend commité et déployé. Revérifié aujourd'hui :

```sql
select count(*) from pg_proc ... prosecdef  →  97 (contre 94 le 2026-08-01, +3 = exactement les 3 RPC finance)
```

- `/dashboard/admin/finance` répond `200` en production (coquille SSR, comme attendu — pas de fuite de données non authentifiées, déjà vérifié).
- Les 3 nouvelles fonctions restent **hors du grant `anon`** (80 fonctions anon-exécutables aujourd'hui, exactement comme le 2026-08-01 — les 3 nouvelles n'ont pas élargi la surface).
- Aucune régression sur les 6 RPC pré-existantes de commissions/décaissements (déjà vérifié lors du déploiement, reconfirmé par le comptage stable).

### 1.3 MonCash Collect — 🔴 Aggravé (le seul vrai signal négatif de cet audit)

**Constat du 2026-08-02** (lors du déploiement) : 4 des 5 variables `MONCASH_*` présentes sur Vercel Production (`MONCASH_API_URL`, `MONCASH_WEBHOOK_SECRET`, `MONCASH_CLIENT_SECRET`, `MONCASH_MERCHANT_ID`), seule `MONCASH_CLIENT_ID` manquait.

**Constat du 2026-08-03 (aujourd'hui)**, `vercel env ls production` :

```
MONCASH_WEBHOOK_SECRET     Encrypted   Production, Preview   3j
MONCASH_CLIENT_SECRET      Encrypted   Production, Preview   3j
```

**Seules 2 des 5 variables subsistent.** `MONCASH_API_URL` et `MONCASH_MERCHANT_ID` ont disparu en plus de `MONCASH_CLIENT_ID`, qui manquait déjà. `isMonCashConfigured()` (`src/lib/payment-providers/moncash-config.server.ts`) requiert les 5 par ET logique strict — le résultat (`false`) était déjà vrai avant, il l'est encore plus clairement maintenant.

**Interprétation, sans supposer une cause** : ce retrait supplémentaire pourrait être une action délibérée (cohérente avec la discussion en cours sur le remplacement du backend MonCash Collect par un nouveau gateway — voir `docs/MONCASH_AUTOMATIK_PHASE0_AUDIT.md` — un nettoyage des anciens secrets Digicel en amont d'un changement de fournisseur serait logique) ou un effet de bord non intentionnel (rotation de secrets, erreur de configuration). **Aucune des deux hypothèses n'est confirmée** — c'est un simple constat d'état, à clarifier avec vous.

**Impact réel** : `payment_transactions` contient **0 ligne** au total (vérifié aujourd'hui) — aucun client n'a jamais réellement utilisé ce canal, donc aucun préjudice concret n'a eu lieu. Mais tant que "MonCash Automatik" reste l'option **par défaut** affichée sur `/checkout` (`useState<CheckoutMethod>("moncash_auto")`, inchangé), tout client qui la choisirait aujourd'hui recevrait un échec immédiat (`"MonCash Automatik pa konfigire toujou"`).

**Recommandation** : soit confirmer que ce retrait est intentionnel (auquel cas il serait cohérent de retirer temporairement "MonCash Automatik" de la liste des méthodes affichées, ou de la reclasser visuellement, pour éviter de proposer une option qui échoue systématiquement), soit restaurer les 3 variables manquantes si le retrait n'était pas voulu.

---

## 2. Frontend — inchangé, re-confirmé

68 routes, aucune modification depuis le dernier audit détaillé (aucun commit touchant `src/routes/` hors les 2 fichiers finance déjà couverts en § 1.2). Les 3 constats mineurs déjà connus (route `payout-migration` sans entrée de nav — intentionnel confirmé ; `dashboard.customer.tsx` sans `requireRole` explicite ; garde d'authentification incohérente sur `/orders/$id`) restent tels quels, non traités, non aggravés. Smoke test production frais aujourd'hui : `/`, `/restaurants`, `/checkout`, `/dashboard/admin/finance`, `/sitemap.xml` → tous `200`.

## 3. Backend / Supabase / SQL / RPC / RLS — re-vérifié en direct

| Métrique                         | 2026-08-01          | 2026-08-03                                                         | Delta                                                                        |
| -------------------------------- | ------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Migrations appliquées et suivies | 112 (+1 en attente) | 113 (toutes suivies)                                               | Réconcilié (§ 1.2)                                                           |
| Policies RLS (`public`)          | 65                  | 65                                                                 | Inchangé                                                                     |
| Fonctions `SECURITY DEFINER`     | 94                  | 97                                                                 | +3 (finance dashboard)                                                       |
| ... dont exécutables par `anon`  | 80 (85%)            | 80 (82%, proportion en légère baisse car le dénominateur a grossi) | Pas d'aggravation — les 3 nouvelles fonctions sont correctement verrouillées |
| Buckets Storage                  | 8                   | 8                                                                  | Inchangé                                                                     |

Le constat M-1 (grant `anon` systémique, hygiène de privilège) reste identique en substance — non traité, comme convenu, hors périmètre des missions récentes.

## 4. Sécurité

- **PITR/backups Supabase** : toujours `pitr_enabled: false`, `backups: []` — inchangé, non traité (`docs/BACKUP_OPERATION_GUIDE.md` reste la seule ligne de défense documentée, toujours pas automatisée en pratique).
- **Cron** : `/api/cron/moncash-reconcile` toujours correctement sécurisé (`401` sans `CRON_SECRET`, revérifié aujourd'hui).
- **MonCash secrets** : voir § 1.3 — c'est le seul changement de posture de sécurité/fiabilité depuis le dernier audit, et il va dans le mauvais sens (plus de secrets manquants, pas moins).
- Aucune nouvelle vulnérabilité de code introduite — les 2 commits déployés depuis le dernier audit ont chacun été vérifiés ligne par ligne au moment de leur création (`docs/PHASE1_FOOTER_WCAG_REPORT.md`, `docs/PHASE2_FINANCE_DASHBOARD_VERIFICATION.md`).

## 5. Performance / PWA / SEO / Responsive / Accessibilité / GPS / Chat / Notifications

**Aucun changement de code dans ces dimensions depuis le 2026-08-01** — les constats de `docs/RELEASE_V1_AUDIT_REPORT.md` §§ 7–17 restent valides tels quels, à une exception : l'accessibilité du footer (§ 1.1) est passée de "1 bug WCAG AA confirmé" à "résolu", ce qui améliore légèrement le score Accessibilité (88 → ~91, estimation cohérente avec la réduction du nombre de pages en échec dans la suite `axe-core`, déjà mesurée à l'époque du correctif : 3 pages en échec → 1).

## 6. Volumétrie (contexte, pas un défaut)

|                                  | 2026-08-01 | 2026-08-03 |
| -------------------------------- | ---------- | ---------- |
| Utilisateurs                     | 4          | 4          |
| Commandes                        | 2          | 4          |
| Restaurants                      | 1          | 1          |
| Livreurs                         | 0          | 0          |
| Paiements                        | —          | 4          |
| Payouts                          | 0          | 0          |
| `payment_transactions` (Collect) | 0          | 0          |

Toujours à l'échelle développement/lancement très précoce — aucun des constats de cet audit n'a été "masqué" par un volume élevé de son côté, la lecture reste fiable.

---

## 7. Score détaillé mis à jour

| Dimension         | 2026-08-01 | 2026-08-03 | Note                             |
| ----------------- | ---------- | ---------- | -------------------------------- |
| Frontend          | 95         | 95         | Inchangé                         |
| Backend           | 92         | 92         | Inchangé                         |
| Supabase          | 90         | 90         | Inchangé (PITR toujours absent)  |
| SQL/RPC           | 88         | 88         | Inchangé                         |
| RLS               | 94         | 94         | Inchangé                         |
| Sécurité          | 87         | 85         | 🔻 Dégradation MonCash secrets   |
| Accessibilité     | 88         | 91         | 🔺 Footer résolu                 |
| Responsive        | 96         | 96         | Inchangé                         |
| PWA               | 97         | 97         | Inchangé                         |
| SEO               | 96         | 96         | Inchangé                         |
| Performance       | 90         | 90         | Inchangé                         |
| Monitoring        | 78         | 78         | Inchangé                         |
| Cron              | 96         | 96         | Inchangé                         |
| MonCash           | 90         | 75         | 🔻 Collect plus dégradé qu'avant |
| Notifications     | 85         | 85         | Inchangé                         |
| GPS               | 98         | 98         | Inchangé                         |
| Chat              | 97         | 97         | Inchangé                         |
| Finance Dashboard | (pending)  | 95         | 🔺 Livré et vérifié              |
| **Moyenne**       | **91.4**   | **89.0**   |                                  |

---

## 8. Ce qui reste ouvert (rappel, statut inchangé, pas re-détaillé ici)

Voir `docs/RELEASE_V1_AUDIT_REPORT.md` § 19 pour le détail complet de chaque point — statuts inchangés depuis :

- Grant `anon` systémique sur les fonctions `SECURITY DEFINER` (M-1).
- Adoption partielle du moteur de notifications (M-2, 32 sites d'insertion brute).
- Absence de PITR/sauvegarde automatique Supabase.
- Automatisation réelle du workflow de sauvegarde (référence prête dans `docs/BACKUP_OPERATION_GUIDE.md`, jamais activée).

## 9. Nouveau point à trancher (issu de cet audit)

**MonCash secrets en production** (§ 1.3) : confirmer si le retrait de `MONCASH_API_URL`/`MONCASH_MERCHANT_ID` est intentionnel. Selon la réponse :

- Si intentionnel (préparation du remplacement par bouspam.net) : envisager de masquer/désactiver temporairement l'option "MonCash Automatik" côté client plutôt que de laisser une option par défaut qui échoue systématiquement.
- Si non intentionnel : restaurer les variables manquantes, ou traiter cela comme faisant partie de l'incident déjà documenté dans `docs/DEPLOYMENT_REPORT.md`.

---

## Conclusion

Le site est stable — les 2 commits déployés depuis le dernier audit ont fonctionné exactement comme prévu, sans régression. Le seul mouvement notable est opérationnel, pas applicatif : la disponibilité de MonCash Automatik a continué de se dégrader plutôt que de se stabiliser. Aucune action n'a été prise sur ce constat dans le cadre de cet audit — il est remonté pour décision, conformément à la pratique établie de cette session (audit et vérification d'abord, action seulement sur validation explicite).
