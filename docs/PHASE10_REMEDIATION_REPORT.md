# Phase 10 — Rapport de remédiation des réserves finales

**Commit local : `ece73a7`. Aucun push effectué — en attente de validation.**

Audit complet et raisonnement détaillé pour chaque réserve : `docs/PHASE10_REMEDIATION_AUDIT.md`.
Ce rapport couvre l'implémentation et la vérification.

---

## Réserves traitées

### 1. Footer non session-aware — ✅ Corrigé

`site-footer.tsx` importe désormais `useAuth()` (même mécanisme que `site-header.tsx`) et
remplace le lien « Konekte » par « Dashboard » quand un utilisateur est connecté, quel que soit
son rôle. Découverte pendant l'audit : ce footer n'est jamais rendu sur `/dashboard/*` (confirmé
par recherche exhaustive), donc pas besoin de distinguer les 4 rôles entre eux — seulement
connecté/non connecté, exactement ce que fait déjà le header.

### 5b. `Chip` sur les filtres Tout/An atant (dashboard restaurant, vue Liste) — ✅ Corrigé

Les deux boutons pilule recodés à la main dans `dashboard.restaurant.orders.tsx` sont remplacés
par `<Chip selected={...}>`, qui ajoute `aria-pressed` (absent avant) sans changer le comportement
de filtrage.

---

## Réserves volontairement laissées, et pourquoi

| Réserve | Décision | Raison résumée (détail complet dans l'audit) |
|---|---|---|
| Mode sombre | 🟡 Phase dédiée recommandée, non implémenté | 105 fichiers utilisent `bg-white` littéral (non thémable), 0 usage de `dark:` nulle part dans l'app — une vraie phase de design, pas une case à cocher. Décision produit nécessaire (voir ci-dessous). |
| Admin grand écran | 🟡 Dette technique | Marge périphérique réelle seulement à partir de ~1600-1920px (~500px cumulés, calculé précisément à partir des classes Tailwind), audience étroite (équipe admin), un vrai correctif est un redesign contenu/aside, pas un simple élargissement — refusé de « remplir l'espace pour remplir l'espace ». |
| `DataTable` généralisé (vue Liste restaurant) | 🟢 Backlog, explicitement écarté | La carte actuelle porte une vraie densité d'information (liste d'articles imbriquée, impression de bon de cuisine) que le modèle colonnes/cellules de `DataTable` ne peut pas absorber sans redesign — risque de dégrader l'usage réel des restaurateurs pour un bénéfice de code seul. |
| Échelle typographique fermée | 🟢 Backlog | Seulement 5 occurrences quasi-identiques (0.70-0.72rem) dans toute l'app, différence imperceptible — construire un système de tokens à 9 paliers pour ça est l'abstraction disproportionnée que cette phase devait éviter. |
| Fil d'ariane dashboards | 🟢 Backlog, explicitement écarté | Profondeur de route faible (1-2 niveaux), sidebar déjà persistante et indiquant la position — aucun gain de navigation démontré ; ajouté mécaniquement, ça aurait été une troisième source d'information redondante. |

Aucune de ces décisions n'a été prise par défaut — chacune est documentée avec preuve chiffrée ou
lue directement dans le code, dans `docs/PHASE10_REMEDIATION_AUDIT.md`.

---

## Mode sombre — décision produit nécessaire

Conformément à l'instruction, le mode sombre n'a **pas** été implémenté automatiquement. Recommandation
issue de l'audit : **🟡 créer une phase dédiée** si le produit veut toujours le livrer — ni une
implémentation immédiate (contredirait la contrainte « ne pas devenir une nouvelle refonte
générale »), ni un retrait du périmètre (les tokens sont un investissement réel déjà fait, le
besoin reste légitime). **Cette décision reste à trancher côté produit** — aucune action de ma
part tant qu'elle n'est pas prise.

---

## Fichiers modifiés

- `src/components/site-footer.tsx`
- `src/routes/_authenticated/dashboard.restaurant.orders.tsx`
- `docs/PHASE10_REMEDIATION_AUDIT.md`

Confirmé par `git show --stat ece73a7` — aucun autre fichier touché.

---

## Tests

- `npm run verify` (typecheck, lint, garde-fou migrations, tests unitaires, build) : **clean**.
- `e2e/cross-cutting/accessibility.spec.ts` ré-exécuté sur les pages publiques non authentifiées
  (accueil, liste restaurants, détail restaurant) : mêmes 2 échecs déjà connus et documentés depuis
  la Phase 7 (contraste `text-brand`/`text-brand-deep`, choix de marque assumé) — sans rapport avec
  ce diff, aucune nouvelle violation.
- `e2e/restaurant/order-lifecycle-restaurant.spec.ts` (vue Kanban, non touchée par ce diff) et la
  branche « utilisateur connecté » du footer bloquées par la même limitation SSR/mock-auth déjà
  documentée en Phase 7-9 — confirmé via capture d'écran qu'il s'agit du même symptôme connu (écran
  de connexion au lieu de la page protégée), pas une nouvelle régression. La logique du changement
  a été vérifiée par relecture de code et par sa cohérence stricte avec le pattern déjà fonctionnel
  de `site-header.tsx` (même hook, même condition), plutôt que par une preuve E2E live actuellement
  hors de portée dans cet environnement.

## Responsive / Accessibilité

- Footer : structure de navigation (`<nav aria-label>`, liens) inchangée, seul le libellé/la cible
  d'un lien change conditionnellement — aucun impact responsive, aucune nouvelle classe de mise en
  page.
- `Chip` : composant déjà vérifié accessible et responsive ailleurs dans l'app (`restaurants.
  index.tsx`, `restaurants.$slug.tsx`) — même composant, mêmes garanties, gain net d'`aria-pressed`
  sur cet écran spécifiquement.

---

## Risques résiduels

- La branche « connecté » du footer (lien « Dashboard ») n'a pas pu être confirmée par un test E2E
  live dans cet environnement, pour la raison documentée ci-dessus (limitation harness pré-
  existante, pas propre à ce changement). Risque jugé faible : logique strictement identique à
  celle déjà en production dans `site-header.tsx`.
- Aucun autre risque identifié — changements strictement additifs/de remplacement mécanique
  vérifié, aucune logique métier, Supabase, API, Edge Function, RLS, migration ou paiement touchée.

---

## Décision finale

**✅ P10 prête pour validation**

Commit local déjà créé (`ece73a7`, conforme à la même discipline que les phases précédentes :
commit après auto-vérification, push seulement après votre confirmation). En attente de votre
validation avant `git push`.
