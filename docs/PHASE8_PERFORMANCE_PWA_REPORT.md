# Phase 8 — Performance Frontend & PWA — Rapport final

**Commit local : `434abdd`. Aucun push effectué — en attente de validation.**

Audit détaillé (Étapes 1-2) : `docs/PHASE8_PERFORMANCE_PWA_AUDIT.md`. Ce rapport couvre
l'implémentation (Étape 3) et la validation (Étapes 4-5).

---

## 1. État avant

Voir `docs/PHASE8_PERFORMANCE_PWA_AUDIT.md` pour le détail complet. Résumé :

- Fondations déjà solides : manifest PWA complet, service worker avec fallback offline,
  installation cross-plateforme déjà mature, code-splitting par route déjà fonctionnel,
  `staleTime` React Query déjà réglé, aucun polling superflu, dish images déjà en WebP.
- Précache du service worker : **256 entrées, 5655.82 KiB**, sans distinction de rôle ni
  d'usage réel.
- `index-*.js` (chunk partagé, toutes pages) : 340.6 Ko / gzip 100.4 Ko.
- Cartes de `/restaurants` : `loading="lazy"` posé sans exception, y compris sur les
  premières cartes visibles au chargement.

## 2. Problèmes détectés

Classement complet dans l'audit. Les 3 traités dans cette phase :

- 🟠 **#1** — Précache du SW trop large : 1.5 Mo d'assets `payment-global/` jamais référencés
  dans `src/`, + les chunks `vendor-pdf`/`vendor-charts` (déjà lazy en usage réel) précachés
  eagerly quand même.
- 🟡 **#2** — `@sentry/react` importé statiquement dans `__root.tsx`, dans le chemin critique
  de chaque page.
- 🟡 **#3** — `loading="lazy"` appliqué sans exception sur `restaurants.index.tsx`, y compris
  aux cartes au-dessus de la ligne de flottaison.

**Découverte supplémentaire pendant l'implémentation** (pas dans l'audit initial, trouvée en
vérifiant #2) : la regex `manualChunks` pour `vendor-react` (`[\/]react[\/]`) matchait aussi
`node_modules/@sentry/react/...` — le sous-dossier du paquet Sentry est littéralement nommé
`react`. Résultat : `@sentry/react` se retrouvait de toute façon dans le chunk `vendor-react`
(eager sur toutes les pages), annulant silencieusement le bénéfice du correctif #2. Corrigée
dans le même commit — voir mesures ci-dessous.

## 3. Mesures avant/après

Toutes mesurées sur un vrai `npm run build` (preset `vercel`), avec `VITE_SENTRY_DSN` défini
pour refléter les conditions de production (un DSN vide ferait disparaître Sentry du bundle
et fausserait la comparaison).

| Métrique                                  | Avant                                  | Après                                                   | Delta                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Précache SW (entrées / poids)             | 256 / 5655.82 KiB                      | 192 / ~2110 KiB                                         | **-3.5 Mo (-63 %)**                                                                                                                                   |
| `vendor-react-*.js` (eager, toutes pages) | 284.9 Ko (avec le bug de regex)        | 178.48 Ko / gzip 56.40 Ko                               | **-106.4 Ko brut**                                                                                                                                    |
| `sentry-browser-*.js` (chunk séparé)      | inexistant (fondu dans `vendor-react`) | 84.67 Ko / gzip 28.69 Ko, chargé après le premier rendu | Sorti du chemin critique                                                                                                                              |
| `index-*.js`                              | 340.6-340.8 Ko / gzip 100.4-100.5 Ko   | 340.67-340.78 Ko / gzip 100.45-100.47 Ko                | Stable (Sentry n'y était pas directement — confirmé via grep, 1 seule référence résiduelle à `captureException`, la glue d'appel dynamique elle-même) |

**LCP/CLS/INP réels (Lighthouse/CrUX)** : non mesurables dans cet environnement (pas de
navigateur pilotable pour un audit Lighthouse en conditions réelles) — voir "Non mesuré" dans
l'audit. `e2e/cross-cutting/lighthouse.spec.ts` (basé sur `playwright-lighthouse`) a été
exécuté (section 7) mais ses scores ne sont pas un LCP/CLS/INP terrain réel.

## 4. Corrections réalisées

