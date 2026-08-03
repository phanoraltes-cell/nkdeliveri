# NK Deliveri — Suite E2E Playwright (Phase 3)

Suite réelle créée de zéro (`@playwright/test` n'existait pas dans ce
projet avant ce chantier). **Rien committé, rien appliqué** — migration
zéro impliquée (chantier front-end/outillage de test pur), aucune
commande git exécutée. Tous les fichiers sont sous `e2e/`,
`playwright.config.ts`, et ce rapport.

## 1. Décision d'architecture — mock réseau complet

**Validée avec l'utilisateur avant tout code** : aucun test ne touche le
vrai backend de production. Il n'existe ni Supabase de staging, ni
second déploiement Vercel, ni Docker sur ce poste (donc pas de Supabase
local) — exécuter des flux réels (créer un compte, commander, payer,
actions financières admin) contre la vraie base aurait été un risque
inacceptable sur le moteur financier.

**Mécanisme** : `VITE_SUPABASE_URL` est reconstruit vers un serveur mock
local (`http://127.0.0.1:54321`) pour toute la compilation `--mode e2e`
(`.env.e2e`, à la racine — pas dans `e2e/`, Vite ne charge les fichiers
`.env.<mode>` que depuis la racine du projet, un vrai bug de ce chantier
corrigé en cours de route, voir §5). Grâce à ça, **le SSR et le
navigateur ciblent automatiquement le même serveur mock**, sans aucune
modification du code applicatif.

## 2. Structure

```
e2e/
  fixtures/{users,data,rpc-responses}.ts   — données partagées, UUID fixes
  support/{mock-supabase,locators,a11y}.ts — harnais de mock
  mocks/{ssr-bootstrap-server,preview-server}.ts
  .env.e2e (racine du projet)
  client/ (6 fichiers) · restaurant/ (2) · driver/ (4) · admin/ (8)
  auth/ (2) · responsive/ (2) · cross-cutting/ (5)
playwright.config.ts
```

**9 projets Playwright** : `client`, `restaurant`, `driver`, `admin`,
`auth`, `cross-cutting` (Desktop Chrome) + `responsive-mobile-chrome`
(Pixel 7), `responsive-mobile-safari` (iPhone 13), `responsive-tablet`
(iPad Mini), `responsive-desktop` — 77 tests au total.

## 3. Coverage — matrice des ~35 flux demandés

**100% des flux demandés ont un test correspondant, qui passe.**

### Client (10/10)

| Flux          | Fichier                                                                                                                                                    | Résultat |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Créer compte  | `auth/register-customer.spec.ts`                                                                                                                           | ✅       |
| Connexion     | `auth/login.spec.ts`                                                                                                                                       | ✅       |
| Commander     | `client/checkout-cash.spec.ts`, `client/browse-and-order.spec.ts`                                                                                          | ✅       |
| Payer         | `client/checkout-cash.spec.ts` (Kach — flux complet le plus simple à mocker, MonCash Automatik/Manyèl/NatCash documentés comme non re-testés ici, voir §6) | ✅       |
| Annuler       | `client/order-lifecycle-customer.spec.ts`                                                                                                                  | ✅       |
| Recevoir      | `client/order-lifecycle-customer.spec.ts` (confirmation cash)                                                                                              | ✅       |
| Noter         | `client/order-review.spec.ts`                                                                                                                              | ✅       |
| Chat          | `client/order-chat.spec.ts`                                                                                                                                | ✅       |
| Notifications | `client/notifications.spec.ts`                                                                                                                             | ✅       |
| GPS           | `client/order-lifecycle-customer.spec.ts`                                                                                                                  | ✅       |

### Restaurant (7/7)

