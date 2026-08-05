# Payment Global — Déclinaisons graphiques du logo

**Date** : 2026-08-04
**Portée** : génération de toutes les déclinaisons graphiques (PNG, WebP, PWA, favicons, Open Graph, réseaux sociaux, monochrome, dark/light) à partir de la source unique `public/payment-global-logo.svg`. **Aucun code métier, React ou Supabase modifié. Aucune migration. Aucun commit. Aucun déploiement.**

## Statut

**LIVRÉ**

---

## 0. Intégrité de la source — vérifiée, pas seulement affirmée

`public/payment-global-logo.svg` **n'a pas été touché**. Preuve : hash SHA-256 pris avant toute génération, puis recalculé à la fin :

```
0a427eb8dc23b51482f0264c3cea7acbcf07d9c88bbb7b6099988c108b3998f7   (avant)
0a427eb8dc23b51482f0264c3cea7acbcf07d9c88bbb7b6099988c108b3998f7   (après)
```

Identiques — aucune écriture, directe ou indirecte, sur ce fichier pendant toute la mission.

---

## 1. Méthode de génération — honnêteté sur les outils réellement utilisés

Aucun outil de rastérisation dédié n'est installé dans cet environnement (pas de `sharp`, pas d'ImageMagick, pas de Python, pas de `cwebp`, pas d'Inkscape, pas de `rsvg-convert` — vérifié explicitement, pas supposé). Le seul outil réellement disponible et fiable est **Playwright**, déjà présent en dépendance (`@playwright/test@1.62.1`) avec les moteurs **Chromium** et **WebKit** déjà téléchargés localement.

Toutes les images ont donc été produites par un moteur de navigateur réel, pas par un outil de conversion d'image tiers :

| Format | Méthode réelle | Preuve |
|---|---|---|
| PNG | Chromium headless, SVG chargé en `data:` URI, `page.screenshot({ omitBackground: true })` | Vérifié : type couleur PNG (octet IHDR) = RGBA pour tous les fichiers destinés à être transparents, RGB (sans alpha) pour les fonds pleins volontaires (maskable, apple-touch-icon) |
| WebP | **Encodeur WebP natif de Chromium**, via `canvas.toDataURL('image/webp')` — pas de conversion PNG→WebP externe | Vérifié : chaque fichier généré commence par l'en-tête binaire `RIFF….WEBP` (`VP8X`), le script échoue explicitement si Chromium retombe sur `image/png` au lieu d'honorer `image/webp` (aucun cas rencontré) |
| ICO | Empaqueteur ICO écrit à la main (format MS-ICO documenté, entrées PNG intégrées telles quelles — supporté nativement depuis Windows Vista et par tous les navigateurs modernes) | Vérifié : le fichier généré a été **rechargé dans Chromium** (`<img src="favicon.ico">`) qui l'a décodé sans erreur et rapporté la plus grande entrée (48×48) |

Aucun octet n'a été fabriqué ou renommé (pas de PNG déguisé en `.webp`, pas de PNG déguisé en `.ico`).

---

## 2. Structure livrée

```
public/payment-global/
├── logo.svg                    (copie de la source — inchangée)
├── logo-light.svg              (identique à la source, voir § 5)
├── logo-dark.svg               (variante additive, voir § 5)
├── png/            payment-global-{64,128,256,512,1024}.png
├── webp/           payment-global-{64,128,256,512,1024}.webp
├── favicon/        favicon.ico, favicon-{16,32,48}.png, apple-touch-icon.png
├── pwa/            icon-{72,96,128,144,152,192,384,512}.png, maskable_icon.png, monochrome_icon.png
├── social/         og-payment-global.png, profile-facebook-720.png, profile-whatsapp-640.png, profile-linkedin-x-400.png
└── monochrome/     logo-black.svg, logo-white.svg, logo-black.png, logo-white.png
```

36 fichiers, 1 436 935 octets (≈1.4 Mo) au total — mesuré (`find public/payment-global -type f | wc -l` / somme des tailles réelles), pas estimé.

---

## 3. Inventaire complet — dimensions et poids réels

Toutes les valeurs ci-dessous sont mesurées sur les fichiers générés (pas estimées).

### PNG cœur (fond transparent, aspect natif 100:70 du badge conservé)

| Fichier | Dimensions réelles | Poids |
|---|---|---|
| `png/payment-global-64.png` | 64×45 | 2.6 Ko |
| `png/payment-global-128.png` | 128×90 | 7.3 Ko |
| `png/payment-global-256.png` | 256×179 | 24.1 Ko |
| `png/payment-global-512.png` | 512×358 | 79.1 Ko |
| `png/payment-global-1024.png` | 1024×717 | 275.1 Ko |

### WebP (mêmes 5 tailles, ré-encodées depuis les PNG ci-dessus)

