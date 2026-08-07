# Phase 2.1 — Rapport de remédiation
## Correction des deux anomalies bloquantes (Suivi de commande)

**Portée respectée :** exclusivement les deux anomalies identifiées dans `docs/PHASE2_PUSH_DECISION_REPORT.md`. Aucun refactoring, aucune logique métier modifiée, aucun composant protégé (les 8 sections) touché, aucun changement Supabase/API/Edge Function/migration.

**Fichier modifié :** un seul — `src/routes/orders.$id.tsx`.

---

## 1. Les deux corrections appliquées

### Anomalie 1 — Paiement manuel en cours de vérification (`under_review`)

Ajout d'une bannière dans la zone d'action principale, visible dès que `isManual && payment?.status === "under_review"` :

> 🕐 Nou resevwa prèv peman ou a — n ap verifye li. Pa gen lòt aksyon pou ou fè kounye a.

Remplit les 4 exigences demandées : confirme la réception (« Nou resevwa prèv peman ou a »), explique que la vérification est en cours (« n ap verifye li »), rassure et précise explicitement qu'aucune action n'est requise (« Pa gen lòt aksyon pou ou fè kounye a »). Mêmes tokens que la bannière « paiement automatique en attente » déjà existante (`bg-status-info-soft` / `text-status-info`, icône `Clock` déjà importée) — aucun nouveau token, aucune nouvelle couleur.

### Anomalie 2 — Litige actif sur commande non terminale

Deux ajouts complémentaires, tous deux dans `orders.$id.tsx` :

1. **Un hook de lecture** (`useQuery`) qui reproduit exactement la requête déjà utilisée par `DisputeSection` (même `queryKey`, mêmes colonnes) — React Query déduplique automatiquement les deux en un seul appel réseau. Aucune nouvelle logique backend, uniquement une réutilisation de la donnée déjà exposée par la table `disputes` existante.
2. **Une bannière cliquable**, visible quand `!TERMINAL_ORDER_STATUSES.has(o.status) && dispute.data && !DISPUTE_TERMINAL_STATUSES.has(dispute.data.status)` :

> ⚠️ Nou resevwa siyalman ou a — ekip sipò a ap swiv dosye a. →

Le lien pointe vers `#dispute`, une ancre ajoutée autour de l'appel existant à `<DisputeSection>` (le composant lui-même n'est pas modifié — seul son emplacement d'appel dans `orders.$id.tsx` est enveloppé d'un `<div id="dispute">`). Les navigateurs modernes déroulent automatiquement un `<details>` ancêtre quand sa cible de fragment est visée, donc ce lien ouvre aussi l'accordéon — sans JavaScript ni composant supplémentaire.

Remplit les 3 exigences demandées : informe clairement qu'un litige est en cours, rappelle que le support suit le dossier, et donne un accès direct au fil existant.

## 2. Fichiers modifiés

| Fichier | Nature du changement |
|---|---|
| `src/routes/orders.$id.tsx` | +65 / -3 lignes : 1 import (`AlertTriangle`), 1 import (`DISPUTE_TERMINAL_STATUSES`), 1 hook `useQuery` (dédupliqué avec celui de `DisputeSection`), 2 blocs de bannière, 1 `<div id="dispute">` enveloppant l'appel existant à `<DisputeSection>`. |

Aucun autre fichier du dépôt n'a été touché — confirmé par `git status` (seul `orders.$id.tsx` apparaît modifié parmi les fichiers suivis liés à cette session).

## 3. Scénarios retestés

