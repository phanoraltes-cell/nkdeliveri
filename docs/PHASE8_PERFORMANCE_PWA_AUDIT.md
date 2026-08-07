# Phase 8 — Performance Frontend & PWA — Audit (Étapes 1 & 2)

**Aucun code modifié dans ce document — audit et mesures uniquement, comme demandé.**

Méthode : inspection directe du code source, du build de production réel (`npm run build`,
preset `vercel`, sorties `.vercel/output/static`), des tailles gzip rapportées par Vite/Rollup, et
du manifeste de précache généré par `vite-plugin-pwa` (`injectManifest`). Pas d'accès à un vrai
Lighthouse/Chrome DevTools dans cet environnement (pas de navigateur pilotable pour un audit
Lighthouse local) — les métriques Core Web Vitals (LCP/CLS/INP) ci-dessous sont donc **estimées
par analyse statique du code et du poids réel des ressources**, pas mesurées en conditions de
rendu réel. C'est explicité pour chaque point plutôt que présenté comme un chiffre Lighthouse.

---

## Étape 1 — État actuel (mesures)

### Bundle JavaScript (client, build de production réel)

| Chunk | Taille brute | Gzip | Chargement |
|---|---|---|---|
| `vendor-pdf` (jspdf+html2canvas+canvg+dompurify) | 779.7 kB | 235.6 kB | ✅ déjà en `import()` dynamique — jamais dans le chemin critique |
| `vendor-charts` (recharts+d3+victory) | 358.9 kB | 104.4 kB | ✅ déjà isolé par route (dashboards admin/restaurant uniquement) |
| `index-*.js` (app shell partagé) | 340.6 kB | 100.4 kB | ⚠️ chargé sur **toutes** les pages, y compris celles qui n'utilisent ni Sentry ni animation |
| `vendor-supabase` | 204.0 kB | 52.3 kB | Nécessaire partout (client Supabase) |
| `vendor-react` | 200.3 kB | 64.5 kB | Incompressible (React 19 + ReactDOM) |
| `vendor-leaflet` (+15 kB CSS) | 153.7 kB | 45.0 kB | ✅ déjà isolé par route (carte de suivi livreur uniquement) |
| `vendor-motion` (framer-motion) | 121.6 kB | 39.5 kB | ⚠️ chargé sur toutes les pages via `MotionConfig` racine, utilisé dans seulement 4 fichiers |
| `routes-*.js` (manifeste de routes TanStack Router) | 20.2 kB | 5.9 kB | Nécessaire partout |

**174 chunks JS route-splittés au total** — la séparation par route (chaque `dashboard.*.tsx`,
`checkout.tsx`, etc. produit son propre petit chunk, ex. `checkout-*.js` 13.8 kB,
`dashboard.admin.finance-*.js` 26.3 kB) fonctionne déjà correctement et n'est pas un problème.

### CSS

`styles-*.css` : 95.3 kB / **gzip 15.7 kB**, un seul fichier global (Tailwind v4 + 7 déclarations
`@font-face`). Poids raisonnable, pas un problème identifié.

### Fonts

7 fichiers de poids (`Bricolage Grotesque` 400/600/800, `Instrument Sans` 400/500/600/700) via
`@fontsource`, chargés en `@import` CSS résolus au build (pas de requête `@import` réseau
bloquante). `font-display: swap` déjà présent par défaut dans le CSS généré par `@fontsource`
(vérifié dans le package installé) — pas de FOIT (texte invisible pendant le chargement).

### PWA — manifest, service worker, offline

- `public/manifest.webmanifest` : complet et correct — `display: standalone`, `orientation:
  portrait`, icônes 192/512 + variante `maskable`, `shortcuts`, `theme_color`/`background_color`
  cohérents avec la marque.
- `src/sw.ts` : stratégie `NetworkFirst` (5 s de timeout) pour la navigation, `CacheFirst` +
  expiration (30 jours, 200 entrées max) pour les assets statiques, fallback hors-ligne
  (`offline.html`, autonome, sans dépendance JS, dark-mode aware), gestion Web Push
  (notification + clic) déjà en place. Base technique déjà solide.
