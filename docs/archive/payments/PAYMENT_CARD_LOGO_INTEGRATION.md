# Intégration du logo « Paiement par carte »

**Aucune modification de la logique de paiement, Supabase, API, PLOP, ou base de données.**
Modification strictement visuelle/UX, comme demandé.

---

## 1. Asset utilisé

```text
public/katkredi.png
```

**Note importante trouvée dès l'audit initial (Phase 1)** : `public/katkredi` n'est **pas** un
dossier comme le prompt le supposait — c'est un unique fichier `katkredi.png` directement à la
racine de `public/`. Confirmé par inspection directe plutôt que supposé.

| Propriété      | Valeur                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dimensions     | 447×447 px (carré, ratio 1:1)                                                                                                                                                               |
| Format         | PNG, RGBA (canal alpha présent)                                                                                                                                                             |
| Poids          | 14.8 Ko                                                                                                                                                                                     |
| Contenu visuel | Illustration générique de deux cartes bancaires empilées (bleu/or) avec un symbole de réseau de paiement stylisé — **aucun logo Visa/Mastercard officiel**, pas de risque de marque déposée |
| Variantes      | Aucune — un seul fichier, pas de version alternative                                                                                                                                        |

Comparaison avec les logos de paiement déjà en place (pour contexte, Phase 15) :

| Logo                     | Poids   |
| ------------------------ | ------- |
| `katkredi.png` (nouveau) | 14.8 Ko |
| `moncash-logo-hero.png`  | 23.8 Ko |
| `natcash-logo-new.png`   | 77.5 Ko |

Le nouvel asset est en fait le plus léger des quatre — aucun impact de performance.

Asset utilisé **tel quel**, sans recréation HTML/CSS, sans recadrage, sans compression
supplémentaire — conformément à l'instruction.

---

## 2. Audit du système de paiement — disponibilité réelle (Phase 2 & 17)

**Étape critique effectuée avant toute intégration**, conformément à l'instruction explicite de
ne jamais présenter le paiement par carte comme disponible s'il ne l'est pas réellement.

Recherche dans le code : le paiement par carte existe déjà sous le nom **« Kat Kredi »**
(provider `stripe`), avec sa propre entrée dans `checkout.tsx` (`METHODS`) et son propre logo déjà
utilisé là-bas (`/stripe-card-logo.svg`).

**Constat initial, avant validation utilisateur** : la valeur _seedée_ par la dernière migration
touchant `payment_provider_settings` (`20260805140000_stripe_collect_integration.sql`) est
`('stripe', visible: true, enabled: false, ..., 'Peman ak kat kredi ap disponib byento.')` — et
aucune migration ultérieure ne modifie cette ligne. Le placeholder client dans `checkout.tsx`
reflète la même valeur (`enabled: false`), avec le commentaire explicite « mirrors the migration's
own seed values ».

