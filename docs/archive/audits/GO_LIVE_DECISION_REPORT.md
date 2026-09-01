# NK Deliveri — Go-Live Decision Report (v1.0)

**Date** : 2026-08-01
**Portée** : strictement les 4 points demandés — Backup strategy, `moncash_api.is_active`, Footer WCAG, Finance Dashboard readiness. **Hors périmètre par instruction explicite** : notifications legacy (M-2), hardening sécurité global (M-1, grant `anon` systémique) — voir `docs/RELEASE_V1_AUDIT_REPORT.md` pour ces deux points, non traités ici.
**Méthode** : chaque constat ci-dessous a été re-vérifié en direct aujourd'hui (requêtes SQL live sur `dcsnmvbtsmdbwrwbutph`, lecture de code, `npm run typecheck`/`check:migrations`), pas repris tel quel de l'audit précédent — l'état peut avoir changé depuis.
**Aucune action appliquée.** Ce document sert uniquement à la prise de décision.

---

## Tableau de synthèse

| #   | Décision                    | Impact | Risque si non traité                                                                | Effort               | Recommandation                                                                                                               |
| --- | --------------------------- | ------ | ----------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Stratégie de sauvegarde     | Élevé  | Élevé                                                                               | Faible → Moyen       | Planifier la sauvegarde manuelle existante immédiatement (faible effort) ; activer PITR Supabase séparément (dépend du plan) |
| 2   | `moncash_api.is_active`     | Élevé  | Moyen (aujourd'hui), Élevé (si quelqu'un s'y fie pour juger l'état du décaissement) | Faible               | Corriger la documentation/le libellé UI immédiatement ; le vrai correctif de code est un choix à trancher séparément         |
| 3   | Footer WCAG                 | Faible | Faible                                                                              | Très faible          | Corriger avant Go-Live — coût quasi nul, gain immédiat                                                                       |
| 4   | Finance Dashboard readiness | Moyen  | Faible (si on ne l'applique pas)                                                    | Faible (déjà validé) | Prêt à appliquer sur confirmation ; aucun obstacle technique restant                                                         |

---

## 1. Stratégie de sauvegarde

### Constat vérifié aujourd'hui

```
supabase --experimental backups list --project-ref dcsnmvbtsmdbwrwbutph
{"pitr_enabled": false, "backups": []}
```

Inchangé depuis le dernier audit. **Aucune sauvegarde automatique Supabase, aucun PITR.** La seule ligne de défense existante est le script manuel `scripts/backup-database.sh` (`npm run db:backup`), qui produit un dump local et fonctionne, mais n'est déclenché par rien — c'est une action humaine, jamais planifiée. `docs/BACKUP_RESTORE.md` affirme à tort que "tout projet Supabase sur un plan payant bénéficie de sauvegardes automatiques quotidiennes" — ce n'est pas le cas ici aujourd'hui, à corriger indépendamment de la décision de fond.

### Impact

Élevé. C'est la seule protection contre une perte de données irréversible (erreur humaine, migration ratée, incident de la plateforme). Sans backup, tout incident SEV-1 impliquant une perte de données (voir `INCIDENT_RESPONSE.md`) est définitif.

### Risque si non traité avant Go-Live

Élevé et croissant avec le volume de commandes/paiements réels une fois en production — la fenêtre de perte potentielle grandit chaque jour sans action, et le risque financier (paiements MonCash perdus) est concret, pas théorique.

### Effort

- **Sauvegarde manuelle planifiée** (ex. via GitHub Actions cron, puisque le cron applicatif Vercel est déjà saturé à 1 job/jour sur le plan Hobby) : **faible**, le script existe déjà et fonctionne, il ne manque qu'un déclencheur externe + une destination de stockage durable pour le fichier produit.
- **PITR/backups automatiques Supabase** : **moyen**, dépend du plan Supabase actuel et implique potentiellement un coût récurrent — nécessite une vérification du plan (Dashboard → Settings → Billing) avant de pouvoir chiffrer l'effort exact.

### Recommandation

Ne pas attendre la décision PITR pour agir : planifier la sauvegarde manuelle existante dès maintenant (effort faible, aucune dépendance externe), en parallèle d'une décision séparée sur l'upgrade de plan Supabase pour le PITR. Corriger `docs/BACKUP_RESTORE.md` pour refléter l'état réel plutôt que l'état supposé.

---

## 2. `payment_providers.moncash_api.is_active`

### Constat vérifié aujourd'hui

Valeur actuelle en base (requête live) :

```
code: moncash_api | is_active: false | label: "MonCash API"
```

**Ce que ce flag contrôle réellement, confirmé en lisant le code source** (`src/lib/initiate-provider-payout.functions.ts:42-46`, `src/lib/payment-providers/index.server.ts:26-28`) : il désactive uniquement l'option `moncash_api` dans **le formulaire admin de décaissement** (paiement plateforme → restaurant/livreur). Rien de plus.

**Ce que ce flag ne contrôle PAS** : le flux de paiement client (MonCash Collect, checkout). `src/routes/checkout.tsx` affiche "MonCash Automatik" comme méthode de paiement par défaut sans aucune condition, et `src/lib/initiate-collect-payment.logic.ts:38-41` vérifie exclusivement `moncashProvider.isConfigured()` (présence des 5 variables d'environnement `MONCASH_*`) — jamais `is_active`. Confirmé par lecture directe du code aujourd'hui, aucun changement depuis le dernier audit.

**Conséquence concrète** : alors même que `is_active = false` en base — ce qui pourrait laisser croire que MonCash est "éteint" — le paiement Collect côté client est déjà pleinement actif en production (confirmé lors du Go-Live MonCash Collect de cette session), uniquement parce que les 5 variables d'environnement sont présentes sur Vercel. Le flag et la réalité racontent deux histoires différentes.

### Impact

Élevé sur la fiabilité de la prise de décision opérationnelle — quiconque (admin, développeur futur) lit `is_active = false` et en conclut à tort que le paiement client MonCash est désactivé prend une décision sur une prémisse fausse.

### Risque si non traité

Moyen aujourd'hui (le flux réel fonctionne correctement, le risque est de lecture/confiance, pas de panne) — mais devient Élevé le jour où quelqu'un s'appuie sur ce flag pour un choix sensible (ex. "je peux tester sans risque, `is_active` est à `false`" — faux, un paiement réel serait quand même tenté).

### Effort

- **Corriger le libellé/la documentation** (expliquer que `is_active` ne gate que le décaissement admin, pas le Collect client) : **très faible**, déjà fait dans `docs/RELEASE_V1_AUDIT_REPORT.md` et `docs/GUIDE_ADMINISTRATEUR.md` — reste à décider si le flag lui-même doit changer.
- **Faire du flag le vrai verrou du Collect client** (ex. `initiate-collect-payment.logic.ts` vérifie aussi `is_active` en plus de `isConfigured()`) : **faible**, un seul appel RPC/lecture supplémentaire dans un fichier déjà identifié, mais c'est un changement de comportement du paiement en production — nécessite un test transactionnel avant application, comme toute modification touchant le paiement.

### Recommandation

Deux options valables, à trancher par vous — ni l'une ni l'autre n'est appliquée ici :

- **Option A (documentation seule)** : renommer/décrire clairement le flag comme "Décaissement MonCash actif" plutôt que "MonCash actif" tout court, pour éliminer l'ambiguïté sans toucher au comportement de paiement en production juste avant un Go-Live.
- **Option B (code)** : faire vérifier `is_active` par le Collect client aussi, pour que le flag redevienne un vrai kill-switch global. Recommandé à moyen terme, mais introduit un changement de comportement sur le paiement client — à valider avec un test transactionnel dédié avant toute application, pas dans la fenêtre resserrée d'un Go-Live.

Pour la v1.0 immédiate, **Option A est la plus sûre** (effort quasi nul, aucun risque sur le paiement déjà en production).

---

## 3. Footer WCAG (contraste)

### Constat vérifié aujourd'hui

`src/components/site-footer.tsx`, lignes 69, 83, 98, 112 — inchangé depuis le dernier audit :

```tsx
<span className="font-semibold uppercase tracking-wide text-white/70 text-xs">
```

4 occurrences, classe `text-white/70` sur fond `bg-brand` (#F97316) — ratio de contraste mesuré entre 2.06:1 et 3.79:1 (WCAG AA exige 4.5:1), confirmé par la suite Playwright/`axe-core` construite précédemment.

**Note sur le brand color** : la couleur de marque (#F97316/#EA580C) ne doit pas être assombrie pour ce correctif (préférence déjà connue) — la correction porte sur l'opacité du **texte**, pas sur le fond. Le même composant utilise déjà `text-white/85` ailleurs (lignes 49, 60) sans être signalé comme un échec par le même audit `axe-core` — c'est donc une valeur déjà éprouvée dans ce fichier précis, pas une nouvelle hypothèse.

### Impact

Faible — un seul composant partagé, un seul type de défaut (contraste), pas de rupture fonctionnelle, mais WCAG AA réel et mesuré, pas cosmétique.

### Risque si non traité

Faible. N'empêche aucun parcours, mais reste un defect d'accessibilité confirmé sur un composant visible sur la majorité des pages publiques (pied de page partagé).

### Effort

Très faible — changer `text-white/70` en `text-white/85` (ou équivalent) aux 4 lignes concernées, un seul fichier, aucune dépendance, aucune migration, aucun risque de régression fonctionnelle (c'est un libellé de section, pas un élément interactif).

### Recommandation

Corriger avant le Go-Live. C'est le seul des 4 points où effort et risque sont tous deux au plus bas — le rapport coût/bénéfice ne justifie pas de le reporter.

---

## 4. Finance Dashboard — readiness

### Constat vérifié aujourd'hui

- Migration `supabase/migrations/20260731140000_admin_finance_dashboard_rpcs.sql` : présente, **toujours non appliquée à la production** (confirmée non appliquée précédemment ; aucune application n'a eu lieu depuis, aucun commit/push n'a été fait sur ce chantier).
- `npm run typecheck` : **vert**, ré-exécuté aujourd'hui sur l'arbre de travail actuel (inclut les 4 fichiers frontend + les types RPC ajoutés à la main).
- `npm run check:migrations` : **vert** — "113 migrations scanned, 2 historical overload(s) all later cleaned up, no unresolved hazards" (la migration Finance Dashboard fait partie des 113 fichiers scannés localement, aucun hazard détecté).
- Déjà validée en transactionnel (`BEGIN...ROLLBACK`) contre des données réelles de production lors de sa construction — le bug `ORDER BY` sur `UNION ALL` trouvé à cette occasion est déjà corrigé dans le fichier actuel.
- Composants frontend (`finance-overview-section.tsx`, `finance-history-table.tsx`, `order-financial-timeline-dialog.tsx`, route `dashboard.admin.finance.tsx`) : présents, non commités, aucune erreur de type.

### Impact

Moyen — une fonctionnalité admin complète (vue financière consolidée) reste indisponible en production tant qu'elle n'est pas appliquée/commitée, mais son absence ne bloque aucun parcours client/restaurant/livreur existant.

### Risque si non traité

Faible si la décision est de la reporter sciemment — rien ne se dégrade en la laissant de côté. Le seul risque est celui, croissant avec le temps, de drift entre ce code déjà écrit et le reste du schéma si d'autres migrations venaient à toucher les mêmes tables avant que celle-ci soit appliquée (à réévaluer si l'attente se prolonge de plusieurs semaines).

### Effort

Faible pour l'appliquer maintenant — tout le travail de construction et de validation est déjà fait (session précédente) ; il ne reste que l'application de la migration elle-même (fichier par fichier, avec confirmation, selon la convention du projet) et un commit/push classique. Aucun nouveau développement requis.

### Recommandation

**Prête à être appliquée sur confirmation explicite.** Aucun obstacle technique restant. Séquence recommandée si validée : (1) nouvelle vérification transactionnelle rapide contre l'état actuel de la prod (les données ont pu changer depuis la construction), (2) application de la migration seule, (3) vérification live que les 3 RPC répondent, (4) commit + push du code frontend + migration ensemble, (5) smoke test de `/dashboard/admin/finance` en production.

---

## Ce qui n'a pas été traité (hors périmètre, sur instruction explicite)

- **Notifications legacy** (32 sites d'insertion brute contournant `private.notify_secure`) — non ré-audité ici, voir `docs/RELEASE_V1_AUDIT_REPORT.md` § 6/M-2.
- **Hardening sécurité global** (grant `EXECUTE` à `anon` sur 80/94 fonctions `SECURITY DEFINER`) — non ré-audité ici, voir `docs/RELEASE_V1_AUDIT_REPORT.md` § 6/M-1.

Ces deux points restent des décisions ouvertes du rapport d'audit complet, simplement écartées de cette itération de décision par instruction explicite.
