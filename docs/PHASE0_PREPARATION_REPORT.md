# Phase 0 — Rapport de préparation
## Refonte Frontend Premium NK Deliveri

**Statut :** ✅ Préparation terminée — en attente de validation avant toute exécution.
**Fichiers modifiés dans cette phase :** aucun. **Commits créés :** aucun. **Migrations lancées :** aucune. **Backend/Supabase/Edge Functions touchés :** aucun.

Documents sources (produits précédemment dans cette session, mêmes conclusions reprises ici sans les rouvrir à débat) :
- Dossier d'audit frontend NK Deliveri (6 août 2026)
- Spécification de refonte « Refonte Frontend Premium » (Vision, Langage visuel, Design System, Wireframes, Plan de migration, Plan d'implémentation)

---

## 1. Compréhension de la phase

Phase 0 n'est pas une phase d'exécution : c'est un **portail de validation**. Son unique produit est ce rapport. Rien dans le dépôt ne doit changer avant que ce rapport soit approuvé.

Ce qu'il confirme avoir compris :

1. **Le backend est figé.** Supabase, RLS, RPC, Edge Functions, migrations SQL, logique métier : hors périmètre pour l'intégralité de la refonte, pas seulement pour cette phase. Aucun fichier sous `supabase/` ni aucune fonction serveur (`*.functions.ts`) ne sera touché par les phases de design décrites ici.
2. **La refonte est une évolution, pas une reconstruction.** L'audit conclut à des fondations saines (score global 7.4/10, 0 point bloquant critique) — la spécification en découle logiquement : conserver la palette `oklch`, la typographie, Radix, Tailwind v4, l'architecture TanStack Start, et ne refondre que les deux points faibles identifiés (suivi de commande, Kanban restaurant) plus le nettoyage de la dette de cohérence.
3. **La prochaine étape réelle, une fois ce rapport validé, est P1 — Fondations du Design System**, telle que définie dans le plan de migration de la spécification : tokens de statut, tokens de mouvement, échelle typographique, purge des ombres non tokenisées, extension de `Button` avec un état `loading` formel. C'est la phase qui débloque toutes les suivantes (P2–P8) — elle est donc celle dont ce rapport détaille le périmètre fichier par fichier.
4. **Chaque phase suivante (P2 à P8) reste soumise au même principe** : rapport de préparation → validation → exécution → vérification → validation de sortie, avant d'ouvrir la phase suivante. Ce document ne préjuge pas d'un feu vert pour P2+.

---

## 2. Fichiers concernés

### 2.1 Périmètre immédiat — P1 Fondations du Design System

| Fichier | Nature du changement prévu | État actuel vérifié |
|---|---|---|
| `src/styles.css` | Ajout de tokens `--status-good/-soft`, `--status-warn/-soft`, `--status-bad/-soft` (réutilise `--destructive` existant), `--status-info/-soft`, et de tokens de mouvement `--duration-instant/fast/base/entrance` — **additif**, aucun token existant retiré. | Lu intégralement (234 lignes) ; `@theme inline` documente déjà la procédure d'ajout d'un token de couleur — les nouveaux tokens suivent exactement cette convention. |
| `src/components/ui/button.tsx` | Ajout d'une prop `isLoading` formelle sur `buttonVariants`/`Button` — rétrocompatible, aucun appelant existant ne change de comportement sans y opter. | Lu intégralement (57 lignes) ; 6 variantes `cva` existantes, aucune collision de nom prévue. |
| `src/components/dashboard/status-badge.tsx` | Migration des tons `TONE_CLASSES` (`bg-emerald-100`, `bg-amber-100`, `bg-red-100`, `bg-sky-100`…) vers les nouveaux tokens `--status-*`. | Lu intégralement (42 lignes) ; composant à interface stable (`tone`/`children`/`className`), changement interne uniquement. |
| `src/routes/profile.tsx` | Remplacement de `shadow-[0_8px_24px_rgba(194,90,5,…)]` (×3) par `shadow-brand-sm`/`shadow-brand-md`. | Occurrence confirmée par lecture directe. |
| `src/routes/orders.index.tsx` | Idem — même motif d'ombre non tokenisée. | Occurrence confirmée. |
| `src/routes/terms.tsx`, `src/routes/privacy.tsx`, `src/routes/contact.tsx`, `src/routes/faq.tsx` | Idem — 4 pages secondaires. | Occurrences confirmées par recherche (`rgba(194,\s*90,\s*5`, 8 fichiers au total dont `styles.css` lui-même en commentaire explicatif et `revenue-chart.tsx` à vérifier au cas par cas). |
| `src/routes/__root.tsx` | Réhabillage de `NotFoundComponent` et `ErrorComponent` (lignes 23–91) avec `Button`, `font-display`, fond `--cream` — pas de changement de logique de routage. | Lu intégralement (231 lignes). |

**Non concernés par P1** (mentionnés pour mémoire, traités en P2/P3/P4) : `orders.$id.tsx` (timeline), `order-kanban-board.tsx` (Kanban tactile), `dashboard.admin.index.tsx` (hiérarchie de décision). Aucun de ces trois fichiers ne sera ouvert en écriture avant validation explicite de P1 puis de son propre rapport de préparation.

### 2.2 Périmètre différé — aperçu P2 à P8 (pour traçabilité, non exécuté ici)

| Phase | Fichiers principaux | Déclenchée par |
|---|---|---|
| P2 — Suivi de commande | `src/routes/orders.$id.tsx` + les 9 composants `src/components/order/*.tsx` (réordonnancement, pas de réécriture) | Validation P1 |
| P3 — Kanban tactile | `src/components/dashboard/restaurant/order-kanban-board.tsx` | Validation P1 |
| P4 — Dashboard Admin | `src/routes/_authenticated/dashboard.admin.index.tsx` | Validation P1 |
| P5 — Expérience client | Accueil (`src/components/home/*.tsx`), `restaurants.$slug.tsx`, `restaurants.index.tsx`, `checkout.tsx`, `orders.index.tsx`, `profile.tsx` | Validation P1 |
| P6 — Durcissement responsive | Tous les écrans livrés en P2/P3/P5 | Validation P2, P3, P5 |
| P7 — Accessibilité WCAG 2.2 AA | Timeline, Kanban, `StatusBadge`, `Button` | Validation P2, P3, P4 |
| P8 — Performance &amp; PWA | Toggle mode sombre dans `profile.tsx`, `MotionConfig` (`__root.tsx`) | Indépendante |

---

## 3. Dépendances

### 3.1 Techniques (déjà en place, aucune nouvelle librairie requise)
- **Tailwind v4** (`@tailwindcss/vite`) avec système `@theme inline` déjà en place dans `styles.css` — les nouveaux tokens s'y insèrent sans changement d'outillage.
- **class-variance-authority (cva)** — déjà la base de `button.tsx` ; l'ajout d'un état `loading` reste dans ce même modèle.
- **Radix UI** (Dialog/Sheet/Popover/Tooltip/Select) — non modifié par P1.
- **Framer Motion** (`MotionConfig reducedMotion="user"` dans `__root.tsx`) — les tokens de mouvement introduits en P1 sont des valeurs de référence pour les phases suivantes ; P1 ne branche aucune nouvelle animation.

### 3.2 Séquencement inter-phases
P1 est un **prérequis dur** pour P2, P3, P4, P5 (elles consomment les tokens de statut/mouvement). P6 dépend de P2+P3+P5 livrées. P7 dépend de P2+P3+P4. P8 est indépendante et peut démarrer en parallèle dès que souhaité. Aucune phase ne doit démarrer avant que la précédente dont elle dépend soit validée par vous — pas seulement codée.

### 3.3 Dépendances de vérification — outillage déjà présent dans le dépôt
Le projet dispose déjà de tout l'outillage nécessaire pour vérifier chaque phase sans rien ajouter :
- `npm run verify` (`typecheck` → `lint` → `check:migrations` → `test` → `build`) — porte de sortie standard pour chaque phase, déjà définie dans `package.json`.
- **Suite e2e Playwright existante** (`e2e/`), directement réutilisable comme filet de régression par phase :
  - P2 → `e2e/client/order-lifecycle-customer.spec.ts`
  - P3 → `e2e/restaurant/order-lifecycle-restaurant.spec.ts`
  - P4 → `e2e/admin/approvals.spec.ts`, `e2e/admin/finance-dashboard.spec.ts`
  - P5 → `e2e/client/browse-and-order.spec.ts`, `e2e/client/checkout-cash.spec.ts`
  - P6 → `e2e/responsive/checkout-mobile.spec.ts`, `e2e/responsive/navigation-and-layout.spec.ts` (correspondance quasi exacte avec le périmètre de la phase)
  - P7 → `e2e/cross-cutting/accessibility.spec.ts`, qui utilise déjà `@axe-core/playwright`
  - P8 → `e2e/cross-cutting/lighthouse.spec.ts` (via `playwright-lighthouse`), `e2e/cross-cutting/pwa.spec.ts`, `e2e/cross-cutting/offline.spec.ts`
- Pour P1 spécifiquement (changement transverse à faible surface fonctionnelle), le filet de sécurité est `npm run verify` plus une relecture visuelle manuelle des écrans listés en §2.1 — voir §4.3 pour la lacune que cela représente.

### 3.4 Dépendance humaine
Chaque transition de phase (Phase 0 → P1, P1 → P2…) dépend de votre validation explicite. Ce rapport ne déclenche aucune exécution par lui-même.

---

## 4. Risques

### 4.1 Régression fonctionnelle — faible
P1 ne touche que des styles et une prop additive de composant ; aucun appel Supabase, RPC ou route n'est modifié. Le principal vecteur de risque est une classe Tailwind mal substituée sur l'un des 8 fichiers d'ombre — mitigé par `npm run verify` (build échoue sur une classe invalide) et une relecture visuelle ciblée des 8 écrans avant clôture de P1.

### 4.2 Régression visuelle en cascade — moyen, à surveiller particulièrement sur `status-badge.tsx`
`StatusBadge` est consommé par 25+ écrans (listés dans l'audit : dashboards admin/restaurant/livreur, historiques, tables de paiement). Migrer ses tons vers les nouveaux tokens change l'apparence partout d'un coup — c'est l'effet recherché, mais aussi le point où une erreur de teinte se propage le plus largement. Mitigation : migrer `status-badge.tsx` en dernier dans l'ordre d'exécution de P1 (après avoir validé les tokens eux-mêmes sur des écrans isolés comme 404/Erreur), et effectuer une revue visuelle explicite de chaque famille d'écran qui l'utilise avant clôture.

### 4.3 Lacune d'outillage — pas de régression visuelle automatisée
Le dépôt n'a pas de test de régression visuelle (pas de `toHaveScreenshot()` Playwright, pas de Chromatic/Percy) malgré une suite e2e fonctionnelle riche. Pour P1 (changement essentiellement visuel), cela signifie que la vérification de « rien n'a visuellement cassé » reste manuelle. Ce n'est pas bloquant pour une phase de cette taille, mais c'est un risque croissant pour P2/P3/P5 (changements de layout plus profonds) — à signaler comme amélioration possible de l'outillage avant d'attaquer P2, pas comme correctif de P1.

### 4.4 Dérive de portée (scope creep) — faible si le cadrage est respecté
Le plan de migration est explicitement séquencé pour qu'aucune phase n'empiète sur la suivante. Le risque concret serait de « profiter » de l'ouverture de `status-badge.tsx` ou `button.tsx` pour anticiper des besoins de P2/P3 (ex. ajouter déjà des variantes pour la timeline). Ce rapport fixe le périmètre de P1 au tableau du §2.1 — toute extension repasse par un nouveau rapport de préparation.

### 4.5 Adoption partielle des tokens — faible, auto-résolutif
Ajouter des tokens sans migrer immédiatement 100% des consommateurs (ex. `StatusBadge` migré, mais un futur composant qui recoderait encore une couleur Tailwind brute) est un risque de dette qui *revient* plutôt qu'un risque d'exécution de P1. Mitigation : la règle d'utilisation déjà documentée dans la spécification (« tout badge de statut passe par les tokens `--status-*` ») sert de référence de revue de code pour P2–P5.

---

## 5. Plan d'exécution proposé (P1 — en attente de validation, non démarré)

1. Ajouter les tokens `--status-*` et `--duration-*` à `src/styles.css`, en respectant la convention documentée dans le fichier lui-même (variable `:root` + entrée `@theme inline`).
2. Réhabiller `NotFoundComponent`/`ErrorComponent` dans `__root.tsx` — écran isolé, sans dépendant, sert de premier point de vérification visuelle du nouveau vocabulaire avant de toucher des écrans à fort trafic.
3. Étendre `button.tsx` avec la prop `isLoading` — vérifier la non-régression sur au moins un appelant existant (ex. le bouton de confirmation du checkout).
4. Nettoyage mécanique des 8 occurrences d'ombre `rgba(194,90,5,…)` → `shadow-brand-sm`/`shadow-brand-md`.
5. Migrer `status-badge.tsx` vers les nouveaux tokens `--status-*`, en dernier, avec relecture visuelle explicite des familles d'écrans consommatrices (§4.2).
6. Exécuter `npm run verify`.
7. Revue visuelle manuelle des 6 fichiers du §2.1 (avant/après).
8. Rapport de clôture de P1 soumis à votre validation avant ouverture de P2.

Aucune de ces étapes n'a été exécutée. Elles ne démarreront qu'après votre feu vert sur ce rapport.

---

## 6. Garde-fous rappelés

- ❌ Aucun fichier du dépôt modifié dans le cadre de cette Phase 0.
- ❌ Aucun commit, aucune branche créée.
- ❌ Aucune migration Supabase lancée ou écrite.
- ❌ Aucun appel RPC, Edge Function, politique RLS ou schéma de base de données consulté en vue d'une modification.
- ✅ Lecture complète du dossier d'audit et de la spécification de refonte, confrontée au code réel du dépôt à la date du 6 août 2026 (`git status` vérifié propre sur tous les fichiers listés au §2.1).

---

## 7. Prochaine étape

**En attente de votre validation** pour ouvrir l'exécution de P1 selon le plan du §5. Aucune action supplémentaire ne sera entreprise avant ce feu vert.
