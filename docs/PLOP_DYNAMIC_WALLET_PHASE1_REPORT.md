# NK Deliveri — PLOP Dynamic Wallet Selection — Phase 1 Remediation

**Date** : 2026-08-04
**Portée** : correction du bug identifié dans `docs/PLOP_MULTIWALLET_PHASE0_AUDIT.md` § 2 (dépendance transactionnelle à `PLOP_PAYMENT_METHOD`) — **uniquement ce problème**, comme demandé. Code écrit et vérifié. **Migration écrite, non appliquée. Aucun commit.**

---

## 1. Analyse avant modification

| Fichier | Constat avant correction |
|---|---|
| `plop-client.server.ts::createPayment()` | Lisait `payment_method` **exclusivement** depuis `getPlopConfig().paymentMethod` (variable d'env `PLOP_PAYMENT_METHOD`, une seule valeur pour toute l'application). Aucun paramètre par appel. |
| `plop-client.server.ts::verifyPayment()` | Ne capturait pas le champ `method` que PLOP retourne pourtant dans `paiement-verify` (confirmé de nouveau dans le PDF fourni, page 3) — présent uniquement dans `raw`, jamais un champ typé. |
| `plop-provider.server.ts::initiatePayment()`/`checkStatus()` | Ne recevaient et ne propageaient aucune information de wallet — appelaient `createPayment(reference, amount)`/`verifyPayment(reference)` sans possibilité de préciser ou de récupérer le wallet. |
| `initiate-collect-payment.logic.ts` | Appelait `plopProvider.initiatePayment({direction, amount, reference})` sans jamais transmettre `payment.method`. La porte `payment.method !== "moncash"` (business, Option B de l'audit) **reste inchangée** — hors périmètre de cette correction. |
| `payment_transactions` | Aucune colonne pour distinguer ce qui a été **demandé** de ce qui a été **réellement utilisé** par le client sur la page PLOP. |
| ENUM `public.payment_method` | Confirmé de nouveau (`stripe`,`moncash`,`natcash`,`kach`) — `kashpaw` absent, aucun changement nécessaire pour cette correction puisque le flux métier continue de ne créer que des paiements `moncash` (§ 6). |

---

## 2. Corrections appliquées

### 2.1 `payment-providers/types.ts`
- `InitiatePaymentInput.paymentMethod?: string` — hint optionnel par appel, ignoré par les autres providers (MonCash Digicel, NatCash, manuel).
- `InitiatePaymentResult`/`PaymentStatusResult` (variante `success`) : `walletUsed?: string | null`.
- `InitiatePaymentResult` (variante `failed`) : nouveau `code?: "invalid_wallet"`.

### 2.2 `plop-client.server.ts`
- `VALID_PAYMENT_METHODS = ["moncash","kashpaw","natcash","all"]` + `isValidPaymentMethod()` (exportée) — la liste documentée par PLOP, aucune valeur devinée.
- `createPayment(reference, amountHtg, paymentMethod?)` — **le paramètre l'emporte sur la config globale**, qui ne sert plus que de valeur par défaut si aucun paramètre n'est fourni. Validation **avant tout appel réseau** — un wallet invalide lève un `PlopApiError` immédiat, jamais transmis à PLOP.
- `PlopCreatePaymentResult.paymentMethodRequested` — trace ce qui a réellement été envoyé (utile pour propager vers `payment_method_requested`, § 2.4).
- `verifyPayment()` — capture désormais `data.method` → `PlopVerifyResult.walletUsed` (`string | null`).

### 2.3 `plop-provider.server.ts`
- `initiatePayment()` : valide `input.paymentMethod` **avant** le `try/catch` — un wallet invalide retourne `{status:"failed", code:"invalid_wallet"}` immédiatement, **sans jamais déclencher la réconciliation-sur-échec (A1)**, qui n'aurait aucun sens pour une requête jamais envoyée. Transmet `input.paymentMethod` à `createPayment()`.
- `checkStatus()` et la branche de réconciliation A1 : propagent désormais `walletUsed` depuis `verifyPayment()`.

### 2.4 `initiate-collect-payment.logic.ts`
- `plopProvider.initiatePayment({..., paymentMethod: payment.method})` — le rail réellement demandé par la commande est transmis, au lieu de laisser `plop-client.server.ts` retomber sur sa config globale.
- `_payment_method_requested: payment.method` ajouté aux **4** appels de `create_collect_payment_secure` de ce fichier (fournisseur désactivé, non configuré, rejeté, et création réussie/pending).
- **La porte métier `payment.method !== "moncash"` n'a pas été touchée** — décision de périmètre distincte (Option B de l'audit), pas un bug.

