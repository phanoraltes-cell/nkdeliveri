# Fournisseurs de paiement (PaymentProvider) — NK Deliveri

Ce document couvre l'abstraction `PaymentProvider`
(`src/lib/payment-providers/`) qui découple le décaissement (paiement des
restaurants/livreurs) de son mode d'exécution — manuel aujourd'hui, API
MonCash/NatCash demain — et la procédure de configuration de MonCash. Pour
le module financier lui-même (wallets, commissions, `initiate_payout_secure`),
voir [DATABASE.md](./DATABASE.md) et [API.md](./API.md).

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

| Fichier | Rôle |
|---|---|
| `payment-providers/types.ts` | Interface commune : `initiatePayment()`, `checkStatus()`, `cancelPayment()`, `verifyWebhook()`, `isConfigured()` |
| `payment-providers/manual-provider.server.ts` | Implémentation triviale — reflète le geste humain déjà fait (`isConfigured()` toujours `true`) |
| `payment-providers/moncash-provider.server.ts` | Implémentation MonCash — voir statut ci-dessous |
| `payment-providers/natcash-provider.server.ts` | Stub — `isConfigured()` toujours `false`, aucun secret NatCash n'existe encore |
| `payment-providers/moncash-config.server.ts` | Lecture/validation centralisée des 5 secrets MonCash — voir plus bas |
| `payment-providers/index.server.ts` | Registre `getPaymentProvider(code)` — le seul point d'accès à une implémentation |
| `initiate-provider-payout.functions.ts` | Fonction serveur TanStack Start — le seul appelant autorisé de `getPaymentProvider(...).initiatePayment()` pour un décaissement |

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

## Trois portes indépendantes avant qu'un transfert réel puisse partir

1. **`payment_providers.is_active`** (base de données) — contrôle si le
   provider apparaît dans le menu déroulant de `payout-pay-modal.tsx`.
   `moncash_api` reste `is_active = false` jusqu'à activation délibérée.
2. **`provider.isConfigured()`** (code) — vérifié par
   `initiate-provider-payout.functions.ts` avant tout appel, indépendamment
   du drapeau en base (défense en profondeur : si le drapeau était activé
   par erreur avant que les secrets existent, cette vérification bloque
   quand même l'appel). Pour MonCash, reflète la présence réelle des 5
   variables d'environnement ci-dessous.
3. **Les méthodes elles-mêmes** — même une fois `isConfigured()` vrai (les
   5 secrets présents), `initiatePayment()`/`checkStatus()`/
   `cancelPayment()`/`verifyWebhook()` renvoient aujourd'hui un échec
   explicite ("intégration pas encore écrite"). C'est volontaire : voir
   [Ce qui n'est PAS fait](#ce-qui-nest-pas-fait-volontairement) plus bas.

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

| Variable | Description | Où l'obtenir |
|---|---|---|
| `MONCASH_CLIENT_ID` | Identifiant client OAuth2 de l'application MonCash Business | Portail développeur MonCash/Digicel, après création d'une application |
| `MONCASH_CLIENT_SECRET` | Secret associé au client ID — permet d'obtenir un jeton d'accès OAuth2 | Idem, affiché une seule fois à la création — le régénérer révoque l'ancien |
| `MONCASH_MERCHANT_ID` | Identifiant du compte marchand MonCash de NK Deliveri | Contrat marchand signé avec Digicel/MonCash |
| `MONCASH_API_URL` | URL de base de l'API (sandbox ou production — MonCash distingue les deux) | Documentation MonCash — **ne jamais pointer la production vers l'URL sandbox ou inversement** |
| `MONCASH_WEBHOOK_SECRET` | Secret utilisé pour vérifier la signature des webhooks entrants (notifications asynchrones de MonCash) | Portail développeur MonCash, section webhooks |

Toutes sont **server-only** — jamais de variante `VITE_*`, jamais commitées
(voir [`.env.example`](../.env.example) pour les placeholders et
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
   `process.env`.
4. **Activer réellement le provider** (seulement une fois
   [la vraie intégration API écrite](#ce-qui-nest-pas-fait-volontairement)) :
   passer `payment_providers.moncash_api.is_active` à `true` en base — un
   `UPDATE` simple, pas une migration de schéma. Tant que ce n'est pas
   fait, le provider reste invisible dans l'UI admin même avec des secrets
   valides.

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

## Ce qui n'est PAS fait (volontairement)

- **Aucun appel HTTP réel vers MonCash n'est implémenté.** L'audit
  d'intégration préalable (voir historique du projet) a identifié un point
  non résolu : l'API publique de MonCash est historiquement une passerelle
  de **collecte** marchande (client → marchand), pas confirmée pour du
  **décaissement** B2C arbitraire (marchand → numéro de téléphone
  quelconque), qui est le besoin réel ici. Écrire un appel HTTP contre un
  contrat d'API non confirmé serait plus risqué qu'utile — les 4 méthodes
  de `moncashProvider` renvoient donc un échec explicite et traçable
  plutôt qu'un comportement inventé.
- **Aucune route webhook n'existe.** `verifyWebhook()` est déjà présent
  dans l'interface (prêt à recevoir une vérification de signature HMAC une
  fois le format réel des webhooks MonCash confirmé), mais aucun endpoint
  HTTP ne reçoit encore de requêtes entrantes de MonCash — à créer comme
  route TanStack Start dédiée (`src/routes/api.webhooks.moncash.ts` ou
  équivalent) le jour où l'intégration réelle est écrite.
- **`NatCash`** n'a aucun secret configuré (aucune variable
  `NATCASH_*` n'existe) — hors périmètre de ce document, `natcashProvider`
  reste un stub non configurable.

Activer réellement MonCash nécessite, dans l'ordre : (1) confirmation
écrite du contrat d'API B2C avec Digicel/MonCash, (2) implémentation des 4
méthodes dans `moncash-provider.server.ts` contre ce contrat confirmé, (3)
une route webhook, (4) tests contre l'environnement sandbox MonCash, (5)
seulement alors, `payment_providers.moncash_api.is_active = true`. Ce
document prépare les étapes (0) — gestion des secrets — sans en présumer
le calendrier.