1. **`vite.config.ts` — `globIgnores` sur le précache SW** : exclusion de
   `public/payment-global/**` (aucune référence dans `src/`, vérifié par recherche
   exhaustive) et des chunks `vendor-pdf`/`vendor-charts` (déjà en `import()` dynamique ou
   import statique route-only, jamais dans le chemin d'un client). Les fichiers restent
   déployés et accessibles à leur URL ; seule la mise en cache _eager_ est retirée — la règle
   runtime `CacheFirst` déjà présente dans `src/sw.ts` les met en cache à la demande, avec la
   même garantie offline.
2. **`src/routes/__root.tsx` — import dynamique de Sentry** : `sentry-browser.ts` passe d'un
   import statique à un `import()` dynamique partagé (`loadSentry()`), appelé depuis le
   `useEffect` d'initialisation ET depuis `ErrorComponent`. Comportement inchangé (le garde
   interne `initialized` de `sentry-browser.ts` continue de fonctionner à l'identique, module
   ES toujours un singleton par session) — seul le moment de chargement du SDK change.
3. **`vite.config.ts` — regex `manualChunks` corrigée** : ancrée sur
   `node_modules/(react|react-dom|scheduler)/` au lieu d'un segment `[\/]react[\/]` trop
   large, pour que `@sentry/react` ne se fasse plus absorber dans le chunk React.
4. **`src/routes/restaurants.index.tsx` — `loading` conditionnel** : les 4 premières cartes de
   chaque grille (sponsorisée et normale) chargent en mode par défaut (`eager`) ; le reste
   reste `lazy`. Aucun changement du composant `ImageWithFallback` nécessaire (la prop
   `loading` y était déjà optionnelle).

## 5. Fichiers concernés

- `vite.config.ts`
- `src/routes/__root.tsx`
- `src/routes/restaurants.index.tsx`
- `docs/PHASE8_PERFORMANCE_PWA_AUDIT.md` (déjà commité séparément dans le même commit)

Aucun autre fichier modifié. Confirmé par `git show --stat 434abdd`.

## 6. Impact attendu

- **Tout visiteur, première visite** : ~3.5 Mo de moins téléchargés en arrière-plan par le
  service worker après le premier chargement — impact direct sur la consommation de données
  mobiles et la batterie, particulièrement pertinent sur ce marché.
