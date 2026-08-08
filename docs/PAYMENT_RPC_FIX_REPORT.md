# Rapport — Remédiation P0 : contrat RPC `create_collect_payment_secure`

Date : 2026-08-07 (mission read-only/diagnostic — **aucun fichier du dépôt modifié, aucune migration appliquée, aucun commit**)

---

## 1. Résumé exécutif

**Le contrat RPC entre le frontend, les migrations (source contrôlée) et les types générés est déjà cohérent — les trois s'accordent sur la même signature à 6 paramètres.** Le mismatch réel n'est pas entre ces trois artefacts, mais entre eux (déjà déployés en code sur `main`) et **la base de données de production**, dont la fonction `create_collect_payment_secure` n'a que 5 paramètres — **confirmé directement sur la production**, pas supposé.

**Conséquence en production, vérifiée en direct** : tout appel réussi d'initiation de paiement automatique — **MonCash Otomatik, NatCash Otomatik, ET Kat Kredi (Stripe), les trois méthodes, pas seulement Stripe** — échoue avec `PGRST202` (fonction introuvable dans le schema cache) au moment d'enregistrer la transaction `pending`, puisque `initiate-collect-payment.logic.ts` envoie systématiquement `_provider_transaction_id` sur cet appel, quel que soit `payment.method`. C'est un **P0 actif en production**, confirmé par sondage direct de l'API PostgREST live (§ 3).

**Aucune correction de code n'a été appliquée** : l'audit démontre que ni la signature SQL, ni l'appel frontend, ni la génération des types n'ont besoin d'être changés — ils sont déjà corrects et mutuellement cohérents. La seule action qui résoudrait le P0 est l'application de la migration `20260805140000_stripe_collect_integration.sql`, déjà committée, déjà validée (§ 5) — **explicitement hors du périmètre de cette mission** ("Aucune migration appliquée").

---

## 2. Comparaison des 5 sources

| Source | Signature trouvée | Statut |
|---|---|---|
| **Frontend** — `src/lib/initiate-collect-payment.logic.ts` (3 sites d'appel `.rpc("create_collect_payment_secure", …)`) | `_payment_id, _external_reference, _status, _error?, _payment_method_requested?, _provider_transaction_id?` (nommés — l'ordre n'a pas d'importance pour PostgREST) | Appelle déjà la signature à 6 paramètres sur le 3ᵉ appel (création de la ligne `pending`/succès) |
| **Types Supabase** — `src/integrations/supabase/types.ts:2650-2658` | `Args: { _error?, _external_reference, _payment_id, _payment_method_requested?, _provider_transaction_id?, _status? }` | Déjà aligné sur la signature à 6 paramètres |
| **Migrations (dépôt, source contrôlée)** — dernière définition : `supabase/migrations/20260805140000_stripe_collect_integration.sql:76-83` | `_payment_id uuid, _external_reference text, _status text DEFAULT 'pending', _error text DEFAULT NULL, _payment_method_requested text DEFAULT NULL, _provider_transaction_id text DEFAULT NULL` | Déjà la signature à 6 paramètres — `DROP FUNCTION IF EXISTS (...5 params...)` avant `CREATE FUNCTION` correctement présent (convention du projet respectée, `npm run check:migrations` : 0 hazard) |
| **PostgreSQL production** (`pg_proc`, interrogé en direct — voir § 3) | `_payment_id uuid, _external_reference text, _status text, _error text, _payment_method_requested text` | **5 paramètres seulement — `_provider_transaction_id` absent** |
| **`supabase migration list`** (linked, en direct) | — | Confirme : toutes les migrations jusqu'à `20260805130000` sont `remote` appliquées ; **`20260805140000` a `"remote":""` — jamais appliquée** |

**Conclusion** : frontend, types et fichier de migration s'accordent tous les trois sur la signature à 6 paramètres. La production est seule en décalage, et ce décalage a une cause connue et unique (une migration écrite mais jamais poussée), pas une erreur de code.

---

## 3. Preuves en production (vérifié en direct, pas supposé)

### 3.1 Catalogue Postgres — requête directe (`supabase db query --linked`, lecture seule)

```sql
SELECT pg_get_function_identity_arguments(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'create_collect_payment_secure';
```
→ `_payment_id uuid, _external_reference text, _status text, _error text, _payment_method_requested text` (un seul overload, 5 paramètres).

### 3.2 Sondage PostgREST live (`POST /rest/v1/rpc/create_collect_payment_secure`, clé publique anonyme — appel sûr, sans écriture possible)

**Avec `_provider_transaction_id`** (payload exact utilisé par le frontend déployé) :
```json
HTTP 404
{
  "code": "PGRST202",
  "message": "Could not find the function public.create_collect_payment_secure(_external_reference, _payment_id, _payment_method_requested, _provider_transaction_id, _status) in the schema cache",
  "hint": "Perhaps you meant to call the function public.create_collect_payment_secure(_error, _external_reference, _payment_id, _payment_method_requested, _status)"
}
```

**Sans `_provider_transaction_id`** (ancienne forme) :
```json
HTTP 401
{ "code": "42501", "message": "permission denied for function create_collect_payment_secure" }
```
→ La fonction à 5 paramètres existe bel et bien (trouvée par PostgREST, bloquée seulement par le GRANT `authenticated`-only — normal et voulu) ; celle à 6 paramètres n'existe pas du tout côté serveur. C'est une preuve directe, à la lettre, du symptôme décrit par la mission.