| Fichier | Poids | Réduction vs PNG |
|---|---|---|
| `webp/payment-global-64.webp` | 1.6 Ko | −37.8 % |
| `webp/payment-global-128.webp` | 2.8 Ko | −61.5 % |
| `webp/payment-global-256.webp` | 5.1 Ko | −78.7 % |
| `webp/payment-global-512.webp` | 9.7 Ko | −87.8 % |
| `webp/payment-global-1024.webp` | 18.3 Ko | −93.3 % |

Réduction croissante avec la taille : le badge est composé de larges aplats et d'un dégradé simple — le profil idéal pour l'encodeur WebP, qui gagne le plus là où PNG paie le plus cher son absence de prédiction inter-blocs. Qualité 0.92 (lossy + canal alpha) — **aucune perte visible** constatée en comparant visuellement chaque paire PNG/WebP côte à côte (voir § 6).

### PWA (icônes carrées, logo centré avec marge de sécurité 10 %, fond transparent)

| Fichier | Dimensions | Poids |
|---|---|---|
| `pwa/icon-72.png` | 72×72 | 2.5 Ko |
| `pwa/icon-96.png` | 96×96 | 3.8 Ko |
| `pwa/icon-128.png` | 128×128 | 5.8 Ko |
| `pwa/icon-144.png` | 144×144 | 7.2 Ko |
| `pwa/icon-152.png` | 152×152 | 7.7 Ko |
| `pwa/icon-192.png` | 192×192 | 10.9 Ko |
| `pwa/icon-384.png` | 384×384 | 35.7 Ko |
| `pwa/icon-512.png` | 512×512 | 55.6 Ko |
| `pwa/maskable_icon.png` | 512×512 | 94.6 Ko |
| `pwa/monochrome_icon.png` | 512×512 | 10.4 Ko |

### Favicons

| Fichier | Dimensions | Poids |
|---|---|---|
| `favicon/favicon-16.png` | 16×16 | 0.5 Ko |
| `favicon/favicon-32.png` | 32×32 | 1.1 Ko |
| `favicon/favicon-48.png` | 48×48 | 1.6 Ko |
| `favicon/favicon.ico` | multi-résolution (16/32/48 intégrées) | 3.2 Ko |
| `favicon/apple-touch-icon.png` | 180×180 | 12.0 Ko |

### Réseaux sociaux

