# Rapport — Remédiation P3 : Cohérence Backend (PaymentProvider → Realtime)

Date : 2026-08-08 · Portée : toute la chaîne backend `PaymentProvider → initiateCollectPayment → create_collect_payment_secure → payment_transactions → complete_collect_payment_secure → payments → orders → Realtime`. Corrections backend uniquement (SQL + `.server.ts`) — **aucune modification frontend**, confirmé ci-dessous.

---

## 1. Résumé exécutif

Audit exhaustif de la chaîne, à la fois par lecture de code (chaque maillon) et par requêtage direct de la production (pas de supposition). **Aucune des 6 catégories d'incohérence demandées n'a de cas structurellement possible pour 4 d'entre elles** (contraintes FK réelles, garde d'idempotence solide) — vérifié empiriquement en plus d'être garanti par le schéma. **Un vrai problème a été trouvé et corrigé** : les 18 paiements automatiques jamais tentés dans ce projet sont **tous** restés `pending` indéfiniment — pas un bug de réconciliation (le cron tourne correctement, PLOP confirme honnêtement qu'aucun n'a été payé), mais une escalade manquante : au-delà de 3 jours, le seul signal était un `console.error` invisible. Corrigé avec une nouvelle RPC idempotente + une notification admin (bell + push), suivant la convention déjà établie du projet.

---

## 2. La chaîne, maillon par maillon

```
PaymentProvider (plopProvider/stripeProvider)
   │  initiatePayment()
   ▼
initiateCollectPayment (runInitiateCollectPayment)
   │  provider settings gate → provider.initiatePayment() → RPC
   ▼
create_collect_payment_secure  (SECURITY DEFINER)
   │  valide payment+order+customer, INSERT
   ▼
payment_transactions  (status: pending|paid|failed)
   │  poll (orders.$id.tsx) OU cron quotidien OU webhook Stripe
   ▼
complete_collect_payment_secure  (SECURITY DEFINER, service_role only)
   │  UPDATE ... WHERE status='pending'  (garde d'idempotence)
   ▼
payments  (UPDATE status = _decision)
   │  trigger trg_payment_paid_confirm_order (AFTER UPDATE OF status)
   ▼
orders  (UPDATE status='confirmed' WHERE status='pending', SI decision='paid')
   │
   ▼
Realtime  (payments + orders dans supabase_realtime, orders.$id.tsx s'y abonne)
```

## 3. Résultats par catégorie demandée

