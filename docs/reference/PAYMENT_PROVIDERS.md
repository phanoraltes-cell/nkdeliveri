# Fournisseurs de paiement (PaymentProvider) — NK Deliveri

Ce document couvre l'abstraction `PaymentProvider`
(`src/lib/payment-providers/`) qui découple le décaissement (paiement des
restaurants/livreurs) de son mode d'exécution — manuel aujourd'hui, API
MonCash/NatCash demain — et la procédure de configuration de MonCash. Pour
le module financier lui-même (wallets, commissions, `initiate_payout_secure`),
voir [DATABASE.md](./DATABASE.md) et [API.md](./API.md). Pour la campagne
de tests (unitaires + transactionnels contre le schéma live, comparaison
des 3 canaux), voir [MONCASH_TEST_REPORT.md](../archive/moncash/MONCASH_TEST_REPORT.md).

## Vue d'ensemble de l'architecture

Deux axes séparés existent déjà dans le schéma et ne doivent jamais être
confondus :

- **`payment_methods`** (`moncash` / `natcash`) — **quel rail** transporte
  l'argent (quel numéro de téléphone du bénéficiaire est utilisé).
- **`payment_providers`** (`manual` / `moncash_api` / `natcash_api`,
  colonne `is_active`) — **qui exécute** le transfert. Aujourd'hui, 100 %
  des décaissements passent par `manual` (un admin envoie l'argent
  lui-même depuis son téléphone, puis enregistre la transaction) — c'est
  la seule ligne avec `is_active = true`.

```
payout-pay-modal.tsx (UI admin)
        │
        │  providerCode === "manual"          providerCode !== "manual"
        ▼                                              ▼
supabase.rpc("initiate_payout_secure")   initiate-provider-payout.functions.ts
   (inchangé, chemin actif en prod)         (server function — seul point
                                              d'entrée autorisé à appeler
                                              un provider)
                                                       │
                                                       ▼
                                     getPaymentProvider(code)  (index.server.ts)
                                                       │
                                        ┌──────────────┼──────────────┐
                                        ▼              ▼              ▼
                              manual-provider   moncash-provider  natcash-provider
                                .server.ts        .server.ts        .server.ts
                                                       │
                                                       ▼
                                       initiatePayment() réussit
                                                       │
                                                       ▼
                                   supabase.rpc("initiate_payout_secure")
                                   (même RPC, avec la référence du
                                    provider comme _transaction_reference)
```

`initiate_payout_secure` reste **l'unique** endroit qui débite un wallet et
crée une ligne `payouts` — que le chemin soit manuel ou via un provider. Un
provider ne fait jamais l'écriture financière lui-même ; il ne fait
qu'exécuter le transfert et rapporter un statut.

### Fichiers

