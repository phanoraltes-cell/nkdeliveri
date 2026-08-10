# P11 — Remédiation Kanban Restaurant Responsive (F-03)

**Modification strictement frontend. Aucun changement Supabase, API, Edge Function, RLS, migration, logique de commande/paiement/auth. Rien commité, rien poussé — travail local uniquement (voir §11).**

---

## 1. Finding F-03 (rappel)

> Le Kanban restaurant s'ouvre actuellement en vue grille par défaut même sur mobile, alors qu'une vue Liste existe déjà. (P2, `docs/FRONTEND_GLOBAL_AUDIT.md` §25)

---

## 2. Audit du code existant (avant toute modification)

Effectué avant d'écrire une seule ligne, conformément à la consigne — comportement vérifié dans le code réel, pas supposé à partir du rapport d'audit.

- **`src/routes/_authenticated/dashboard.restaurant.orders.tsx`** : composant conteneur de la page `/dashboard/restaurant/orders`. Détient `const [view, setView] = useState<"kanban" | "list">("kanban")` — c'est ici, et seulement ici, que vivait le défaut figé "kanban". Le composant pilote **deux requêtes de données distinctes** :
  - `kanbanOrders` — 100 commandes les plus récentes, tous statuts, non paginées (« snapshot opérationnel en direct »).
  - `orders` — historique complet, filtrable (`Tout`/`An atant`), paginé (`PAGE_SIZE = 30`).
- **Vue Grille** : rendue par `<OrderKanbanBoard>` (`src/components/dashboard/restaurant/order-kanban-board.tsx`), un composant séparé et réutilisable — 7 colonnes, drag-and-drop souris (`draggable`/`onDragStart`/`onDrop`), boutons Konfime/Refize/Avanse par carte, badge d'urgence "X min/è/jou ap tann" pour les commandes `pending` en attente depuis ≥10 min.
- **Vue Liste** : **codée en JSX directement dans le fichier de route**, pas dans un composant séparé — chaque ligne réimplémente ses propres boutons Konfime/Refize/Anile (map `NEXT_STATUS` local, distinct de `NEXT_COLUMN` du Kanban mais avec les mêmes transitions), plus une garde spécifique "paiement non vérifié" que le Kanban n'a pas. **Constat important, qui aurait pu bloquer une remédiation naïve** : la vue Liste n'affichait **aucun badge d'urgence** — seule la Grille le faisait. Traité en §4 plutôt qu'ignoré.
- **Toggle Grille/Liste** : deux `<button>` bruts dans un conteneur `flex ... rounded-full`, sans `role`/`aria-pressed` — état actif porté uniquement par la couleur/l'ombre (`bg-white text-brand-deep shadow-sm` vs `text-ink-soft`).
- **Détection responsive existante** : recherche exhaustive (`useMediaQuery`, `matchMedia`, `innerWidth`) dans `src/` — **aucun hook réutilisable trouvé**. Seul `install-prompt.tsx` utilise `matchMedia`, pour détecter le mode PWA standalone, pas une largeur d'écran.
- **`_authenticated/route.tsx`** définit `ssr: false` sur toute la famille de routes authentifiées — confirmé par un commentaire déjà présent ailleurs dans le code (`orders.$id.tsx`, pour Leaflet) que ce choix rend `window` disponible sans risque d'hydratation SSR sur ces pages.
- **Tests existants** : `e2e/responsive/navigation-and-layout.spec.ts` (`"restaurant order Kanban/list is usable"`, ré-exécuté sur 4 profils d'appareils : Pixel 7/412px, iPhone 13/390px, iPad Mini/768px, Desktop Chrome/1280px) et `e2e/restaurant/order-lifecycle-restaurant.spec.ts` (Konfime, Avanse — projet `restaurant`, viewport desktop implicite 1280px). Baseline exécutée avant toute modification : **13/13 verts**, la totalité en Kanban puisque c'était l'unique défaut possible.
- **Commentaire pré-existant trouvé dans `order-kanban-board.tsx`**, laissé par une phase antérieure : *"The 'Lis' view on this same screen ... has the identical pattern and is not fixed by this change — out of scope for this phase's Kanban-only remediation, left for a future pass."* — confirme que les deux vues sont **délibérément indépendantes dans leur implémentation UI** tout en partageant la même RPC serveur (`update_order_status_secure`). Ce constat a directement guidé le périmètre retenu en §3.

---

## 3. Cause réelle identifiée

Une seule ligne de code porte tout le problème : `useState<"kanban" | "list">("kanban")` ne dépend d'aucune information de viewport — c'est un défaut statique, jamais recalculé, quel que soit l'appareil. La vue Liste, elle, fonctionnait déjà correctement (données, statuts, actions Konfime/Refize/Anile toutes fonctionnelles) — le problème n'était donc pas fonctionnel mais purement une question de **sélection du défaut**.

---

## 4. Solution choisie

### 4.1 Défaut responsive (le cœur de F-03)

Un seul changement dans `dashboard.restaurant.orders.tsx` — l'initialiseur paresseux du `useState` :

```tsx
const [view, setView] = useState<"kanban" | "list">(() =>
  typeof window !== "undefined" && window.innerWidth < 768 ? "list" : "kanban",
);
```

- **768px** — pas un seuil inventé : c'est le breakpoint Tailwind `md` déjà utilisé par `DashboardSidebar` pour basculer du chrome mobile au desktop. Cohérence avec une convention déjà établie dans ce même dashboard, plutôt qu'un nouveau seuil arbitraire.
- **Une seule lecture, au montage** — pas d'écouteur `matchMedia`/`resize` : le défaut ne se recalcule jamais après le premier rendu. C'est volontaire : si l'utilisateur choisit manuellement une vue, un redimensionnement de fenêtre (ou une rotation d'écran) ne doit jamais l'écraser silencieusement. Le prompt lui-même le demande : *"Utilisateur → Peut toujours changer de vue."*
- `typeof window !== "undefined"` : garde défensive, pas structurelle — `ssr: false` sur toute la famille `_authenticated` (voir §2) garantit déjà que ce composant ne s'exécute jamais côté serveur.