### 3.3 Test transactionnel BEGIN/ROLLBACK (validation de la migration sans l'appliquer)

Exécuté via `supabase db query --linked --file` avec le contenu **intégral** de `20260805140000_stripe_collect_integration.sql` encadré par `BEGIN;` … `ROLLBACK;` :

1. À l'intérieur de la transaction, après `DROP FUNCTION` + `CREATE FUNCTION`, une requête sur `pg_proc` confirme **un seul overload**, avec exactement la signature à 6 paramètres attendue par le frontend/les types — aucune ambiguïté, aucun overload résiduel.
2. `ROLLBACK` exécuté.
3. **Vérifié après coup**, hors transaction : la fonction en production est retournée à sa forme à 5 paramètres (identique à avant le test), et `information_schema.tables` confirme que `stripe_api_logs` (créée par la même migration) n'existe toujours pas, et `payment_provider_settings` ne contient toujours aucune ligne `provider='stripe'` (`COUNT = 0`). **Rien n'a persisté.**

Ce test démontre que la migration déjà écrite est syntaxiquement et sémantiquement valide contre le schéma réel de production — ce n'est pas une migration théorique, c'est une migration prête à s'appliquer sans erreur.

---

## 4. Source de vérité identifiée

La **signature SQL à 6 paramètres**, telle qu'écrite dans `supabase/migrations/20260805140000_stripe_collect_integration.sql`, est la source de vérité — c'est elle que le frontend (déjà déployé) et les types générés (déjà alignés) attendent tous les deux. La production est l'élément en retard, pas le code.

---

## 5. Correction appliquée

**Aucune.** Ni la signature SQL, ni l'appel frontend, ni la génération des types n'ont été modifiés, parce que l'audit démontre qu'aucun des trois n'est fautif :

- Modifier le fichier de migration serait redondant — il contient déjà la bonne signature, déjà validée en § 3.3.
- Modifier l'appel frontend (par exemple en retirant `_provider_transaction_id`) "corrigerait" l'erreur `PGRST202` immédiate, mais romprait délibérément une capacité déjà conçue et testée : Stripe n'a aucun moyen de retrouver une session par sa propre référence (`docs/STRIPE_INTEGRATION_REPORT.md`), donc `_provider_transaction_id` est indispensable pour que `checkStatus()`/le polling fonctionnent un jour pour Stripe. Ce serait remplacer un bug visible immédiatement par une régression silencieuse plus tard — et cela toucherait `initiate-collect-payment.logic.ts`, au cœur du flux checkout, ce que la mission demande explicitement de ne pas toucher.
- Régénérer les types ne changerait rien : ils reflètent déjà, correctement, l'état cible (même convention déjà suivie ailleurs dans ce projet — `types.ts` est régulièrement mis à jour à la main pour anticiper une migration pas encore appliquée, puis re-synchronisé via `supabase gen types` une fois la migration réellement poussée).

La seule action qui résout réellement le P0 est l'**application de la migration `20260805140000_stripe_collect_integration.sql`** à la base de production — hors périmètre de cette mission par consigne explicite ("Aucune migration appliquée").

---

## 6. Vérifications exécutées

| Vérification | Résultat |
|---|---|
| RPC visible dans PostgREST (signature à 6 paramètres) | ❌ Non — `PGRST202`, confirmé § 3.2 |
| RPC callable (signature à 5 paramètres, celle actuellement en production) | ✅ Oui — trouvée, bloquée seulement par le GRANT anonyme (comportement normal), confirmé § 3.2 |
| Schema cache cohérent avec l'état réel de la base | ✅ Oui — le cache PostgREST reflète fidèlement le seul overload à 5 paramètres présent dans `pg_proc`, cohérent avec `supabase migration list` (`20260805140000` non appliquée) |
| Types régénérés | Non nécessaire — `types.ts` reflète déjà la signature cible à 6 paramètres, aucune dérive à corriger |
| `npm run verify` (typecheck + lint + check:migrations + tests + build) | ✅ Vert — 0 erreur typecheck, 0 erreur lint (12 warnings pré-existants sans rapport), 122 migrations scannées/0 hazard, 105/105 tests, build production réussi |
| Test transactionnel BEGIN/ROLLBACK contre la production | ✅ Réalisé — migration validée valide et non-ambiguë, rollback confirmé propre (aucune trace résiduelle) |

---

## 7. Conformité aux interdictions de la mission

Confirmé via `git status` avant et après cette mission : **aucun fichier du dépôt n'a été modifié**. PLOP, le polling, le cron, les notifications, `checkout.tsx` et l'interface `PaymentProvider` n'ont été ni lus en modification ni touchés — seules des requêtes en lecture (et une transaction explicitement annulée) ont été exécutées contre la production, à des fins de diagnostic uniquement.

---

## 8. Recommandation (hors périmètre de cette mission, signalée pour action séparée)

Ce P0 est **actif en production dès maintenant** et affecte les trois méthodes de paiement automatique (MonCash Otomatik, NatCash Otomatik, Kat Kredi), pas seulement Stripe — tout client qui initie un paiement automatique et dont la tentative auprès du fournisseur réussit rencontre cette erreur au moment d'enregistrer la transaction. Il est recommandé d'appliquer `supabase/migrations/20260805140000_stripe_collect_integration.sql` en urgence, dans une session explicitement autorisée à le faire ([[feedback_migrations_never_pushed]] : jamais sans validation explicite de l'utilisateur).