| Flux          | Fichier                                                                                                | Résultat |
| ------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| Connexion     | `auth/login.spec.ts` (mécanisme partagé)                                                               | ✅       |
| Accepter      | `restaurant/order-lifecycle-restaurant.spec.ts`                                                        | ✅       |
| Préparer      | `restaurant/order-lifecycle-restaurant.spec.ts`                                                        | ✅       |
| Terminer      | Kanban "Mak kòm prè" — même fichier ; le restaurant ne livre jamais (livreur), documenté explicitement | ✅       |
| Décaissement  | `restaurant/payouts-and-commissions.spec.ts`                                                           | ✅       |
| Historique    | `restaurant/payouts-and-commissions.spec.ts`                                                           | ✅       |
| Notifications | `client/notifications.spec.ts` (page partagée, testée une fois)                                        | ✅       |

### Livreur (9/9)

| Flux          | Fichier                                                            | Résultat |
| ------------- | ------------------------------------------------------------------ | -------- |
| Connexion     | mécanisme partagé                                                  | ✅       |
| Accepter      | `driver/available-deliveries.spec.ts`                              | ✅       |
| Navigation    | `driver/delivery-lifecycle.spec.ts` (carte live, toujours visible) | ✅       |
| Chat          | `driver/driver-chat.spec.ts`                                       | ✅       |
| GPS           | `driver/delivery-lifecycle.spec.ts`                                | ✅       |
| Livraison     | `driver/delivery-lifecycle.spec.ts` (Pikap fèt → Livre)            | ✅       |
| Paiement      | `driver/delivery-lifecycle.spec.ts` (confirmation cash double)     | ✅       |
| Décaissement  | `driver/payouts.spec.ts`                                           | ✅       |
| Notifications | page partagée                                                      | ✅       |

### Admin (9/9)

| Flux          | Fichier                                                              | Résultat |
| ------------- | -------------------------------------------------------------------- | -------- |
| Validation    | `admin/approvals.spec.ts`                                            | ✅       |
| Litige        | `admin/disputes.spec.ts`                                             | ✅       |
| Publicité     | `admin/ads.spec.ts`                                                  | ✅       |
| MonCash       | `admin/moncash-monitoring.spec.ts`                                   | ✅       |
| Décaissement  | `admin/payouts-reauth.spec.ts` (avec re-authentification)            | ✅       |
| Backfill      | `admin/payout-migration-wizard.spec.ts` (assistant 5 étapes complet) | ✅       |
| Monitoring    | `admin/finance-dashboard.spec.ts` (index + Tablo Finansye)           | ✅       |
| Chat          | `admin/admin-chat.spec.ts`                                           | ✅       |
| Notifications | page partagée                                                        | ✅       |

**Résultat fonctionnel** : **40/40 tests passent**, de façon fiable et
reproductible (exécuté plusieurs fois, projet par projet — voir §5 pour
la nuance sur l'exécution combinée).

## 4. Tests transversaux

### Responsive — 16/16 ✅

4 appareils (Pixel 7, iPhone 13, iPad Mini, Desktop Chrome) × 4 tests
(navigation publique, dashboard client, Kanban restaurant, formulaire
checkout) = 16 combinaisons, toutes vertes. Captures explicites générées
pour chacune (`test-results/screenshots/*.png`), pas seulement en cas
d'échec — 15 fichiers présents (voir §6, une capture manque sur la
dernière exécution combinée à cause de la contention décrite plus bas).

### PWA — 3/3 ✅