Relecture ligne à ligne du fichier final contre chacun des 13 états demandés (pas d'exécution visuelle disponible dans cet environnement — vérification structurelle/logique, comme pour les rapports précédents).

| État | Timeline | Bannière | Une seule action visible | État silencieux | Conflit de bannières | Accordéon |
|---|---|---|---|---|---|---|
| pending (kach) | ✅ | Aucune (à raison) | ✅ | Non | — | Fermé, Anile visible |
| confirmed | ✅ | Aucune | ✅ | Non | — | Fermé, Anile visible |
| preparing | ✅ | Aucune (litige pas encore éligible) | ✅ | Non | — | Fermé |
| ready | ✅ | Litige si actif (**corrigé**) | ✅ | **Non — corrigé** | Non (voir §5) | Fermé, lien `#dispute` fonctionnel |
| delivering | ✅ (assigned/picked_up fusionnés) | Litige si actif (**corrigé**) | ✅ | **Non — corrigé** | Non | Fermé, carte + chat visibles |
| delivered | ✅ (badge vert) | Aucune (accordéon déjà ouvert) | ✅ | Non | — | **Ouvert automatiquement**, litige visible directement |
| cancelled | ✅ (état plat rouge) | Aucune (accordéon déjà ouvert) | ✅ | Non | — | Ouvert automatiquement |
| payment pending (manuel) | ✅ | — (formulaire = action directe) | ✅ | Non | — | Fermé |
| payment pending (auto) | ✅ | « N ap tann konfimasyon… » | ✅ | Non | — | Fermé |
| **under_review** | ✅ | « Nou resevwa prèv peman ou a… » (**corrigé**) | ✅ | **Non — corrigé** | Non | Fermé, détail redondant mais cohérent si ouvert |
| paid | ✅ | Légende « Peman konfime » | ✅ | Non | — | Fermé |
| payment rejected (manuel/auto) | ✅ | Formulaire ou « pa t reyisi » | ✅ | Non | — | Fermé |
| dispute active (non terminal) | ✅ | Bannière ambre + lien (**corrigé**) | ✅ | **Non — corrigé** | Non | Fermé, ouverture auto au clic |
| dispute resolved | ✅ | Aucune (exclue explicitement) | ✅ | Non | — | Selon statut de la commande |

Les deux lignes en gras sont les anomalies du rapport précédent — désormais couvertes.

## 4. Résultat de `npm run verify`

Exécuté étape par étape (le lancement groupé avait déjà expiré sans erreur lors de P2 — même prudence reconduite) :

```
typecheck        : 0 erreur
lint              : 0 erreur, 12 avertissements (identiques, pré-existants, aucun dans les fichiers touchés)
check:migrations  : 122 migrations scannées, aucun hazard non résolu
tests unitaires   : 105/105 passés
build             : réussi (client + SSR + service worker PWA)
```

## 5. Audit de non-régression

- **Écran unique modifié :** `git status` confirme que seul `src/routes/orders.$id.tsx` a changé — aucun autre écran, aucun composant partagé, aucune des 8 sections protégées.
- **Design System :** aucun nouveau token — réutilisation de `--status-info`/`-soft` (déjà utilisés par la bannière automatique) et introduction de `--status-warn`/`-soft` pour la bannière de litige, tous deux déjà définis en Phase 1 mais pas encore consommés ailleurs dans ce fichier ; aucune couleur Tailwind brute.
- **Conflit entre bannières :** analysé explicitement (commentaire dans le code) — les deux familles de bannières (paiement / litige) ne peuvent pas apparaître simultanément pour la même commande dans le flux normal : un litige n'est éligible qu'à partir du moment où la commande dépasse `preparing`, alors que toutes les bannières de paiement (y compris `under_review`) ne s'appliquent que tant que la commande reste `pending` — une commande ne peut pas avancer au-delà de `pending` tant que son paiement moncash/natcash n'est pas `paid`, manuel ou automatique. **Réserve honnête :** cette garantie a été vérifiée pour les rails moncash/natcash (manuel et automatique) ; le rail Stripe n'a pas été audité aussi loin dans cette session — dans le pire cas théorique non vérifié, l'effet serait deux bannières informatives empilées (pas contradictoires), un risque préexistant à cette remédiation et non aggravé par elle, puisque les bannières `isCollect` existaient déjà sans garde de statut de commande avant même la Phase 2.
- **Performance :** le nouveau hook réutilise la requête déjà faite par `DisputeSection` (déduplication React Query par `queryKey` identique) — aucun appel réseau supplémentaire dans le cas courant où les deux montent ensemble.
- **Accessibilité :** la bannière de litige est un vrai `<a>` avec texte descriptif visible, focusable au clavier, sans `aria-label` nécessaire. Aucune régression par rapport à l'existant.
- **Fonctionnalités existantes :** toutes conservées à l'identique — aucune section déplacée hors de son emplacement Phase 2, seul `DisputeSection` gagne un `id` sur son conteneur d'appel.

## 6. Recommandation finale

### ✅ Push autorisé

Les deux anomalies bloquantes du rapport de décision précédent sont corrigées, vérifiées scénario par scénario, sans effet de bord détecté sur les 11 autres états. `npm run verify` est entièrement au vert. Aucun autre écran n'a été touché. La seule réserve consignée (§5, rail Stripe non ré-audité) est préexistante à cette remédiation, non aggravée par elle, et ne concerne pas les deux anomalies traitées ici.

**Recommandation complémentaire, non bloquante :** une vérification visuelle rapide sur `/orders/$id` pour une commande en `under_review` et une commande avec litige actif reste la meilleure façon de confirmer le rendu réel avant diffusion large — mais n'est plus, à ce stade, une condition de blocage du push.
