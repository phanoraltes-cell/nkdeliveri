# Guide des services — NK Deliveri

Ce document couvre la couche « services » de l'application : le service
externe de routage (`src/services/`), les fonctions serveur TanStack Start
(`src/lib/*.functions.ts`), et les utilitaires partagés (`src/lib/*.ts`).
Pour la couche Supabase elle-même, voir [SUPABASE.md](./SUPABASE.md) ; pour
les endpoints exposés (paramètres/réponses/erreurs), voir
[API.md](./API.md).

## `src/services/routing.ts`

**`getRoute(from: RoutePoint, to: RoutePoint): Promise<RouteResult | null>`**
— interroge un serveur [OSRM](http://project-osrm.org/) (`VITE_OSRM_URL`,
par défaut la démo publique `router.project-osrm.org` — **non adaptée à la
production**, un commentaire du fichier documente explicitement qu'il faut
la remplacer par une instance auto-hébergée avec un extrait `.osm.pbf`
d'Haïti avant un vrai lancement). Retourne un chemin `[lat,lng][]` prêt pour
`<Polyline>` Leaflet, une distance en mètres et une durée en secondes. Cache
en mémoire (5 minutes de TTL, clé arrondie à une grille ~50m pour absorber
le bruit GPS). Consommé exclusivement via le hook `useRoute`
(voir [HOOKS.md](./HOOKS.md)) — jamais appelé directement par un
composant.

## Fonctions serveur (`src/lib/*.functions.ts`)

Toutes utilisent `createServerFn({ method: "POST" })` de TanStack Start,
`.middleware([requireSupabaseAuth])` pour l'identité appelante, et un
validateur Zod. Elles ne modifient jamais l'état métier directement — la
mutation réelle passe toujours par un RPC Postgres (voir
[API.md](./API.md)) ; ces fonctions ne font que le travail annexe (envoi
push, e-mail, upload) déclenché après coup côté client, en best-effort.

### Notifications push (`send-*-push.functions.ts`)

| Fonction                   | Fichier                               | Déclenchée après                                                                  |
| -------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `sendNewOrderPush`         | `send-order-push.functions.ts`        | `create_order_secure` — notifie le restaurant                                     |
| `sendDeliveryAssignedPush` | `send-order-push.functions.ts`        | `claim_delivery_secure` — notifie le client                                       |
| `sendOrderDeliveredPush`   | `send-order-push.functions.ts`        | passage manuel de `deliveries.status` à `delivered`                               |
| `sendOrderStatusPush`      | `send-order-status-push.functions.ts` | `update_order_status_secure`                                                      |
| `sendPaymentReviewPush`    | `send-push.functions.ts`              | approbation/rejet admin d'une preuve de paiement                                  |
| `sendRefundStatusPush`     | `send-refund-push.functions.ts`       | `review_refund_secure` / `complete_refund_secure`                                 |
| `sendDisputeUpdatePush`    | `send-dispute-push.functions.ts`      | `add_dispute_message_secure` / `resolve_dispute_secure`                           |
| `sendEmployeeEventPush`    | `send-employee-push.functions.ts`     | `add_restaurant_employee_secure` / `update_restaurant_employee_role_secure`       |
| `sendNewPromotionPush`     | `send-promotion-push.functions.ts`    | `create_promotion_secure` — notifie les clients ayant mis le restaurant en favori |
| `sendNewsletterBroadcast`  | `send-newsletter.functions.ts`        | diffusion manuelle admin vers `newsletter_subscribers`                            |

Le tronc commun d'envoi (recherche des abonnements dans
`push_subscriptions`, construction du payload VAPID via
`@block65/webcrypto-web-push`, nettoyage des endpoints morts en 404/410) a
été extrait dans **`push-dispatch.server.ts`** — `export async function
pushToUsers(userIds, payload)`. La plupart des fonctions `send-*-push`
l'importent et se contentent de calculer les destinataires et le contenu du
message.

> **Écart connu** : `sendPaymentReviewPush` (`send-push.functions.ts`)
> n'a **pas** été migrée vers `pushToUsers` — elle contient encore sa
> propre copie complète de la logique d'envoi (recherche des abonnements,
> `buildPushPayload`, nettoyage des endpoints morts), écrite avant
> l'extraction du dispatcher partagé. Le comportement est identique, mais
> une modification future de la logique d'envoi (ex. changement du TTL, de
> la gestion d'erreur) doit être répercutée dans ce fichier séparément si
> on ne profite pas de l'occasion pour le migrer vers `pushToUsers`.

### Autres fonctions serveur

