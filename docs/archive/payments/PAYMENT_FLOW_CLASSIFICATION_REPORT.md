# 🔀 Correction — « MANUAL PAYMENT ≠ AUTOMATIC PAYMENT »

**Date** : 2026-08-13
**Périmètre** : exclusivement le bug de classification manuel/automatique du paiement lors de la confirmation de commande par le restaurant.
**Statut** : Root cause identifié et **prouvé** (reproduit puis corrigé en transaction annulée contre production), corrections frontend appliquées directement, migration SQL écrite et testée mais **PAS appliquée en production** — en attente de votre autorisation. Aucun commit, aucun push.

---

## 1. ROOT CAUSE

### Emplacement exact

**Fichier** : `supabase/migrations/...` → fonction live `private.update_order_status_secure` (confirmée via `pg_get_functiondef()` en direct contre la production, pas depuis un fichier de migration historique)
**Fonction** : `private.update_order_status_secure(_order_id, _new_status)`, branche `ELSIF v_is_restaurant_owner THEN`
**Condition fautive** :
```sql
IF v_allowed AND v_order.status = 'pending' AND _new_status = 'confirmed' AND EXISTS (
  SELECT 1 FROM public.payments p
  WHERE p.order_id = v_order.id AND p.method IN ('moncash', 'natcash') AND p.status <> 'paid'
) THEN
  RAISE EXCEPTION 'Peman an poko verifye. Tann yon admin konfime prèv peman an anvan w konfime kòmand la.';
END IF;
```

**Duplication frontend** (même condition, même message, en aval) : `src/routes/_authenticated/dashboard.restaurant.orders.tsx`, vue "Lis" (List), bouton "Konfime" — `paymentUnverified = payment.method IN ('moncash','natcash') && payment.status !== 'paid'`.

### Pourquoi c'est le bug exact décrit

La condition utilise **`payment.method`** (le nom du rail — MonCash/NatCash) comme proxy pour « ce paiement est manuel et nécessite une preuve vérifiée par un admin ». Mais MonCash et NatCash sont utilisés par **deux flux complètement différents** :
- **Manuel** : le client envoie l'argent hors système, uploade une preuve, un admin vérifie (`submit_payment_proof_secure`).
- **Automatique** (« MonCash Automatik », intégration PLOP/Collect) : `create_collect_payment_secure` initie la transaction, le provider répond via webhook (`complete_collect_payment_secure`), **aucune preuve, aucun admin**.

Le nom du wallet est identique dans les deux cas (`payment.method = 'moncash'`) — ce n'est pas une preuve du flux réel, exactement comme votre spec l'indique. Résultat : un paiement automatique encore `awaiting_proof`/`pending` (en attente du webhook du provider, situation normale et temporaire) déclenche le **même blocage et le même message** qu'un paiement manuel jamais vérifié — alors qu'aucun admin n'est impliqué et qu'aucune preuve n'existe.

### La bonne source de vérité existe déjà — et est déjà utilisée correctement ailleurs

Confirmé par lecture directe : la table `public.payment_transactions` (créée par `20260731130000_moncash_collect_payments.sql`) **n'a une ligne que pour le flux automatique** — le commentaire d'origine de cette migration le dit explicitement : *"the order detail page needs to tell 'this MonCash payment is the automatic collect flow' apart from the manual proof flow"*.

`src/routes/orders.$id.tsx` (page client) **utilise déjà correctement ce signal** :
```ts
const isCollect = Boolean(collectTransaction); // collectTransaction = payment.payment_transactions?.[0]
const isManual = (payment?.method === "moncash" || payment?.method === "natcash") && !isCollect;
```
`PaymentProofSection` n'est rendu que si `isManual` — **un client avec un paiement automatique ne voit jamais l'UI "uploadez votre preuve"**. Ce chemin est correct, vérifié, **aucune correction nécessaire côté client**.

Le bug est donc une **régression de couverture**, pas une erreur de conception : quand le flux automatique a été ajouté (migration du 31 juillet), `orders.$id.tsx` a été mis à jour pour distinguer les deux flux — mais **`update_order_status_secure` (le RPC de confirmation restaurant) et `dashboard.restaurant.orders.tsx` (la page restaurant) ne l'ont jamais été.**

**Confiance : VERIFIED** — reproduit et corrigé en transaction réelle contre la base de production (§5).

---

## 2. DATA FLOW

### MANUEL
```
Client choisit MonCash "manuel"
→ checkout crée payments (method='moncash', status='awaiting_proof')
→ PaymentProofSection (orders.$id.tsx) — isManual=true → upload preuve
→ submit_payment_proof_secure → payment_proofs + payments.status='under_review'
→ Admin vérifie (pending-payments-section) → payments.status='paid'|'failed'
→ Restaurant : update_order_status_secure — payments.status='paid' → CONFIRME
```

