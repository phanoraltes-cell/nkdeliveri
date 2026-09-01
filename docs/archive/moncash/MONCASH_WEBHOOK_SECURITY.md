# Rapport de sécurité — Webhook MonCash

Audit du endpoint `POST /api/webhooks/moncash` et de tout ce qu'il touche
(`src/routes/api.webhooks.moncash.ts`,
`src/lib/payment-providers/moncash-webhook-handler.server.ts`,
`moncash-provider.server.ts` § `verifyWebhook`, et la migration
`20260730100000_moncash_webhook_payout_lifecycle.sql`). Voir
[PAYMENT_PROVIDERS.md](../../reference/PAYMENT_PROVIDERS.md) pour l'architecture
générale du connecteur MonCash.

## Score de sécurité : 78/100

Note volontairement non maximale — deux points restent explicitement non
résolus (signature non confirmée par la documentation publique MonCash,
absence de rate limiting au niveau du endpoint) et sont listés ci-dessous
avec leur justification, pas masqués derrière un score flatteur.

## Résumé de l'architecture

```
MonCash ──POST──▶ /api/webhooks/moncash (route publique, aucune session)
                        │
                        ▼
          moncashProvider.verifyWebhook(rawBody, headers)
          (HMAC-SHA256 sur le corps brut + parsing)
                        │
                 signature invalide ──▶ 401, ligne "rejected" journalisée
                        │ valide
                        ▼
          moncash_webhook_events (INSERT, UNIQUE(event_id))
                        │
                 doublon (23505) ──▶ 200, aucun traitement
                        │ nouveau
                        ▼
     complete_pending_payout_secure / fail_pending_payout_secure
     (RPC SECURITY DEFINER, GRANT service_role UNIQUEMENT)
                        │
                        ▼
        payouts + wallets + wallet_transactions + notifications
        (mise à jour atomique, FOR UPDATE, idempotente)
                        │
                        ▼
              push notification (best-effort, non bloquant)
```

## Constat central : ce endpoint est aujourd'hui inerte par construction