- `src/components/install-prompt.tsx` : gère `beforeinstallprompt` (Android/desktop) et le
  fallback manuel iOS (Safari ne déclenche jamais cet événement), cooldown de 14 jours après un
  rejet, demande de permission push après installation. Déjà mature, rien à corriger.
- `viewport-fit=cover` + variables CSS de safe-area (`--sab`/`--sal`/`--sar`) déjà utilisées dans
  `BottomNav` et `InstallPrompt`.
- **Précache du service worker : 256 entrées, 5 655.82 KiB (~5.65 Mo)** — voir problème #1
  ci-dessous, c'est la découverte la plus significative de cet audit.

### Images

- Images plats (`public/dishes/*.webp`) : déjà en WebP, 19-96 Ko chacune — bon format, bon poids.
- Cartes restaurant/produit (`restaurants.$slug.tsx`, `ImageWithFallback`) : `width`/`height`
  explicites, `loading="lazy"` correctement posé sur les images sous la ligne de flottaison.
- Image bannière restaurant (au-dessus de la ligne de flottaison) : dimensions explicites,
  correctement **non** lazy.
- Image hero de la page d'accueil (`hero-livreur.jpg`) : `fetchPriority="high"` déjà posé (bonne
  pratique), mais voir problème #4.
- **`restaurants.index.tsx` : `loading="lazy"` posé sans exception sur toutes les cartes,
  y compris les toutes premières, visibles dès le chargement initial** — voir problème #3.

### Animations / INP

- Framer Motion utilisé dans seulement 4 fichiers du projet (usage limité, pas généralisé).
- `MotionConfig reducedMotion="user"` au niveau racine — respecte bien la préférence
  système "réduire les animations", déjà correct.
- Aucun `setInterval`/`refetchInterval` trouvé dans tout `src/` — pas de polling, tout repose sur
  Supabase Realtime + invalidation explicite. Pas de gaspillage réseau/CPU en arrière-plan.
- `staleTime: 30_000` déjà configuré sur le QueryClient global, avec invalidation Realtime pour
  les données réellement live — évite les refetch redondants à chaque navigation. Déjà correct.
- Aucun hotspot de re-render mesurable identifié par analyse statique (pas de `React.memo` dans
  le projet, mais aucun signe de re-render coûteux non plus — listes de taille raisonnable, pas
  de calcul lourd dans le corps du rendu). **Honnêteté : je n'ai pas d'outil de profiling React
  réel disponible dans cet environnement pour confirmer ou infirmer un problème d'INP en
  conditions réelles** — voir la section "Non mesuré" plus bas plutôt que d'inventer un problème.

---

## Étape 2 — Problèmes identifiés, classés

### 🟠 #1 — Précache du service worker trop large, inclut des ressources jamais utilisées par l'app

**Preuve** : le manifeste de précache généré (`injectManifest`, glob
`**/*.{js,css,html,ico,png,svg,webp,jpg,jpeg,json,webmanifest,woff2}` sur tout
`.vercel/output/static`) contient 256 entrées / 5.65 Mo, dont :
- Les 174 chunks JS de **toutes** les routes, y compris les 40 chunks admin/livreur/restaurant
  qu'un client final ne visitera jamais, et les chunks lourds `vendor-pdf` (779.7 kB) et
  `vendor-charts` (358.9 kB) qui ne servent qu'aux tableaux de bord.
