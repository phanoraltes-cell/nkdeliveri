# Phase 10 — Audit de remédiation des réserves finales

**Phase d'audit — aucun code modifié dans ce document.** Objectif : traiter uniquement les
réserves de P9 qui apportent un bénéfice UX/UI suffisamment concret pour justifier une
modification. Ce n'est pas une nouvelle refonte générale.

---

## Étape 1 — Priorisation des 6 réserves

| #   | Réserve                                                     | Priorité                              | Impact utilisateur                                                                                                                                                                                                                                       | Complexité                                                                                             | Risque                                                                                                          | Bénéfice attendu                                            |
| --- | ----------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Footer non session-aware                                    | 🟠 À corriger dans P10                | Faible-modéré : un utilisateur déjà connecté voit « Konekte » dans le footer, juste sous un header qui, lui, affiche correctement « Dashboard »/« Pwofil mwen » — incohérence visible à chaque défilement jusqu'en bas de n'importe quelle page publique | Très faible — même mécanisme que le header (`useAuth()`), déjà éprouvé                                 | Quasi nul — 1 fichier, changement additif, aucune logique métier                                                | Cohérence immédiate avec le header, sur 12 routes publiques |
| 2   | Admin — grand écran (≥1440px)                               | 🟡 Dette technique                    | Faible — audience étroite (équipe admin uniquement), contenu lisible, juste entouré de marge sur très grand écran ; pattern courant et volontaire chez de nombreux produits (GitHub, Linear, Notion plafonnent aussi leur contenu)                       | Élevée pour un vrai correctif (split contenu/aside touchant carte live, graphique, filtres)            | Modéré si fait à la hâte — page à données live, mémoïsation de marqueurs déjà fragile aux changements de layout | Voir §4 — pas assez justifié pour cette phase               |
| 3   | Mode sombre                                                 | Voir Étape 2 dédiée                   | —                                                                                                                                                                                                                                                        | —                                                                                                      | —                                                                                                               | —                                                           |
| 4   | Échelle typographique fermée                                | 🟢 Backlog                            | Quasi nul — voir §5, seulement 5 usages, différence imperceptible                                                                                                                                                                                        | Faible en soi, mais gouvernance ("revue de design avant merge") disproportionnée pour le problème réel | Faible                                                                                                          | Cosmétique, non mesurable                                   |
| 5a  | `DataTable` généralisé (vue Liste restaurant)               | 🟢 Backlog — explicitement non retenu | Voir §6 — risque de **dégrader** l'UX actuelle                                                                                                                                                                                                           | Élevée (redesign, pas un simple remplacement)                                                          | Élevé si forcé                                                                                                  | Aucun bénéfice concret identifié                            |
| 5b  | `Chip` sur les filtres Tout/An atant (dashboard restaurant) | 🟠 À corriger dans P10                | Modéré — ajoute `aria-pressed`, absent aujourd'hui sur un vrai toggle de filtre                                                                                                                                                                          | Très faible                                                                                            | Quasi nul                                                                                                       | Vraie duplication éliminée + gain d'accessibilité réel      |
| 6   | Fil d'ariane dashboards                                     | 🟢 Backlog — explicitement non retenu | Voir §7 — bénéfice non démontré                                                                                                                                                                                                                          | —                                                                                                      | —                                                                                                               | —                                                           |

Détail de chaque analyse ci-dessous.

---

## Étape 2 — Mode sombre : analyse dédiée

**Constat quantitatif (mesuré, pas estimé) :**

```
bg-white (littéral, non thémable) : 105 fichiers src/components + src/routes
dark: (variante Tailwind)          : 0 fichier, 0 occurrence
.dark / [data-theme="dark"]        : tokens de couleur déjà définis dans styles.css
```

**Le Design System actuel permet-il réellement l'implémentation ?** Partiellement. Les _tokens_
sont prêts (`--brand`, `--ink`, `--cream`, `--status-*`, tous déjà déclinés en variante sombre dans
`styles.css`). Mais la quasi-totalité des surfaces « carte » de l'application (Kanban, Timeline,
KPI, sections dashboard, modales de contenu) utilisent `bg-white` **littéral** plutôt que le
token `--paper-raised`/`--cream` équivalent — ce sont deux choses différentes : le token existe,
mais 105 fichiers ne le consomment pas pour leur fond de carte. Activer `.dark` aujourd'hui, sans
toucher à ces 105 fichiers, produirait une application où le texte passe en clair mais où
l'immense majorité des cartes restent blanches — illisible, pas juste imparfait.