| Catégorie | Verdict | Preuve |
|---|---|---|
| **Transaction orpheline** | ❌ Structurellement impossible | `payment_transactions.order_id`/`payment_id` sont `NOT NULL REFERENCES ... ON DELETE CASCADE` depuis leur toute première migration. Re-vérifié en direct : `orphaned_transactions_no_payment=0`, `orphaned_transactions_no_order=0` sur 17→18 lignes réelles |
| **Payment sans order** | ❌ Structurellement impossible | `payments.order_id UUID NOT NULL REFERENCES orders(id)`. Vérifié : `payments_no_order=0` sur 32→33 lignes réelles |
| **Order sans payment** | ❌ Aucun cas trouvé | `orders_with_zero_payments=0`, `orders_with_multiple_payments=0` — relation 1:1 stricte, confirmée sur toute la production actuelle |
| **Payment bloqué pending** | 🔴 **Confirmé, corrigé** | § 4 — 18/18 tentatives de paiement automatique jamais résolues |
| **Double finalisation** | ❌ Aucun cas trouvé, garde vérifiée | `complete_collect_payment_secure`'s `UPDATE ... WHERE status='pending'` empêche toute double écriture ; confirmé sur `audit_log` : **zéro** évènement `collect_payment.paid`/`collect_payment.failed` n'a jamais eu de doublon (et en fait, aucun n'existe du tout encore — cohérent avec § 4) |
| **Perte de payment_method** | ❌ Chaîne saine, vérifiée par le code (P1) | `payment_method_used` utilise `COALESCE(_payment_method_used, payment_method_used)` — ne jamais écraser par `NULL`. Aucune donnée réelle "paid" n'existe encore pour vérifier un cas de bout en bout, mais la chaîne `walletUsed → _payment_method_used` a déjà été auditée et testée (docs/PLOP_CLIENT_REMEDIATION_REPORT.md, mission P1) |

## 4. Le vrai problème — preuve directe, root-cause confirmée

### Constat initial (surprenant)
```
total payment_transactions : 18
status='pending'            : 18   (100%)
status='paid'                : 0
status='failed'               : 0
```
**Tous**, sans exception, restent `pending` — la moitié depuis plus de 3 jours (jusqu'à 96h). Aucun `collect_payment.paid`/`.failed` n'existe dans `audit_log`.

### Hypothèse écartée après vérification : "le cron ne tourne pas"
- `vercel cron ls` confirme les 2 cron jobs enregistrés (`/api/cron/plop-reconcile`, `15 3 * * *`).
- `CRON_SECRET`/`PLOP_CLIENT_ID`/`PLOP_CLIENT_SECRET` confirmés présents en production (`vercel env ls`).
- **Preuve décisive** : `plop_api_logs` contient 56 appels réels à `/api/paiement-verify`, répartis sur 4 jours (`2026-08-05`: 8, `-06`: 16, `-07`: 16, `-08`: 16) — tous `http_status:200`, tous horodatés ~03:46 UTC (30 min après l'heure planifiée, latence Vercel Cron normale). **Le cron tourne bel et bien, chaque jour, sans erreur.**

### La vraie cause : PLOP confirme honnêtement qu'aucun de ces paiements n'a abouti
Contenu réel de chaque réponse `paiement-verify` (échantillon complet des 16 références les plus anciennes) :
```json
{ "status": true, "trans_status": "no", "method": "moncash", "montant": "1150", ... }
```
**`trans_status: "no"` pour les 16/16** — PLOP lui-même indique que ces paiements n'ont jamais été complétés côté client (tentatives de checkout abandonnées, personne n'a validé sur la page PLOP). Le code applicatif se comporte **exactement comme conçu** : il ne finalise jamais en `paid` (correct, PLOP dit non), et refuse explicitement de deviner un `failed` (`trans_status` ne documente que `no`/`ok`, jamais un vrai "rejeté" — docs/PLOP_PHASE0_AUDIT.md § 14.6). **Ce n'est donc pas un bug de réconciliation.**

### Le vrai gap
`plop-reconcile.server.ts` détectait déjà correctement le dépassement du seuil de 3 jours (`STALE_REVIEW_AFTER_MS`), mais l'unique action était :
```ts
console.error(`[plop-reconcile] transaction ${reference} still pending after 3 days — needs manual review`);
```
**Invisible en pratique** — aucune notification admin (bell), aucun push, rien dans le tableau de bord. 16 des 18 transactions ont déjà dépassé ce seuil aujourd'hui, sans qu'aucun admin n'en ait été informé.

## 5. Correctif appliqué (backend uniquement)

### Migration `supabase/migrations/20260808200000_flag_stale_collect_payments.sql` (non appliquée)
1. `ALTER TABLE payment_transactions ADD COLUMN stale_flagged_at timestamptz` — nullable, marque si/quand une transaction a déjà été signalée, pour ne notifier **qu'une seule fois** (jamais chaque jour en boucle).
2. Nouvelle fonction `flag_stale_collect_payment_secure(_external_reference text)` — `SECURITY DEFINER`, `service_role` uniquement, idempotente (`UPDATE ... WHERE status='pending' AND stale_flagged_at IS NULL`), appelle `private.notify_secure` pour `admin`/`super_admin` — même schéma que les deux RPC existantes de cette chaîne.

### `src/lib/payment-providers/plop-reconcile.server.ts`
Le `console.error` reste (utile pour Vercel logs), mais s'accompagne désormais d'un appel à la nouvelle RPC + d'un push admin (`flagStaleAndNotify`, nouvelle fonction) — reprend `pushToUsers` (`push-dispatch.server.ts`), le même moteur que tous les autres `send-*-push` du projet, appelé directement ici (pas de wrapper `createServerFn`/`send-*-push.functions.ts` : ce code tourne dans un contexte cron `service_role`, sans session utilisateur à authentifier, contrairement à tous les autres pushes de ce projet). Un échec de cet appel (RPC ou push) est intercepté et journalisé — ne fait jamais échouer le reste du passage de réconciliation.

### `src/integrations/supabase/types.ts`
Colonne `stale_flagged_at` ajoutée au type `payment_transactions` (Row/Insert/Update) et aux `Returns` de `create_collect_payment_secure`/`complete_collect_payment_secure` (qui renvoient la ligne complète) ; nouvelle entrée `flag_stale_collect_payment_secure` dans `Functions` — même convention de "hand-patch avant application réelle" que toutes les migrations précédentes de ce projet.

### Tests
`src/lib/payment-providers/__tests__/plop-reconcile.test.ts` : mock `rpc` étendu pour distinguer `complete_collect_payment_secure`/`flag_stale_collect_payment_secure`, mock de `pushToUsers`. Le test "stale" existant réécrit pour vérifier le nouveau comportement + 2 nouveaux tests :
- La RPC est bien appelée et **exactement un** push admin est envoyé quand `just_flagged:true`.
- **Aucun** push répété quand `just_flagged:false` (déjà signalé un jour précédent).
- Un échec de la RPC de signalement est intercepté et journalisé, ne fait jamais planter le reste du passage.

## 6. Vérification

| Étape | Résultat |
|---|---|
| `npm run typecheck` | ✅ Aucune erreur |
| `npm run lint` | ✅ 0 erreur (12 warnings pré-existants sans rapport) |
| `npm run check:migrations` | ✅ 123 migrations scannées, 0 hazard |
| `npx vitest run` (suite complète) | ✅ **130/130** (10 fichiers — 120 pré-existants + 10 nouveaux/renforcés dans `plop-reconcile.test.ts`) |
| `npx vite build` | ✅ Build production complet réussi (client + SSR + service worker PWA, 220 entrées precache) |
| `npm run verify` (chaîne complète) | ✅ Exit code 0, confirmé explicitement |

## 7. Observations additionnelles (non corrigées — hors périmètre exact des 6 catégories demandées)

- **5 commandes `cancelled` conservent un `payments.status` non terminal** (`awaiting_proof`×4, `pending`×1 — méthodes manuelles/cash, pas le flux automatique). Aucun risque financier constaté (aucune n'est `paid`), mais elles ne se résoudront jamais. Ce n'est pas exactement une des 6 catégories demandées (ni orphelin, ni double finalisation, ni perte de payment_method) et la vraie correction (faut-il annuler automatiquement un paiement quand sa commande est annulée ?) est une décision produit, pas une incohérence technique — signalé ici plutôt que corrigé unilatéralement.
- Toutes les 18 lignes `payment_transactions` partagent le même montant (`1150.00 HTG`) — cohérent avec des tests répétés du même panier pendant le développement, pas un signe de bug de transmission du montant (le code lit `payment.amount` fraîchement à chaque appel, aucune valeur codée en dur trouvée).
- Le lien `/dashboard/admin/collect` utilisé dans le nouveau push suppose que la page admin "Peman Otomatik" (chantier "Étape 1", toujours en attente de son propre feu vert de commit) est déployée — si ce correctif est committé avant cette page, le lien renverra un 404 jusqu'à ce qu'elle le soit. Signalé, pas bloquant (le push et la notification in-app restent fonctionnels indépendamment de cette page).

## 8. Conformité au périmètre imposé

Confirmé via `git status` :
```
 M src/integrations/supabase/types.ts
 M src/lib/payment-providers/plop-reconcile.server.ts
 M src/lib/payment-providers/__tests__/plop-reconcile.test.ts
?? supabase/migrations/20260808200000_flag_stale_collect_payments.sql
```
**Aucun fichier frontend touché** — `checkout.tsx`, `orders.$id.tsx`, tout composant React : lus pour l'audit, jamais modifiés. `PaymentProvider` (interface `types.ts` des providers, distincte du fichier Supabase du même nom) : non modifiée.

---

## Statut

Correctif backend appliqué et testé, périmètre strictement respecté. **Migration non appliquée, aucun commit effectué** — en attente de votre validation, même discipline que les remédiations P0/P1/P2 précédentes de cette chaîne.
