# Audit — Page Notifications (`/notifications`)

**Audit uniquement — aucune modification de code, de structure ou de style. `git status` identique avant/après (hors ce fichier).**

Périmètre : `src/routes/_authenticated/notifications.tsx`, `src/components/push-toggle.tsx`, `src/components/notification-preferences-panel.tsx`, `src/components/notification-permission-denied-help.tsx` (référencé). Vérification par lecture de code **et** captures Playwright réelles à 320/375/390/414/768/1024/1440px, dans 4 états (par défaut avec 5 notifications variées, panneau de préférences ouvert, liste vide, permission push refusée), plus un scan axe-core dédié.

---

## 1. Structure actuelle (rappel factuel, non jugé)

```text
<h1>Notifikasyon</h1> + "X nouvo"          ⟷  <PushToggle />        (ligne d'en-tête, flex sans wrap)
<NotificationPreferencesPanel />                                     (carte repliable)
[9 onglets catégorie]                       ⟷  [Make tout kòm li] [Vide tout]   (ligne flex-wrap)
<ul> de cartes notification (icône + titre/corps/date + Li/poubelle)
```

Composant unique, pas de sous-composants extraits pour la ligne d'en-tête ou pour une carte de notification (contrairement au Kanban restaurant, la carte de notification n'est pas un composant séparé — tout est inline dans le fichier de route).

---

## 2. Finding le plus important — chevauchement réel sur mobile (P2)

**Confirmé par capture réelle, pas supposé** : la ligne d'en-tête (`<div className="flex items-center justify-between">`, **sans `flex-wrap`**) place `<h1>Notifikasyon</h1>` à gauche et `<PushToggle />` à droite. Tant que `PushToggle` rend son bouton compact ("Aktive notifikasyon push"), cette ligne tient. Mais dans son état "permission refusée" (`NotificationPermissionDeniedHelp` — un vrai composant plus large : titre + paragraphe + liste à 4 étapes + bouton), il n'y a pas assez de place à 320–414px et **le titre et le panneau d'aide se chevauchent visuellement**.

- Vérifié à 320, 375, 390, 414px : chevauchement présent à chaque fois.
- Vérifié à 768px et plus : se résout, les deux blocs cohabitent proprement côte à côte.
- Vérifié que ce n'est **pas** un artefact de capture `fullPage` (un `<BottomNav>` en `position: fixed` apparaissait à tort au milieu de la page dans les captures `fullPage: true` — vérifié séparément avec une capture viewport-seule : le chevauchement titre/aide persiste, le `BottomNav` lui est bien ancré en bas comme attendu).
- **Portée réelle** : dans cet environnement de test Chromium automatisé, `Notification.permission` vaut `"denied"` par défaut — donc cet état n'est pas un cas rare artificiellement construit pour l'audit, c'est probablement l'état le plus fréquemment rencontré en pratique (beaucoup d'utilisateurs mobiles refusent ou n'accordent jamais la permission push).

**Cause** : absence de `flex-wrap` (ou d'un empilement vertical en dessous d'un certain seuil) sur le conteneur de la ligne d'en-tête.

---

## 3. Autres constats structurels