**Composants concernés :** essentiellement tout composant « carte » construit depuis P1-P8
(`OrderStatusTimeline`, `OrderKanbanBoard`, `KpiCard`, les sections du dashboard admin, `Button`
outline, les modales/`Sheet`/`Dialog` Radix dont le fond est géré par shadcn en `bg-white` par
défaut) — pas un sous-ensemble isolé, une portion transversale de l'application entière.

**Les tokens existants sont-ils suffisants ?** Pour la couleur, oui. Pour l'exécution, non : il
manque un mécanisme de bascule (`data-theme` sur `<html>`, persistance `localStorage`, toggle dans
Profil — aucun des trois n'existe) **et** l'audit + remplacement systématique de `bg-white` (et
probablement `text-black`/`border-*` codés en dur ailleurs, non quantifiés ici) par leurs
équivalents tokenisés sur les ~100 fichiers concernés.

**Est-ce une vraie phase de design, ou une extension mécanique ?** **Une vraie phase.** 105
fichiers à auditer un par un (certains `bg-white` sont volontaires — ex. logo sur fond de marque —
et ne doivent _pas_ changer), un mécanisme de bascule à construire et tester sur mobile/desktop, et
une vérification de contraste sur chaque paire couleur/fond en mode sombre (le contraste vérifié en
P7 ne l'a été qu'en mode clair). L'estimation d'effort **S** de la spécification d'origine ne
correspond pas à l'ampleur réelle mesurée ici.

### Recommandation

**🟡 Créer une phase dédiée.** Ni une implémentation immédiate (l'ampleur réelle contredirait
directement la contrainte de cette phase : « cette phase ne doit pas devenir une nouvelle refonte
générale » — 105 fichiers en sont une), ni un retrait officiel du périmètre (les tokens sont un
investissement déjà fait et le besoin reste réel et légitime, documenté depuis l'audit initial).

**Décision produit nécessaire :** confirmer si le mode sombre reste un objectif du produit à moyen
terme. Si oui, une Phase 10-bis (ou 11) dédiée, scoping le balayage des 105 fichiers, le mécanisme
de bascule et la revérification de contraste — pas une case à cocher dans cette phase-ci. **Non
implémenté dans P10**, conformément à l'instruction.

---

## Étape 3 — Footer

**Comportement actuel, par audience :**

| Audience            | Ce que le footer affiche aujourd'hui          | Ce que le header affiche (référence)      |
| ------------------- | --------------------------------------------- | ----------------------------------------- |
| Non connecté        | « Konekte » + « Pwofil » (les deux, toujours) | « Konekte »/« Enskri »                    |
| Client connecté     | Idem — incorrect                              | « Dashboard »/« Pwofil mwen »/déconnexion |
| Restaurant connecté | Idem — incorrect                              | Idem (même mécanisme `useAuth()`)         |
| Livreur connecté    | Idem — incorrect                              | Idem                                      |
| Admin connecté      | Idem — incorrect                              | Idem                                      |

**Précision importante trouvée pendant cet audit, absente de P9 :** `SiteFooter` n'est jamais rendu
sur les routes `/dashboard/*` (confirmé : `grep SiteFooter src` → 17 fichiers, tous des routes
publiques — accueil, restaurants, commandes, checkout, profil, légal, auth — jamais un fichier de
dashboard). Un restaurateur/livreur/admin ne voit donc ce footer que lorsqu'il navigue sur une page
publique (ex. `/faq`) en dehors de son dashboard — le footer n'a donc pas besoin de distinguer les
4 rôles entre eux, seulement l'état « connecté / non connecté », exactement comme le header le fait
déjà avec `useAuth()`.

**Un footer session-aware apporte-t-il une amélioration réelle ?** Oui, modeste mais réelle :
éviter d'inviter un utilisateur déjà connecté à se « Konekte » à nouveau, directement sous un
header qui, lui, sait déjà qu'il est connecté — c'est exactement le type d'incohérence qu'un audit
UX relève en premier.

**Implémentation minimale proposée :** dans `site-footer.tsx`, importer `useAuth()` (déjà utilisé
par `site-header.tsx`, `bottom-nav.tsx` — pattern établi, pas un nouveau concept). Si `user` est
présent, remplacer l'entrée « Konekte » de `navLinks` par un lien vers `/dashboard` (libellé
« Dashboard », cohérent avec le header) ; garder « Pwofil » tel quel (valide pour tout utilisateur
connecté, quel que soit son rôle). Si `user` est absent, comportement actuel inchangé.

---

## Étape 4 — Admin grand écran

**Mesuré par calcul direct des classes Tailwind (le rendu réel de cette route protégée reste
bloqué par la limitation SSR/auth déjà documentée en P7-P9 — tentative de capture d'écran faite,
bloquée par le même mécanisme ; l'analyse ci-dessous est donc arithmétique, pas visuelle, mais
fiable car la mise en page est un simple grid/flex CSS sans logique JS de mesure) :

- Sidebar dashboard : `md:w-[72px] lg:w-[260px]` (`dashboard-sidebar.tsx:23`).
- Zone de contenu : `<div className="mx-auto max-w-6xl">` (`dashboard.tsx:45`) — 1152px max, centré.

| Largeur | Sidebar     | Espace dispo pour le contenu | Plafonné à 1152px ?                        | Marge périphérique totale                   |
| ------- | ----------- | ---------------------------- | ------------------------------------------ | ------------------------------------------- |
| 1024px  | 72px (rail) | ~950px                       | Non, contenu utilise presque tout l'espace | ~0px                                        |
| 1280px  | 260px       | ~1020px                      | Non                                        | ~0px                                        |
| 1440px  | 260px       | ~1180px                      | À peine (28px)                             | ~28px, invisible                            |
| 1920px  | 260px       | ~1660px                      | Oui, largement                             | **~508px** (marges gauche/droite combinées) |

**Problèmes réels identifiés :** uniquement à partir de ~1600-1920px, une marge périphérique
notable (jusqu'à ~500px cumulés) apparaît de part et d'autre du contenu. En dessous, le plafond
n'a quasi aucun effet visible. Grille KPI (`sm:grid-cols-3`, jamais de variante `xl:`/`2xl:`) : à
1152px de large, 3 cartes KPI se partagent l'espace sans exploiter de colonnes supplémentaires,
mais restent lisibles, pas visuellement cassées.

**Ce n'est pas un problème de densité, de tables, de navigation ou de hiérarchie** — ces aspects
sont corrects (P4 a déjà résolu la hiérarchie de décision). C'est strictement un usage de l'espace
périphérique sur une minorité d'écrans très larges, pour une audience interne restreinte (équipe
admin), pas les clients/restaurants/livreurs.

**Décision :** ne pas modifier l'interface uniquement pour remplir l'espace, conformément à
l'instruction. Un vrai correctif (split contenu/aside avec carte live + graphique en panneau
persistant, comme évoqué par la spécification d'origine) est un travail de conception à part
entière — toucher `dashboard.admin.index.tsx` de façon superficielle (juste élargir `max-w-6xl`)
étirerait les cartes KPI et la table sans gain d'information réel, un résultat cosmétique sans
bénéfice. **Classé 🟡 dette technique, non traité dans cette phase.**

---

## Étape 5 — Typographie

**Usage réel mesuré :** `grep text-\[0\.7 src --include=*.tsx` → **5 occurrences** dans toute
l'application (`hero-section.tsx` ×2, `popular-dishes-section.tsx`, `site-header.tsx`,
`restaurants.$slug.tsx`), toutes dans la fourchette 0.70-0.72rem (≈11.2-11.5px) — une différence
imperceptible entre elles, et proche de l'utilitaire Tailwind existant `text-xs` (0.75rem/12px).