- `public/payment-global/` — **1.5 Mo sur 36 fichiers, introuvables dans une seule référence de
  `src/`** (vérifié par recherche exhaustive) : images de type OG/réseaux sociaux
  (`og-payment-global.png` 302 Ko, `profile-facebook-720.png` 202 Ko,
  `profile-whatsapp-640.png` 154 Ko, icônes PWA d'une autre feature...). Rien dans le code de
  l'app ne les charge — seul le glob du service worker les ramasse.

**Impact utilisateur** : après la toute première visite, le navigateur télécharge ~5.65 Mo en
arrière-plan pour "installer" le cache offline — sur une connexion mobile lente ou limitée
(contexte réel de ce marché), c'est un coût réseau et batterie significatif pour du contenu que
la plupart des visiteurs (clients, jamais admin/livreur) ne verront jamais.
**Impact technique** : gonfle le stockage `CacheStorage` du navigateur inutilement, ralentit
l'installation du service worker, complique le nettoyage lors des mises à jour.
**Priorité** : 🟠 Élevé (le dossier `payment-global/` à lui seul est un cas net et sans risque ;
la portion routes admin/livreur est plus nuancée, voir solution).
**Difficulté** : Faible.
**Solution proposée** :
- Exclure `public/payment-global/**` du glob de précache (`workbox.injectManifest.globIgnores`
  dans `vite.config.ts`) — n'affecte en rien la disponibilité de ces fichiers sur leur URL directe
  (utile si un service externe — réseau social, WhatsApp Business — les référence encore par
  URL), seulement leur mise en cache offline inutile par l'app.
- Exclure des chunks clairement hors-périmètre client (`vendor-pdf`, `vendor-charts`) du précache
  eager, en laissant la règle runtime `CacheFirst` déjà en place dans `sw.ts` les mettre en cache
  à la demande, la première fois qu'un admin/restaurateur les charge réellement.

### 🟡 #2 — `index-*.js` (chunk partagé, chargé sur 100 % des pages) pèse 100.4 Ko gzip

**Preuve** : mesuré deux fois (avec et sans `VITE_SENTRY_DSN` défini au build) — poids stable à
340.6-340.8 Ko brut / ~100.4-100.5 Ko gzip dans les deux cas, donc représentatif du build de
production réel. Ce chunk regroupe le code partagé non isolé dans un `manualChunks` dédié :
`@sentry/react` (import statique au niveau racine dans `src/lib/sentry-browser.ts`, importé
directement par `__root.tsx`), `sonner`, les icônes `lucide-react` utilisées globalement,
`AuthProvider`, la colle de routing.

**Impact utilisateur** : ~100 Ko gzip payés sur la toute première page visitée dans une session
(coût unique par session, pas par navigation — TanStack Router fait du routing côté client après
l'hydratation initiale), avant même la première interaction possible.
**Impact technique** : allonge le temps de parsing/exécution JS avant que la page devienne
interactive, surtout sensible sur un appareil mobile bas de gamme.
**Priorité** : 🟡 Moyen (coût réel mais unique par session, pas répété à chaque page).
**Difficulté** : Faible à moyenne.
**Solution proposée** : passer l'import de `sentry-browser.ts` dans `__root.tsx` en `import()`
dynamique à l'intérieur du `useEffect` qui appelle déjà `initSentryClient()` — le SDK Sentry se
télécharge alors après le premier rendu au lieu d'être compilé dans le chemin critique initial,
sans perte de couverture significative (l'initialisation se produit déjà après le montage, pas
avant).

### 🟡 #3 — Cartes restaurant `loading="lazy"` appliqué même aux images visibles au premier écran

**Preuve** : `src/routes/restaurants.index.tsx` — toutes les cartes de la grille
(sponsorisées et normales, lignes ~184 et ~230) reçoivent `loading="lazy"` sans distinction,
y compris les toutes premières cartes du haut de grille, qui sont dans le viewport dès le
chargement initial de la page `/restaurants`.
**Impact utilisateur** : `loading="lazy"` sur une image déjà visible peut retarder son
téléchargement (le navigateur la traite comme non prioritaire tant que la mise en page n'a pas
confirmé sa position), ce qui peut dégrader le LCP de cette page si l'une de ces cartes en est
l'élément candidat.
**Impact technique** : contraire à la recommandation standard (ne jamais `lazy`-charger une image
au-dessus de la ligne de flottaison).
**Priorité** : 🟡 Moyen (page fréquentée, mais pas la page d'entrée principale du site).
**Difficulté** : Faible.
**Solution proposée** : ne pas passer `loading="lazy"` (laisser le comportement par défaut
`eager`) pour le premier rang de cartes visibles (ex. les 4 premières, ou celles rendues avant un
certain index) ; garder `lazy` pour le reste de la grille. Le composant `ImageWithFallback`
supporte déjà la prop `loading` de façon optionnelle — pas de changement de composant requis.

### 🟢 #4 — Image hero de la page d'accueil : source carrée 1024×1024 étirée sur une bannière large

**Preuve** : `public/hero-livreur.jpg` = 1024×1024 px, 83.6 Ko, `object-cover` dans une section
`min-h-[600px] md:min-h-[700px]` en pleine largeur. Sur un viewport desktop large (ex. 1920 px),
la source est ré-échantillonnée (upscale ~1.87×) — perte de netteté possible. Sur mobile, la même
source de 1024 px de large est téléchargée alors que le viewport affiché est ~2-3× plus étroit.
Pas de `srcset`/`sizes`, pas de variante WebP/AVIF (actuellement `.jpg`).
**Impact utilisateur** : c'est très probablement l'élément LCP de la page la plus visitée du
site — chaque octet ici compte directement pour le LCP mesuré ; de plus, rendu potentiellement
flou sur grand écran.
**Impact technique** : poids non optimal (un WebP équivalent réduirait généralement le poids de
30-50 %), pas de responsive images.
**Priorité** : 🟢 Faible à 🟡 Moyen (83.6 Ko n'est déjà pas un poids énorme — `fetchPriority="high"`
et le fait que ce soit une image SSR-rendue avec priorité haute limitent déjà l'impact ; le gain
d'une conversion WebP reste réel mais plus modeste que les problèmes #1-#3).
**Difficulté** : Faible (conversion + `srcset` d'un seul fichier).
**Solution proposée** : convertir en WebP (avec fallback `<picture>`/`.jpg` pour compatibilité
maximale), ajouter un `srcset` avec au moins une variante desktop plus large pour éviter l'upscale
visible sur grand écran.

### 🟢 #5 — Framer Motion chargé globalement pour seulement 4 fichiers consommateurs

**Preuve** : `import { MotionConfig } from "framer-motion"` en import statique dans
`src/routes/__root.tsx`, appliqué à tout l'arbre de l'app (`<Outlet>`), alors que seuls 4 fichiers
du projet importent réellement `framer-motion` (dont `hero-section.tsx`).
**Impact utilisateur** : ~39.5 Ko gzip payés une fois par session, même sur des pages qui
n'animent jamais rien (ex. tableaux de bord admin/livreur).
**Impact technique** : coût de bundle non nul mais déjà isolé dans son propre `manualChunks`
(`vendor-motion`) — mis en cache long terme, pas re-téléchargé à chaque déploiement qui ne
touche pas cette dépendance.
**Priorité** : 🟢 Faible (coût unique par session, page d'entrée la plus commune — l'accueil —
en a de toute façon besoin ; le rapport effort/bénéfice d'une restructuration est faible).
**Difficulté** : Moyenne (nécessiterait soit de scoper `MotionConfig` plus finement, soit de
remplacer les 2-3 animations d'entrée du hero par des transitions CSS pures respectant déjà la
règle `prefers-reduced-motion` documentée dans `styles.css`).
**Solution proposée** : non retenu comme prioritaire pour cette phase — mentionné pour
transparence, pas pour action immédiate (voir "Hors périmètre" dans le rapport final).

---

## Non mesuré / hors de portée de cet environnement

- **LCP/CLS/INP réels (Lighthouse/Chrome DevTools/CrUX)** : aucun navigateur pilotable
  disponible ici pour un audit Lighthouse en conditions réelles. Les estimations ci-dessus
  s'appuient sur le poids réel des ressources et les bonnes/mauvaises pratiques identifiées dans
  le code, pas sur un score mesuré. Recommandation de suivi : lancer Lighthouse (desktop + mobile,
  throttling 4G lent) sur un déploiement de preview après implémentation, pour confirmer les gains.
- **Re-renders réels en conditions d'usage (React DevTools Profiler)** : aucun hotspot identifié
  par analyse statique, mais aucun outil de profiling live disponible pour le confirmer
  positivement. Pas de problème inventé faute de preuve — conformément à l'instruction de ne pas
  optimiser à l'aveugle.
- **Test d'installation PWA réel sur un appareil** : le code du flux d'installation
  (`beforeinstallprompt`, fallback iOS) a été relu et semble correct, mais son comportement final
  dépend du navigateur/OS réel de l'utilisateur — non testable ici de bout en bout.

---

## Prochaine étape

En attente de validation avant de commencer l'Étape 3 (implémentation), qui traitera par
priorité : #1 (précache SW) → #3 (lazy loading au-dessus de la ligne de flottaison) → #2 (Sentry
en import dynamique) → #4 (image hero). #5 est documenté mais non retenu pour implémentation dans
cette phase (voir justification ci-dessus).