| Fichier                                               | Rôle                                                                                                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment-providers/types.ts`                          | Interface commune : `initiatePayment()`, `checkStatus()`, `cancelPayment()`, `verifyWebhook()`, `isConfigured()`                                                                                                                 |
| `payment-providers/manual-provider.server.ts`         | Implémentation triviale — reflète le geste humain déjà fait (`isConfigured()` toujours `true`)                                                                                                                                   |
| `payment-providers/moncash-provider.server.ts`        | Implémentation MonCash — voir statut ci-dessous                                                                                                                                                                                  |
| `payment-providers/natcash-provider.server.ts`        | Stub — `isConfigured()` toujours `false`, aucun secret NatCash n'existe encore                                                                                                                                                   |
| `payment-providers/moncash-config.server.ts`          | Lecture/validation centralisée des 5 secrets MonCash — voir plus bas                                                                                                                                                             |
| `payment-providers/moncash-client.server.ts`          | Client HTTP bas niveau de l'API MonCash Business — auth OAuth2, `CreatePayment`, `RetrieveOrderPayment`/`RetrieveTransactionPayment`, timeout + retry + réconciliation idempotente. Seul `moncash-provider.server.ts` l'appelle. |
| `payment-providers/index.server.ts`                   | Registre `getPaymentProvider(code)` — le seul point d'accès à une implémentation                                                                                                                                                 |
| `payment-providers/moncash-webhook-handler.server.ts` | Orchestration d'une livraison webhook entrante : idempotence, mise à jour du payout, notifications, journalisation. Voir [MONCASH_WEBHOOK_SECURITY.md](../archive/moncash/MONCASH_WEBHOOK_SECURITY.md).                          |
| `routes/api.webhooks.moncash.ts`                      | Route HTTP publique `POST /api/webhooks/moncash` — reçoit les livraisons MonCash, délègue tout au handler ci-dessus                                                                                                              |
| `initiate-provider-payout.functions.ts`               | Fonction serveur TanStack Start — le seul appelant autorisé de `getPaymentProvider(...).initiatePayment()` pour un décaissement                                                                                                  |
| `get-moncash-status.functions.ts`                     | Fonction serveur admin-only exposant `isMonCashConfigured()` (un booléen, jamais un secret) au dashboard admin                                                                                                                   |
| `routes/_authenticated/dashboard.admin.moncash.tsx`   | Page admin "MonCash" — statut, historique, erreurs. Voir § Dashboard admin ci-dessous.                                                                                                                                           |

## Pourquoi `.server.ts` et pas une convention de nommage

`.server.ts` est une garantie **imposée à la compilation** par TanStack
Start : un fichier `.functions.ts` ou un composant de route qui tenterait
d'importer `moncash-provider.server.ts` (ou `moncash-config.server.ts`)
directement ferait échouer le build. C'est ce mécanisme, pas une règle de
revue de code, qui empêche `MONCASH_CLIENT_SECRET`/`MONCASH_WEBHOOK_SECRET`
d'atteindre le bundle navigateur — voir
[ARCHITECTURE.md § Frontière client/serveur](./ARCHITECTURE.md#frontière-client--serveur).
Aucun composant React n'appelle jamais un provider ; le seul chemin est
`payout-pay-modal.tsx` → `initiate-provider-payout.functions.ts` (une
fonction serveur) → `getPaymentProvider()`.

## ⚠️ Mise à jour 2026-08-01 — le Collect client est en production, ce document ne le couvrait pas

Tout ce document, écrit avant le Go-Live du paiement client, décrit
exclusivement le chemin **décaissement (B2C, plateforme → bénéficiaire)** —
`payout-pay-modal.tsx` → `initiate-provider-payout.functions.ts` →
`getPaymentProvider()`. Ce chemin reste inatteignable en production (voir
[Ce qui n'est PAS fait](#ce-qui-nest-pas-fait-volontairement)).

**Le chemin Collect (B2C inverse, client → plateforme) est un flux
entièrement séparé, déjà en production** depuis le Go-Live MonCash Collect
de cette session : `checkout.tsx` → `initiate-collect-payment.functions.ts`
→ `moncashProvider.initiatePayment({ direction: "collect", ... })`. Ce flux
**n'est gardé que par `moncashProvider.isConfigured()`** (présence des 5
variables ci-dessous) — **jamais par `payment_providers.moncash_api.is_active`**,
qui ne s'applique qu'au menu déroulant du décaissement admin, § ci-dessous.
Détail complet, y compris pourquoi cette décision est conservée telle
quelle pour la v1.0 : [MONCASH_CONFIGURATION.md](./MONCASH_CONFIGURATION.md).

**Piège de nommage à connaître** : l'option "MonCash Automatik" existe à
deux endroits différents avec deux comportements opposés — dans
`checkout.tsx` (client, en production, gardée par `isConfigured()` seul) et
dans `payout-pay-modal.tsx` (admin, décaissement, gardée par `is_active` ET
`isConfigured()` ET toujours refusée par le check `direction` — § ci-dessous).
Le même libellé créole ne désigne pas le même flux.

## Trois portes indépendantes avant qu'un transfert de **décaissement** puisse partir

Cette section ne concerne que le décaissement (B2C) — le Collect client
(voir l'encart ci-dessus) n'a que la porte 2.

1. **`payment_providers.is_active`** (base de données) — contrôle si le
   provider apparaît dans le menu déroulant de `payout-pay-modal.tsx`
   (décaissement admin uniquement — n'affecte jamais le Collect client).
   `moncash_api` reste `is_active = false` jusqu'à activation délibérée.
2. **`provider.isConfigured()`** (code) — vérifié par
   `initiate-provider-payout.functions.ts` avant tout appel, indépendamment
   du drapeau en base (défense en profondeur : si le drapeau était activé
   par erreur avant que les secrets existent, cette vérification bloque
   quand même l'appel). Pour MonCash, reflète la présence réelle des 5
   variables d'environnement ci-dessous.
3. **La direction du paiement** — même une fois `isConfigured()` vrai,
   `initiatePayment({ direction: "disburse", ... })` (le seul appel que
   fait le flux de décaissement) renvoie toujours un échec explicite et
   traçable, jamais un succès inventé. Voir
   [Ce qui n'est PAS fait](#ce-qui-nest-pas-fait-volontairement) plus bas
   pour pourquoi.

## Gestion des secrets MonCash

Toute lecture de secret MonCash passe par
**`src/lib/payment-providers/moncash-config.server.ts`** — aucun autre
fichier ne doit appeler `process.env.MONCASH_*` directement. Ce module
expose :

- `isMonCashConfigured(): boolean` — ne lève jamais, vrai seulement si les
  5 variables sont présentes. C'est ce que `moncashProvider.isConfigured()`
  appelle.
- `getMonCashConfig(): MonCashConfig` — lève une erreur claire listant les
  variables manquantes (jamais leur valeur) si la configuration est
  incomplète.

### Variables requises

| Variable                 | Description                                                                                            | Où l'obtenir                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `MONCASH_CLIENT_ID`      | Identifiant client OAuth2 de l'application MonCash Business                                            | Portail développeur MonCash/Digicel, après création d'une application                         |
| `MONCASH_CLIENT_SECRET`  | Secret associé au client ID — permet d'obtenir un jeton d'accès OAuth2                                 | Idem, affiché une seule fois à la création — le régénérer révoque l'ancien                    |
| `MONCASH_MERCHANT_ID`    | Identifiant du compte marchand MonCash de NK Deliveri                                                  | Contrat marchand signé avec Digicel/MonCash                                                   |
| `MONCASH_API_URL`        | URL de base de l'API (sandbox ou production — MonCash distingue les deux)                              | Documentation MonCash — **ne jamais pointer la production vers l'URL sandbox ou inversement** |
| `MONCASH_WEBHOOK_SECRET` | Secret utilisé pour vérifier la signature des webhooks entrants (notifications asynchrones de MonCash) | Portail développeur MonCash, section webhooks                                                 |

Toutes sont **server-only** — jamais de variante `VITE_*`, jamais commitées
(voir [`.env.example`](../../.env.example) pour les placeholders et
[ENVIRONMENTS.md](./ENVIRONMENTS.md) pour la règle générale `VITE_*` vs
sans préfixe).

### Procédure de configuration

1. **Développement local** : copier les 5 lignes `MONCASH_*` de
   `.env.example` vers `.env.local`, remplir avec des identifiants
   **sandbox** MonCash si disponibles. `.env.local` n'est jamais commité
   (voir `.gitignore`).
2. **Production/Preview (Vercel)** : Project Settings → Environment
   Variables → ajouter les 5 noms exacts, en distinguant explicitement le
   scope Production (identifiants réels) du scope Preview (identifiants
   sandbox si utilisés — ne jamais mettre les identifiants de production
   en scope Preview, même règle que documentée pour Supabase dans
   [ENVIRONMENTS.md](./ENVIRONMENTS.md)).
3. **Vérifier** : une fois les 5 variables présentes dans un environnement,
   `moncashProvider.isConfigured()` devient `true` dans cet environnement —
   sans redéploiement de code, seulement une nouvelle exécution qui relit
   `process.env`. **C'est déjà, à elle seule, suffisant pour que le Collect
   client (`checkout.tsx`) fonctionne réellement** — aucune étape
   supplémentaire, aucun flag base de données à changer pour ce flux-là.
4. **Activer réellement le provider de _décaissement_** (seulement une fois le
   [B2C disbursement confirmé et implémenté](#ce-qui-nest-pas-fait-volontairement) —
   la connexion écrite aujourd'hui ne couvre que la collecte, pas le
   décaissement — **sans lien avec l'étape 3 ci-dessus, qui concerne le
   Collect**) : passer `payment_providers.moncash_api.is_active` à
   `true` en base — un `UPDATE` simple, pas une migration de schéma. Tant
   que ce n'est pas fait, le provider de décaissement reste invisible dans
   `payout-pay-modal.tsx` même avec des secrets valides. Sans effet sur le
   Collect client, déjà actif indépendamment (étape 3).

### Rotation

- `MONCASH_CLIENT_SECRET` et `MONCASH_WEBHOOK_SECRET` sont les deux
  valeurs à traiter comme des secrets au sens strict (capacité d'agir au
  nom du compte marchand / de falsifier un webhook). Les régénérer côté
  MonCash révoque l'ancienne valeur — mettre à jour Vercel **avant** de
  révoquer côté MonCash pour éviter une fenêtre d'indisponibilité.
- Aucune rotation automatique n'existe ni n'est prévue — la même
  contrainte s'applique déjà à `SUPABASE_SERVICE_ROLE_KEY` et
  `VAPID_PRIVATE_JWK` (voir [SECURITY.md § Secrets](./SECURITY.md#secrets-et-variables-denvironnement)).
- En cas de fuite suspectée : régénérer immédiatement côté portail MonCash,
  mettre à jour Vercel, redéployer. `getMonCashConfig()` ne journalise
  jamais les valeurs, seulement les noms des variables manquantes le cas
  échéant.

## Le connecteur MonCash (`moncash-client.server.ts`)

Implémentation réelle de l'API publique **MonCash Business**
(https://moncashbutton.digicelgroup.com/Moncash-business/), pas un stub —
c'est du code qui fait de vrais appels HTTP dès que les 5 secrets sont
configurés. Tout appel passe par `moncash-provider.server.ts`, jamais
directement.

- **Authentification** — OAuth2 `client_credentials`
  (`POST {MONCASH_API_URL}/oauth/token`, `Authorization: Basic