**Une échelle centralisée apporterait-elle un bénéfice réel ?** Pas à la mesure du problème actuel.
L'audit initial citait cet exemple pour illustrer un _risque de dérive_, pas un chaos déjà constaté
— 5 occurrences quasi-identiques ne constituent pas une incohérence visible pour un utilisateur, et
aucune confusion de hiérarchie n'a été relevée nulle part dans les 9 audits/rapports de cette
refonte. Construire une échelle fermée à 9 paliers (nouveaux tokens CSS, migration de tous les
composants, processus de revue de design) pour corriger 5 valeurs à la marge serait une
abstraction pour le principe, explicitement écartée par l'instruction de cette phase.

**Décision :** 🟢 Backlog. Non traité. Si jamais repris, la version minimale utile serait de
remplacer les 5 occurrences par un unique `text-[11px]` (ou `text-xs` directement) — un
micro-nettoyage, pas une nouvelle abstraction — mais même ce geste n'a aucun bénéfice utilisateur
mesurable aujourd'hui.

---

## Étape 6 — DataTable / Chip

### `DataTable` — vue « Liste » du dashboard restaurant

Relecture complète de `dashboard.restaurant.orders.tsx` (vue `list`, lignes 256-330+) : chaque
ligne de commande affiche un en-tête (numéro + badge de statut), téléphone cliquable, adresse,
détail financier (sous-total/livraison/total), méthode de paiement, un bouton d'impression de bon
de cuisine, un bouton de masquage, **et** une liste imbriquée des articles commandés. C'est une
carte de détail riche, pas une ligne tabulaire — la faire passer par `DataTable` (modèle
colonnes/cellules) obligerait soit à retirer la liste d'articles (perte d'information consultée en
un coup d'œil par le restaurateur), soit à la re-designer entièrement dans une cellule dédiée —
dans les deux cas, ce n'est plus une généralisation mécanique, c'est une refonte de cet écran.

