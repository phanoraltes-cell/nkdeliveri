# PWA — NK Deliveri

NK Deliveri est une Progressive Web App installable, avec précache offline
et notifications push. Implémentée avec `vite-plugin-pwa` en mode
**`injectManifest`** (Service Worker écrit à la main, pas généré
automatiquement) — pas le mode `generateSW`.

## Manifest (`public/manifest.webmanifest`)

Manifest statique (pas généré par `vite-plugin-pwa`, `manifest: false` dans
`vite.config.ts`) :

- `name`: "NK Deliveri — Gonaïves", `lang`: "ht"
- `display: "standalone"`, `orientation: "portrait"`
- `theme_color: "#F97316"`, `background_color: "#FFF7ED"`
- Icônes : `app-icon-192.png`, `app-icon-512.png`,
  `app-icon-512-maskable.png` (`public/`)
- `shortcuts` : accès rapide à `/restaurants` et `/orders` depuis l'icône
  de l'app (menu long-press sur mobile/desktop)

## Service Worker (`src/sw.ts`)

Source unique, écrite à la main avec les primitives Workbox
(`workbox-precaching`, `workbox-routing`, `workbox-strategies`,
`workbox-expiration`) puis injectée par `vite-plugin-pwa` (stratégie
`injectManifest`) — la liste de précache (`self.__WB_MANIFEST`) est
substituée au build, le reste du fichier est exécuté tel quel.

| Bloc | Comportement |
|---|---|
| Précache | `precacheAndRoute(self.__WB_MANIFEST)` + `cleanupOutdatedCaches()` — précharge tous les assets buildés listés dans le manifeste Workbox |
| Navigation (pages) | `NetworkFirst` (timeout réseau 5s), exclut `/~oauth` et `/api/` |
| Assets statiques (js/css/woff2/png/svg/jpg/jpeg/webp, même origine) | `CacheFirst`, 200 entrées max, 30 jours d'expiration |
| Offline | `setCatchHandler` : toute navigation qui échoue à la fois en réseau et en précache retombe sur `/offline.html` (page statique sans dépendance JS, précachée comme le reste) |
| Mise à jour | Écoute `message` de type `SKIP_WAITING` pour activer immédiatement une nouvelle version sur demande de l'UI |
| Push | `push` → construit et affiche une `Notification` depuis le payload JSON envoyé par `pushToUsers` (voir [SERVICES.md](./SERVICES.md)) ; `notificationclick` → focus un onglet existant et y navigue, ou en ouvre un nouveau vers `payload.url` (par défaut `/notifications`) |

## Enregistrement (`src/lib/pwa-register.ts`)

`registerPWA()` — appelée au montage de l'app côté client uniquement :

- **No-op** en dehors de la production (`import.meta.env.PROD`), en SSR
  (`typeof window === "undefined"`), si `serviceWorker` n'est pas supporté,
  ou si la page tourne **dans une iframe** (détection `window.self !==
  window.top` — désenregistre même un Service Worker déjà actif dans ce
  cas, via `unregisterAppSw()`).
- Un paramètre d'URL `?sw=off` force aussi le désenregistrement — utile en
  debug.
- Enregistre `/sw.js` via `workbox-window`. Sur détection d'une version en
  attente (`waiting`), affiche un toast persistant ("Nouvo vèsyon
  disponib") avec un bouton "Rafrechi" qui déclenche `SKIP_WAITING` puis
  recharge la page une fois le nouveau Service Worker aux commandes
  (`controllerchange`).

## Invite d'installation

`src/components/install-prompt.tsx` capture l'événement natif
`beforeinstallprompt` et affiche une invite personnalisée (le comportement
natif du navigateur est sinon supprimé par `event.preventDefault()`).

## Notifications Push

Cycle de vie côté navigateur dans `src/lib/push.ts`
(`isPushSupported`/`subscribeToPush`/`unsubscribeFromPush`), abonnement
persisté dans la table `push_subscriptions`. Bascule utilisateur :
`src/components/push-toggle.tsx` sur `/notifications`. Émission côté
serveur : voir [SERVICES.md § Notifications push](./SERVICES.md#notifications-push-send--push-functionsts).

## Build : chemin de sortie du precache

`vite-plugin-pwa` est configuré avec `outDir: ".vercel/output/static"` et
`injectManifest.globDirectory: ".vercel/output/static"` — **pas** le
`dist/` par défaut de Vite. C'est une conséquence directe du choix explicite
du preset Nitro `vercel` (voir [ARCHITECTURE.md](./ARCHITECTURE.md) et
[DEPLOYMENT.md](./DEPLOYMENT.md)) : Nitro assemble les assets statiques
réellement servis dans `.vercel/output/static/`, donc c'est le seul
répertoire que `vite-plugin-pwa` doit scanner pour construire une liste de
précache exacte. Une désynchronisation entre ce chemin et le preset Nitro
actif fait silencieusement tomber le précache à 0 entrée (aucune erreur de
build, juste un Service Worker qui ne précache rien) — si le preset change
un jour, ce chemin doit être mis à jour en même temps.

## Vérification manuelle

Après un `npm run build`, confirmer :
1. `.vercel/output/static/sw.js` existe et contient une liste
   `precacheAndRoute` non vide.
2. `.vercel/output/static/manifest.webmanifest` est présent et accessible.
3. En local avec `npm run preview` (ou après déploiement), l'app s'installe
   depuis le menu du navigateur et fonctionne hors-ligne sur les pages déjà
   visitées.