**Aucune donnée, aucune requête, aucune action, aucune règle de transition de statut n'a été touchée.** `kanbanOrders`, `orders`, `changeStatus`, `NEXT_STATUS`, tout reste identique — seule la valeur initiale de `view` change.

### 4.2 Accessibilité du toggle

`role="group"` + `aria-label` sur le conteneur, `aria-pressed={view === "kanban"}` / `aria-pressed={view === "list"}` sur chaque bouton — l'état actif n'est plus porté uniquement par la couleur. Ce pattern (`aria-pressed` sur un bouton togglable) est **repris tel quel** de celui déjà utilisé par le composant `Chip` partagé (`src/components/ui/chip.tsx`, utilisé juste en dessous pour les filtres Tout/An atant) — pas une convention inventée pour l'occasion.

### 4.3 Correction du gap trouvé en §2 : urgence absente de la vue Liste

Puisque la vue Liste devient le défaut mobile, un gap trouvé pendant l'audit devenait un vrai problème : **elle ne montrait aucune information d'urgence**, alors que c'est explicitement la priorité #3 de la consigne (*"1. voir rapidement les commandes; 2. comprendre leur statut; 3. identifier les commandes urgentes; 4. effectuer l'action principale"*) et que §5 exige que la vue Liste conserve les *"informations critiques"*.

Plutôt que de dupliquer la logique d'urgence de `OrderKanbanBoard` dans le fichier de route (ce que la consigne interdit explicitement, §3), elle a été **extraite** vers `src/lib/order-status.ts` — le fichier qui contient déjà les constantes de statut partagées entre les deux vues (`ORDER_STATUS_LABEL`, `TERMINAL_ORDER_STATUSES`) :

```ts
export function getOrderWaitUrgency(status: string, createdAt: string):
  | { isUrgent: true; minutesWaiting: number }
  | { isUrgent: false; minutesWaiting: number | null }

export function formatOrderWaitTime(minutes: number): string
```