**Décision :** 🟢 Backlog, **explicitement non retenu**. Le bénéfice de code (moins de duplication)
ne compense pas le risque de dégrader une information dense que les restaurateurs consultent
concrètement (déjà noté comme un point fort par l'audit initial : « pense au flux physique réel
d'une cuisine »).

### `Chip` — filtres Tout / An atant (même écran, vue Liste)

```tsx
<button
  onClick={() => updateFilter("all")}
  className={`rounded-full px-4 py-2.5 text-sm font-bold ${filter === "all" ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
>
  Tout
</button>
```

C'est un vrai toggle de sélection mutuellement exclusif (`filter === "all" | "pending"`) —
exactement le cas d'usage pour lequel `Chip` existe déjà (`aria-pressed={selected}`, focus-visible
ring, déjà utilisé sur `restaurants.index.tsx`/`restaurants.$slug.tsx`). Contrairement à
`DataTable` ci-dessus, remplacer ces deux boutons par `<Chip selected={...}>` est un vrai
remplacement mécanique — même comportement, même apparence visuelle (à ajuster minimalement),
gain d'accessibilité réel (`aria-pressed` actuellement absent).

**Autres candidats vérifiés et écartés :** le bouton « Netwaye istorik » (`orders.index.tsx:91`)
n'est **pas** un filtre/sélection — c'est une action ponctuelle (vider l'historique). Lui donner la
sémantique `Chip` (`aria-pressed`) serait sémantiquement faux. Aucun autre pseudo-filtre non-`Chip`
trouvé sur `checkout.tsx`.

**Décision :** 🟠 à corriger dans P10 — remplacement des 2 boutons de filtre par `Chip`.

---

## Étape 7 — Breadcrumbs

**Profondeur réelle des routes dashboard :** `/dashboard/{role}` (0 niveau), `/dashboard/{role}/
{section}` (1 niveau, ex. `/dashboard/admin/finance`), rarement un 3ᵉ niveau (détail d'un élément
depuis une liste, ex. un litige ouvert depuis `/dashboard/admin/disputes`). La sidebar (desktop) ou
le tiroir (mobile) affiche en permanence la section active en surbrillance — c'est déjà, de facto,
un indicateur de position constamment visible, contrairement au contexte public (`/restaurants/
$slug`) où il n'existe aucune navigation persistante équivalente et où le fil d'ariane comble un
vrai vide.

**Un fil d'ariane améliorerait-il réellement la navigation dashboard ?** Pas de façon démontrable.
Le titre `<h1>` de chaque page dashboard indique déjà la section (« Dashboard Administratè »,
etc.), et la sidebar indique déjà la position dans l'arborescence. Un fil d'ariane
« Dashboard > Admin > Finans » ajouterait une troisième source d'information redondante avec les
deux premières, pour un gain de repérage marginal — à l'inverse, là où un 3ᵉ niveau existe
réellement (détail d'un litige, d'un versement), le pattern déjà utilisé ailleurs dans l'app
(lien « ← Retounen » explicite, ex. `restaurants.$slug.tsx`) répond mieux au besoin réel
(« comment je reviens en arrière ») qu'un fil d'ariane générique.

**Décision :** 🟢 Backlog, **explicitement non retenu** — l'ajouter mécaniquement à toutes les
pages dashboard, comme l'instruction le met explicitement en garde, sans bénéfice de navigation
démontré.

---

## Synthèse — ce qui sera implémenté dans cette phase

1. ✅ Footer session-aware (Étape 3) — 1 fichier, additif, risque quasi nul.
2. ✅ `Chip` sur les filtres Tout/An atant du dashboard restaurant (Étape 6) — 1 fichier, additif,
   gain d'accessibilité réel.

Tout le reste (mode sombre, admin grand écran, typographie, `DataTable` généralisé, fil d'ariane)
reste **volontairement non traité**, avec la justification ci-dessus pour chacun — conformément à
l'instruction de ne pas transformer cette phase en nouvelle refonte générale.

En attente : décision produit sur le mode sombre (Étape 2) avant de créer une éventuelle phase
dédiée.