| # | Constat | Gravité | Preuve |
|---|---|---:|---|
| 1 | Les 9 onglets catégorie sont des `<button>` bruts (couleur seule pour l'état actif), **pas** le composant `Chip` déjà utilisé ailleurs dans l'app (qui a déjà `aria-pressed` correctement câblé) — même pattern que celui corrigé sur le toggle Kanban/Liste en P11 | 🟡 P3 | Code + axe (pas de `aria-pressed` détecté) |
| 2 | Sur mobile (320–414px), les 9 onglets se répartissent sur 2–3 lignes avant qu'une seule notification soit visible | 🟢 P4 | Capture 320/375/414px |
| 3 | Panneau "Preferans notifikasyon" : cases à cocher natives non stylées (`<input type="checkbox">` brut), seul endroit de toute la page (et l'un des rares de l'app) à utiliser des contrôles de formulaire non habillés — contraste visuel net avec `Button`/`Chip` utilisés partout ailleurs. Zone tactile de la case elle-même très inférieure aux 44px recommandés | 🟡 P3 | Capture 375/1440px prefs ouvert |
| 4 | État vide en texte brut centré, pas le composant `EmptyState` partagé déjà utilisé sur ~15 pages dashboard (même famille de constat que F-01 de l'audit global, instance confirmée ici) | 🟡 P3 | Capture empty-375 |
| 5 | `iconFor()` ne différencie que 3 valeurs de `type` (`payment_paid/failed/under_review`) — les 6 autres catégories (livraison, promotion, système, commande, litige, chat) partagent toutes la même icône Bell générique, alors que la page expose 9 catégories distinctes en onglets | 🟢 P4 | Code + capture (toutes les cartes non-paiement ont la même icône) |
| 6 | Aucune distinction visuelle entre une carte notification navigable (enveloppée dans un `<Link>` vers la commande/le chat) et une carte purement informative (`div` simple) — même style pour les deux, aucun indice visuel de "cliquable" | 🟡 P3 | Code (`inner` reçoit le même style dans les deux branches) |
| 7 | Sur très large écran (1440px, dans le conteneur `max-w-6xl` du dashboard), la liste reste sur une seule colonne — les cartes s'étirent sur toute la largeur pour un contenu court, avec beaucoup d'espace vide | 🟢 P4 | Capture 1440px |

---

## 4. Responsive — résultats par largeur

| Largeur | Résultat |
|---:|---|
| 320px | Chevauchement titre/aide push (§2). Reste de la page lisible, cartes bien empilées, pas de débordement horizontal |
| 375/390/414px | Idem — chevauchement présent à toutes ces largeurs (toute la plage mobile standard) |
| 768px | Chevauchement résolu. Les 9 onglets tiennent sur une seule ligne. Mise en page confortable |
| 1024/1440px | Aucun problème de layout ; simplement peu optimisé pour l'espace disponible (§3.7) |

Aucun débordement horizontal, aucun texte tronqué de façon illisible, aucun bouton inaccessible détecté à aucune largeur testée — le seul défaut réel et reproductible est le chevauchement du §2.

---

## 5. Accessibilité (axe-core, scan dédié)

**Un seul type de violation détecté : `color-contrast` (21 nœuds)** — le même compromis de couleur de marque déjà documenté et accepté à l'échelle du site (`docs/FRONTEND_GLOBAL_AUDIT.md`, F-08), rien de spécifique à cette page ni de nouveau. Aucune violation de labels, landmarks, alt text ou structure ARIA — la base sémantique de la page est saine.

Gap non capturé par axe mais réel : les onglets catégorie (§3.1) n'exposent pas leur état actif aux technologies d'assistance, uniquement par la couleur — le même défaut déjà corrigé sur le toggle Kanban/Liste en P11, avec un correctif directement transposable ici (`aria-pressed`, ou migration vers le composant `Chip` qui l'a déjà).

---

## 6. Ce qui fonctionne déjà bien (à préserver dans une refonte)

- États loading (Skeleton ×3), vide, et liste peuplée tous présents et fonctionnels.
- Distinction lu/non-lu claire (fond teinté + bouton "Li"), cohérente avec le reste du dashboard.
- Filtrage par catégorie fonctionnel et réactif.
- Actions groupées ("Make tout kòm li", "Vide tout") bien positionnées, n'apparaissent que quand pertinentes (jamais de bouton mort).
- Masquage (jamais suppression réelle) avec confirmation — cohérent avec le reste de l'app.
- Panneau de préférences : logique saine (opt-out uniquement pour les promos), juste l'habillage visuel qui détonne (§3.3).

---

## 7. Pistes pour une future refonte (non implémentées — audit seulement)

Classées par impact, pas par obligation :

1. **Corriger le chevauchement du §2** — `flex-wrap` sur la ligne d'en-tête, ou empiler `PushToggle`/son état "refusé" sous le titre en dessous d'un certain seuil. C'est le seul vrai défaut visuel confirmé.
2. **Remplacer les 9 boutons d'onglet par le composant `Chip`** — supprime la duplication de style et récupère `aria-pressed` gratuitement, dans l'esprit de ce qui a déjà été fait pour le toggle Kanban/Liste.
3. **Envisager un scroll horizontal (rail) pour les onglets sur mobile** plutôt qu'un retour à la ligne sur 2-3 lignes, pour que la première notification reste visible plus haut sur l'écran — pattern déjà utilisé ailleurs dans l'app (Kategori Pla).
4. **Aligner le panneau de préférences sur le Design System** (contrôles stylés type `Chip`/switch au lieu de cases natives), avec des zones tactiles ≥44px.
5. **Adopter le composant `EmptyState` partagé** pour l'état vide.
6. **Icônes par catégorie plutôt que par `type`** — profiterait immédiatement des 9 catégories déjà définies dans `CATEGORY_TABS`.
7. Optionnel : un indice visuel (chevron, soulignement au survol) sur les cartes navigables, pour les distinguer des cartes purement informatives.

Rien de ce qui précède n'a été implémenté — ce rapport est une base de décision pour une phase de remédiation ultérieure, si vous le souhaitez.

---

## 8. Vérification finale

```
git status --short
```
Identique à l'état avant l'audit, à l'exception de ce nouveau fichier (`docs/NOTIFICATIONS_PAGE_AUDIT.md`) — aucun code, style ou structure modifié.
