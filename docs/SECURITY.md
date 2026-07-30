# Sécurité applicative — NK Deliveri

Ce document couvre la sécurité **au niveau du code applicatif** : modèle
d'autorisation, validation des entrées, gestion des secrets côté
application, protection contre les abus. Pour la sécurité
**infrastructure** (en-têtes HTTP, permissions Vercel/GitHub/Supabase,
audit RLS/RPC/buckets ligne par ligne), voir
[SECURITY_INFRASTRUCTURE.md](./SECURITY_INFRASTRUCTURE.md), qui reste la
référence pour ces aspects et n'est pas dupliquée ici.

## Modèle d'autorisation (défense en profondeur)

Trois couches indépendantes, détaillées dans
[ARCHITECTURE.md § Autorisation à trois niveaux](./ARCHITECTURE.md#autorisation-à-trois-niveaux) :
RLS Postgres, RPC `SECURITY DEFINER`, garde de route côté client. La
garde côté client est une commodité UX — **la sécurité réelle vit
entièrement dans Postgres** (RLS + RPC). Toute nouvelle fonctionnalité doit
partir de ce principe : si une policy RLS ou une vérification dans un RPC
manque, aucune garde React ne compense, car l'API REST Supabase reste
directement accessible avec le token de n'importe quel utilisateur
authentifié.

## Authentification

- Supabase Auth (email/mot de passe + Google OAuth). Le JWT de session est
  porté par le navigateur (`localStorage`), attaché aux appels de fonction
  serveur par `attachSupabaseAuth`, vérifié côté serveur par
  `requireSupabaseAuth` (`supabase.auth.getClaims(token)`) — voir
  [SUPABASE.md](./SUPABASE.md).
- **`requireSupabaseAuth` rejette explicitement** : absence d'en-tête
  `Authorization`, en-tête non `Bearer`, token vide, ou token qui n'a pas
  la forme d'un JWT (3 segments séparés par des points) — avant même
  d'appeler Supabase pour la vérification cryptographique.
- **Bootstrap du premier compte admin** : `public.handle_new_user()` (déclenché
  à l'inscription) et `public.grant_admin_on_confirm()` (déclenché à la
  confirmation d'e-mail) contiennent tous deux une règle identique :
  accorder automatiquement le rôle `admin` à l'adresse e-mail codée en dur
  du porteur du projet, **uniquement si aucun `admin`/`super_admin` n'existe
  encore** (`NOT EXISTS (SELECT 1 FROM user_roles WHERE role IN
  ('admin','super_admin'))`). C'est un mécanisme d'amorçage à usage unique
  qui se désactive lui-même dès qu'un premier admin existe — il ne
  constitue pas une porte dérobée permanente. Toute évolution de ce
  mécanisme doit préserver cette clause d'auto-désactivation.

## Validation des entrées

- **Fonctions serveur** (`createServerFn`) : chaque entrée est validée par
  un schéma Zod avant d'atteindre le handler — voir
  [API.md § Fonctions serveur](./API.md#2-fonctions-serveur-tanstack-start)
  pour le détail des schémas.
- **RPC Postgres** : la validation métier (longueur minimale de texte,
  transitions de statut légales, appartenance restaurant/commande) est
  faite en PL/pgSQL à l'intérieur de chaque fonction `..._secure`, pas
  côté client — un client malveillant appelant directement l'API REST
  avec un payload fabriqué de toutes pièces rencontre les mêmes
  vérifications qu'un appel légitime depuis l'UI.
- **Commandes** : `create_order_secure` recalcule le prix côté serveur à
  partir des données `products` en base — les prix envoyés par le client
  ne sont jamais approuvés tels quels (voir
  [API.md § Fonctions RPC Postgres](./API.md#1-fonctions-rpc-postgres)).

## Rate limiting

`check_rate_limit_secure` (compteur à fenêtre fixe dans
`private.rate_limit_hits`, table inaccessible hors RPC) protège les
opérations sensibles aux abus : création de commande, réclamation de
livraison, soumission de preuve de paiement, ajout d'employé, demande de
remboursement, ouverture de litige, message de litige, envoi de push de
revue de paiement. Voir la liste complète avec les limites exactes dans
[API.md](./API.md). Un dépassement renvoie systématiquement un message
utilisateur en kreyòl, jamais une erreur technique brute.

## Upload de fichiers

`src/lib/file-validation.ts` (`IMAGE_MIME_TYPES`, `DOCUMENT_MIME_TYPES`,
`UPLOAD_LIMITS`, `validateUploadFile`/`assertValidUploadFile`) valide type
MIME et taille **côté client avant l'upload**, en miroir exact des limites
réellement appliquées par les buckets Supabase Storage
(`file_size_limit`/`allowed_mime_types`, voir
[DATABASE.md § Buckets](./DATABASE.md#5-buckets-de-stockage-storage)). La
validation côté client est un confort UX (retour immédiat) — la limite
réelle est appliquée par Supabase Storage lui-même côté serveur, donc un
contournement de la validation client échouerait quand même à l'upload.

## Secrets et variables d'environnement

- Aucun secret n'est jamais commité — voir
  [ENVIRONMENTS.md](./ENVIRONMENTS.md) et [`.env.example`](../.env.example)
  pour la liste complète documentée des variables attendues.
- `SUPABASE_SERVICE_ROLE_KEY` (contourne RLS) n'est utilisée que dans
  `client.server.ts`/`*.server.ts` et à l'intérieur de handlers de
  fonctions serveur via `import()` dynamique — jamais dans un fichier qui
  finit dans le bundle client. Voir
  [ARCHITECTURE.md § Frontière client/serveur](./ARCHITECTURE.md#frontière-client--serveur).
- `VAPID_PRIVATE_JWK` (clé privée Web Push) suit la même règle — chargée
  dynamiquement à l'intérieur de `pushToUsers`/`sendPaymentReviewPush`, pas
  importée statiquement.
- `MONCASH_CLIENT_ID`/`MONCASH_CLIENT_SECRET`/`MONCASH_MERCHANT_ID`/
  `MONCASH_API_URL`/`MONCASH_WEBHOOK_SECRET` suivent la même règle —
  lus exclusivement par `payment-providers/moncash-config.server.ts`,
  jamais importés hors d'un module `.server.ts`. Voir
  [PAYMENT_PROVIDERS.md](./PAYMENT_PROVIDERS.md) pour la procédure de
  configuration et de rotation complète.

## Observabilité et confidentialité (Sentry)

`src/lib/sentry.server.ts`/`sentry-browser.ts` : Sentry est **no-op tant
qu'aucun DSN n'est configuré** (`SENTRY_DSN`/`VITE_SENTRY_DSN`). Lorsqu'il
est actif :
- `sendDefaultPii: false` — aucune donnée personnelle identifiable
  automatique.
- `beforeSend` retire explicitement cookies, en-têtes d'authentification,
  corps de requête et objet utilisateur avant tout envoi à Sentry.
- Cette configuration doit être préservée lors de toute évolution — Sentry
  ne doit jamais recevoir de token de session, de numéro de téléphone ou
  d'adresse de livraison.

## En-têtes de sécurité HTTP et CSP

Voir [SECURITY_INFRASTRUCTURE.md § En-têtes HTTP](./SECURITY_INFRASTRUCTURE.md#en-têtes-http---vérifié)
pour la Content-Security-Policy complète (`vercel.json`) — note connue et
acceptée : `'unsafe-inline'` reste nécessaire pour `script-src`/`style-src`
tant que les dépendances (Radix UI, Leaflet) injectent du style inline.

## Dépendances

Voir [DEPENDENCIES.md](./DEPENDENCIES.md) pour la procédure d'audit
(`npm audit`) et l'état des dépendances au moment de la Phase 6.

## Ce qui n'est PAS couvert ici

- L'audit ligne par ligne de chaque policy RLS (déjà fait dans
  [DATABASE.md](./DATABASE.md) et
  [SECURITY_INFRASTRUCTURE.md](./SECURITY_INFRASTRUCTURE.md)).
- Les permissions d'accès humain (Vercel, GitHub, Supabase Studio) — hors
  du code, voir [SECURITY_INFRASTRUCTURE.md § À vérifier manuellement](./SECURITY_INFRASTRUCTURE.md#à-vérifier-manuellement-hors-accès-de-cette-session).
- Les tests de pénétration — aucun n'a été réalisé sur ce projet à ce jour.
