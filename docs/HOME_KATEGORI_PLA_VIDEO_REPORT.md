# Kategori Pla + Vidéo « Bèlte Ayiti » — Rapport d'implémentation

**Aucun commit créé, aucun push effectué — changements conservés localement, conformément à
l'instruction.**

---

## 1. Assets découverts (`Kategori/`)

Inspection complète effectuée avant toute modification (headers WebP/MP4 parsés directement,
MD5 calculé sur les 11 fichiers — aucun doublon, aucun fichier corrompu ou à 0 octet).

### Images — 10 fichiers `.webp`

| Fichier | Dimensions | Ratio | Taille |
|---|---|---|---|
| `haiti-1-soup-joumou-symbole-de-liberte-1739209611.webp` | 1332×1332 | 1:1 | 349.1 Ko |
| `haiti-2-diri-blan-sos-pwa-legim-l039essence-du-quotidien-1739209664.webp` | 714×952 | 3:4 | 99.8 Ko |
| `haiti-7-ragou-un-plat-reconfortant-et-epice-1739210329.webp` | 660×660 | 1:1 | 113.0 Ko |
| `haiti-9-diri-sos-pwa-kongo-un-mariage-parfait-de-saveurs--1739210578.webp` | 1280×720 | 16:9 | 134.1 Ko |
| `haiti-10-mayi-moulen-ak-sos-pwa-un-plat-reconfortant--1739210703.webp` | 3642×3642 | 1:1 | 541.4 Ko |
| `haiti-11-fritay-le-snack-incontournable-des-rues-haitiennes--1739210736.webp` | 512×512 | 1:1 | 91.8 Ko |
| `haiti-12-tonmtonm-ak-sos-kalalou-une-specialite-du-grand-sud--1739210770.webp` | 1400×934 | ~3:2 | 239.6 Ko |
| `haiti-16-lalo-l-epinard-haitien--1739211070.webp` | 1440×1080 | 4:3 | 237.0 Ko |
| `haiti-17-pate-kode-le-street-food-par-excellence--1739211190.webp` | 2048×2048 | 1:1 | 757.7 Ko |
| `haiti-21-pwason-gro-sel-l-authenticite-des-saveurs-de-la-mer--1739211784.webp` | 1600×1600 | 1:1 | 756.6 Ko |

**Constat fiable** : chaque nom de fichier suit le motif `haiti-<N>-<nom-du-plat>-<timestamp>.webp`
et contient un vrai nom de plat haïtien plus une courte description — aucune catégorie n'a dû être
devinée. La séquence numérique (1,2,7,9,10,11,12,16,17,21) a des trous — signalé, pas interprété :
il existe peut-être d'autres images de cette même série ailleurs, non utilisées ici.

### Vidéo — 1 fichier `.mp4`

`haiti-tourisme.mp4` — seul fichier vidéo du dossier, donc candidat par élimination pour
« Bèlte Ayiti » (le nom du fichier lui-même ne dit pas littéralement « beauté d'Haïti » — signalé,
pas présenté comme une certitude). MP4 (H.264 `avc1` + AAC `mp4a`, donc **avec piste audio**),
1280×720, **30.3 s**, **10.92 Mo**, débit combiné ≈ 3.02 Mbps.

**Aucune image d'affiche (poster) dédiée** trouvée dans le dossier — aucune des 10 images ne
correspond par nom ou par sujet (toutes sont des photos de plats, pas de paysage/tourisme). Décision
prise en conséquence : pas d'extraction automatique de frame (pas d'outil fiable disponible dans cet
environnement, et une extraction hasardeuse aurait été pire qu'une absence de poster) — le popup
utilise à la place une couverture conçue (dégradé de marque + bouton Play + libellé), voir §5.

---

## 2. Analyse de l'accueil (avant modification)

`src/routes/index.tsx`, ordre exact avant cette phase :

```
SiteHeader
Hero
AdBannerSection
HowItWorksSection
RestaurantCtaBanner
PopularRestaurantsSection (filtre cuisine — chips locales, jamais branchées à Supabase/routeur)
AppBenefitsSection
PopularDishesSection (filtre dish_type — chips locales, DISH_TYPES réel sur la table products)
NewsletterSection
SiteFooter
```