base64(clientId:clientSecret)`). Le jeton est mis en cache en mémoire
  jusqu'à ~1 min avant son expiration (`expires_in`) ; des appels
  concurrents pendant un cache froid partagent une seule requête de jeton
  en vol (pas de N requêtes de jeton pour N décaissements simultanés). Le
  jeton ne quitte jamais ce module, sauf comme en-tête `Bearer` de la
  requête suivante — jamais journalisé, jamais retourné à un appelant.
- **Création de paiement** — `POST {MONCASH_API_URL}/v1/CreatePayment`
  (`{ amount, orderId }`). `orderId` est notre propre référence
  (`InitiatePaymentInput.reference`) : MonCash exige un `orderId` unique
  par marchand et rejette une seconde création pour un `orderId` déjà
  utilisé — cette contrainte d'unicité est le mécanisme d'idempotence de
  cette API (elle n'a pas d'en-tête `Idempotency-Key`).
- **Récupération du statut** — `POST
{MONCASH_API_URL}/v1/RetrieveOrderPayment` (par notre `orderId` — le
  chemin utilisé par `checkStatus()`) et `POST
{MONCASH_API_URL}/v1/RetrieveTransactionPayment` (par l'identifiant de
  transaction propre à MonCash, exposé pour un usage futur — ex. un
  webhook confirmé plus tard).
- **Gestion des erreurs** — `MonCashApiError` (message, `httpStatus`,
  corps de réponse brut) pour toute réponse HTTP non-2xx ; jamais une
  exception `fetch` brute qui remonterait jusqu'à l'UI.
- **Timeout** — `AbortController`, 15 secondes par tentative.
- **Retry** — jusqu'à 3 tentatives, backoff exponentiel (300ms, 900ms),
  seulement sur erreur réseau, timeout, HTTP 429, ou HTTP 5xx. Jamais sur
  un 4xx — un `4xx` veut dire que MonCash a rejeté la requête elle-même
  (identifiants invalides, paramètres invalides, `orderId` déjà utilisé),
  la renvoyer à l'identique échouerait encore.
- **Idempotence** — pas d'en-tête dédié (MonCash n'en documente pas) ;
  l'unicité d'`orderId` en tient lieu côté serveur MonCash, et
  `moncashProvider.initiatePayment()` réconcilie explicitement : si
  `CreatePayment` échoue (réseau, timeout, ou "orderId déjà utilisé"), il
  interroge `RetrieveOrderPayment(orderId)` avant de rapporter un échec —
  un appel qui a réellement réussi côté MonCash malgré une erreur locale
  n'est donc jamais réessayé en double.
- **Audit** — chaque tentative HTTP (y compris chaque repriz) est
  journalisée dans `moncash_api_logs` : requête/réponse assainies,
  statut, délai, erreur, référence. Table append-only (triggers
  `BEFORE DELETE`/`UPDATE`/`TRUNCATE`, tout rôle confondu). Détail
  complet : [MONCASH_FINANCIAL_AUDIT.md](../archive/moncash/MONCASH_FINANCIAL_AUDIT.md).

## Le cycle de vie asynchrone (`payouts.status = 'pending'`) et le webhook

Jusqu'à cette migration, `payouts` ne modélisait qu'un transfert _déjà
effectué_ (`status` par défaut `'paid'`, comme le fait toujours le flux
manuel) — il n'existait nulle part de "on a demandé, pas encore
confirmé". Un webhook a besoin de cet état intermédiaire pour avoir
quelque chose à mettre à jour :

```
initiate-provider-payout.functions.ts
        │  provider.initiatePayment() → status: "pending"
        ▼