### AUTOMATIQUE
```
Client choisit "MonCash Automatik"
→ initiate-collect-payment.functions.ts → moncashProvider.initiatePayment()
→ create_collect_payment_secure → payment_transactions (status='pending') + payments.status='awaiting_proof'
→ orders.$id.tsx — isCollect=true (payment_transactions existe) → PAS de PaymentProofSection
→ Provider MonCash → webhook → complete_collect_payment_secure → payment_transactions.status='paid'|'failed' → payments.status suit
→ Restaurant : update_order_status_secure —
   AVANT correction : method='moncash' + status≠'paid' → BLOQUE avec message "Tann admin" (BUG — aucun admin impliqué)
   APRÈS correction : payment_transactions existe → message "Peman otomatik la poko konfime" si pas encore payé, CONFIRME normalement une fois payé
```

---

## 3. CARTOGRAPHIE

| Flux | Source | État initial | Action | Validation | État final | Admin requis ? | Proof requis ? |
|---|---|---|---|---|---|---|---|
| Manuel | `submit_payment_proof_secure` | `awaiting_proof` | Upload preuve | Admin review | `paid`/`failed` | **OUI** | **OUI** |
| Automatique | `create_collect_payment_secure` → `complete_collect_payment_secure` | `awaiting_proof`/`pending` | Webhook provider | Signature webhook | `paid`/`failed` | **NON** | **NON** |

**Signal de classification unique et fiable** : existence d'une ligne `payment_transactions` pour le `payment_id` → automatique. Absence → manuel. (Jamais le nom du wallet, jamais un statut générique seul.)

---

## 4. AUTRES ENDROITS AUDITÉS (même classe de bug recherchée explicitement)

| Surface | Verdict | Détail |
|---|---|---|
| `orders.$id.tsx` + `PaymentProofSection.tsx` (client) | ✅ **Déjà correct** | `isCollect`/`isManual` déjà basés sur `payment_transactions` — aucune modification |
| `dashboard.restaurant.orders.tsx`, vue Kanban | ✅ Non affecté | Aucune logique de blocage côté client sur ce bouton — reçoit simplement l'erreur RPC (désormais correcte) si le clic échoue |
| `dashboard.restaurant.orders.tsx`, vue Lis | 🔴 **Bug confirmé, corrigé** | §5 |
| `private.update_order_status_secure` | 🔴 **Bug confirmé, corrigé** | §1 — c'est la VRAIE barrière (aucun trigger sur `orders`, RLS n'a aucune policy d'écriture sur `orders` — ce RPC est la seule protection) |
| `pending-payments-section.queries.ts` (file d'attente admin "preuves à vérifier") | 🔴 **Bug de la même famille, corrigé** | Filtrait `payments WHERE method IN (...) AND status IN ('awaiting_proof','under_review')` **sans exclure les lignes ayant une `payment_transactions`** — un paiement automatique en transit pouvait apparaître dans la file "à vérifier manuellement" alors qu'aucune action admin n'est nécessaire |

**Décision explicitement NON prise, documentée plutôt qu'appliquée silencieusement** : Stripe utilise aussi `payment_transactions` (son propre flux "collect", `20260805140000_stripe_collect_integration.sql`) — le nouveau bloc "automatique" du RPC aurait pu être généralisé à toute méthode de paiement plutôt que restreint à `moncash`/`natcash`. **Je ne l'ai pas fait** : Stripe n'était jamais bloqué par cette vérification avant (le filtre `method IN ('moncash','natcash')` l'excluait déjà), donc généraliser aurait introduit un **nouveau** blocage pour Stripe — un changement de comportement non lié au bug rapporté, hors du périmètre de « correction minimale nécessaire ». Signalé ici pour votre décision plutôt que décidé pour vous.

---

## 5. REMEDIATION PLAN — appliqué

