# P12 — Remédiation page Notifications (`/notifications`)

**Modification strictement frontend, limitée à cette page. Aucun changement Supabase, RPC, Edge Function, préférences backend, push, authentification. Rien commité, rien poussé — travail local uniquement (voir §16).**

---

## 0. Audit préalable (rappel du point de départ)

Lu intégralement avant toute modification : `docs/NOTIFICATIONS_PAGE_AUDIT.md`. Code réel réinspecté (`notifications.tsx`, `push-toggle.tsx`, `notification-preferences-panel.tsx`, `notification-permission-denied-help.tsx`) pour confirmer que rien n'avait changé depuis l'audit. Composants Design System déjà disponibles vérifiés avant d'écrire quoi que ce soit : `Chip` (`src/components/ui/chip.tsx`, déjà `aria-pressed`), `EmptyState` (`src/components/dashboard/cards/empty-state.tsx`). **Aucun composant `Checkbox`/`Switch`/`FormControl` n'existe dans `src/components/ui/`** — vérifié par `ls`, pas supposé.

---

## 1. Findings traités

| Finding (audit)                                                       | Statut                                                                                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Header mobile — chevauchement titre/PushToggle (P2)                   | ✅ Corrigé                                                                                                              |
| Onglets catégorie — boutons bruts sans `aria-pressed` (P3)            | ✅ Corrigé (migré vers `Chip`)                                                                                          |
| Préférences — cases natives non stylées, tap target trop petit (P3)   | ✅ Corrigé (cases natives conservées, habillage + tap target agrandis)                                                  |
| État vide — texte brut au lieu de `EmptyState` (P3)                   | ✅ Corrigé                                                                                                              |
| Icônes — 3 catégories seulement sur 9 (P4)                            | ✅ Amélioré (6 catégories de plus, 1 conservée en fallback documenté)                                                   |
| Notifications cliquables vs informatives indiscernables (P3)          | ✅ Corrigé                                                                                                              |
| `color-contrast` (F-08, compromis de marque site-large)               | **Non touché**, décision globale non rouverte (voir §8)                                                                 |
| Onglets sur 2-3 lignes mobile (P4, "piste" optionnelle #3 de l'audit) | **Non traité** — hors périmètre des 8 sections numérotées du prompt P12 (rail horizontal explicitement non demandé ici) |
| Liste mono-colonne sur très large écran (P4)                          | **Non traité** — même raison, non listé dans les 8 problèmes numérotés de P12                                           |

---

## 2. Fichiers modifiés

| Fichier                                             | Nature du changement                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/_authenticated/notifications.tsx`       | Header responsive (§3), onglets → `Chip` (§4), état vide → `EmptyState` (§6), icônes par catégorie (§7), affordance cliquable/informative (§8) |
| `src/components/notification-preferences-panel.tsx` | Habillage des cases à cocher + agrandissement du tap target (§5)                                                                               |
| `e2e/responsive/notifications-mobile.spec.ts`       | **Nouveau** — test de non-régression permanent (§13)                                                                                           |

Aucun autre fichier touché. `Chip` et `EmptyState` ont été **consommés**, pas modifiés — zéro risque pour les ~15 autres pages qui les utilisent déjà.

---

## 3. Header mobile (P2) — la correction principale

**Cause exacte** (confirmée dans le code, pas supposée) : `<div className="flex items-center justify-between">` sans `flex-wrap` forçait `<h1>` et `<PushToggle />` sur une seule ligne, quelle que soit la largeur réelle du contenu de `PushToggle`.

**Solution retenue** :

```tsx
<div className="flex flex-wrap items-start justify-between gap-3 sm:items-center">
```

- `flex-wrap` : seul changement structurellement nécessaire — dès qu'un des deux blocs ne tient plus sur la ligne, il passe naturellement à la ligne suivante, sans jamais chevaucher, **quelle que soit la largeur réelle du contenu** (pas de seuil `sm:`/`md:` codé en dur pour décider QUAND empiler — le navigateur le décide lui-même selon le contenu réel, conformément à la contrainte "fonctionner avec du contenu réellement variable").
- `items-start` par défaut (empilé : chaque bloc s'aligne proprement en haut), `sm:items-center` seulement pour recentrer verticalement une fois que les deux tiennent côte à côte.
- `gap-3` pour un espacement propre dans les deux configurations.

**Pourquoi cette solution couvre tous les états de `PushToggle`, pas seulement "denied"** : `PushToggle` a 3 rendus possibles — bouton compact, message "navigateur non supporté", ou `NotificationPermissionDeniedHelp`. Les deux derniers sont des blocs larges de forme identique (texte + liste/bouton). La correction n'a ciblé aucun état spécifiquement — elle rend la ligne d'en-tête robuste à _n'importe quel_ contenu large, ce qui a été confirmé utile en pratique : le test automatisé (§13) montre que Chromium affiche l'état "denied" tandis que WebKit affiche "non supporté" (l'API Push n'y est pas exposée de la même façon dans l'environnement Playwright) — **les deux cas passent avec la même correction, sans code spécifique à l'un ou l'autre**.

Ni réduction de texte, ni masquage du message, ni largeur fixe — conforme aux contraintes du prompt.

---

## 4. Onglets de catégorie → `Chip`

Les 9 `<button>` bruts ont été remplacés par le composant `Chip` déjà utilisé pour les filtres "Tout"/"An atant" juste en dessous, avec la logique de sélection strictement identique :

```tsx
<Chip key={c.key} selected={tab === c.key} onClick={() => setTab(c.key)}>
  {c.label}
</Chip>
```

`Chip` pose déjà `aria-pressed={selected}` en interne — vérifié programmatiquement (pas seulement visuellement) dans un test dédié : `aria-pressed="true"` sur l'onglet actif, `"false"` sur les autres, et bascule correctement au clic (§9). Comportement de filtrage, de sélection et de responsive (wrap) **strictement inchangé** — seule la présentation et l'accessibilité ont changé, conformément à la contrainte du prompt. Aucun nouveau composant créé.

---

## 5. Panneau des préférences — cases à cocher

Aucun composant `Checkbox`/`Switch` n'existe dans le Design System (vérifié, §0) — conformément à la contrainte de ne pas ajouter de dépendance ni de composant lourd pour cette phase, **les `<input type="checkbox">` natifs sont conservés tels quels** (sémantique et clavier déjà corrects). Deux changements seulement :

1. Chaque `<label>` — qui enveloppait déjà nativement son `<input>` (donc déjà cliquable sur toute sa surface au niveau HTML) — reçoit maintenant `rounded-lg px-2 py-2.5 hover:bg-brand-soft/30`, ce qui rend cette zone déjà-cliquable _visible_ et confortable (~44px de hauteur au lieu de ~20px). Conforme à la consigne : _"Éviter de rendre uniquement le petit carré de checkbox cliquable. Lorsque pertinent, rendre la ligne/label suffisamment interactive."_
2. `accent-brand` sur chaque case — teinte la coche en orange de marque au lieu du bleu par défaut du navigateur, seul point d'alignement visuel possible sans introduire de nouveau composant.

Logique des préférences (opt-out uniquement pour les promos, sauvegarde via `update_notification_preferences_secure`) **non touchée**.

---

## 6. État vide → `EmptyState`

```tsx
{
  !isLoading && visible.length === 0 && (
    <EmptyState icon={Bell} title="Pa gen notifikasyon isit la." />
  );
}
```

Même message, même condition d'affichage. `Bell` (déjà importé pour l'icône de repli) réutilisé plutôt qu'une nouvelle icône.

---

## 7. Icônes par catégorie

Correspondance construite à partir des icônes **déjà assignées au même concept ailleurs dans l'app** (`nav-items.ts`, sidebars des 4 dashboards), pas inventée :

| Catégorie    | Icône                                    | Déjà utilisée pour                                |
| ------------ | ---------------------------------------- | ------------------------------------------------- |
| `order`      | `ShoppingBag`                            | "Kòmand" (client, restaurant)                     |
| `delivery`   | `Bike`                                   | "Livrè" (admin)                                   |
| `payment`    | `CreditCard`                             | "Peman Kliyan" / "Peman" (driver)                 |
| `commission` | `Percent`                                | "Komisyon" (restaurant, driver, admin)            |
| `promotion`  | `Megaphone`                              | "Pwomosyon" / "Piblisite" (restaurant, admin)     |
| `dispute`    | `AlertTriangle`                          | "Litij" (les 3 rôles)                             |
| `system`     | _(non mappée — Bell générique conservé)_ | Aucune destination de nav équivalente à emprunter |

`system` documenté et volontairement laissé au fallback générique, conformément à la consigne _"Sinon : conserver le fallback générique et documenter pourquoi."_ — inventer une icône pour ce seul cas aurait été la seule option arbitraire du lot.

Priorité conservée : les 3 icônes spécifiques au `type` de paiement (`payment_paid`/`failed`/`under_review`) restent prioritaires sur l'icône de catégorie — elles portent une information plus fine (résultat) que la simple catégorie.

---

## 8. Notifications cliquables vs informatives

- Carte cliquable (a un `orderId`) : `shadow-brand-xs hover:shadow-brand-sm` — **exactement** le même motif déjà utilisé pour le même besoin dans `routes/orders.index.tsx` (liste "Kòmand mwen"), pas un nouveau langage visuel inventé.
- Carte informative : aucune ombre, reste visuellement plate.
- Focus clavier : `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2` posé sur le `<Link>` lui-même (pas sur le `div` interne — un anneau de focus sur un élément qui ne reçoit jamais le focus ne se déclencherait jamais).
- Curseur et navigation clavier : gratuits, `<Link>` de TanStack Router rend un vrai `<a>`.

---

## 9. Accessibilité — résultats axe-core

Scan dédié sur `/notifications`, état par défaut **et** panneau de préférences ouvert :

```
DEFAULT STATE: [{"id":"color-contrast","impact":"serious","n":16}]
PREFS OPEN:    [{"id":"color-contrast","impact":"serious","n":13}]
```

**Une seule règle en violation, dans les deux états : `color-contrast`** — aucune violation de labels, ARIA, landmarks ou structure introduite ni préexistante en dehors de ça. Conformément à la consigne, **ce finding n'a pas été touché** — c'est le compromis de marque déjà documenté et accepté à l'échelle du site (`docs/FRONTEND_GLOBAL_AUDIT.md`, F-08), et la décision globale n'a pas été rouverte ici.

`aria-pressed` vérifié programmatiquement (pas seulement par lecture de code) :

```
Tout   → aria-pressed="true"   (état initial)
Kòmand → aria-pressed="false"  (état initial)
[clic sur Kòmand]
Kòmand → aria-pressed="true"
Tout   → aria-pressed="false"
```

---

## 10. Tests — baseline avant modification

```
npx playwright test e2e/client/notifications.spec.ts e2e/cross-cutting/accessibility.spec.ts --grep "notification|customer dashboard"
→ 1 passed, 2 failed
```

**Incident méthodologique rencontré et corrigé avant d'utiliser un seul résultat** (même classe de problème que lors de l'audit précédent, cette fois causé par le `npm run build` de fond exécuté par `npm run verify` d'une session concurrente dans ce même dépôt partagé) : le build servi par le serveur de preview Playwright pointait vers la vraie base Supabase de production au lieu du serveur mock local. Confirmé par inspection du bundle compilé (`grep` sur les fichiers `.js`), corrigé par `npm run build:e2e`, et **toute preuve de test utilisée dans ce rapport provient d'exécutions faites après cette correction**. Reproduit une seconde fois en cours de phase (après le build de production interne à `npm run verify`) — reconnu immédiatement et re-corrigé de la même façon, sans qu'aucun résultat erroné n'ait été retenu comme preuve.

## 11. Tests — après modification

```
npx playwright test e2e/client/notifications.spec.ts
→ 2/2 passed
```

```
npx playwright test e2e/responsive/notifications-mobile.spec.ts
→ 4/4 passed (Pixel 7, iPhone 13, iPad Mini, Desktop Chrome)
```

```
npx playwright test e2e/cross-cutting/accessibility.spec.ts
→ seules les pages non liées à /notifications échouent (home, restaurant list,
  checkout — toutes color-contrast déjà connu), le test dédié /notifications
  ci-dessus (§9) confirme la même unique violation
```

## 12. `npm run verify`

```
Test Files  13 passed (13)
     Tests  143 passed (143)
```

Typecheck, lint, garde-fou migrations, tests unitaires, build — tous verts, exit code 0.

---

## 13. Couverture de test ajoutée — mobile + permission denied

Nouveau fichier permanent : `e2e/responsive/notifications-mobile.spec.ts`. Ne vérifie **pas seulement l'URL** — vérifie le rendu réel :

1. Le titre `<h1>Notifikasyon</h1>` est visible.
2. Le bloc large de `PushToggle` (celui qui rend réellement, "denied" ou "non supporté" selon le moteur du navigateur — voir §3) est visible.
3. **Test géométrique réel** : calcul des rectangles (`boundingBox()`) des deux éléments et vérification qu'ils ne se chevauchent sur aucun axe — pas une simple vérification de présence.

Re-exécuté sur les 4 profils d'appareils du projet `responsive-*` (Pixel 7, iPhone 13, iPad Mini, Desktop Chrome) — **4/4 verts**, avec capture d'écran conservée pour chacun.

---

## 14. Validation visuelle réelle (captures Playwright)

Captures prises (spec temporaire, créée/exécutée/supprimée après inspection) à 320/375/390/414/768/1024/1440px en état par défaut, plus panneau de préférences ouvert (375px) et état vide (375px) — toutes inspectées avant d'écrire ce rapport, pas seulement générées :

- **320–414px** : header empilé proprement (titre puis bloc d'aide push, sans chevauchement), onglets `Chip` bien visibles avec état actif clair, icônes différenciées par catégorie (sac pour commande, vélo pour livraison, mégaphone pour promo…), cartes bien lisibles.
- **768/1024/1440px** : header côte à côte, tout le reste identique à avant (aucune régression visuelle sur desktop).
- **Préférences ouvertes (375px)** : cases à cocher teintées en orange, lignes espacées et confortables au tap.
- **État vide (375px)** : carte `EmptyState` (icône cloche + message), cohérente avec le reste du dashboard.

Aucun chevauchement, aucun débordement horizontal, aucun bouton inaccessible à aucune largeur testée.

---

## 15. Non-régression

| Fonctionnalité                                                         | Statut                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Filtrage par catégorie/onglet                                          | ✅ intact (`e2e/client/notifications.spec.ts` vert)                                |
| Marquage lu/non lu                                                     | ✅ intact (`e2e/client/notifications.spec.ts` "marks a notification as read" vert) |
| Masquage (`hideOne`/`hideAllVisible`)                                  | ✅ intact, code non touché                                                         |
| Préférences (sauvegarde RPC)                                           | ✅ intacte, seule la présentation des cases a changé                               |
| Navigation vers commande/chat                                          | ✅ intacte, `Link`/`to`/`params` non touchés, seul le `className` a changé         |
| `PushToggle` (activer/désactiver push)                                 | ✅ intact, composant non modifié — seul son conteneur parent gère mieux sa largeur |
| Backend notifications, Supabase, RPC, Edge Functions, push infra, auth | ✅ non touchés (aucun fichier hors frontend modifié)                               |

---

## 16. Findings volontairement non corrigés

- **`color-contrast` (F-08)** : documenté (§9), **non modifié**, décision globale de garder l'orange de marque vif non rouverte — conforme à l'instruction explicite du prompt.
- **Onglets sur 2-3 lignes mobile** (piste optionnelle #3 de l'audit, rail horizontal) : non traitée — cette phase P12 ne listait que le remplacement par `Chip` (§4 du prompt), pas de changement de layout des onglets. Rester dans le périmètre exact demandé plutôt que d'élargir.
- **Liste mono-colonne sur très large écran** : non traitée, même raison — non listée dans les 8 sections numérotées du prompt P12.

Rien de ce qui précède n'est un oubli — chacun a une raison de rester hors périmètre, documentée ici plutôt que silencieusement ignoré ou corrigé sans mandat.

---

## 17. Limites

- Le test de non-chevauchement (§13) vérifie une intersection de rectangles 2D — robuste, mais ne remplace pas une revue visuelle humaine complète ; les captures de la section 14 restent la preuve principale.
- Comme pour l'audit initial, l'incident de build (§10) montre que cet environnement de développement est partagé avec au moins une autre session active — toute future phase sur ce dépôt devrait revérifier `.vercel/output` avant de faire confiance à un résultat Playwright plutôt que de le supposer à jour.
- Aucun test manuel au lecteur d'écran réel n'a été effectué — validation limitée à axe-core et à la vérification programmatique de `aria-pressed`.

---

## Décision finale

## ✅ PRÊT POUR VALIDATION VISUELLE
