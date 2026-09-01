# Phase 1 — Footer WCAG — Mini Rapport

## Correctif appliqué

`src/components/site-footer.tsx` — 5 occurrences changées, rien d'autre :

| Ligne | Avant                          | Après      |
| ----- | ------------------------------ | ---------- |
| 69    | `text-white/70` ("Navigasyon") | `text-ink` |
| 81    | `text-white/70` ("Konpayi")    | `text-ink` |
| 94    | `text-white/70` ("Legal")      | `text-ink` |
| 106   | `text-white/70` ("Peman")      | `text-ink` |
| 135   | `text-white/80` (copyright)    | `text-ink` |

**Correction de trajectoire pendant l'implémentation** : la décision initialement validée (`text-white/70` → `text-white/85`) s'est avérée mathématiquement insuffisante une fois vérifiée avec la vraie formule de luminance WCAG — le blanc plein (100% d'opacité) sur `--brand` (#F97316) plafonne à ~2,8:1, déjà sous le seuil AA de 4,5:1. Ce plafond est corroboré par un commentaire déjà présent dans `src/styles.css` (daté du 2026-07-20), documentant que ce même compromis a été explicitement accepté pour les boutons/badges du site. Vous avez validé le correctif corrigé (bascule vers `text-ink`, token existant, fond `--brand` non touché) via une question de clarification avant toute modification.

**Couleur de marque non touchée** — `--brand` (#F97316) reste inchangé, conformément à la préférence connue.

## Vérifications

### WCAG AA

Suite `e2e/cross-cutting/accessibility.spec.ts` (axe-core, `wcag2aa`), exécutée isolément après le correctif :

- **Restaurant list** : ✅ passe (échouait avant le correctif).
- **Checkout (cash flow)** : ❌ échoue toujours, mais **aucune des 5 éléments corrigés n'apparaît plus dans les violations** (vérifié par recherche textuelle : "Navigasyon", "Konpayi", "Legal", "Peman", "Tout dwa" — zéro correspondance). Les violations restantes concernent des éléments **hors périmètre** de cette phase : les liens de navigation du footer (`text-white` plein, 2.79:1) et des éléments du header (`text-brand-deep` sur fond blanc, 3.17–3.96:1) — le même compromis site-wide déjà documenté et explicitement accepté dans `styles.css`, pas une régression introduite ici.
- Résultat global avant/après : **3 pages en échec → 1 page en échec**, et la page restante échoue pour une cause pré-existante et hors périmètre, pas pour le correctif lui-même.

### Lighthouse

Réexécuté isolément (résistant à la contention de ressources documentée en exécution groupée) :

| Page              | Best Practices | SEO | Avant (référence)                            |
| ----------------- | -------------- | --- | -------------------------------------------- |
| Accueil           | 92             | 100 | 92 / 100 — inchangé                          |
| Liste restaurants | 92             | 100 | 92 / 100 — inchangé                          |
| Dashboard client  | 96             | —   | 100 — écart non lié au correctif (voir note) |

Note dashboard client : `SiteFooter` **n'est jamais rendu** sur les routes `_authenticated/*` (confirmé par recherche, aucune occurrence) — la variation 100→96 est donc une fluctuation de mesure locale déjà documentée dans `docs/E2E_TEST_REPORT.md` (Lighthouse contre un serveur Node nu, non représentatif), pas un effet du correctif.

### Responsive

`e2e/responsive/navigation-and-layout.spec.ts` exécuté sur les 3 projets (`responsive-mobile-chrome`, `responsive-tablet`, `responsive-desktop`) : **9/9 passent**. Le footer n'a subi qu'un changement de couleur de texte sur des éléments non positionnés (`span`/`div` en flux normal) — aucun changement de layout, de dimensions ou de comportement de wrap.

### Dark mode

**Non applicable — ce projet n'a aucun mode sombre.** Recherche exhaustive (`dark:`, `prefers-color-scheme`, `ThemeProvider`, `useTheme`, `data-theme`) : zéro résultat dans tout `src/`. Ne pas inventer une vérification pour une fonctionnalité qui n'existe pas.

### Hover / Focus

Aucun changement — les 5 éléments modifiés sont des `<span>`/`<div>` non interactifs (labels de section, copyright), qui n'avaient et n'ont toujours pas d'état hover/focus. Les `<Link>` interactifs environnants (`hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white`) sont restés strictement inchangés — vérifié par lecture du fichier final.

## Régression

Aucune. Aucun des 5 éléments modifiés n'apparaît dans les violations de contraste restantes ; aucune modification de layout, hover, focus, ou dark mode (inexistant) ; Lighthouse best-practices/SEO inchangés sur les pages publiques concernées.

## Hors périmètre (confirmé, pas oublié)

Le contraste des liens de navigation du footer (`text-white` plein, 2.79:1) et de certains éléments du header (boutons `text-brand-deep`) reste sous AA — c'est le même compromis "couleur de marque vivide" déjà explicitement accepté et documenté site-wide dans `src/styles.css`. Non traité ici, conformément à l'instruction explicite de corriger uniquement le problème identifié (les 4 labels + copyright), sans toucher à d'autres composants.