### 2.5 `plop-reconcile.server.ts` / `poll-collect-payment.logic.ts`
- Les deux points de finalisation (cron quotidien et poll client) transmettent désormais `_payment_method_used` (depuis `status.walletUsed`/`walletUsed`) à `complete_collect_payment_secure`.

---

## 3. Audit d'impact ENUM `payment_method`

Reconfirmé (§ 1) : `CREATE TYPE public.payment_method AS ENUM ('stripe','moncash','natcash','kach')`. **Cette correction ne le touche pas** — `payment.method` continue de ne valoir que `'moncash'` à l'endroit où PLOP est appelé (la porte métier gate toujours ainsi). La capacité technique de transmettre `'natcash'` existe désormais dans `plop-client.server.ts`/`plop-provider.server.ts` (testée, § 5), mais **rien dans le flux métier actuel ne peut encore l'exercer** — elle attend une décision produit (Option B), pas cette correction.

---

## 4. Migration SQL proposée (écrite, **non appliquée**)

`supabase/migrations/20260804130000_plop_wallet_traceability.sql` :
- `ALTER TABLE payment_transactions ADD COLUMN payment_method_requested text, ADD COLUMN payment_method_used text` — purement additif, `NULL` par défaut, aucune ligne existante modifiée.
- `create_collect_payment_secure` — nouveau paramètre `_payment_method_requested text DEFAULT NULL`. **`DROP FUNCTION IF EXISTS` (ancienne signature 4 arguments) exécuté avant le `CREATE OR REPLACE`** (signature 5 arguments) — évite la création d'une surcharge silencieuse (hazard documenté dans `docs/MIGRATIONS.md`, vérifié par `npm run check:migrations` : **0 hazard non résolu**).
- `complete_collect_payment_secure` — même traitement, nouveau paramètre `_payment_method_used text DEFAULT NULL`.
- Corps des deux fonctions **identique à l'original** (`20260731130000_moncash_collect_payments.sql`) en dehors du nouveau paramètre et de son utilisation dans `INSERT`/`UPDATE` — aucune autre logique modifiée (permissions `RLS`/`GRANT`/notifications inchangées).

**Non appliquée** — ni `supabase db push`, ni aucune commande n'a touché la base de données distante dans cette phase, conformément à l'instruction explicite.

---

## 5. Résultats des tests

| Suite | Avant | Après |
|---|---|---|
| `npx vitest run` | 91 tests | **98 tests, tous verts** |
| `npm run typecheck` | — | Propre |
| `npm run lint` | 0 erreur | 0 erreur (mêmes avertissements préexistants, sans rapport) |
| `npx vite build` | — | Réussi |
| `npm run check:migrations` | — | **117 migrations scannées, 0 hazard non résolu** |

**7 nouveaux tests, exactement les 3 cas demandés + couverture des points de propagation** :
- `plop-client.test.ts` : `createPayment(...,"natcash")` transmet bien `natcash` (✅ moncash), `createPayment(...,"moncash")` explicite (regression check), `createPayment(...,"bogus-wallet")` rejeté **avant tout appel réseau** (✅ invalid wallet) ; `verifyPayment` capture `walletUsed` (cas nominal, cas `natcash` différent du wallet demandé, cas absent → `null`).
- `plop-provider.test.ts` : `paymentMethod` transmis à `createPayment` ; wallet invalide retourne `code:"invalid_wallet"` **sans** appeler `createPayment`/`verifyPayment` (donc sans tenter de réconciliation) ; `walletUsed` propagé par `checkStatus()`.
- `initiate-collect-payment.test.ts` : `payment.method` transmis à `plopProvider.initiatePayment()` et à `create_collect_payment_secure` comme `_payment_method_requested`.
- `plop-reconcile.test.ts` : `walletUsed` propagé jusqu'à `_payment_method_used` sur `complete_collect_payment_secure`.

---

