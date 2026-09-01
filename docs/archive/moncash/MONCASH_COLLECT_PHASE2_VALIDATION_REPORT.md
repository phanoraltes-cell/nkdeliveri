# MonCash Collect — Phase 2 Validation & Hardening Report

Validation complète du module Collect (Phase 1) avant application de la
migration et activation en production. **2 bugs réels trouvés et
corrigés** au cours de cette validation — voir §6. `npm run verify`
vert (47/47 tests, typecheck/lint/migrations/build). **Rien commité,
rien poussé, aucune migration appliquée.**

## 1. Tests Backend — `initiate-collect-payment`

`createServerFn` s'invoque mal isolément dans un test (import qui
draine le runtime serveur de TanStack Start et bloque 5000ms hors
d'une vraie requête HTTP) — la logique a donc été extraite dans
[`initiate-collect-payment.logic.ts`](../../../src/lib/initiate-collect-payment.logic.ts)
(aucun `createServerFn`, testable directement), et
[`initiate-collect-payment.functions.ts`](../../../src/lib/initiate-collect-payment.functions.ts)
est redevenu un wrapper d'une ligne. Comportement identique, refactor
pur pour la testabilité.

[`initiate-collect-payment.test.ts`](../../../src/lib/__tests__/initiate-collect-payment.test.ts)
— 8 tests, `moncashProvider` mocké (aucun appel réseau réel) :

| Cas demandé                | Couverture                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paiement créé correctement | ✅ `outcome:"pending"` + `redirectUrl` retournés, `initiatePayment` appelé avec `{direction:"collect", amount:500}`                                             |
| Erreur API MonCash         | ✅ rejet du provider rapporté honnêtement (jamais une exception brute), enregistré via `create_collect_payment_secure(_status:"failed")`                        |
| Timeout                    | ✅ une erreur `code:"timeout"` traitée exactement comme tout autre rejet                                                                                        |
| Retry                      | ✅ `initiatePayment` appelé exactement 1 fois par invocation — aucun retry côté client, c'est le rôle du connecteur (déjà couvert par `moncash-client.test.ts`) |
| Absence de secret exposé   | ✅ `JSON.stringify(result)` ne contient jamais le `paymentToken` du mock ; les clés retournées sont exactement `outcome/redirectUrl/transaction`                |

3 tests bonus : paiement introuvable, méthode non-MonCash rejetée sans
appeler le provider, provider non configuré rejeté sans l'appeler.

## 2. Validation RPC (transactionnelle, `BEGIN…ROLLBACK`)

Migration entière (table, 2 RPC, RLS, publication realtime) inlinée
dans une transaction, exécutée pour de vrai contre la base liée, puis
annulée — même technique que pour les triggers d'immutabilité de
`moncash_api_logs` côté décaissement. Fixtures : 2 vrais ids
`auth.users` (un "propriétaire", un "autre utilisateur" — qui se
trouve être le compte admin déjà utilisé pour la simulation JWT dans
ce chantier).

