# MonCash Automatik — Désactivation temporaire — Rapport UX

**Date** : 2026-08-03

---

## 1. Décision de design retenue

**Option A** (préférée par la mission) : la méthode reste **visible** dans la grille des 4 méthodes de paiement, mais devient **non sélectionnable**, avec un badge "Byento disponib" et un message explicatif.

**Pourquoi Option A plutôt que B (masquage complet)** :

- Cohérent avec le design actuel : la grille `sm:grid-cols-2` de 4 boutons égaux serait déséquilibrée (3 éléments, une case vide ou un réagencement) si on masquait complètement l'option.
- Un client qui a l'habitude de "MonCash Automatik" (déjà utilisé, même brièvement, en production) comprend immédiatement _pourquoi_ il ne peut plus la choisir plutôt que de se demander où elle est passée.
- Cohérent avec le principe "ne jamais supprimer du code" étendu à l'UX : rien ne disparaît, un état temporaire est communiqué.

## 2. Message affiché

- **Badge** (sur le bouton, toujours visible) : _"Byento disponib"_.
- **Sous-texte** (remplace le sous-texte habituel _"Peman otomatik, konfimasyon imedya"_ uniquement pour cette méthode) : _"MonCash Automatik pa disponib pou kounye a. L ap retounen byento."_

Choix de formulation : le second exemple suggéré par la mission ("Fonksyonalite sa a anba amelyorasyon") a été écarté au profit du premier ("ap retounen byento") — plus honnête vis-à-vis du contexte réel (ce n'est pas une amélioration en cours, c'est un remplacement de fournisseur en préparation), sans exposer de détail interne (le nom "Bouspam" ou "Digicel" n'apparaît nulle part côté client).

## 3. Cohérence avec le reste du site

- Réutilise le composant `Badge` existant (`src/components/ui/badge.tsx`, `variant="secondary"`) — déjà utilisé ailleurs dans le dashboard, pas un nouveau style inventé.
- Le sous-texte suit exactement le même `<small>` déjà utilisé pour les 3 autres méthodes — même taille, même couleur (`text-ink-soft`), aucune nouvelle classe typographique introduite.
- Le bouton désactivé garde la même forme/taille que les 3 autres (`rounded-2xl border-2 p-3`) — seule sa couleur de fond (`bg-cream` au lieu de `bg-white`) et son opacité (`opacity-60`) changent, signalant "indisponible" sans rupture visuelle avec la grille.

## 4. Accessibilité

- `disabled` natif → annoncé automatiquement par les lecteurs d'écran ("MonCash Automatik, Byento disponib, MonCash Automatik pa disponib pou kounye a. L ap retounen byento., désactivé"), sans ARIA supplémentaire nécessaire — le nom accessible du bouton inclut déjà tout le texte visible.
- `aria-disabled="true"` ajouté en complément de l'attribut HTML `disabled` — redondant par design (défense en profondeur), sans effet négatif.
- `cursor-not-allowed` en CSS confirme visuellement l'état non interactif au survol souris.
- Contraste : `text-ink-soft` sur `bg-cream` — même paire de couleurs déjà utilisée ailleurs sur le site pour du texte secondaire, aucun nouveau risque de contraste introduit (vérifié : aucune violation `axe-core` sur les nouveaux éléments, voir le rapport de tests).

## 5. Responsive

Testé sur mobile (Pixel 7), tablette (iPad Mini) et desktop — la grille `grid gap-2 sm:grid-cols-2` est inchangée, le badge utilise `flex-wrap` pour ne jamais forcer un débordement horizontal sur les petits écrans (le libellé + le badge passent à la ligne suivante si nécessaire plutôt que de déborder). Voir le rapport de tests pour les résultats E2E.

## 6. Traduction / langue

Le site n'a pas de système d'internationalisation (confirmé par audit antérieur — tout le texte UI est en kreyòl, sans bascule de langue). Le message suit donc la même convention : kreyòl uniquement, cohérent avec absolument tout le reste de l'interface checkout.

## 7. Défaut du formulaire

Le sélecteur de méthode démarre désormais sur **Kach nan livrezon** (Cash) au chargement de la page, via `getDefaultPaymentMethod()` (Phase 4) plutôt qu'un littéral `"moncash_auto"` codé en dur — un client qui ne change rien complète sa commande par une méthode réellement disponible.