supabase.rpc("create_pending_payout_secure")
  (réserve les fonds : available_balance → pending_balance,
   status = 'pending', notifie le bénéficiaire "peman ap pare",
   AUCUNE liaison de commission — rien n'est encore confirmé)
        │
        ▼           ◀──────────────── webhook MonCash (async, plus tard)
   … en attente …            │
                              ▼
                    POST /api/webhooks/moncash
                              │
                    moncash-webhook-handler.server.ts
                    (signature, idempotence — voir
                    MONCASH_WEBHOOK_SECURITY.md)
                              │
              ┌───────────────┴───────────────┐
              ▼                                ▼
  complete_pending_payout_secure    fail_pending_payout_secure
  (status → 'paid', notifie le      (status → 'failed', restitue
   bénéficiaire ET l'admin, lie      pending_balance → available_balance,
   les commissions — même point      notifie le bénéficiaire ET l'admin
   d'arrivée que le flux manuel)     qui a initié le paiement)
```

### Notifications automatiques

Chaque étape du cycle ci-dessus appelle **`private.notify_secure`** (le
moteur générique de
[20260723090000_notifications_engine_and_gps_sharing.sql](../../supabase/migrations/20260723090000_notifications_engine_and_gps_sharing.sql),
déjà utilisé par le chat, le partage GPS et l'annulation client) —
jamais un `INSERT INTO notifications` écrit à la main, exactement la
règle déjà établie pour toute nouvelle fonctionnalité. Catégorie
`commission` partout (même regroupement que les notifications de
décaissement existantes), donc filtrable dans le centre de notifications
comme n'importe quelle autre.

| Destinataire                      | Événement             | RPC                                                                 | `type`                          |
| --------------------------------- | --------------------- | ------------------------------------------------------------------- | ------------------------------- |
| Restaurant/Livreur (bénéficiaire) | Peman voye            | `create_pending_payout_secure`                                      | `payout_provider_sent`          |
| Restaurant/Livreur (bénéficiaire) | Peman konfime         | `complete_pending_payout_secure`                                    | `payout_provider_confirmed`     |
| Restaurant/Livreur (bénéficiaire) | Erè                   | `fail_pending_payout_secure`                                        | `payout_provider_failed`        |
| Admin (qui a lanse peman an)      | Siksè                 | `complete_pending_payout_secure`                                    | `payout_provider_admin_success` |
| Admin (qui a lanse peman an)      | Erè                   | `fail_pending_payout_secure` ou `log_payment_provider_error_secure` | `payout_provider_admin_error`   |
| Admin (qui a lanse peman an)      | Delè ekoule (timeout) | `log_payment_provider_error_secure`                                 | `payout_provider_admin_timeout` |

Le "timeout" est une vraie distinction structurelle, pas un texte
deviné : `MonCashApiError` (`moncash-client.server.ts`) porte un champ
`code: "timeout"` posé uniquement quand `AbortController` coupe la
requête faute de réponse à temps ; ce code remonte jusqu'à
`InitiatePaymentResult.code` puis jusqu'à `_code` sur
`log_payment_provider_error_secure`, qui choisit le `type`/titre en
conséquence — jamais un `error.includes("timeout")` fragile.

Notifications push (best-effort, en plus des notifications en app) :
`moncash-webhook-handler.server.ts` pousse au bénéficiaire et à l'admin
sur confirmation/échec webhook ; le chemin synchrone
(`initiate-provider-payout.functions.ts`, toujours le seul atteignable
aujourd'hui) ne pousse rien lui-même — le toast client-side donne déjà
un retour immédiat dans ce cas.

Point clé : `complete_pending_payout_secure` fait aboutir un payout
confirmé par webhook exactement au même état (`status = 'paid'`) qu'un
payout manuel dès sa création — `confirm_payout_secure`/
`dispute_payout_secure` (la confirmation de réception par le
bénéficiaire) fonctionnent donc _sans aucune modification_ sur un payout
d'origine webhook.

**`complete_pending_payout_secure`/`fail_pending_payout_secure` ne sont
appelables que par le rôle `service_role`** (`GRANT`/`REVOKE` au niveau
Postgres, pas seulement une vérification applicative) — seul le handler
webhook, via `supabaseAdmin`, peut les invoquer ; aucune session
utilisateur authentifiée ne le peut, même admin. Les deux sont également
idempotentes indépendamment de la table `moncash_webhook_events` : un
appel sur un payout qui n'est plus `'pending'` renvoie la ligne
inchangée plutôt que de rejouer un mouvement de solde. Détail complet :
[MONCASH_WEBHOOK_SECURITY.md](../archive/moncash/MONCASH_WEBHOOK_SECURITY.md).

**Statut réel aujourd'hui** : `create_pending_payout_secure` n'a aucun
appelant vivant, puisque `direction: "disburse"` échoue toujours avant
d'atteindre `"pending"` (voir ci-dessous) — toute cette chaîne est
construite, testée par le typecheck/build, mais inatteignable en
production tant que le décaissement MonCash lui-même n'est pas confirmé.

## Dashboard admin (`/dashboard/admin/moncash`)

Le sélecteur de `payout-pay-modal.tsx` (autrefois deux menus déroulants
indépendants — "Metòd peman" et "Ki jan peman an egzekite" — pouvant
produire des combinaisons incohérentes comme `natcash` + `moncash_api`)
est maintenant **un seul choix** à exactement 3 options utiles,
combinant rail et exécuteur :

| Option affichée   | `method`  | `provider_code`                                      |
| ----------------- | --------- | ---------------------------------------------------- |
| MonCash Automatik | `moncash` | `moncash_api` (désactivé tant que `is_active=false`) |
| MonCash Manyèl    | `moncash` | `manual`                                             |
| NatCash Manyèl    | `natcash` | `manual`                                             |

Pas de "NatCash Automatik" — `natcashProvider` n'a ni secret ni
implémentation, l'offrir serait un cul-de-sac. **Les deux canaux manuels
ne sont jamais retirés ni désactivés par ce changement** — ils restent le
choix par défaut (présélectionné à l'ouverture de la modale) et le seul
chemin réellement atteignable en production aujourd'hui, exactement comme
avant cette réorganisation.

La page `/dashboard/admin/moncash` (nav "Finans" → "MonCash") affiche :

- **Statut** — deux indicateurs indépendants et volontairement distincts :
  `payment_providers.moncash_api.is_active` (contrôle s'il apparaît dans
  le sélecteur) et `isMonCashConfigured()` (les 5 secrets sont-ils
  présents côté serveur — via `get-moncash-status.functions.ts`, qui
  n'expose qu'un booléen, jamais une valeur).
- **Historique / progression / référence** — table des lignes `payouts`
  où `provider_code = 'moncash_api'`, triée par date : bénéficiaire,
  montant, statut (`StatusBadge`, voir le cycle de vie plus haut),
  `transaction_reference` (notre référence) et `provider_transaction_id`
  (celle de MonCash, une fois connue), dates de création/dernier
  changement.
- **Erreurs** — deux sources, une seule table (`audit_log`, déjà
  admin-lisible) : `payout.provider_attempt_failed` (échec synchrone à
  l'initiation — le seul chemin réellement atteignable aujourd'hui,
  journalisé par la nouvelle RPC `log_payment_provider_error_secure`) et
  `payout.provider_failed` (échec confirmé par webhook, déjà journalisé
  par `fail_pending_payout_secure`).

**Vide aujourd'hui, honnêtement** : puisque `create_pending_payout_secure`
n'a aucun appelant vivant (voir plus haut), aucune ligne
`provider_code='moncash_api'` ne peut exister dans `payouts` — l'historique
et les erreurs de cette page seront réellement vides tant que le
décaissement MonCash n'est pas confirmé, pas un bug d'affichage.

## Ce qui n'est PAS fait (volontairement)

- **Le décaissement (B2C) reste refusé, explicitement.** L'audit
  d'intégration préalable (voir historique du projet) a identifié un point
  non résolu, toujours vrai : l'API publique de MonCash est une passerelle
  de **collecte** marchande (client → marchand, via une redirection que le
  client complète lui-même) — elle ne documente aucun point final pour
  envoyer de l'argent vers un numéro de téléphone arbitraire, qui est le
  besoin réel du flux de décaissement de cette appli.
  `moncashProvider.initiatePayment()` vérifie explicitement
  `input.direction` et renvoie un échec clair et traçable pour
  `"disburse"` (jamais un succès inventé), même une fois les secrets
  configurés. `"collect"`, lui, est réellement implémenté contre la vraie
  API **et a un appelant vivant en production depuis le Go-Live MonCash
  Collect** (`checkout.tsx` → `initiate-collect-payment.functions.ts`) —
  voir l'encart de mise à jour en tête de document et
  [MONCASH_CONFIGURATION.md](./MONCASH_CONFIGURATION.md).
- **`cancelPayment()`** renvoie toujours `"not_cancellable"` — l'API
  MonCash n'a pas de point final d'annulation ; un jeton de paiement créé
  expire simplement s'il n'est pas utilisé.
- **`verifyWebhook()` est implémenté, mais contre un schéma non confirmé.**
  L'API Business de MonCash ne documente publiquement aucun mécanisme de
  webhook (contrairement à Stripe par exemple) — la vérification de
  signature (HMAC-SHA256 sur le corps brut, en-tête `x-moncash-signature`)
  est la convention générique la plus répandue, écrite pour qu'un vrai
  webhook soit immédiatement traitable, mais **pas** une donnée confirmée
  par Digicel. Voir [MONCASH_WEBHOOK_SECURITY.md](../archive/moncash/MONCASH_WEBHOOK_SECURITY.md)
  pour l'audit complet de ce endpoint.
- **`NatCash`** n'a aucun secret configuré (aucune variable
  `NATCASH_*` n'existe) — hors périmètre de ce document, `natcashProvider`
  reste un stub non configurable.

Activer réellement le décaissement MonCash nécessite, dans l'ordre : (1)
confirmation écrite d'un contrat d'API B2C avec Digicel/MonCash (aucun
n'existe publiquement aujourd'hui), (2) implémentation contre ce contrat
confirmé dans `moncash-provider.server.ts`/`moncash-client.server.ts`, (3)
tests contre l'environnement sandbox MonCash, (4) seulement alors,
`payment_providers.moncash_api.is_active = true`. Le flux de collecte
(`direction: "collect"`), lui, est déjà utilisable dès que les 5 secrets
sont configurés — voir la section connecteur ci-dessus.
