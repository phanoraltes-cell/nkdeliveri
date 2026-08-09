# SEO Brand Authority — « NK Deliveri »

**Aucun commit créé, aucun push effectué, aucun déploiement — conformément à l'instruction.**
Changements conservés localement uniquement.

---

## 1. Problème initial

Une recherche Google pour **« NK Delivery »** (orthographe anglicisée, incorrecte) affiche
aujourd'hui une suggestion orthographique du type « Essayez avec l'orthographe NK Deliveri » —
signe que Google traite « NK Deliveri » comme une variante/correction de « NK Delivery », plutôt
que de reconnaître immédiatement « NK Deliveri » comme le nom de marque officiel et distinct.

## 2. Cause probable

Ce comportement ne vient d'aucune erreur technique corrigible en un seul endroit — il vient du
fait que Google construit sa compréhension d'une entité de marque à partir d'un **faisceau de
signaux cumulés dans le temps** : cohérence du nom à travers le site, données structurées,
citations externes, recherches historiques des utilisateurs, autorité de domaine. Un domaine
relativement jeune (`nkdeliveri.com`), sans volume de recherche de marque encore établi et sans
présence externe (réseaux sociaux, citations) documentée dans Google, laisse le correcteur
orthographique de Google par défaut vers la variante anglicisée plus statistiquement commune
(« delivery » est un mot anglais courant ; « deliveri » ne l'est pas). Le code du site **ne peut
pas forcer** ce comportement — voir §9 et la limite explicite ci-dessous.

## 3. Audit

### Metadata (avant modification)

| Élément | État constaté |
|---|---|
| `<title>` racine | ✅ « NK Deliveri — Manje lakay, livre lakay ou » — marque présente, orthographe correcte |
| Meta description racine | ⚠️ Correcte mais ne mentionnait pas explicitement « Ayiti »/Haïti, seulement « Gonaïves » |
| Canonical | ✅ Chaque page indexable pose le sien via `pageMeta()` (`lib/seo.ts`) ; la racine n'en pose délibérément pas, pour éviter un doublon — décision déjà correcte, documentée dans le code lui-même |
| `robots` | ✅ `index, follow` par défaut, `noindex, nofollow` explicite sur les pages privées (`noIndexMeta()`) |
| Open Graph | ⚠️ `og:title`/`og:description`/`og:url`/`og:type`/`og:image` présents ; **`og:site_name` totalement absent** — ni à la racine, ni dans `pageMeta()` |
| Twitter/X card | ✅ Présent (`summary_large_image`, title, description, image) |
| Viewport | ✅ `width=device-width, initial-scale=1, viewport-fit=cover` |
| Langue | ✅ `<html lang="ht">` — correct, le site est en kreyòl ayisyen |
| Favicon | ✅ `favicon.ico` + `favicon.png` + `apple-touch-icon.png` (180×180), tous référencés |
| Manifest | ✅ Déjà brandé correctement (voir §6) |

### Structured Data (avant modification)

| Schema | État constaté |
|---|---|
| `Organization` | ⚠️ Présent (`name`, `url`, `logo`, `areaServed`) mais sans `alternateName`, sans `description`, sans `sameAs` (correctement absent, voir §7) |
| `WebSite` | ⚠️ Présent (`name`, `url`) mais sans `SearchAction`, alors qu'une recherche réelle existe |
| `WebApplication` | ❌ Absent — évalué en §5, décision : ne pas l'ajouter |
| `LocalBusiness` | ❌ Absent — évalué, non retenu (voir §5) |
| `Restaurant` | ❌ Absent — non pertinent : NK Deliveri est la plateforme, pas un restaurant individuel |
| `BreadcrumbList` | ❌ Absent — hors périmètre de cette mission (n'affecte pas l'identité de marque), non traité |
| `SearchAction` | ❌ Absent malgré une fonctionnalité de recherche réelle et fonctionnelle |

---

## 4. Corrections

Toutes les corrections sont additives — aucune suppression de contenu, aucune donnée inventée,
aucune répétition artificielle de la marque.

### `src/lib/seo.ts`
- Ajout de `og:site_name: "NK Deliveri"` dans `pageMeta()` — propage automatiquement à **toutes**
  les pages publiques indexables (accueil, restaurants, à propos, contact, FAQ, conditions,
  confidentialité) puisqu'elles utilisent toutes ce helper central.

### `src/routes/__root.tsx`
- Ajout de `og:site_name: "NK Deliveri"` dans les meta par défaut de la racine (couvre les routes
  qui n'appellent pas encore `pageMeta()`).
- Meta description racine, `og:description` et `twitter:description` : ajout naturel de « Ayiti »
  (le service dessert bien Gonaïves, en Haïti — signal local légitime, pas une invention).
- Schema `Organization` enrichi :
  - `alternateName: "NK Delivery"` — mécanisme schema.org standard pour associer une variante/
    orthographe alternative à l'entité officielle, **sans** en faire le nom principal (`name`
    reste « NK Deliveri », inchangé). C'est la réponse structurée directe au problème du §1 :
    un signal légitime, pas une tentative de manipulation.
  - `description` — reprend le positionnement déjà utilisé ailleurs sur le site (pas de contenu
    inventé).
  - `sameAs` **volontairement non ajouté** — voir §7.
- Schema `WebSite` enrichi d'un `potentialAction` de type `SearchAction`, pointant vers
  `/restaurants?q={search_term_string}` — vérifié comme étant le mécanisme de recherche **réel**
  et fonctionnel du site (`restaurants.index.tsx`, paramètre `q`, filtre serveur `ilike`), pas une
  fonctionnalité décrite pour enrichir artificiellement le schema.

### Ce qui n'a délibérément pas été modifié
- Le H1 de la page d'accueil (« Manje lakay, livre lakay ou ») — la marque apparaît déjà
  naturellement dans le contenu visible de la page (logo/wordmark du header, footer), donc
  l'exigence du Phase 5 est déjà satisfaite sans forcer le nom dans le H1 lui-même, ce que
  l'instruction met explicitement en garde de ne pas faire.
- `sitemap.xml` et `robots.txt` — déjà corrects (voir §3, §8), aucune modification nécessaire.
- Manifest — déjà brandé correctement, aucune modification nécessaire.
- Aucune variante de marque incorrecte trouvée à corriger dans le code (voir §7).

---

## 5. Structured Data — décisions motivées

| Schema | Décision | Raison |
|---|---|---|
| `Organization` | ✅ Enrichi (alternateName, description) | Directement pertinent à l'objectif |
| `WebSite` | ✅ Enrichi (SearchAction) | Fonctionnalité réelle, correctement décrite |
| `WebApplication` | ❌ Non ajouté | Le site est une PWA installable, un `WebApplication` serait techniquement défendable, mais l'objectif principal est la reconnaissance de l'*organisation*, pas les fonctionnalités « installation d'app » dans les résultats de recherche. Ajouter un 3ᵉ type sans bénéfice clairement identifié irait à l'encontre de l'instruction « ne pas multiplier les schemas inutilement ». Décision réversible, documentée ici pour une prochaine phase si le besoin devient clair. |
| `LocalBusiness` | ❌ Non ajouté | NK Deliveri est une plateforme de livraison en ligne, pas un commerce avec une adresse physique/des horaires d'accueil client sur place — le type ne correspond pas fidèlement à la réalité de l'activité. L'ajouter uniquement pour le signal SEO local serait une donnée inexacte, explicitement interdit par l'instruction. |
| `Restaurant` | ❌ Non pertinent | S'applique à un restaurant individuel, pas à la plateforme elle-même. |
| `BreadcrumbList` | ❌ Non traité | Améliorerait l'affichage des résultats de recherche pour les pages profondes (ex. détail restaurant), mais sans rapport avec la reconnaissance du *nom de marque* — hors du périmètre ciblé de cette mission. |

---

## 6. Metadata — avant / après

| Champ | Avant | Après |
|---|---|---|
| `og:site_name` (toutes pages) | *(absent)* | `NK Deliveri` |
| Meta description (racine) | « Kòmande manje nan meyè restoran nan Gonaïves epi resevwa l lakay ou. Peman ak MonCash, NatCash oswa kach. » | « NK Deliveri se platfòm livrezon manje Gonaïves, Ayiti. Kòmande manje nan meyè restoran yo epi resevwa l lakay ou. Peman ak MonCash, NatCash oswa kach. » |
| `og:description` / `twitter:description` (racine) | « Livrezon manje nan Gonaïves. MonCash, NatCash, Kach. » | « Livrezon manje nan Gonaïves, Ayiti. MonCash, NatCash, Kach. » |
| `Organization.alternateName` | *(absent)* | `NK Delivery` |
| `Organization.description` | *(absent)* | Présent (kreyòl, reprend le positionnement existant) |
| `WebSite.potentialAction` | *(absent)* | `SearchAction` réel vers `/restaurants?q=` |
| Manifest, sitemap, robots, canonical, title, H1 | Déjà corrects | Inchangés |

---

## 7. Brand consistency — recherche exhaustive

Recherche systématique dans `src/` et `public/` pour toutes les variantes (« NK Delivery »,
« NK DELOVERI », « NKDelivery », « NK Deliveri », majuscules/minuscules).

| Occurrence | Fichier | Contexte | Action |
|---|---|---|---|
| « NK delivery person » | `src/components/home/hero-section.tsx:23` | Commentaire de code décrivant l'image de fond (« the NK delivery person » = le livreur de NK) | **Faux positif** — ce n'est pas une référence à la marque « NK Delivery », c'est la phrase anglaise « a delivery person [who works for] NK ». Aucune action. |
| « NK Deliveri » | Partout (titres de page, `SITE_NAME`, manifest, JSON-LD, footer, header) | Nom de marque | ✅ Correct partout, aucune occurrence incorrecte trouvée |
| « nkdeliveri.com » | `site-config.ts`, emails, webhooks, tests | Nom de domaine (toujours en minuscules, sans espace — normal pour un domaine) | ✅ Correct |
| « NK DELOVERI » / « NKDelivery » | — | — | **Aucune occurrence trouvée** dans tout le projet |

**Conclusion** : le code source est déjà exemplaire sur ce point — `SITE_NAME = "NK Deliveri"` est
défini une seule fois dans `site-config.ts` et importé partout où c'est pertinent, et les
occurrences codées en dur (titres de page notamment) sont toutes orthographiées correctement.
Aucun remplacement aveugle n'a été nécessaire ni effectué.

---

## 8. Indexability

- **`sitemap.xml`** (`src/routes/sitemap[.]xml.ts`) : déjà correct — pages statiques publiques
  uniquement (accueil, restaurants, à propos, contact, FAQ, conditions, confidentialité) +
  restaurants approuvés générés dynamiquement depuis Supabase (`status = "approved"`), avec
  `lastmod` réel. Aucune page privée/dashboard/admin. Dégrade proprement vers les URLs statiques
  en cas d'erreur DB plutôt que de renvoyer une erreur 500. Non modifié — déjà conforme au Phase
  12.
- **`robots.txt`** (`src/routes/robots[.]txt.ts`) : déjà correct — `Disallow` sur
  `/dashboard`, `/admin`, `/api`, `/private`, `/auth`, `/checkout`, `/orders`, `/profile` ; tout le
  reste autorisé ; référence le sitemap. Non modifié — déjà conforme au Phase 13.
- **Canonical** : chaque page publique pose le sien vers `https://www.nkdeliveri.com` (domaine
  `www`, confirmé comme celui réellement servi — l'apex redirige en 308 vers `www`, documenté dans
  `site-config.ts`). Vérifié qu'il n'y a jamais deux balises canonical en conflit (la racine n'en
  pose délibérément pas).
- **Résultat Lighthouse SEO** (catégorie SEO, accueil) : **100/100** — mesuré après les
  modifications, confirme que title, meta description, crawlabilité et liens sont tous
  correctement en place du point de vue d'un outil d'audit automatisé.

---

## 9. Performance

Vérifié en marge (le cœur de cette mission n'est pas la performance, mais une bonne architecture
SEO ne doit pas être annulée par une page lourde) :

- Lighthouse **best-practices : 100/100**, **SEO : 100/100** sur la page d'accueil, mesuré après
  les modifications de cette phase.
- Aucun changement de cette phase n'affecte le poids de page, les images, le JS chargé ou le
  rendu — uniquement des balises `<meta>` et un bloc `<script type="application/ld+json">`
  supplémentaire (quelques centaines d'octets), sans impact mesurable sur LCP/CLS/INP.
- SSR déjà en place pour toute l'application (TanStack Start) — le contenu, y compris les
  nouvelles métadonnées et le JSON-LD enrichi, est présent dans le HTML dès la réponse serveur,
  sans dépendre de l'exécution JS côté client pour être visible par un crawler.

---

## 10. Actions externes recommandées (hors du code)

Ce qui suit ne peut pas être fait depuis le dépôt de code — actions à mener séparément :

1. **Google Search Console** : vérifier la propriété du domaine `www.nkdeliveri.com`, soumettre
   `https://www.nkdeliveri.com/sitemap.xml`, surveiller le rapport « Performances » filtré sur les
   requêtes de marque (« NK Deliveri », « NK Delivery ») pour suivre l'évolution du comportement
   décrit au §1 dans le temps.
2. **Profils sociaux officiels** : aucun profil Facebook/Instagram/TikTok/YouTube/LinkedIn n'est
   actuellement référencé dans le projet (`SOCIAL_LINKS` est vide, intentionnellement — voir
   `site-config.ts`). Créer des profils officiels sous le nom exact « NK Deliveri » renforcerait
   directement le graphe d'identité de marque — dès qu'un profil existe, l'ajouter à
   `SOCIAL_LINKS` **et** au tableau `sameAs` du schema `Organization` (ligne clairement indiquée
   dans `__root.tsx`).
3. **Backlinks/citations légitimes** : annuaires d'entreprises haïtiens, articles de presse
   locale, partenariats avec les restaurants déjà sur la plateforme (lien retour vers
   `nkdeliveri.com` depuis leurs propres réseaux sociaux, par exemple) — des citations externes
   authentiques du nom exact « NK Deliveri » associé au domaine sont le signal le plus efficace
   pour ce type de problème, et ne peuvent pas être fabriquées depuis le code.
4. **Image OG dédiée** : `og:image`/`twitter:image` utilisent actuellement le logo carré
   (512×512). Les standards des réseaux sociaux recommandent une image paysage ~1200×630 pour un
   rendu optimal des aperçus de lien — non créée dans cette phase (pas d'outil de génération/
   retouche d'image fiable disponible ici), signalée comme amélioration future plutôt que
   négligée.
5. **Soumission manuelle de l'orthographe** : Google propose parfois un mécanisme de correction
   pour les entités mal orthographiées (Google Business Profile, formulaires de correction) — à
   explorer séparément si un profil Google Business existe ou est créé pour NK Deliveri.

---

## 11. Limites — à lire avant toute attente de résultat

> **Le code du site ne peut pas empêcher Google d'afficher une suggestion orthographique.**
> Ce comportement est entièrement déterminé par les algorithmes de correction orthographique de
> Google, hors du contrôle du site. Les modifications de cette phase renforcent les signaux
> légitimes indiquant que « NK Deliveri » est le nom officiel d'une entité réelle et cohérente
> (`alternateName` associe explicitement la variante, le nom est cohérent partout, les données
> structurées sont valides) — mais **aucune garantie de résultat, ni de délai, ne peut être
> donnée.** Ce type de changement de perception se construit progressivement, souvent sur
> plusieurs semaines à mois, et dépend aussi de facteurs hors du site (volume de recherches
> réelles, citations externes, autorité de domaine).
>
> **Ne jamais promettre : « Google ne montrera plus jamais NK Delivery. »** Ce résultat dépend de
> Google, pas du code.

---

## 12. Vérifications techniques

- `npm run typecheck` : clean.
- `npm run lint` : clean (seuls les avertissements `react-refresh` préexistants, sans rapport).
- `npm run build` : réussi.
- `npm run verify` (typecheck + lint + garde-fou migrations + tests unitaires + build) : **clean**.
- JSON-LD validé : les deux blocs (`Organization`, `WebSite`) parsés avec succès comme JSON valide
  dans un test Playwright dédié (temporaire, supprimé après vérification) — aucune URL fictive,
  aucun profil social inventé, `sameAs` correctement absent.
- `og:site_name = "NK Deliveri"` confirmé présent sur les 6 pages publiques testées (accueil, à
  propos, contact, FAQ, conditions, confidentialité, restaurants) via le `pageMeta()` central.
- Canonical confirmé unique (aucun doublon) sur chaque page testée.
- `e2e/cross-cutting/seo.spec.ts` (suite préexistante) : 3/5 passent ; les 2 échecs restants
  reproduisent **à l'identique** sur le code non modifié (vérifié par `git stash` + rebuild du
  baseline) — limitation déjà documentée depuis la Phase 7 : le loader SSR de
  `sitemap.xml.ts`/`restaurants.$slug.tsx` interroge Supabase côté serveur, non intercepté par le
  mock côté navigateur du harness E2E. Non lié aux modifications de cette phase.
- `e2e/cross-cutting/accessibility.spec.ts` (page d'accueil) : aucune nouvelle violation.
- Lighthouse (page d'accueil) : SEO 100/100, best-practices 100/100.
- **Note de transparence** : pendant cette session, le dépôt contenait également des
  modifications non liées, en cours dans une autre tâche (remédiation newsletter — fichiers
  `send-newsletter.functions.ts`, une migration `newsletter_send_log.sql`, etc.). Ces fichiers
  n'ont pas été touchés, modifiés, ni inclus dans les vérifications de cette phase — signalé ici
  par souci de transparence, sans lien avec le travail SEO.

---

## Résultat

Les corrections apportées renforcent un faisceau cohérent de signaux (`og:site_name`,
`Organization.alternateName`, `Organization.description`, `WebSite.SearchAction`, mentions
naturelles de « Ayiti ») pointant tous vers la même réalité : **NK Deliveri, à
`www.nkdeliveri.com`, est une entité de marque réelle, cohérente et identifiable.** Aucune
technique de manipulation, aucun contenu inventé, aucun keyword stuffing. Aucun commit, aucun
push, aucun déploiement — changements en attente de validation.