- `OrderKanbanBoard` a été mis à jour pour **appeler** cette fonction extraite au lieu de sa copie locale (suppression de la duplication existante, pas ajout d'une nouvelle) — comportement et seuil (10 min) strictement identiques, vérifié visuellement (§8) : le badge "221 jou ap tann" s'affiche à l'identique dans les deux vues pour la même commande fixture.
- La vue Liste affiche désormais le même badge (`bg-status-bad-soft text-status-bad`, "X min/è/jou ap tann"), juste à côté du badge de statut existant, pour les commandes `pending` en attente depuis ≥10 min — **même donnée, même seuil, même format, présentation différente**, exactement ce que demande §3 de la consigne.
- Le type de retour est une union discriminée sur `isUrgent` plutôt que `{ isUrgent: boolean; minutesWaiting: number | null }` : TypeScript ne pouvait plus narrower `minutesWaiting` à `number` après extraction dans une fonction séparée (le narrowing d'alias de TS 4.4+ qui fonctionnait sur l'expression locale d'origine ne traverse pas un appel de fonction opaque) — détecté par `npm run typecheck`, corrigé proprement plutôt que contourné par une assertion non-null.

**Aucun autre écart de logique** entre les deux vues n'a été touché (ex. la garde "paiement non vérifié" reste spécifique à la Liste, le bouton "Anile kòmand" pour les statuts non-terminaux aussi) — ce ne sont pas des régressions de F-03, ils existaient déjà avant et restent hors périmètre.

---

## 5. Fichiers modifiés

| Fichier | Nature du changement |
|---|---|
| `src/routes/_authenticated/dashboard.restaurant.orders.tsx` | Défaut de vue responsive (§4.1), `role="group"`/`aria-pressed` sur le toggle (§4.2), badge d'urgence dans la vue Liste (§4.3) |
| `src/components/dashboard/restaurant/order-kanban-board.tsx` | Suppression de la logique d'urgence dupliquée, appel à la fonction partagée à la place (§4.3) — aucun changement de comportement |
| `src/lib/order-status.ts` | Ajout de `getOrderWaitUrgency` et `formatOrderWaitTime`, extraits depuis `order-kanban-board.tsx` |
| `e2e/responsive/navigation-and-layout.spec.ts` | Test existant mis à jour pour vérifier le vrai contenu par largeur (§7) |

**Note de transparence** : `git status` montre aussi des modifications sur `src/components/auth/restaurant-form.tsx`, `src/components/dashboard/admin/driver-detail-dialog.tsx`, `src/integrations/supabase/types.ts`, `src/lib/register-documents.functions.ts`, `src/routes/_authenticated/dashboard.driver.profile.tsx` et `src/routes/_authenticated/dashboard.restaurant.profile.tsx` — **ces fichiers n'ont pas été touchés par cette phase**, ils appartiennent à un autre travail en cours dans ce même dépôt (zone inscription/documents restaurant/livreur, sans rapport avec le Kanban). Non lus en détail, non modifiés, non inclus dans la portée de ce rapport.

---

## 6. Comportement desktop

Inchangé par rapport à avant P11 : la page s'ouvre en vue **Kanban**, 7 colonnes, drag-and-drop souris fonctionnel, boutons Konfime/Refize/Avanse identiques. Vérifié visuellement à 768px (limite basse desktop) et 1440px (§8) — aucune régression visuelle, le badge d'urgence s'affiche désormais avec le texte exact déjà utilisé auparavant (extraction sans changement de sortie).

## 7. Comportement mobile

La page s'ouvre désormais en vue **Liste** en dessous de 768px. Toutes les actions existantes restent identiques (Konfime, Refize, Anile kòmand, impression du bon cuisine, masquage d'historique) — aucune n'a été retirée ni réimplémentée. Le badge d'urgence, absent avant P11 dans cette vue, y apparaît maintenant pour les commandes en attente depuis ≥10 minutes, avec le même style visuel que sur le Kanban.

Le toggle Grille/Liste reste pleinement fonctionnel dans les deux sens à toutes les largeurs — un utilisateur mobile peut toujours rouvrir la Grille manuellement s'il le préfère (vérifié dans le test, §7).

---

## 8. Vérification visuelle réelle (captures Playwright)

Spec temporaire créée, exécutée, puis supprimée après inspection (`e2e/cross-cutting/_zz-p11-kanban-visual.spec.ts`) — capture `fullPage` de `/dashboard/restaurant/orders` à **320, 390, 414, 768, 1024, 1440px**, avec une commande `pending` ancienne (urgente, "221 jou ap tann") et une commande `confirmed` fraîche (non urgente) affichées ensemble, pour voir les deux cas dans la même capture.

| Largeur | Vue par défaut confirmée | Observations |
|---:|---|---|
| 320px | **Lis** | Cartes lisibles, badges de statut + urgence sur une seule ligne avec retour à la ligne propre, boutons Konfime/Refize empilés proprement, aucun débordement horizontal |
| 390px | **Lis** | Idem, boutons Konfime/Refize/Konfime tiennent sur une ligne |
| 414px | **Lis** | Idem |
| 768px | **Kanban** | Sidebar en mode icône seule (comportement `md` existant, non lié à P11), 4 colonnes visibles, carte urgente avec bordure rouge à gauche identique à avant |
| 1024px | **Kanban** | Sidebar toujours en mode icône (`lg` non atteint), colonnes bien espacées |
| 1440px | **Kanban** | Sidebar complète avec libellés, mise en page identique à avant P11 |

**Aucun chevauchement, aucun débordement, aucune perte de lisibilité constatée à aucune des 6 largeurs.**

---

## 9. Accessibilité

- Le toggle expose maintenant son état actif via `aria-pressed` (`"true"`/`"false"`), vérifié programmatiquement dans le test mis à jour (§7), pas seulement visuellement.
- `role="group"` + `aria-label="Chwazi fason pou wè kòmand yo"` sur le conteneur du toggle, pour qu'un lecteur d'écran annonce qu'il s'agit d'un groupe de choix de présentation, pas de deux boutons isolés sans rapport.
- Le pattern `aria-pressed` reprend celui déjà utilisé par le composant `Chip` partagé — cohérence avec une convention d'accessibilité déjà existante dans ce même dashboard, pas une invention isolée.
- `npx eslint` et `npx tsc --noEmit` : clean sur les 4 fichiers modifiés.
- `accessibility.spec.ts` (axe-core) exécuté après modification (§10) : le test "restaurant dashboard" (qui charge exactement `/dashboard/restaurant/orders`) est **resté vert** dans les deux exécutions de contrôle — aucune nouvelle violation introduite par le toggle ou le badge d'urgence.

---

## 10. Tests

### 10.1 Baseline (avant modification)

```
npx playwright test e2e/responsive/navigation-and-layout.spec.ts e2e/restaurant/order-lifecycle-restaurant.spec.ts e2e/cross-cutting/accessibility.spec.ts --grep "restaurant"
→ 13 passed (13)
```

### 10.2 Test mis à jour — vérifie le vrai contenu, pas seulement l'URL

`"restaurant order Kanban/list is usable"` (`e2e/responsive/navigation-and-layout.spec.ts`) a été complété pour :
1. Lire la largeur réelle du viewport (`page.viewportSize()?.width`), pas le nom du projet.
2. En dessous de 768px : vérifier que le chip "Tout" (propre à la vue Liste, sans équivalent Kanban) **est visible**, que le titre de colonne Kanban "Nouvo kòmand" **ne l'est pas**, que la commande fixture s'affiche réellement (`order.order_number`), et que `aria-pressed="true"` est bien posé sur le bouton "Lis".
3. À 768px et plus : l'inverse exact (Kanban visible, chip "Tout" absent, `aria-pressed="true"` sur "Kanban").
4. Clique ensuite sur l'autre vue et vérifie qu'elle s'affiche bien — le toggle reste utilisable dans les deux sens à chaque largeur.

Une vérification qui se limitait à `toHaveURL` n'aurait rien prouvé de ce que P11 devait changer — c'est pourquoi ce test lit désormais du contenu réel rendu, conformément à la consigne.

### 10.3 Après modification

```
npx playwright test e2e/responsive/navigation-and-layout.spec.ts e2e/restaurant/ e2e/cross-cutting/accessibility.spec.ts
→ 21 passed, 4 failed (accessibility.spec.ts uniquement — voir §10.4)
```

```
npx playwright test e2e/responsive/navigation-and-layout.spec.ts e2e/restaurant/
→ 16 passed (16) — zéro échec sur tout ce qui touche au Kanban/Liste/lifecycle restaurant
```

⚠️ **Piège méthodologique rencontré et corrigé en cours de route** : la première exécution après modification du code source a échoué à l'assertion `aria-pressed` — pas à cause d'un bug, mais parce que le serveur de preview Playwright (`e2e/mocks/preview-server.ts`) importe une seule fois le bundle compilé et le garde en mémoire ; il servait encore le build **d'avant** mon changement. Corrigé en relançant `npm run build:e2e` avant de ré-exécuter les tests — documenté ici pour la même raison de transparence que dans l'audit précédent.

### 10.4 `npm run verify`

```
Test Files  13 passed (13)
     Tests  143 passed (143)
```
Typecheck, lint, garde-fou migrations, tests unitaires, build — **tous verts**, exit code 0.

Les 4 échecs `accessibility.spec.ts` restants (home, checkout, admin dashboard, order tracking) sont tous la même violation `color-contrast` déjà documentée en détail dans `docs/FRONTEND_GLOBAL_AUDIT.md` §15 (F-08, compromis de couleur de marque déjà connu et accepté) — **aucun ne concerne la page `/dashboard/restaurant/orders`** modifiée par cette phase, confirmé en isolant son propre test ("restaurant dashboard") qui reste vert dans les deux exécutions.

---

## 11. Non-régression

| Fonctionnalité | Statut |
|---|---|
| Konfime (Kanban + Liste) | ✅ intact — `order-lifecycle-restaurant.spec.ts` vert |
| Refize (Kanban + Liste) | ✅ intact — code non touché |
| Avanse / Kòmanse prepare (Kanban + Liste) | ✅ intact — `order-lifecycle-restaurant.spec.ts` vert |
| Drag-and-drop (Kanban) | ✅ intact — code non touché |
| Vue Liste (filtres, pagination, masquage historique) | ✅ intact — code non touché, sauf ajout additif du badge d'urgence |
| Vue Grille | ✅ intact, comportement et sortie identiques (extraction sans changement) |
| Badge d'urgence (Kanban) | ✅ intact — comportement identique, source déplacée |
| États de commande (statuts, transitions) | ✅ intacts — `NEXT_STATUS`/`NEXT_COLUMN` non touchés |

---

## 12. Risques ou limitations

- Le seuil 768px n'a pas été explicitement demandé par le prompt (qui liste 768px sans le classer côté mobile ou desktop) — choisi par cohérence avec le breakpoint `md` déjà utilisé pour la sidebar du même dashboard, documenté et vérifié à cette limite exacte (§8).
- Le défaut n'est calculé qu'une fois au montage (pas de mise à jour live sur redimensionnement) — comportement voulu (voir §4.1), mais signifie qu'un utilisateur qui redimensionne sa fenêtre après le premier rendu ne verra jamais son défaut recalculé automatiquement ; il devra utiliser le toggle manuellement. Cohérent avec l'exigence de ne jamais écraser un choix manuel.
- Aucun test unitaire dédié (Vitest) n'a été ajouté pour `getOrderWaitUrgency`/`formatOrderWaitTime` — la couverture reste E2E uniquement (comportement observé bout-en-bout dans les deux vues). Non demandé explicitement par la consigne (qui ne mentionne que des tests Playwright), mais signalé comme amélioration possible.
- Le commentaire pré-existant dans `order-kanban-board.tsx` notant que "Lis" avait "the identical pattern" de boutons Konfime/Refize non factorisés (couleurs `bg-emerald-600`/`bg-red-600` en dur au lieu du composant `Button` partagé) reste **non traité** — c'était déjà explicitement hors périmètre d'une phase antérieure, et reste hors périmètre de F-03 (qui porte sur le *défaut de vue*, pas sur l'harmonisation des boutons). Non dupliqué ni aggravé par cette phase.

---

## Décision finale

## ✅ PRÊT POUR VALIDATION VISUELLE