## 6. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `src/lib/payment-providers/types.ts` | Modifié |
| `src/lib/payment-providers/plop-client.server.ts` | Modifié |
| `src/lib/payment-providers/plop-provider.server.ts` | Modifié |
| `src/lib/initiate-collect-payment.logic.ts` | Modifié |
| `src/lib/payment-providers/plop-reconcile.server.ts` | Modifié |
| `src/lib/poll-collect-payment.logic.ts` | Modifié |
| `src/integrations/supabase/types.ts` | Modifié (à la main, en attendant l'application réelle de la migration — mêmes conventions que pour `plop_api_logs`, à régénérer pour de vrai après application) |
| `src/lib/payment-providers/__tests__/plop-client.test.ts` | Modifié (+7 tests) |
| `src/lib/payment-providers/__tests__/plop-provider.test.ts` | Modifié (+2 tests, 4 mocks corrigés) |
| `src/lib/payment-providers/__tests__/plop-reconcile.test.ts` | Modifié (assertions enrichies) |
| `src/lib/__tests__/initiate-collect-payment.test.ts` | Modifié (assertions enrichies) |
| `supabase/migrations/20260804130000_plop_wallet_traceability.sql` | **Nouveau — non appliqué** |

**Non touchés, comme exigé** : aucun fichier `*-provider.server.ts` pour MonCash/NatCash/KashPay (pas d'adapters créés), aucune route `/api/webhooks/plop` créée, `plop-reconcile.server.ts`/`orders.$id.tsx`/`useCollectPaymentPoll.ts` non modifiés au-delà du seul paramètre de finalisation (le workflow de polling lui-même — cadence, paliers, arrêt sur confirmation — est intact), `checkout.tsx` non touché (aucune option de wallet supplémentaire exposée au client), `index.server.ts` non touché.

---

## 7. Risques

| Niveau | Risque |
|---|---|
| **Faible** | Migration purement additive (2 colonnes nullable + 2 signatures de RPC étendues avec paramètres `DEFAULT NULL`) — aucun appelant existant ne casse tant que la migration n'est pas appliquée (les nouveaux paramètres sont optionnels dans le code TypeScript ; une fois appliquée, tout appelant qui omettrait le nouveau paramètre continuerait de fonctionner grâce au `DEFAULT NULL`). |
| **Faible** | `check-migration-hazards` confirme 0 surcharge — le `DROP FUNCTION IF EXISTS` avant chaque `CREATE OR REPLACE` a été appliqué correctement pour les deux RPC modifiées. |
| **Faible** | Tant que la migration n'est **pas** appliquée, `src/integrations/supabase/types.ts` référence des colonnes/paramètres qui n'existent pas encore côté base — écart identique à celui déjà rencontré et documenté pour `plop_api_logs` (Phase 2) ; le code applicatif qui les utilise (`_payment_method_requested`/`_payment_method_used`) échouera silencieusement de la même manière que l'avertissement `plop_api_logs` déjà observé (`console.warn`/erreur PostgREST "colonne introuvable") **si redéployé avant l'application de la migration** — best-effort là où c'est le cas (logs), mais **les appels RPC eux-mêmes échoueraient** (`create_collect_payment_secure`/`complete_collect_payment_secure` ne sont pas best-effort) tant que la migration n'est pas appliquée. **Ne pas déployer ce code en production avant d'avoir appliqué la migration.** |
| **Négligeable** | Le message d'erreur métier `'MonCash Automatik disponib sèlman pou peman MonCash'` à l'intérieur de `create_collect_payment_secure` (SQL) n'a pas été renommé en "Peman Otomatik" — laissé identique à l'original pour limiter le diff de cette correction ciblée, à traiter séparément si souhaité. |

---

## 8. Vérification des contraintes

| Contrainte | Respectée ? |
|---|---|
| Ne pas créer d'adapters MonCash/NatCash/Kashpaw | ✅ — aucun nouveau fichier provider, un seul client paramétré |
| Ne pas créer de webhook | ✅ — `/api/webhooks/plop` n'existe pas et n'a pas été créé |
| Ne pas modifier le workflow polling existant | ✅ — `useCollectPaymentPoll.ts` intact, seule la donnée transmise à la RPC de finalisation a changé |
| Ne pas appliquer les migrations automatiquement | ✅ — migration écrite uniquement, `supabase db push` **non exécuté** |
| Ne pas commit | ✅ — aucun `git add`/`git commit` exécuté |

---

**En attente de votre revue avant application de la migration et commit.**