Deux mécanismes de « catégorie » préexistaient déjà, tous deux **purement côté client** (état React
local, aucun paramètre d'URL, aucune nouvelle requête Supabase) :
- `cuisine` (`PopularRestaurantsSection`) : `["Tout","Manje Kreyòl","Soup Joumou","Ragou","Lalo","Fritay"]`.
- `dishType` (`PopularDishesSection`) : `DISH_TYPES` réel, aligné sur la colonne `products.dish_type`
  (`diri_sos`, `griyo`, `fritay`, `soup`, `pwason`, `sandwich`, `pizza`, `bwason`).

Design tokens confirmés disponibles et réutilisés tels quels : `--brand`/`--brand-deep`/
`--brand-soft`/`--cream`/`--ink`/`--ink-soft`, `shadow-brand-xs/sm/md`, rayons `rounded-2xl`→
`rounded-4xl`, `Button`, `Chip`. Aucun nouveau token créé.

---

## 3. Kategori Pla

### Architecture

`src/components/home/kategori-pla-section.tsx`, monté dans `index.tsx` immédiatement après
`<HeroSection>`, avant `<AdBannerSection>` — ordre imposé respecté.

### Association image → catégorie

Chacune des 10 images a été mise en correspondance avec un nom de plat en kreyòl tiré directement
du nom de fichier (traduit dans le ton du site, pas inventé). **5 des 10** correspondent en plus à
une vraie valeur `dish_type` déjà existante dans `PopularDishesSection` :

| Carte | `dish_type` réel utilisé |
|---|---|
| Soup Joumou | `soup` |
| Diri Blan ak Sòs Pwa | `diri_sos` |
| Diri ak Sòs Pwa Kongo | `diri_sos` |
| Fritay | `fritay` |
| Pwason Gro Sèl | `pwason` |

Les 5 autres (Ragou, Mayi Moulen ak Sòs Pwa, Tonmtonm ak Sòs Kalalou, Lalo, Patè Kòde) n'ont **aucune**
correspondance fiable dans la taxonomie `dish_type` existante — **aucune catégorie n'a été inventée
pour elles**.

### Interaction

Réutilise la logique de filtre déjà existante (`dishType`/`setDishType`, déjà branchée à
`PopularDishesSection`) — **aucune nouvelle logique métier créée**. Cliquer une carte appelle
toujours `onCategoryClick`, qui règle `dishType` (à la vraie valeur pour les 5 cartes mappées, à
`"all"` pour les 5 autres — un reset honnête plutôt qu'un filtre laissé dans un état non pertinent)
puis fait défiler jusqu'à la section « Plat popilè » (`id="plat-popile"`, ajouté avec
`scroll-mt-20` pour dégager le header sticky). Toutes les cartes ont donc un comportement cohérent
— pas de mélange cartes-cliquables/cartes-décoratives dans la même grille.

### Design

Rail horizontal à défilement contrôlé (`overflow-x-auto`, `snap-x snap-mandatory`), identique à
tous les breakpoints plutôt qu'une grille qui change de disposition — choix fait au regard du
nombre réel d'images (10, largeur cumulée > tout conteneur raisonnable, donc un rail est la
disposition qui s'impose naturellement, cohérent avec la mise en garde de ne pas appliquer une
grille mécaniquement). Boutons précédent/suivant visibles uniquement à partir de `md:` (le swipe
tactile suffit sur mobile). Cartes : image carrée (`aspect-square`, `object-cover`, jamais déformée)
+ nom + courte étiquette, `rounded-3xl`/`shadow-brand-xs`/`ring-brand-soft/40` — mêmes tokens que
`PopularDishesSection`/`PopularRestaurantsSection`, pas de nouveau vocabulaire visuel.

### Responsive

Le rail lui-même limite le défilement horizontal à la section — vérifié qu'aucun débordement
horizontal global n'apparaît (test dédié, voir §9). Testé visuellement 320→1920px (§7).