| Fichier | Dimensions | Poids | Couvre |
|---|---|---|---|
| `social/og-payment-global.png` | 1200×630 | 295.7 Ko | Open Graph universel — Facebook, X, LinkedIn, WhatsApp, Slack utilisent tous ce même format en 2026 ([source](https://www.krumzi.com/blog/open-graph-image-sizes-for-social-media-the-complete-2026-guide)) |
| `social/profile-facebook-720.png` | 720×720 | 198.1 Ko | Photo de profil Facebook (recommandé 720×720) |
| `social/profile-whatsapp-640.png` | 640×640 | 151.0 Ko | Photo de profil WhatsApp Business (recommandé 640×640, [source](https://gallabox.com/blog/whatsapp-business-profile-picture)) |
| `social/profile-linkedin-x-400.png` | 400×400 | 50.5 Ko | Photo de profil LinkedIn et X/Twitter (les deux recommandent 400×400, [source X](https://www.evergreenfeed.com/blog/twitter-profile-picture-size/)) |

Les formats de profil sont **recadrés en cercle** par ces quatre plateformes — le badge est centré avec une marge large pour rester lisible après ce recadrage.

### Monochrome

| Fichier | Dimensions | Poids |
|---|---|---|
| `monochrome/logo-black.svg` | vectoriel | 1.2 Ko |
| `monochrome/logo-white.svg` | vectoriel | 1.2 Ko |
| `monochrome/logo-black.png` | 512×512 | 11.2 Ko |
| `monochrome/logo-white.png` | 512×512 | 12.2 Ko |

---

## 4. Optimisations appliquées

- **PNG** : générés directement à la taille cible (pas de sur-échantillonnage puis réduction) — évite tout flou de redimensionnement. Fond transparent réel (canal alpha RGBA vérifié), pas de case blanche.
- **WebP** : qualité 0.92, canal alpha conservé (format étendu `VP8X`), gain moyen ~72 % vs PNG équivalent sur les 5 tailles.
- **ICO** : entrées PNG (pas de bitmap non compressé) — 3.2 Ko pour 3 résolutions au lieu de dizaines de Ko en BMP brut.
- **SVG** (source déjà propre, dérivés hérités du même style) : pas de métadonnées d'éditeur (`<metadata>`, commentaires Inkscape/Illustrator, `xmlns:xlink` inutilisé), pas de précision décimale superflue dans les coordonnées, `viewBox` cohérent — tous validés XML bien formé (`[xml]` .NET) :

  | Fichier | XML valide |
  |---|---|
  | `logo.svg` | ✅ |
  | `logo-dark.svg` | ✅ |
  | `logo-light.svg` | ✅ |
  | `monochrome/logo-black.svg` | ✅ |
  | `monochrome/logo-white.svg` | ✅ |

- **Maskable icon** : contenu réduit à 62 % du canevas (zone de sécurité Android — le cercle de masquage inscrit ne dépasse jamais 80 % de diamètre ; marge supplémentaire prise volontairement).
- **Icône monochrome PWA (Android 13+ themed icon)** : glyphe blanc réduit à 66 % du canevas, fond transparent — l'OS applique sa propre teinte, le fichier ne doit contenir qu'une seule couleur, ce qui est le cas.
- **Apple touch icon** : fond opaque plein (dégradé de marque), **pas de transparence** — conforme à la recommandation Apple (iOS applique son propre masque d'angles arrondis ; un fond transparent y produit un carré avec des coins visibles).

---

## 5. Variantes dark/light et monochrome — choix de conception expliqués

### `logo-light.svg`

Identique octet-pour-octet à la source. Justification : le badge est déjà un aplat opaque avec dégradé — il n'a jamais dépendu du fond pour rester lisible, donc la version "light" *est* la source elle-même. Créer une variante visuellement différente aurait été une modification non demandée sans raison fonctionnelle.

### `logo-dark.svg`

Géométrie strictement identique à la source (mêmes `x`/`y`/`width`/`height`/`rx`/`d` sur chaque forme). Le **seul** ajout : un liseré blanc translucide (`stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="1"`) sur le contour du badge, pour restituer une délimitation nette quand ce logo est posé directement sur une surface quasi noire (l'orange reste très lisible sur noir, mais sans liseré les angles arrondis se fondent légèrement dans un fond très sombre). Aucune forme, couleur de remplissage ou proportion changée — uniquement un trait additif.

### Monochrome (`logo-black.svg` / `logo-white.svg`)

Choix assumé : le monochrome est le **glyphe seul** (carte + arcs), sans le badge de fond coloré, sur fond transparent — c'est l'usage standard d'un logo monochrome (utilisable en tampon sur n'importe quel support, papier à en-tête, impression 1 couleur). Le contour du badge est conservé en **contour non rempli** (`fill="none"`, `stroke`) plutôt que supprimé, pour garder la silhouette reconnaissable de la marque. Toutes les coordonnées (`x`/`y`/`width`/`height`/`d`) sont copiées à l'identique depuis la source — seuls les attributs `fill`/`stroke` changent. Les opacités des arcs (1 / 0.8 / 0.55) sont conservées telles quelles : elles restent une seule teinte avec transparence variable (pas une deuxième couleur), ce qui respecte "une seule couleur" tout en gardant l'effet de profondeur déjà présent dans l'original.

---

## 6. Vérifications effectuées

| Vérification | Résultat | Preuve |
|---|---|---|
| Netteté Retina (haute densité) | ✅ | Rendu directement à la résolution cible par un moteur de navigateur (pas de redimensionnement post-génération) — le SVG source garantit une netteté vectorielle à toute échelle en amont du rendu |
| Fond transparent où requis | ✅ | Octet IHDR = RGBA vérifié programmatiquement sur `png/`, `pwa/icon-*`, `favicon/favicon-*`, `monochrome/*.png`, `pwa/monochrome_icon.png` |
| Fond opaque où requis (maskable, apple-touch-icon) | ✅ | Octet IHDR = RGB (sans alpha) vérifié programmatiquement |
| Dimensions exactes | ✅ | Toutes mesurées directement sur les fichiers produits (tableau § 3), pas estimées |
| Pas de pixelisation | ✅ | Chaque taille rendue indépendamment depuis le SVG vectoriel — aucune image n'est un agrandissement d'une autre |
| **Rendu Chrome** | ✅ testé réellement | Chromium 151.0.7922.34 (moteur identique à Chrome/Edge), capture d'écran directe |
| **Rendu Safari/iOS** | ✅ testé réellement (moteur) | WebKit (moteur de rendu de Safari/iOS) — capture réalisée, rendu visuellement identique à Chromium (dégradé, coins arrondis, alpha tous corrects) |
| **Rendu Firefox** | ⚠️ non testé | Aucun binaire Firefox/Gecko disponible dans cet environnement (seuls Chromium et WebKit sont installés localement) — voir § 7 |
| **Rendu Android/iOS réel (device/émulateur)** | ⚠️ non testé | Aucun émulateur Android ni simulateur iOS disponible ici — seule la conformité aux spécifications documentées (safe zone maskable, themed icon, apple-touch-icon sans transparence) a pu être vérifiée, pas le rendu final sur OS réel |
| Décodage réel du `.ico` | ✅ | Rechargé dans Chromium, décodé sans erreur (48×48 rapporté, la plus grande entrée) |
| Décodage réel des `.webp` | ✅ | En-tête binaire `RIFF/WEBP/VP8X` vérifié sur les 5 fichiers |
| Source SVG intacte | ✅ | Hash SHA-256 identique avant/après (§ 0) |

---

## 7. Limitations — disclosure honnête

- **Firefox non testé** : aucun binaire Gecko disponible dans cet environnement (Playwright n'a téléchargé que Chromium et WebKit). Les fichiers utilisent des formats web standards (PNG, WebP, SVG, ICO) universellement supportés par Firefox depuis de nombreuses années — risque jugé négligeable, mais non vérifié visuellement comme Chrome/Safari l'ont été.
- **Aucun test sur device/émulateur Android ou simulateur iOS réel** — uniquement conformité aux spécifications publiées (Google Material Design pour maskable/themed icons, Apple Human Interface Guidelines pour apple-touch-icon). Recommandé de confirmer visuellement sur un vrai appareil avant mise en production large si possible.
- **Formats sociaux** : un seul visuel `og-payment-global.png` (1200×630) est livré pour Facebook/X/LinkedIn/WhatsApp — c'est la recommandation actuelle (2026) qui unifie ces quatre plateformes sur un seul format pour l'aperçu de lien ; si une des plateformes changeait sa politique de recadrage, un ajustement serait à revoir.
- **Chiffres de spécifications sociales tiers** (tailles de photo de profil Facebook/WhatsApp/LinkedIn/X) proviennent de recherches web effectuées le jour de cette mission (sources citées § 3) — ces recommandations évoluent, à revalider périodiquement.
- **Poids `og-payment-global.png` et profils sociaux** (150–300 Ko) : plus lourds que les icônes PWA/favicon car fond dégradé plein (pas de zones transparentes compressibles) à haute résolution — bien en dessous des limites documentées de chaque plateforme (WhatsApp plafonne à 600 Ko par exemple), donc sans risque de rejet, mais à garder à l'esprit si une variante encore plus légère est un jour souhaitée (WebP serait alors une option, non demandée ici pour ce sous-dossier).

---

## 8. Recommandations d'usage

| Contexte | Fichier à utiliser |
|---|---|
| `<link rel="icon">` (navigateurs modernes) | `favicon/favicon.ico` (fallback universel) + `favicon/favicon-32.png` en `type="image/png"` |
| `<link rel="apple-touch-icon">` | `favicon/apple-touch-icon.png` |
| `manifest.json` PWA — `icons[]` | `pwa/icon-{72…512}.png`, plus une entrée `purpose: "maskable"` pointant `pwa/maskable_icon.png`, et (Android 13+) `pwa/monochrome_icon.png` en icône thématisable |
| Open Graph / Twitter Card meta tags | `social/og-payment-global.png` (`og:image`, `twitter:image`) |
| Avatar/logo de page Facebook, WhatsApp Business, LinkedIn, X | fichier `social/profile-*` correspondant |
| Logo dans l'app (web, `<img>` haute densité) | `webp/payment-global-{size}.webp` avec fallback `<picture>` vers `png/payment-global-{size}.png` pour les rares navigateurs sans support WebP |
| Logo dans l'app (contexte devant rester net à toute taille — favoriser si possible) | `logo.svg` directement, comme le fait déjà `checkout.tsx` avec la source |
| Fond très sombre / dark mode dédié | `logo-dark.svg` |
| Impression 1 couleur / usage sur fond de marque tiers | `monochrome/logo-black.svg` ou `monochrome/logo-white.svg` selon le fond |

**Aucun de ces fichiers n'est câblé dans le code aujourd'hui** — `checkout.tsx` continue de pointer vers `public/payment-global-logo.svg` (source), inchangé. L'intégration de ces déclinaisons (manifest PWA, meta tags Open Graph, etc.) est un choix distinct, hors du périmètre explicite de cette mission ("livrer uniquement les assets et leur documentation").

---

## 9. Ce qui n'a PAS été fait (hors périmètre, par instruction explicite)

- Aucune modification de `public/payment-global-logo.svg` (vérifié § 0).
- Aucun remplacement du logo existant dans le code.
- Aucun changement de logique métier, React ou Supabase.
- Aucune migration créée ni appliquée.
- Aucun commit créé.
- Aucun déploiement.

---

## Décision finale

**Assets livrés, documentés, vérifiés dans les limites des outils réellement disponibles dans cet environnement.** Deux limitations mineures assumées et documentées ci-dessus (Firefox non testé, pas de device réel Android/iOS) — aucune ne bloque l'usage des fichiers, qui utilisent tous des formats standards largement supportés.