**Ce que cela signifie concrètement** : la valeur _seedée en base_ est `enabled: false` — mais
`payment_provider_settings` a un vrai chemin d'écriture applicatif
(`update_payment_provider_setting_secure`), c'est-à-dire qu'un administrateur peut l'avoir activé
depuis, sans qu'aucune migration ne l'enregistre (les migrations ne capturent que l'état initial/
seed, pas les changements de configuration ultérieurs faits depuis l'interface admin).

**Confirmation obtenue avant implémentation** : interrogé directement sur ce point precis, il a
été confirmé que le paiement par carte est **réellement activé aujourd'hui** (basculé depuis
l'admin après la dernière migration). L'intégration ci-dessous a été faite sur cette base.

**Si cette confirmation s'avérait incorrecte** (ex. redésactivé depuis), il suffit de retirer les
deux ajouts ci-dessous — aucune autre dépendance n'a été créée.

---

## 2bis. Où les logos de paiement existent déjà dans le code

Recherche exhaustive avant d'ajouter quoi que ce soit (Phase 6-10, 18) :

- **`checkout.tsx`** : liste complète des méthodes avec logos — **non modifié** (fait partie de la
  « logique de checkout », explicitement hors périmètre).
- **`hero-section.tsx`** : badge « Peman disponib » (MonCash, Kach, NatCash) — page d'accueil.
- **`site-footer.tsx`** : section « Peman » (MonCash, Kach, NatCash) — footer, présent sur toutes
  les pages publiques.
- **Aucun dashboard** (client, restaurant, livreur, admin) n'affiche de logo de paiement nulle
  part. Le mode de paiement y est représenté **uniquement en texte** via
  `PAYMENT_METHOD_LABEL` (`order-kanban-board.tsx`, `dashboard.restaurant.orders.tsx` —
  ex. « MonCash », « Kach nan livrezon ») — jamais avec une image, pour aucune méthode, y compris
  MonCash/NatCash déjà actifs.

**Décision motivée : aucun dashboard n'a été modifié.** Ajouter un logo uniquement pour la carte
dans un dashboard, alors que MonCash/NatCash n'y ont jamais de logo non plus, créerait exactement
l'incohérence que la Phase 15 demande d'éviter (« Éviter qu'un seul moyen de paiement paraisse
disproportionné ») — dans le sens inverse : la carte y paraîtrait disproportionnée par rapport aux
autres méthodes, toutes traitées en texte simple dans ce contexte. Conforme à l'instruction
explicite : « Ne pas afficher le logo partout simplement pour augmenter sa visibilité » /
« Ne pas ajouter le logo simplement parce qu'il s'agit d'un dashboard ».

_Note hors périmètre, non traitée_ : `PAYMENT_METHOD_LABEL` ne contient pas d'entrée pour `stripe`
(ni pour `moncash_auto`/`natcash_auto`) — une commande payée par carte y afficherait la clé brute
`stripe` plutôt qu'un libellé « Kat Kredi ». C'est une lacune de données textuelles préexistante,
sans rapport avec l'intégration d'un logo — signalée mais non corrigée, hors du périmètre de cette
mission.

---

## 3. Composants modifiés

| Fichier                                | Changement                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/components/home/hero-section.tsx` | Ajout d'un 4ᵉ item dans le badge « Peman disponib » (section confiance déjà existante, Option B du prompt) |
| `src/components/site-footer.tsx`       | Ajout d'un 4ᵉ item dans le tableau `payments` de la section « Peman » (Option C du prompt)                 |

Aucun nouveau composant créé (voir §Phase 12 ci-dessous pour la justification).

### Sur le composant réutilisable (Phase 12)

Le prompt suggérait un composant du type `PaymentMethodLogo`. **Décision : non créé.** MonCash et
NatCash n'utilisent eux-mêmes aucun composant partagé — chaque emplacement (`hero-section.tsx`,
`site-footer.tsx`) les code en `<img>` inline avec ses propres classes. Créer un composant
uniquement pour Kat Kredi, alors que les deux autres méthodes restent codées en dur, introduirait
une incohérence architecturale plutôt qu'une simplification. Le marquage a donc été ajouté en
suivant **exactement** le motif déjà établi à chaque emplacement.

---

## 4. Homepage — emplacement du logo

**Un seul emplacement d'affichage réel sur la homepage : le badge « Peman disponib » du Hero**
(`hero-section.tsx`), déjà la section confiance existante qui liste les moyens de paiement
disponibles (Option A/B du prompt — réutilisée plutôt que créer une nouvelle section, comme
demandé). Le logo carte a été ajouté en 4ᵉ position, après NatCash, avec un traitement identique
(32×32, `rounded`, `object-cover`, chargement eager comme les 3 autres — ils sont au-dessus de la
ligne de flottaison).

Le footer (visible sur `/`, mais aussi sur toutes les pages publiques) a également été mis à jour
— voir §6 : c'est un emplacement de marque global, pas spécifique à la homepage, donc traité comme
faisant partie de la même famille de changement plutôt qu'une section homepage séparée.

`app-benefits-section.tsx` (« Peman sekirite », texte « Peye fasil ak MonCash, NatCash oswa lajan
kach. ») **n'a pas été modifié** — c'est un texte de bullet-point, pas un emplacement de logo, et
le prompt porte explicitement sur l'intégration du **logo**, pas la réécriture de contenu.
Signalé ici pour transparence plutôt que silencieusement ignoré.

---

## 5. Dashboards

**Aucun dashboard modifié** — décision motivée en détail au §2bis. Ni le dashboard client, ni
restaurant, ni livreur, ni admin n'affichent de logo de paiement pour quelque méthode que ce soit
aujourd'hui (texte uniquement) ; en ajouter un uniquement pour la carte y créerait une
incohérence, pas une amélioration.

---

## 6. Cohérence avec MonCash/NatCash (Phase 15)

| Emplacement                | Traitement MonCash/NatCash                                      | Traitement Kat Kredi (nouveau) |
| -------------------------- | --------------------------------------------------------------- | ------------------------------ |
| Hero (`hero-section.tsx`)  | `32×32`, `rounded`, `object-cover`, alt = nom court             | Identique                      |
| Footer (`site-footer.tsx`) | `40×40`, `rounded-xl`, `shadow-brand-xs`, alt+title = nom court | Identique                      |

Même taille, même traitement d'angle/ombre, même position dans le flux (`flex-wrap`/`flex-nowrap`
déjà en place, non modifié) — aucun des deux emplacements ne fait paraître la carte
disproportionnée par rapport aux 3 autres méthodes déjà affichées.

---

## 7. Responsive

Vérifié visuellement par capture Playwright réelle (pas seulement le code) :

- **Hero — 375 / 390 / 393 / 430 px** : les 4 logos (MonCash, Kach, NatCash, Carte) tiennent sur
  une seule ligne dans le badge, sans retour à la ligne, sans débordement. Confirmé
  qu'aucun scroll horizontal global n'apparaît (`scrollWidth` vs `clientWidth`, testé à chaque
  largeur).
- **Hero — 1280 / 1440 / 1920 px** : badge bien équilibré, positionné en bas-droite du hero comme
  avant, aucun élargissement disproportionné.
- **Footer — mobile (390px) et desktop (1440px)** : les 4 icônes s'affichent proprement dans la
  grille `flex-wrap` déjà existante, alignement cohérent, pas d'espace disproportionné.

Aucune « énorme carte juste pour afficher un logo » — l'intégration reste à la taille des icônes
déjà en place.

---

## 8. Accessibilité

- `alt="Kat Kredi"` sur les deux emplacements — libellé court et pertinent, repris directement du
  label déjà utilisé pour cette méthode dans `checkout.tsx` (cohérence terminologique), pas
  `alt="logo"` ni une description trop longue.
- Footer : `title="Kat Kredi"` également posé, même motif que MonCash/NatCash à cet emplacement
  (infobulle au survol).
- Aucune régression détectée : `accessibility.spec.ts` (page d'accueil) repassée après
  modification — les seules violations rencontrées sur l'ensemble de la suite (page de détail
  restaurant, checkout) reproduisent exactement les constats déjà documentés depuis la Phase 7-10
  (contraste de marque assumé, timeout du mock SSR/auth au checkout), sans rapport avec ce
  changement.

---

## 9. Performance

- `katkredi.png` (14.8 Ko) est le plus léger des 4 logos de paiement — aucun impact mesurable.
- Aucun changement de stratégie de chargement nécessaire : utilisé en `eager` dans le Hero
  (au-dessus de la ligne de flottaison, comme MonCash/Kach/NatCash déjà là) et en `loading="lazy"`
  dans le footer (déjà la stratégie existante pour ce bloc, appliquée automatiquement puisque
  l'ajout suit le même `.map()` que les logos existants).
- `width`/`height` explicites posés aux deux emplacements (32×32 et 40×40) — aucun layout shift,
  aucune réservation d'espace supplémentaire nécessaire au-delà de ce que le flex-wrap gère déjà.
- Le fichier a été correctement précaché par le service worker (chargement eager, cohérent avec le
  traitement des 3 autres logos de paiement du Hero) — aucune exclusion de précache nécessaire.

---

## 10. Vérification

- `npm run typecheck` : clean.
- `npm run lint` : clean (avertissements `react-refresh` préexistants uniquement, sans rapport).
- `npm run build` : réussi.
- `npm run verify` (typecheck + lint + garde-fou migrations + tests unitaires + build) : **clean**.
- Vérification visuelle réelle (captures Playwright, pas seulement le code) : Hero à 7 largeurs
  (375/390/393/430/1280/1440/1920px), footer à 2 largeurs (390/1440px) — tout conforme, aucun
  débordement, aucune déformation, alignement cohérent partout.

---

## Résultat

Le logo `public/katkredi.png` est maintenant intégré dans le badge « Peman disponib » du Hero et
dans la section « Peman » du footer — les deux seuls emplacements où des logos de moyens de
paiement existent déjà sur le site. Aucun dashboard n'a été modifié, une décision motivée par le
fait qu'aucun d'eux n'affiche de logo de paiement pour aucune méthode aujourd'hui. La disponibilité
réelle du paiement par carte a été vérifiée avant toute intégration (Phase 2/17), et confirmée par
vous avant implémentation. Aucune ligne de logique de paiement, Supabase, API, PLOP ou base de
données n'a été touchée.