**`create_collect_payment_secure` — 11/11 assertions ✅** (voir
[phase2_rpc_validation.sql](#annexe-scripts) en annexe) :

| Cas                                            | Résultat                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Propriétaire commande valide                   | ✅ ligne créée, `status='pending'`, `amount=500.00`                                                                                                                                                          |
| Tentative déjà en cours (bonus)                | ✅ rejetée — `"Yon tantativ peman deja an kou pou kòmand sa a"`                                                                                                                                              |
| Utilisateur non autorisé                       | ✅ rejetée — `"Payment not found"` (même message qu'une référence inexistante, aucune fuite d'information sur l'existence de la commande)                                                                    |
| Montant incorrect                              | **N/A par conception** — aucun paramètre `_amount` n'existe ; le montant est toujours lu server-side depuis `payments.amount`, jamais accepté du client. Force structurelle, pas une validation d'exécution. |
| Commande déjà payée                            | ✅ rejetée — `"Peman sa a deja an kou trete"`                                                                                                                                                                |
| GRANT `authenticated`=oui / `anon`=non (bonus) | ✅ confirmé via `has_function_privilege`                                                                                                                                                                     |

**`complete_collect_payment_secure` — résultats après correction du
bug §6.1** :

| Cas                | Résultat                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook valide     | ✅ `payment_transactions.status='paid'` **et** `payments.status='paid'` (le trigger existant `trg_notify_payment_status` se déclenche via cette même UPDATE)                                                                                                                                                                                |
| Webhook doublé     | ✅ idempotent — même résultat retourné, **0 ligne d'audit dupliquée** (`audit_log` reste à 1 ligne pour ce paiement après 2 appels identiques)                                                                                                                                                                                              |
| Référence inconnue | ✅ exception explicite `SQLSTATE P0002`, jamais un faux succès silencieux                                                                                                                                                                                                                                                                   |
| Signature invalide | **N/A au niveau RPC** — la vérification de signature se fait une couche au-dessus, dans `moncash-collect-webhook-handler.server.ts` (déjà testée unitairement, 7 tests). La seule défense de ce RPC est d'être verrouillé `service_role` — vérifié en direct : `authenticated`=EXECUTE non, `anon`=EXECUTE non, `service_role`=EXECUTE oui. |

**Publication realtime** : `ALTER PUBLICATION supabase_realtime ADD
TABLE public.payments` confirmé actif pendant la transaction
(`pg_publication_tables` → 1 ligne), absent avant/après (confirmé par
une requête séparée après le `ROLLBACK`).

**Effets permanents après `ROLLBACK`** : zéro. Requête de contrôle
post-transaction : 0 restaurant/commande/paiement de test, table
`payment_transactions` inexistante, `payments` absente de la
publication — exactement l'état d'avant le script.

## 3. Validation RLS (script séparé, même technique transactionnelle)

**4/4 assertions ✅** :

| Cas                                                    | Résultat                                                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le propriétaire voit sa propre ligne                   | ✅ 1 ligne                                                                                                                                                |
| Le propriétaire ne voit PAS la ligne d'un autre client | ✅ 0 ligne                                                                                                                                                |
| Un admin voit toutes les lignes                        | ✅ 2/2 lignes (testé avec un vrai compte admin)                                                                                                           |
| `anon` (aucun JWT)                                     | ✅ bloqué — `permission denied for table payment_transactions` (le `REVOKE ALL ... FROM PUBLIC, anon` fait son travail avant même que RLS n'entre en jeu) |

## 4. Validation Realtime

- **Un seul point de souscription** dans tout le code :
  [`orders.$id.tsx:76`](../../../src/routes/orders.$id.tsx)
  — `useRealtimeTableSync("payments", \`order_id=eq.${id}\`, [["order", id]])`.
Grep confirmé : aucune autre souscription à `payments`nulle part
ailleurs (le seul autre`supabase.channel()`du code est`order-chat-thread.tsx`, un canal broadcast sans rapport).
- **Pas de double souscription possible** : le hook génère une clé de
  canal unique par commande (`realtime-sync-payments-order_id=eq.<id>`)
  et nettoie via `supabase.removeChannel()` au démontage
  (`useEffect` cleanup). Le hook est appelé une seule fois,
  inconditionnellement, avant les `return` anticipés du composant
  (respect des Rules of Hooks, déjà commenté dans le fichier).
- **La mise à jour de page fonctionne réellement** : `payments` est
  bien dans `supabase_realtime` (§2) ; `complete_collect_payment_secure`
  modifie `payments.status` dans la même transaction que
  `payment_transactions.status` ; le filtre `order_id=eq.<id>` porte
  sur une colonne `NOT NULL` toujours présente dans la ligne "NEW" d'un
  `UPDATE` (indépendant de `REPLICA IDENTITY`) — aucun angle mort.

## 5. Validation sécurité

| Contrôle                   | Résultat                                                                                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS `payment_transactions` | Vérifié en direct — §3                                                                                                                                                                                                                                                           |
| Permissions RPC            | Vérifiées en direct via `has_function_privilege` — §2                                                                                                                                                                                                                            |
| Logs                       | `sanitizeWebhookPayload()` — liste blanche stricte (`message`, `status`, `amount`, `transaction_id`, `order_id`), jamais le payload brut, relu et confirmé inchangé                                                                                                              |
| Secrets                    | Build de production inspecté : aucun fichier lié à Collect (`moncash-collect-webhook-handler.server`, `initiate-collect-payment.logic`, `moncash-provider.server`) n'apparaît dans `.vercel/output/static` (bundle client) — présents uniquement dans `_ssr` (fonctions serveur) |
| Protection replay          | Mécanisme = garde d'idempotence du RPC (`UPDATE … WHERE status='pending'`), pas un schéma nonce/horodatage — testé directement (§2, "webhook doublé"), 0 effet dupliqué                                                                                                          |
| Doc obsolète (mineur)      | `api.webhooks.moncash.collect.ts` référençait un fichier `MONCASH_COLLECT_SECURITY_REPORT.md` inexistant — corrigé pour pointer vers les rapports Phase 1/Phase 2 réels                                                                                                          |

## 6. Bugs trouvés et corrigés pendant cette validation

### 6.1 — `complete_collect_payment_secure` : cast enum manquant (critique)

`UPDATE public.payments SET status = _decision` échouait
systématiquement (`_decision` est `text`, `payments.status` est
l'enum `payment_status` — Postgres ne caste pas implicitement une
_variable_ text vers un enum, seulement un littéral). **Ce bug
n'avait jamais été détecté** car aucun test précédent n'exécutait
réellement ce RPC contre une base — c'est exactement le rôle de cette
phase de validation. Sans correction, **100% des paiements collect
réels auraient échoué à se finaliser**, quelle que soit l'issue
MonCash. Corrigé : `_decision::payment_status`. Confirmé par le
script transactionnel (§2, avant/après).

### 6.2 — `checkout.tsx` : risque de commande dupliquée (majeur)

Si `create_order_secure` réussissait mais que
`initiateCollectPayment` échouait ensuite (API MonCash indisponible,
timeout…), le code levait une exception sans vider le panier ni
naviguer — le client restait sur le formulaire de checkout avec son
panier intact et pouvait cliquer "Confirmer" à nouveau, créant une
**deuxième commande** pour le même panier (la première, déjà créée,
restant orpheline). Corrigé : dans tous les cas d'échec après création
de la commande, le panier est vidé et le client est redirigé vers
`orders.$id.tsx`, qui affiche déjà un état clair
("Peman otomatik la pa t reyisi…").

## 7. Risques restants (non corrigés, hors bug critique)

- **Pas de bouton "réessayer" sur `orders.$id.tsx`** pour un paiement
  collect en état `failed` — la page affiche le message mais
  n'offre aucune action pour relancer `initiateCollectPayment`
  depuis là. Le client doit contacter le support ou repasser par une
  nouvelle commande. Recommandé pour un futur incrément, hors du
  périmètre "ne pas modifier l'architecture sauf bug critique" de
  cette phase.
- **Aucun test de bout-en-bout avec de vrais identifiants MonCash** —
  toujours vrai, comme documenté en Phase 1 : aucun compte sandbox
  MonCash n'existe pour ce projet.
- **Le format exact des webhooks MonCash reste non confirmé
  publiquement** — la protection replay repose sur l'idempotence du
  RPC (solide et testée), pas sur un schéma nonce/horodatage propre au
  fournisseur, comme déjà noté en Phase 1.

## 8. Recommandation Go/No-Go

**GO — sous réserve d'application de la migration corrigée.**

Les deux bugs trouvés étaient réels et auraient cassé la fonctionnalité
(6.1, critique) ou créé un risque opérationnel concret pour le support
(6.2). Les deux sont corrigés et re-vérifiés en direct. Le reste de la
conception (RLS, permissions, idempotence, séparation stricte d'avec
le décaissement) tient face à des tests transactionnels réels, pas
seulement une relecture de code.

**Avant activation** :

1. Appliquer `supabase/migrations/20260731130000_moncash_collect_payments.sql`
   (version corrigée, §6.1) — sur confirmation explicite.
2. Committer et pousser (rapport fourni, comme requis).
3. Configurer un vrai compte marchand MonCash pour un test bout-en-bout
   réel avant d'annoncer la fonctionnalité aux clients.

## Annexe — scripts

Scripts de validation transactionnels (non committés, usage unique,
zéro effet permanent confirmé après exécution) :

- `phase2_rpc_validation.sql` — §2
- `phase2_rls_validation.sql` — §3