`complete_pending_payout_secure`/`fail_pending_payout_secure` n'agissent
que sur une ligne `payouts` avec `status = 'pending'`. Une telle ligne ne
peut exister que si `create_pending_payout_secure` a été appelée, qui
elle-même ne peut être atteinte que si `moncashProvider.initiatePayment()`
retourne `status: "pending"` — **impossible aujourd'hui** pour
`direction: "disburse"` (le seul appel que fait le flux de décaissement),
qui échoue toujours immédiatement (voir
[PAYMENT_PROVIDERS.md § Ce qui n'est PAS fait](../../reference/PAYMENT_PROVIDERS.md#ce-qui-nest-pas-fait-volontairement)).

**Conséquence vérifiée** : même un appel malveillant avec une signature
valide (si le secret venait à fuiter) ne peut aujourd'hui provoquer
aucun mouvement d'argent — `complete_pending_payout_secure` lève
`'Pa gen okenn peman an atant pou referans sa a'` pour toute référence,
puisqu'aucune ligne `'pending'` n'existe jamais. C'est une propriété de
sécurité réelle et vérifiable, pas une supposition — elle tient tant que
`create_pending_payout_secure` reste sans appelant vivant, exactement
comme documenté dans PAYMENT_PROVIDERS.md.

## Vulnérabilités et constats, classés par sévérité

### Critique — aucun

### Haute — aucun

### Moyenne

**M1. Aucun rate limiting au niveau du endpoint HTTP.**
`check_rate_limit_secure` (utilisé partout ailleurs dans ce schéma) est
indexé sur `auth.uid()` — inapplicable ici, un webhook n'a pas de
session utilisateur. Une requête à signature invalide est rejetée avant
tout appel RPC coûteux, mais écrit quand même une ligne dans
`moncash_webhook_events` pour la traçabilité (voir M2) — un flot de
requêtes non authentifiées reste donc capable de générer un volume
d'écritures DB soutenu.
**Recommandation** : activer une protection au niveau infrastructure
(Vercel Attack Challenge Mode / règle de rate limiting sur ce chemin),
pas une solution applicative — un compteur en mémoire serait fragile et
non fiable dans un environnement serverless multi-instance. Non
implémenté dans ce tour ; à traiter comme un suivi d'infrastructure,
voir [SECURITY_INFRASTRUCTURE.md](../../reference/SECURITY_INFRASTRUCTURE.md).

**M2. Le schéma exact du webhook MonCash (en-tête de signature, algorithme,
forme du payload) n'est pas confirmé par la documentation publique.**
`verifySignature`/`parseWebhookPayload` implémentent la convention
générique la plus répandue (HMAC-SHA256 sur le corps brut, en-tête
`x-moncash-signature`, hex) — un choix explicite et documenté dans le
code (`moncash-provider.server.ts`), pas une donnée vérifiée. Le mode
d'échec est sûr par construction (une signature qui ne correspond pas au
schéma réel de MonCash est simplement rejetée — 401 — jamais acceptée à
tort), mais un vrai webhook MonCash ne sera pas traité tant que ce n'est
pas confirmé et, si besoin, corrigé.
**Recommandation** : vérifier avec la documentation développeur MonCash
(ou leur support) l'en-tête et l'algorithme réels avant d'activer quoi
que ce soit en production.

### Faible

**F1. `deriveEventId` retombe sur un hash SHA-256 du corps brut quand
aucun identifiant explicite n'est présent dans le payload.** Deux
livraisons logiquement identiques avec un corps strictement identique
fusionnent correctement (c'est le but) ; mais si MonCash renvoie deux
fois le même évènement métier avec un corps légèrement différent (ex.
un timestamp qui change), chaque copie serait traitée comme un nouvel
évènement. Le second passage resterait sûr grâce à l'idempotence de
`complete_pending_payout_secure`/`fail_pending_payout_secure` elles-mêmes
(vérification `status <> 'pending'`), donc aucun double mouvement
financier n'est possible — seule une entrée dupliquée dans
`moncash_webhook_events` en résulterait. Accepté tel quel : impossible à
mieux garantir sans connaître le format réel du payload.

**F2. Pas de vérification d'origine réseau (allowlist IP MonCash).**
MonCash ne publie pas d'IP fixes documentées pour ses webhooks à ma
connaissance ; la signature reste la seule barrière. Standard pour ce
type d'intégration (Stripe/PayPal fonctionnent pareillement), pas traité
comme un gap en soi.

## Contrôles vérifiés (ce qui va bien)

- **Frontière client/serveur** : `moncash-webhook-handler.server.ts` et
  `moncash-provider.server.ts` ne sont importés que dynamiquement
  (`await import(...)`) depuis le seul point d'entrée
  (`api.webhooks.moncash.ts`) — vérifié après build que ni le secret, ni
  la logique de signature, ni `complete_pending_payout_secure` n'apparaît
  dans `.vercel/output/static` (grep dédié sur les noms de fonctions, le
  nom d'en-tête `x-moncash-signature`, et `MONCASH_WEBHOOK_SECRET`).
- **Comparaison de signature en temps constant** — `timingSafeEqual`
  (Node `crypto`), pas `===`, pour éliminer une attaque par mesure de
  timing sur la comparaison elle-même. Vérification de longueur avant
  l'appel (évite l'exception que `timingSafeEqual` lève sur des buffers
  de tailles différentes plutôt que de la laisser remonter comme une
  erreur 500 non gérée).
- **Idempotence à deux niveaux indépendants** : `UNIQUE(event_id)` sur
  `moncash_webhook_events` (atomique, résiste aux livraisons concurrentes
  dupliquées) _et_ `IF v_row.status <> 'pending' THEN RETURN v_row` dans
  chacune des deux RPC de finalisation — une seconde application du même
  évènement (ou un bug dans la couche d'idempotence applicative) ne peut
  pas créditer/débiter deux fois un wallet.
- **Autorisation par GRANT, pas seulement par logique applicative** :
  `complete_pending_payout_secure`/`fail_pending_payout_secure` sont
  `REVOKE ALL ... FROM PUBLIC, authenticated, anon` puis
  `GRANT EXECUTE ... TO service_role` uniquement — vérifiable
  directement dans Postgres (`information_schema.role_routine_grants`),
  indépendant de toute vérification côté application. Un token JWT d'un
  admin authentifié, même dérobé, ne peut pas appeler ces fonctions via
  l'API REST Supabase.
- **Verrouillage de ligne (`FOR UPDATE`)** dans les 3 nouvelles RPC —
  aucune fenêtre de concurrence entre deux traitements simultanés du même
  payout.
- **Pas de mouvement de solde en double** : `create_pending_payout_secure`
  déplace `available_balance → pending_balance` une seule fois, à la
  création ; la confirmation ne fait plus bouger que le statut (ligne de
  ledger à delta zéro, uniquement pour la visibilité) ; l'échec renvoie
  exactement le même montant vers `available_balance`. Aucune RPC ne
  touche le solde d'un payout qui n'est plus `'pending'`.
- **Aucune donnée sensible dans les réponses d'erreur** — les messages
  renvoyés au client HTTP (`401`/`500`) ne contiennent jamais de valeur
  de secret, de token, ni de détail interne de la base (comparer à
  `getMonCashConfig()`, qui ne journalise déjà que les _noms_ de
  variables manquantes, jamais leurs valeurs).
- **Validation stricte du payload** avant tout usage — `JSON.parse` dans
  un `try/catch`, chaque champ revérifié par `typeof` avant lecture,
  jamais un payload non-conforme propagé tel quel dans une requête SQL
  (tous les appels passent par `.rpc()`/`.insert()` paramétrés — aucune
  concaténation de chaîne SQL nulle part dans ce flux).
- **Séparation notification bénéficiaire / notification admin** :
  `create_pending_payout_secure` ne notifie personne (rien n'a encore été
  envoyé) ; seule une confirmation _réelle_ déclenche la notification
  "vous avez reçu un paiement" au bénéficiaire ; un échec notifie l'admin
  qui a initié le paiement, jamais le bénéficiaire (qui n'a jamais été
  informé d'un paiement qui n'a finalement pas eu lieu).

## Ce qui n'a pas été testé (limite de cet audit)

Aucun test contre un vrai serveur MonCash n'a été possible — comme pour
le reste de l'intégration, aucun identifiant réel n'existe dans cet
environnement. Le chemin heureux (signature valide → paiement confirmé)
n'a été vérifié que par lecture de code et par le typecheck/build ; les
chemins d'erreur (signature invalide, doublon, payout introuvable) sont
couverts par construction (voir le code lui-même) mais pas par un test
d'intégration exécuté.

## Prochaines étapes recommandées, par ordre

1. Confirmer avec Digicel/MonCash le contrat B2C disbursement complet
   (préalable déjà documenté dans PAYMENT_PROVIDERS.md) — sans lui, ce
   webhook reste sans appelant légitime quel que soit son niveau de
   finition.
2. Confirmer le schéma réel du webhook (M2) et ajuster
   `SIGNATURE_HEADER`/`parseWebhookPayload` en conséquence.
3. Mettre en place une protection de rate limiting au niveau
   infrastructure sur `/api/webhooks/moncash` (M1).
4. Une fois 1–3 faits, écrire un test d'intégration contre l'environnement
   sandbox MonCash avant toute activation en production
   (`payment_providers.moncash_api.is_active = true`).