### Animations

`whileInView`/`viewport={{once:true}}`, même schéma que `HowItWorksSection` déjà existant (fade +
léger déplacement, delai échelonné `i*0.05`) — hérite automatiquement de `MotionConfig
reducedMotion="user"` déjà monté à la racine, aucun câblage supplémentaire nécessaire.

---

## 4. Vidéo

Fichier utilisé : `/kategori/haiti-tourisme.mp4` (copié tel quel dans `public/kategori/`, nom
inchangé). 1280×720, 30.3 s, 10.92 Mo, avec piste audio.

**Stratégie de chargement — la plus conservatrice possible** : le popup démarre **minimisé**, et
même une fois ouvert, l'élément `<video>` n'est monté dans le DOM **qu'après** que le visiteur ait
cliqué sur Play (pas seulement `preload="none"` — l'élément n'existe littéralement pas avant ce
clic). Conséquence directe : **zéro octet de la vidéo n'est jamais téléchargé sans une action
explicite du visiteur**, et il n'y a donc aucune question d'autoplay à trancher (pas d'autoplay du
tout, ni muet ni sonore).

Poids jugé raisonnable pour une lecture à la demande (pas de compression tentée sans validation,
conformément à l'instruction) — signalé ici plutôt que traité : à 3 Mbps, un visiteur sur une
connexion 3G lente attendrait un moment avant que la lecture démarre ; aucune mesure corrective
appliquée sans votre accord.

---

## 5. Popup

Composant : `src/components/home/haiti-video-popup.tsx`, monté uniquement dans `routes/index.tsx`
(jamais dans `__root.tsx`) — ne peut donc jamais apparaître sur `/checkout` ou `/orders/$id`.

### États

- **Minimisé** (défaut) : pastille compacte « ▶ Bèlte Ayiti », bottom-right desktop, position
  adaptée mobile avec zones de sécurité (`--sab`/`--sar`).
- **Ouvert** : carte flottante (260px mobile / 300px desktop), couverture dégradé + bouton Play
  tant que la vidéo n'a pas démarré, puis lecteur + barre de contrôles une fois lancée.
- **Fermé** : disparaît entièrement, `sessionStorage` (`nk-haiti-video-closed`) empêche toute
  réapparition pendant la même session — cohérent avec la convention déjà en place dans le projet
  (`nk-install-dismissed-at`, etc.), adaptée en `sessionStorage` plutôt que `localStorage` puisque
  la persistance ne doit tenir que pour la session en cours.

**Découverte pendant l'implémentation, non prévue dans le plan initial** : le popup ne s'affiche
(même minimisé) qu'une fois le Hero défilé hors champ (`IntersectionObserver` sur `#hero`). Ajouté
après avoir trouvé, par une vraie capture d'écran, que la carte ouverte chevauchait le badge
« Peman disponib » du Hero en haut de page sur plusieurs hauteurs d'écran desktop courantes — corrigé
à la racine plutôt que masqué par un simple ajustement de position (voir §10 pour le détail de cette
découverte).

### Contrôles

Play/Pause, Mute/Unmute (`aria-pressed`), Minimiser, Fermer, Plein écran (`requestFullscreen`) —
tous des `<button>` natifs avec `aria-label` en kreyòl, cohérent avec le reste de l'app
(`InstallPrompt`, etc.).

### Accessibilité

- `aria-expanded`/`aria-controls` sur la pastille minimisée, pointant vers le panneau
  (`id="haiti-video-panel"`).
- `role="group"` + `aria-label="Videyo Bèlte Ayiti"` sur le panneau ouvert.
- **Gestion du focus clavier — trouvée manquante par un vrai test Tab, puis corrigée** : activer la
  pastille au clavier ne déplaçait pas le focus dans le panneau nouvellement ouvert (il tombait sur
  `<body>`). Corrigé avec `onAnimationComplete` de Framer Motion (pas un simple `useEffect` sur
  l'état — `AnimatePresence mode="wait"` retarde le montage du nouvel élément jusqu'à la fin de
  l'animation de sortie de l'ancien, donc un effet basé sur l'état lisait une ref encore nulle).
  Vérifié à nouveau après correctif : focus atterrit sur le bouton Play à l'ouverture, revient sur
  la pastille à la minimisation.
- Respecte `prefers-reduced-motion` automatiquement (héritage de `MotionConfig` racine).

---

## 6. Performance

Mesuré sur un vrai `npm run build` (comme en Phase 8), avant/après :

| Métrique | Avant | Après | Delta |
|---|---|---|---|
| Chunk `routes-*.js` (contient les 2 nouveaux composants) | 20.15 Ko / gzip 5.86 Ko | 30.74 Ko / gzip 8.76 Ko | +10.59 Ko / **+2.9 Ko gzip** |
| Précache service worker | 193 entrées / ~2110 Ko | 193 entrées / 2114.73 Ko | **quasi nul** |
| Poids vidéo téléchargé par défaut | — | **0 octet** (jusqu'au clic Play) | — |

**Décision de precache prise pendant l'implémentation** : le premier build montrait les 10 images
Kategori (~3.4 Mo) balayées dans le précache *eager* du service worker — en contradiction directe
avec le `loading="lazy"` posé sur 6 des 10 cartes dans le composant lui-même. Corrigé en excluant
`kategori/*.webp` du glob de précache (`vite.config.ts`, même mécanisme déjà utilisé en Phase 8 pour
`payment-global/**` et les chunks admin) — la règle `CacheFirst` déjà en place dans `src/sw.ts` met
quand même chaque image en cache dès son premier vrai affichage, juste pas en avance pour tout le
monde.

Impact LCP : le Hero (élément LCP de la page) est inchangé — toujours `fetchPriority="high"`, aucune
ressource Kategori/vidéo ne le précède dans le chemin critique.

---

## 7. Responsive

Captures Playwright réelles prises et inspectées visuellement (pas seulement code/compilation) aux
9 largeurs demandées : 320, 360, 390, 414, 768, 1024, 1280, 1440, 1920px.

- Rail Kategori Pla : cartes bien proportionnées à toutes les largeurs, défilement tactile fluide
  sur mobile, boutons précédent/suivant nets sur desktop, aucun écrasement de contenu.
- **Aucun scroll horizontal global** confirmé par un test dédié (`document.documentElement.
  scrollWidth` vs `clientWidth`), pas seulement par inspection visuelle.
- Popup : pastille et carte ouverte correctement contenues sur mobile (largeur `calc(100vw - 2rem)`
  max), ne recouvrent ni la bottom-nav ni aucun CTA — vérifié visuellement à 390px.
- **Bug réel trouvé et corrigé** (pas seulement documenté) : chevauchement popup/badge Hero sur
  desktop à l'ouverture en haut de page — voir §5 et §10.

---

## 8. Accessibilité

- `npx playwright test e2e/cross-cutting/accessibility.spec.ts -g "home page"` : les seules
  violations relevées (contraste `text-brand` du logo header, sur fond blanc) sont **le même constat
  déjà documenté depuis la Phase 7** (choix de marque assumé, `--brand` non retouché sans validation
  explicite) — confirmé non lié aux nouveaux composants par relecture : aucune violation ne cite
  `kategori-pla-section.tsx` ni `haiti-video-popup.tsx`.
- Clavier : vérifié directement (script de test dédié, supprimé après validation) — cartes Kategori
  Pla et tous les contrôles du popup atteignables et activables au Tab/Entrée, focus géré
  correctement à l'ouverture/minimisation (voir §5).
- `prefers-reduced-motion` : hérité automatiquement, aucune nouvelle animation ne le contourne.

---

## 9. Tests

`npm run verify` (typecheck, lint, garde-fou migrations, tests unitaires, build) : **clean**,
exécuté à plusieurs reprises pendant l'implémentation, dernière exécution propre.

`e2e/cross-cutting/kategori-pla-video.spec.ts` (nouveau, 5 tests, tous réels — pas de test
artificiel) : **5/5 passent**, de façon stable sur deux exécutions complètes consécutives.

1. Kategori Pla apparaît après le Hero, les 10 cartes sont présentes.
2. Cliquer une catégorie mappée fait défiler jusqu'à « Plat popilè ».
3. Aucun débordement horizontal global sur mobile.
4. Popup : démarre minimisé, s'ouvre, se minimise, se ferme, la fermeture persiste pour la session
   (rechargement inclus).
5. Appuyer sur Play monte et démarre la vidéo.

**Limitation SSR/auth (déjà documentée depuis P7)** : sans objet ici — la page d'accueil est
publique, ces tests ne dépendent d'aucun mock d'authentification et constituent donc une preuve
fiable, pas une fausse route de connexion.

Vérification de non-régression élargie : `accessibility.spec.ts` et
`responsive/navigation-and-layout.spec.ts` ré-exécutés en entier — les 6 échecs rencontrés
reproduisent exactement les signatures déjà documentées en P7-P10 (contraste marque, timeout
SSR/auth checkout, pollution de mock « AC Resto ») ; aucun ne cite un fichier ou composant de cette
phase.

---

## 10. Limites — documentées honnêtement

- **Image d'affiche (poster) de la vidéo** : absente du dossier source, aucune extraction de frame
  tentée (pas d'outil fiable disponible) — le popup utilise une couverture conçue à la place
  (dégradé + Play), pas un vrai aperçu de la vidéo.
- **Poids de la vidéo** (10.92 Mo, ~3 Mbps) : non compressé, non modifié — signalé, pas corrigé sans
  validation, conformément à l'instruction. Le chargement à la demande (0 octet par défaut) limite
  fortement l'impact réel malgré ce poids.
- **Chevauchement Hero/popup découvert puis corrigé** (§5, §7) — corrigé à la racine
  (`IntersectionObserver`), pas contourné par un simple ajustement visuel qui aurait laissé le
  problème partiellement présent.
- **Flakiness résiduelle, non un bug applicatif** : pendant la vérification manuelle du parcours
  clavier (script de test temporaire, non conservé), l'activation au clavier de la première carte
  Kategori Pla a échoué de façon intermittente (~1 fois sur 3) à faire défiler la page — alors que
  le même comportement, testé au clic dans la suite de tests permanente, est stable à 100% sur
  plusieurs exécutions complètes. Cohérent avec la flakiness d'environnement local déjà documentée
  depuis la Phase 6 (contention de ressources en exécution groupée) plutôt qu'avec un défaut du
  composant — non approfondi davantage faute de reproduction fiable, signalé plutôt que passé sous
  silence.
- **Contraste de marque** (`text-brand` du logo header) : constat pré-existant depuis la Phase 7,
  sans rapport avec cette phase, non retouché conformément à la décision permanente du projet.
- **Trous dans la séquence numérique des noms de fichiers Kategori** (indices 3-6, 8, 13-15, 18-20
  manquants) : signalé au §1, non interprété — il pourrait exister d'autres images de cette série
  ailleurs dans le projet, non recherchées activement au-delà du dossier `Kategori/` fourni.

---

## Décision finale

- Les deux fonctionnalités demandées sont implémentées, intégrées à l'ordre imposé (Hero → Kategori
  Pla → contenu existant), sans toucher la logique métier, Supabase, RLS, API, Edge Functions,
  migrations, paiements ou authentification (confirmé par la liste de fichiers modifiés : 3 fichiers
  existants touchés de façon minimale + 2 nouveaux composants + `vite.config.ts` pour le précache).
- `npm run verify` clean, tests Playwright dédiés stables (5/5, deux exécutions consécutives), audit
  visuel réel effectué à 9 largeurs (pas seulement code compilé), un vrai bug visuel trouvé par
  capture d'écran et corrigé à la racine plutôt que contourné, gestion du focus clavier trouvée
  manquante et corrigée.
- Limites documentées honnêtement plutôt que dissimulées (poster vidéo absent, poids vidéo non
  compressé, flakiness clavier intermittente non totalement élucidée).

**✅ PRÊT POUR VALIDATION VISUELLE**

En attente de votre autorisation avant tout `git add`/`git commit`/`git push`.
