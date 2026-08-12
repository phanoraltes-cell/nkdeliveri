# Phase 7 — Accessibilité WCAG 2.2 AA — Rapport de clôture

**Statut : Commit local effectué (`08c9a36`). En attente de confirmation avant push.**

## Périmètre

Refonte Frontend Premium, Phase 7, tel que défini dans la spécification : vérifier le
contraste des nouveaux tokens de statut, la navigation clavier du Timeline et du Kanban, et
la présence de messages d'état explicites sur les nouveaux états loading/disabled.
Composants dans le périmètre : Timeline, Kanban, StatusBadge, Button.

## Ce qui a changé

### 1. `src/styles.css` — contraste de `--status-bad`

`--status-bad` réutilisait `var(--destructive)` tel quel depuis la Phase 1. Mesure
(calcul manuel de luminance relative WCAG à partir des valeurs oklch, plus confirmation
axe-core) du contraste entre `--status-bad` et son fond `--status-bad-soft` :

| Mode  | Avant                | Ratio avant                        | Après                 | Ratio après |
| ----- | -------------------- | ---------------------------------- | --------------------- | ----------- |
| Light | `var(--destructive)` | 3.53:1 ❌ (seuil AA texte : 4.5:1) | `oklch(0.44 0.19 25)` | ~6.63:1 ✅  |
| Dark  | `var(--destructive)` | 4.50:1 ⚠️ (tout juste à la limite) | `oklch(0.75 0.19 25)` | ~4.95:1 ✅  |

`--destructive` lui-même **n'a pas été modifié** — c'est un token beaucoup plus large et
déjà en production (boutons destructifs, texte blanc dessus, déjà ≥4.5:1 dans tous ses
usages actuels). Conformément à la contrainte déjà actée sur `--brand`, je n'ai pas
retouché une couleur de marque déjà en production sans validation explicite — `--status-bad`
a simplement sa propre valeur maintenant, alignée sur la même famille de luminosité que
`--status-good/-warn/-info`.

### 2. `src/components/order/order-status-timeline.tsx` — état des étapes pour lecteurs d'écran

Les étapes du timeline (fini / actif / à venir) n'étaient portées que visuellement (couleur,
anneau, icône check en `aria-hidden`). Ajouts, purement additifs, aucun changement visuel :

- `aria-label="Pwogrè kòmand"` sur le `<ol>`.
- `aria-current="step"` sur le `<li>` actif — la valeur ARIA prévue précisément pour une
  étape dans un processus.
- Un suffixe `sr-only` par étape (« — fini » / « — etap aktyèl »).

### 3. `e2e/cross-cutting/accessibility.spec.ts` — couverture axe-core manquante

`/orders/$id` (le Timeline, explicitement dans le périmètre P7) n'avait aucune couverture
axe-core. Deux tests ajoutés : le timeline actif, et la branche cancelled/refunded (un
chemin de rendu structurellement différent dans `OrderStatusTimeline`, pas juste un label
différent).

### 4. Kanban et `Button.isLoading` — vérifiés, aucun changement de code

- Les boutons Konfime/Refize/Avanse du Kanban sont des `<button>`/`<Button>` natifs —
  focusables et activables au clavier (Tab puis Entrée/Espace) par construction. Le
  `draggable` sur la carte n'interfère pas avec le focus des boutons qu'elle contient.
- `Button`'s `isLoading` implémente déjà `aria-busy={isLoading || undefined}` et
  `disabled={props.disabled || isLoading}` depuis la Phase 1 — confirmé par lecture du
  code, rien à corriger.

## Vérification

`npm run verify` (typecheck, lint, contrôle migrations, tests unitaires, build) : **clean**.

## Découverte hors-périmètre — limitation pré-existante du harnais e2e (importante)

En re-exécutant `e2e/cross-cutting/accessibility.spec.ts` isolément pour confirmer les
correctifs, les 3 échecs déjà documentés dans `docs/E2E_TEST_REPORT.md` (2 contraste
`text-brand`/`text-brand-deep`, 1 timeout checkout) se reproduisent à l'identique. Vérifié
via `git diff` que les fichiers concernés (`site-header.tsx`, `restaurants.$slug.tsx`)
n'ont pas été touchés cette session — conforme à la contrainte marque, non retouché.

En creusant plus loin pour valider mes propres nouveaux tests (Timeline), et en re-exécutant
aussi `e2e/responsive/order-tracking.spec.ts` (Phase 6, jusqu'ici considéré stable) et
`e2e/client/order-lifecycle-customer.spec.ts`, j'ai trouvé quelque chose de plus large que
prévu : **tout test qui fait un `page.goto()` direct vers une route protégée peut afficher
l'écran de connexion au lieu de la page attendue**, y compris des tests préexistants déjà
dans ce fichier (customer/restaurant/driver/admin dashboard) que je n'ai pas touchés.

Cause : `mockSupabaseAuth` (dans `e2e/support/mock-supabase.ts`) ne fait que déposer une
session dans le `localStorage` du **navigateur**. Il n'a aucun moyen d'authentifier le
rendu **SSR** initial qu'un `page.goto()` déclenche — c'est exactement la limitation déjà
documentée dans `docs/E2E_TEST_REPORT.md` (« architecture recap » en tête de
`mock-supabase.ts»), mais je ne l'avais jusqu'ici vue affecter que le test checkout. Elle
touche en réalité tous les tests de ce fichier basés sur un chargement complet d'une route
protégée.

Conséquence concrète pour ce rapport : un axe-scan qui « passe » sur une route protégée
dans ce fichier ne prouve pas qu'il a bien scanné la page attendue plutôt que l'écran de
connexion — c'est vrai pour mes 2 nouveaux tests Timeline autant que pour les 4 tests
dashboard préexistants. Je ne l'ai pas corrigé ici : réparer ce harnais demanderait un mock
de session compatible SSR (cookies), un chantier d'infrastructure de test à part entière,
hors du périmètre d'une phase d'accessibilité front. J'ai :

- Laissé les 2 nouveaux tests en place (cohérent avec la convention existante du fichier
  pour toute route protégée, et ils deviendront réellement probants dès que ce trou
  d'infrastructure sera comblé), avec un commentaire explicite dans le code.
- Vérifié le correctif ARIA du Timeline par lecture directe du code plutôt que par scan
  automatisé du composant réellement rendu, faute d'un canal fiable pour l'obtenir
  actuellement (technique `aria-current="step"` conforme à la recommandation WCAG pour les
  indicateurs d'étape ; changement strictement additif, aucune suppression de rôle ou de
  nom accessible existant).
- Documenté ceci ici comme recommandation de suivi plutôt que de le glisser sous le tapis.

## Findings classés

| #   | Sévérité                   | Constat                                                                        | Action                                  |
| --- | -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| 1   | Réel, corrigé              | `--status-bad` sous le seuil AA (3.53:1 light)                                 | ✅ Corrigé                              |
| 2   | Réel, corrigé              | Timeline sans état accessible (lecteurs d'écran)                               | ✅ Corrigé                              |
| 3   | Hors périmètre, déjà connu | Contraste `text-brand`/`text-brand-deep` (marque)                              | ❌ Non touché (contrainte marque)       |
| 4   | Hors périmètre, infra      | SSR mock auth non session-aware — affecte plus de tests qu'identifié jusqu'ici | 📋 Recommandation de suivi, non corrigé |

## Recommandation

Aucun changement de cette phase n'introduit de régression (`npm run verify` clean, diffs
strictement additifs). Prêt à commit — déjà fait localement (`08c9a36`). **En attente de
votre confirmation avant `git push`**, comme pour les phases précédentes.