| Fonction                                       | Fichier                                 | Rôle                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `finalizeRegistrationDocuments`                | `register-documents.functions.ts`       | Finalise l'upload des documents d'inscription (pièce d'identité livreur, documents restaurant) après création du compte                         |
| `suspendUserAccount` / `reactivateUserAccount` | `manage-user.functions.ts`              | Actions admin de suspension/réactivation d'un compte (via `supabaseAdmin`, Auth Admin API)                                                      |
| `initiateProviderPayout`                       | `initiate-provider-payout.functions.ts` | Seul appelant autorisé d'un `PaymentProvider` (`getPaymentProvider`) pour un décaissement — voir [PAYMENT_PROVIDERS.md](./PAYMENT_PROVIDERS.md) |

## Utilitaires partagés (`src/lib/*.ts`)

| Fichier                   | Exporte                                                                                                   | Rôle                                                                                                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utils.ts`                | `cn`, `inputCls`, `inputClsCompact`                                                                       | Fusion de classes Tailwind (`clsx`/`tailwind-merge`) et styles d'input partagés                                                                                                                                        |
| `format.ts`               | `formatHTG(amount)`                                                                                       | Formatage monétaire en gourdes haïtiennes                                                                                                                                                                              |
| `creole.ts`               | `CREOLE_DAY` + helpers de `useWeeklySeries`                                                               | Étiquettes de jour en kreyòl pour les graphiques                                                                                                                                                                       |
| `delivery-status.ts`      | helpers de statut                                                                                         | Libellés/couleurs pour `delivery_status`                                                                                                                                                                               |
| `employee-roles.ts`       | `EMPLOYEE_ROLES`, `isOperationalRole(role)`                                                               | Source unique des 6 rôles d'employé restaurant et de la distinction rôle opérationnel vs managérial, partagée entre l'UI et la nav (voir [DATABASE.md](./DATABASE.md#personnel-restaurant--configuration-de-paiement)) |
| `kitchen-ticket.ts`       | `printKitchenTicket(order, restaurantName)`                                                               | Génère et imprime le bon de cuisine — PDF via `jspdf` (chargé paresseusement), format thermique 80mm, hauteur dynamique selon le nombre d'articles, `doc.autoPrint()` + `window.open()`                                |
| `push.ts`                 | `isPushSupported`, `subscribeToPush`, `unsubscribeFromPush`                                               | Cycle de vie de l'abonnement Push côté navigateur (Service Worker + `PushManager`), écrit/supprime dans `push_subscriptions`                                                                                           |
| `push-dispatch.server.ts` | `pushToUsers(userIds, payload)`                                                                           | Dispatcher push partagé côté serveur — voir ci-dessus                                                                                                                                                                  |
| `file-validation.ts`      | `IMAGE_MIME_TYPES`, `DOCUMENT_MIME_TYPES`, `UPLOAD_LIMITS`, `validateUploadFile`, `assertValidUploadFile` | Validation côté client des fichiers avant upload Storage (type MIME + taille), miroir des limites réelles des buckets (voir [DATABASE.md](./DATABASE.md#5-buckets-de-stockage-storage))                                |
| `csv-export.ts`           | `downloadCSV(filename, headers, rows)`                                                                    | Export CSV côté navigateur (ex. liste clients admin)                                                                                                                                                                   |
| `auth-errors.ts`          | `translateAuthError`, `isEmailNotConfirmedError`                                                          | Traduction des messages d'erreur Supabase Auth en kreyòl/français lisible                                                                                                                                              |
| `seo.ts`                  | `pageMeta`, `noIndexMeta`, `jsonLdScript`                                                                 | Génération des balises meta/JSON-LD par page                                                                                                                                                                           |
| `site-config.ts`          | `SITE_URL`, `SITE_NAME`, `PRIMARY_CITY`, `CONTACT_EMAIL`, `absoluteUrl`                                   | Constantes de configuration du site                                                                                                                                                                                    |
| `html.ts`                 | `escapeHtml(s)`                                                                                           | Échappement HTML minimal (utilisé dans la génération d'e-mails/tickets)                                                                                                                                                |
| `pwa-register.ts`         | `registerPWA()`                                                                                           | Enregistrement du Service Worker PWA — voir [PWA.md](./PWA.md)                                                                                                                                                         |
| `error-page.ts`           | `renderErrorPage()`                                                                                       | HTML de secours si le rendu React échoue totalement côté serveur                                                                                                                                                       |
| `error-capture.ts`        | `consumeLastCapturedError()`                                                                              | Relais entre la capture d'erreur bas niveau et l'UI d'erreur                                                                                                                                                           |
| `sentry.server.ts`        | `initSentryServer`, `captureExceptionServer`                                                              | Initialisation Sentry côté serveur — voir [SECURITY.md](./SECURITY.md)                                                                                                                                                 |
| `sentry-browser.ts`       | `initSentryClient`, `captureExceptionClient`                                                              | Initialisation Sentry côté navigateur (nommé `-browser` et non `.client.` pour contourner le plugin de protection d'imports de TanStack Start, voir [ARCHITECTURE.md](./ARCHITECTURE.md))                              |