| # | Fichier | Fonction | Ancienne logique | Nouvelle logique | Risque |
|---|---|---|---|---|---|
| 1 | `supabase/migrations/20260813120000_fix_manual_vs_automatic_payment_classification.sql` (nouveau) | `private.update_order_status_secure` | 1 condition : `method IN (moncash,natcash) AND status≠paid` → 1 message générique | 2 conditions distinctes : sans `payment_transactions` → message manuel (inchangé) ; avec `payment_transactions` → nouveau message automatique | **Migration NON appliquée** — attend autorisation |
| 2 | `src/lib/order-status.ts` | nouvelle fonction pure `classifyUnconfirmedPayment()` | (n'existait pas) | Réutilisée par la page restaurant ; testée unitairement | Appliqué |
| 3 | `src/routes/_authenticated/dashboard.restaurant.orders.tsx` | vue Lis | `paymentUnverified` (booléen, message unique) | `classifyUnconfirmedPayment()` → `"manual" \| "automatic" \| null`, message + libellé de bouton distincts | Appliqué |
| 4 | `src/components/dashboard/admin/pending-payments-section.queries.ts` | `fetchPendingPayments()` | Aucune exclusion des paiements automatiques | Filtre les lignes ayant une `payment_transactions` (flux automatique) hors de la file de vérification manuelle | Appliqué |

**PLOP/wallet selection non touché** : `initiate-collect-payment.logic.ts`, `moncash-client.server.ts`, `plop-provider.server.ts`, le polling, `payment_method_requested`/`payment_method_used` — aucun de ces fichiers n'a été ouvert en écriture. La correction se limite au **point de lecture** de `payment_transactions` pour classifier, jamais à sa logique d'écriture.

---

## 6. TEST PLAN — exécuté

### SQL (BEGIN/ROLLBACK, contre production, migration + tests dans la même transaction annulée) — **7/7 réussis**

| Test | Scénario | Résultat attendu | Résultat |
|---|---|---|---|
| 1 | Manuel, `awaiting_proof`, pas de `payment_transactions` | Bloqué, message manuel | ✅ |
| 2 | Manuel, `paid` | Confirmation autorisée | ✅ |
| 3 | Automatique, `payment_transactions.status='pending'` | Bloqué, message **automatique** (pas le message manuel) | ✅ |
| 4 | Automatique, `paid` | Confirmation autorisée | ✅ |
| 5 | Automatique, `payment_transactions.status='failed'` | Bloqué, message automatique — **jamais** le workflow manuel | ✅ |
| 6 | Automatique + preuve manuelle accidentellement présente | Classification reste automatique (n'est jamais requalifié manuel) | ✅ |
| 7 (régression) | Commande cash (`kach`) | Confirmation inchangée, aucune des deux branches ne s'applique | ✅ |

Zéro résidu confirmé après coup (0 utilisateur de test restant).

### Frontend (Vitest, réel) — **8/8 nouveaux tests, 181/181 au total**

`src/lib/__tests__/order-status.test.ts` — couvre exactement la même matrice (null pour cash/Stripe/payé, "manual" sans `payment_transactions`, "automatic" avec — y compris transaction échouée et preuve accidentelle).

---

## 7. VALIDATION

| Commande | Résultat |
|---|---|
| `npm run typecheck` | ✅ 0 erreur |
| `npm run lint` | ✅ 0 erreur (3 warnings préexistants, fichiers non touchés) |
| `npm run check:migrations` | ✅ 135 migrations scannées, aucun hazard |
| `npx vitest run` | ✅ **181/181** (173 existants + 8 nouveaux) |
| Suite SQL transactionnelle (migration + 7 tests) | ✅ Toutes assertions, zéro résidu |

---

## 8. Files Modified / Created

**Modifiés** (code, déjà appliqué — pas de migration, pas de secret, pas de config) :
- `src/lib/order-status.ts` — nouvelle fonction pure `classifyUnconfirmedPayment`
- `src/routes/_authenticated/dashboard.restaurant.orders.tsx` — requête + logique du bouton "Konfime"
- `src/components/dashboard/admin/pending-payments-section.queries.ts` — filtre de la file de vérification manuelle

**Créés** :
- `supabase/migrations/20260813120000_fix_manual_vs_automatic_payment_classification.sql` — **NON appliqué**, en attente d'autorisation
- `src/lib/__tests__/order-status.test.ts`
- `docs/PAYMENT_FLOW_CLASSIFICATION_REPORT.md` (ce fichier)

**Non touchés** (confirmé par grep exhaustif avant toute modification) : PLOP client/provider/reconcile, MonCash/NatCash/Stripe clients, wallet selection, polling, cartographie GPS, tout autre RLS/table, CI, configuration, variables d'environnement.

---

## 9. Critère final de succès — état

- [x] MANUEL → preuve requise, vérification admin requise (inchangé)
- [x] AUTOMATIQUE → confirmation provider requise, **preuve non requise**, **vérification admin non requise**
- [x] `AUTOMATIC PAYMENT PENDING ≠ MANUAL PAYMENT WAITING FOR PROOF` — prouvé par le test 3 (message distinct) et le test 5 (jamais le message manuel même en échec)
- [x] Le message "Tann yon admin konfime prèv peman an" ne peut plus se déclencher pour un paiement automatique — impossible dans les 7 scénarios testés

**Migration en attente de votre autorisation explicite avant application en production. Aucun commit, aucun push.**