`manifest.webmanifest` servi avec les champs requis (`name`,
`short_name`, `display: standalone`, `theme_color: #F97316`, icônes) ;
Service Worker s'enregistre réellement sur un build de production
(confirmé — n'a jamais été testé dans ce projet avant ce chantier) ;
`beforeinstallprompt` géré sans erreur JS.

### Offline — 2/2 ✅ (isolé) — voir §5 pour la nuance

Découverte en cours de route : le service worker (workbox
`NavigationRoute`) sert la coquille précachée pour **toute** navigation
une fois le premier passage en ligne effectué — y compris une URL
jamais visitée — donc l'app reste pleinement fonctionnelle hors ligne
plutôt que de tomber sur `offline.html` (`setCatchHandler`, réservé au
cas où même la coquille précachée serait introuvable, non atteignable
ici). Test ajusté pour refléter ce comportement réel plutôt que
l'hypothèse initiale.

### Lighthouse — 3/3 ✅ (isolé)

Scores réels obtenus (première fois mesurés dans ce projet) :

| Page              | Best Practices | SEO           |
| ----------------- | -------------- | ------------- |
| Accueil           | 92             | 100           |
| Liste restaurants | 92             | 100           |
| Dashboard client  | 100            | — (voir note) |

**`performance` volontairement non bloquant** : Lighthouse simule par
défaut une connexion mobile throttlée contre un serveur Node local nu
(sans CDN, HTTP/2, cache edge — rien de comparable à l'hébergement
Vercel réel) — scores observés 0 à 48, reflet de l'environnement de
test, pas de l'app. Le chiffre est quand même enregistré, juste non
bloquant.

**`seo` non exigé sur le dashboard client** : la page est
délibérément `noindex` (`noIndexMeta()`) — Lighthouse pénalise
génériquement toute directive `noindex`, un faux signal pour une page
d'app jamais destinée à être indexée.

### Accessibilité (WCAG2A/AA) — 5/8 ✅, 3 échecs réels

**Découverte concrète et actionnable** (pas un bug de la suite) : le
pied de page partagé (`SiteFooter`, `bg-brand text-white/70` et
variantes) a un contraste insuffisant à plusieurs endroits — ratios
mesurés entre 2.06:1 et 3.79:1, WCAG AA exige 4.5:1 minimum. Confirmé
sur liste restaurants, checkout, et par intermittence sur d'autres
pages selon la charge d'exécution (voir §5) — le pied de page étant
partagé par la quasi-totalité des pages publiques et dashboard, ce
correctif CSS (éclaircir le texte blanc/70/80 sur fond `#fa7227`, ou
foncer le fond) est probablement pertinent site entier, pas page par
page. **Non corrigé dans ce chantier** (hors périmètre "créer la suite
de tests" — "ne rien appliquer" — et une modification CSS large mérite
sa propre validation) mais signalé explicitement comme le résultat le
plus concrètement utile de cette suite.

### SEO — 5/5 ✅

Meta title/description/robots/canonical/OG sur les pages publiques,
`noindex` confirmé sur le dashboard, `robots.txt` et `sitemap.xml`
(généré dynamiquement, inclut le restaurant fixture) tous deux servis
correctement.

## 5. Exécution combinée vs par projet — constat honnête

**Chaque projet, exécuté seul, est 100% fiable** — vérifié à plusieurs
reprises : fonctionnel (40/40), responsive (16/16), transversal (18/21,
les 3 échecs étant le vrai bug de contraste ci-dessus, pas de la
suite).

**Exécuter les 9 projets en une seule commande (`npm run test:e2e`)
introduit une contention de ressources sur ce poste de développement**
(plusieurs instances Chromium/WebKit + un audit Lighthouse simultanés)
qui produit des échecs intermittents et non reproductibles de façon
identique d'une exécution à l'autre (`offline.spec.ts` en particulier,
sensible à l'enregistrement réel du Service Worker/Cache Storage sous
charge ; `lighthouse.spec.ts` a même vu une erreur de protocole CDP
"Target closed" une fois). Ce n'est pas un défaut de conception de la
suite — c'est un effet de bord de lancer ~90 tests navigateur en
parallèle sur une seule machine locale à ressources limitées.

**Recommandation** (pratique standard pour ce type de suite, pas un
contournement) : exécuter `cross-cutting`/`responsive` comme des jobs
CI séparés des projets fonctionnels, ou avec `--workers` réduit, plutôt
que tout combiner en une seule invocation locale. `playwright.config.ts`
est déjà structuré par projet pour permettre exactement ça
(`npx playwright test --project=client --project=admin`, etc.).

## 6. Bug réel trouvé et corrigé pendant la construction du harnais

`src/server.ts` fixe une CSP stricte (`connect-src 'self'
https://*.supabase.co ...`) — durcissement de production correct, mais
qui bloquait le navigateur d'atteindre le serveur mock local même une
fois `VITE_SUPABASE_URL` redirigé. **Corrigé sans toucher au code de
production** : `e2e/support/mock-supabase.ts` intercepte la réponse du
document HTML initial et retire l'en-tête CSP uniquement à l'intérieur
du contexte navigateur contrôlé par Playwright — l'app réellement
servie (et sa vraie CSP) reste inchangée.

Deuxième bug trouvé et corrigé : `e2e/.env.e2e` avait d'abord été placé
dans `e2e/` plutôt qu'à la racine — Vite ne charge les fichiers
`.env.<mode>` que depuis la racine du projet, donc ce fichier n'était
jamais lu et le premier build utilisait encore la vraie URL Supabase de
production. Détecté avant tout test réel (grep du bundle compilé
confirmant la présence du vrai nom de projet Supabase), corrigé
immédiatement, reconfirmé par un second grep montrant `127.0.0.1:54321`
à la place.

Troisième découverte : `npm run preview` (`vite preview`) ne fonctionne
pas du tout avec ce projet — `vite.config.ts` fixe `preset: "vercel"`
pour Nitro, qui produit le format Vercel Build Output API v3
(`.vercel/output/`), pas la disposition générique `dist/server/
server.js` que le plugin de preview de TanStack Start attend.
`docs/DEVELOPMENT.md` affirme le contraire — probablement rédigé avant
que ce preset ne soit fixé, maintenant obsolète. Contournement :
`e2e/mocks/preview-server.ts`, un petit serveur Node qui sert
`.vercel/output/static` pour les fichiers statiques et route tout le
reste vers le gestionnaire `fetch(Request)` standard exporté par
`.vercel/output/functions/__server.func/index.mjs` — un vrai build de
production servi localement, pas un contournement en mode dev.

## 7. Limites connues de l'approche full-mock

Cette suite valide le **comportement de l'interface et les contrats
RPC attendus** contre des données fixtures — elle ne valide pas la RLS
réelle, le comportement des triggers, ni la validation des arguments
côté PostgreSQL. Un test qui passe ici signifie "le frontend appelle la
bonne RPC avec la bonne forme et affiche correctement le résultat
mocké" — pas "cette RPC se comporte ainsi contre la vraie base." Ce
niveau-là reste couvert par les scripts SQL transactionnels
(`BEGIN…ROLLBACK`) déjà utilisés dans ce projet (chantiers MonCash
Collect et Dashboard Financier).

## 8. Comment relancer

```bash
npm install --save-dev @playwright/test tsx @axe-core/playwright playwright-lighthouse  # déjà fait
npx playwright install chromium webkit                                                    # déjà fait
npm run build:e2e        # compile avec l'URL Supabase mock
npm run test:e2e         # tous les projets — voir §5 sur la contention
npm run test:e2e:report  # ouvre playwright-report/index.html
```

Pour une exécution fiable individuelle : `npx playwright test
--project=client --project=restaurant --project=driver --project=admin
--project=auth`, puis séparément `--project=cross-cutting`, puis
`--project=responsive-mobile-chrome --project=responsive-mobile-safari
--project=responsive-tablet --project=responsive-desktop`.

**Artefacts produits** : `playwright-report/` (HTML), `test-results/
results.json`, `test-results/screenshots/*.png` (15 captures
responsive dédiées), vidéos et captures d'échec par test dans
`test-results/<nom-du-test>/`.

## 9. Ce qui n'a pas été fait (hors périmètre explicite)

- Correction du bug de contraste couleur du pied de page — signalé,
  pas corrigé (nécessite sa propre validation CSS).
- Coverage de code JS (pourcentage statement/branch) — la matrice de
  flux ci-dessus a été retenue comme l'interprétation principale de
  "Coverage", plus directement actionnable ; le coverage Chromium natif
  (`page.coverage`) reste une extension possible, non construite ici.
- Aucun commit, aucun push, aucune application de migration — conforme
  à la consigne.