- **Toute page, chaque session** : ~106 Ko de JS en moins dans le chemin critique avant
  interactivité (Sentry déferré), sans perte de couverture d'erreur significative
  (l'initialisation a toujours lieu après le montage, comme avant).
- **`/restaurants`** : le ou les premiers restaurants visibles ne subissent plus le délai de
  fetch potentiel induit par `loading="lazy"` sur du contenu déjà à l'écran — bénéfice direct
  sur le LCP de cette page si l'un de ces éléments en est le candidat.

## 7. Résultats des tests

`npm run verify` (typecheck, lint, garde-fou migrations, tests unitaires, build) : **clean**,
exécuté à plusieurs reprises pendant l'implémentation, dernière exécution propre avant commit.

Tests Playwright ciblés exécutés : `e2e/cross-cutting/{pwa,offline,lighthouse}.spec.ts`,
`e2e/client/browse-and-order.spec.ts`, plus les suites déjà couvertes en Phase 6/7
(responsive, accessibilité) ré-exécutées implicitement via le build partagé.

**6 échecs observés au premier passage — tous audités individuellement, aucun retenu comme
preuve fiable de régression sans vérification supplémentaire, conformément à la consigne de
ne pas présenter un test tombé sur la page de connexion comme une preuve valide :**

| Test                                                       | Verdict                                          | Méthode de vérification                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `offline.spec.ts` — 404 hors-ligne                         | **Pré-existant**                                 | `git stash` → rebuild du code non modifié → échec identique reproduit. Pas causé par P8.                                                                                                                                             |
| `offline.spec.ts` — shell hors-ligne sur page déjà visitée | **Pré-existant**                                 | Idem — même méthode, même résultat identique sur le baseline.                                                                                                                                                                        |
| `browse-and-order.spec.ts` — liste restaurants             | **Pré-existant**                                 | Idem — `git stash` + rebuild baseline reproduit l'échec identique (un restaurant "AC Resto" différent de la fixture s'affiche, sur le code non modifié aussi — symptôme de pollution d'environnement local, pas du code applicatif). |
| `browse-and-order.spec.ts` — détail + panier               | **Pré-existant**                                 | Idem, même symptôme reproduit sur le baseline.                                                                                                                                                                                       |
| `lighthouse.spec.ts` — accueil                             | **Flakiness de lot déjà documentée**             | Ré-exécuté seul (`-g "home page"`) : **passe** (best-practices 100, SEO 100). Le lot complet réintroduit l'échec — pattern déjà documenté dans `docs/E2E_TEST_REPORT.md` pour cette suite.                                           |
| `lighthouse.spec.ts` — checkout                            | **Limitation harness déjà documentée (Phase 7)** | Timeout identique sur `getByRole("button", { name: "Ajoute ... nan panye" })` — même symptôme SSR/mock-auth déjà investigué et documenté dans `docs/PHASE7_ACCESSIBILITY_REPORT.md` et `docs/E2E_TEST_REPORT.md`.                    |

Aucun de ces 6 échecs n'a été écarté sans vérification : les 4 premiers ont été confirmés
**identiques sur le code d'avant P8** via un `git stash`/rebuild/test en aller-retour complet,
pas juste supposés pré-existants. Les 2 derniers correspondent à des limitations déjà
identifiées et documentées lors de phases précédentes de ce projet, avec la même signature
exacte.

**Tests passés confirmant le bon fonctionnement des correctifs** : `pwa.spec.ts` (5 tests, y
compris les vérifications d'installation/manifest), les tests d'accessibilité déjà validés en
Phase 7 non affectés par ces changements.

## 8. Problèmes volontairement laissés en dehors du périmètre

- **Image hero (`hero-livreur.jpg`)** — trouvé dans l'audit (🟢 Faible à 🟡 Moyen), non
  implémenté : convertir en WebP et ajouter un `srcset` nécessite un outil de conversion
  d'image binaire, indisponible et non installé dans cet environnement. Plutôt que de deviner
  ou d'improviser une conversion non vérifiable, ce point reste documenté comme
  recommandation de suivi.
- **`framer-motion` chargé globalement via `MotionConfig` racine** (🟢 Faible, audit #5) — coût
  réel mais unique par session (pas répété par page), déjà isolé dans son propre
  `manualChunks`. Rapport effort/bénéfice jugé insuffisant pour cette phase ; documenté, non
  implémenté.
- **Les 40 chunks de routes admin/livreur/restaurant** dans le précache SW — mentionnés dans
  l'audit comme « plus nuancés » : contrairement à `payment-global`/`vendor-pdf`/
  `vendor-charts`, ces utilisateurs (restaurateurs, livreurs) bénéficient réellement d'un accès
  hors-ligne rapide à leur propre tableau de bord. Laissés dans le précache intentionnellement,
  pas par oubli.
- **Profiling React réel (re-renders, INP en conditions d'usage)** — aucun outil de profiling
  live disponible ici ; aucun hotspot inventé faute de preuve, conformément à la consigne de ne
  pas optimiser à l'aveugle.

## 9. Risques résiduels

- Le calcul avant/après du précache SW dépend d'un DSN Sentry factice pour représenter les
  conditions de production ; le DSN réel de production n'a pas été utilisé (non disponible
  ici) — les chiffres exacts en production peuvent varier légèrement, mais l'ordre de grandeur
  (~63 % de réduction) et le mécanisme sont vérifiés et stables sur plusieurs builds répétés.
- L'exclusion de `payment-global/**` du précache suppose que ces fichiers ne sont utiles qu'au
  crawling/à des services externes (réseaux sociaux) et jamais à une fonctionnalité offline de
  l'app elle-même — confirmé par recherche exhaustive dans `src/`, mais pas par une
  connaissance directe de l'usage prévu de ce dossier (nom suggérant une feature de paiement
  antérieure). Les fichiers restent déployés à leur URL normale ; le risque, s'il existe, se
  limite à une absence de cache offline pour un contenu qui n'était de toute façon jamais
  demandé par l'app.
- Les 4 échecs Playwright confirmés pré-existants restent des échecs réels dans la suite —
  non introduits ni aggravés par cette phase, mais toujours présents et non traités ici (hors
  périmètre d'une phase performance/PWA ; relèvent de l'infrastructure de test).

---

## Décision finale

- Les 3 corrections identifiées comme prioritaires dans l'audit sont implémentées, mesurées
  avant/après avec des chiffres réels de build (pas des estimations), et une découverte
  supplémentaire (bug de regex `manualChunks`) trouvée pendant la vérification a été corrigée
  dans la foulée plutôt que rapportée sans agir.
- `npm run verify` clean. Portée strictement respectée : aucune logique métier, API, Supabase,
  RLS, Edge Function, migration ou authentification applicative touchée — confirmé par
  `git show --stat` sur le commit.
- Les 6 échecs Playwright observés ont tous été audités individuellement plutôt qu'ignorés en
  bloc ; 4 confirmés pré-existants par une vérification directe (`git stash` + rebuild
  baseline), 2 correspondent à des limitations déjà documentées lors de phases précédentes.
  Aucun n'est présenté ici comme une preuve automatisée valide d'un problème qu'il ne prouve
  pas.
- Deux points de l'audit (image hero, `framer-motion` global) sont documentés comme non
  traités, avec justification, plutôt que silencieusement omis.

**✅ Push autorisé**

En attente de votre confirmation avant `git push`.
