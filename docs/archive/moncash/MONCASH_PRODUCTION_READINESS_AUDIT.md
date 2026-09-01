# Audit de préparation production — Intégration MonCash

**Phase 1 (Audit complet) + Phase 2 (Validation des migrations).**
Rien n'a été modifié pour produire ce rapport — lecture seule sur le
code, requêtes en lecture seule sur la base de données liée
(`dcsnmvbtsmdbwrwbutph`) et sur Vercel. Aucune migration appliquée,
aucun commit effectué, conformément aux contraintes de cette mission.

## Verdict

**PAS PRÊT pour la production — et ce n'est pas grave : le système est
inerte par construction, exactement comme prévu.** Le vrai risque
aujourd'hui n'est pas qu'un paiement MonCash automatique se déclenche
par erreur (structurellement impossible — voir § 1.3), mais que l'écart
entre le code sur `main` et l'état réel de la base de production ne soit
pas visible sans audit actif, ce que ce rapport corrige.

| Axe                                    | État                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Décaissement B2C MonCash               | Non supporté par l'API publique MonCash — bloquant externe, connu depuis l'audit initial |
| Migrations appliquées                  | 1 sur 5 (`20260730100000`) — voir § 4                                                    |
| Secrets MonCash                        | Absents partout (Git, Vercel, local) — vérifié à nouveau dans cet audit                  |
| Paiements manuels (MonCash/NatCash)    | Non affectés, chemin de production actuel, aucune régression détectée                    |
| Nouvelle faille de sécurité découverte | 1 — **corrigée** (migration `20260731100000`, non appliquée) — voir § 2, R1              |

---

## 1. Inventaire complet

### 1.1 Migrations MonCash

| Migration                                              | Contenu                                                                                                                                                                           | Appliquée sur `main` (repo) | Appliquée en production (vérifié par requête) |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------- |
| `20260722190000_payment_provider_prep.sql`             | Table `payment_providers`, colonne `payouts.provider_code`, `initiate_payout_secure` étendu                                                                                       | ✅                          | ✅                                            |
| `20260730100000_moncash_webhook_payout_lifecycle.sql`  | `payout_status` enum→text+CHECK (`pending`/`failed` ajoutés), `payouts.provider_transaction_id`, table `moncash_webhook_events`, RPC `create/complete/fail_pending_payout_secure` | ✅                          | ✅                                            |
| `20260730110000_log_payment_provider_error.sql`        | RPC `log_payment_provider_error_secure`                                                                                                                                           | ✅                          | ❌ **non appliquée**                          |
| `20260730120000_moncash_provider_notifications.sql`    | Câblage `create/complete/fail_pending_payout_secure` vers `private.notify_secure`, `log_payment_provider_error_secure` +1 paramètre                                               | ✅                          | ❌ **non appliquée**                          |
| `20260730130000_moncash_financial_audit_log.sql`       | Table `moncash_api_logs`, triggers d'immutabilité (`private.prevent_log_mutation`)                                                                                                | ✅                          | ❌ **non appliquée**                          |
| `20260731100000_revoke_anon_create_pending_payout.sql` | Corrige R1 (§ 2) — `REVOKE EXECUTE ... FROM anon` sur `create_pending_payout_secure`                                                                                              | ✅                          | ❌ **non appliquée**                          |

**Conséquence vérifiée en production** (lecture directe de la définition
de fonction live, pas une supposition) : `complete_pending_payout_secure`
utilise encore `INSERT INTO notifications` (type `payout_paid`), pas
`private.notify_secure` ; `moncash_api_logs` n'existe pas ; aucun trigger
d'immutabilité n'existe encore sur `moncash_webhook_events` (seul
`UNIQUE(event_id)` protège aujourd'hui son idempotence — réel et
suffisant pour l'idempotence, mais **pas encore un vrai "append-only"
au sens strict** tant que `20260730130000` n'est pas appliquée : une
suppression via `service_role` resterait possible aujourd'hui).

### 1.2 Edge Functions

**Aucune.** `supabase/functions/` n'existe pas dans ce projet — confirmé
par inspection directe du système de fichiers. Toute la logique serveur
passe par des fonctions serveur TanStack Start déployées comme fonctions
Vercel (`*.functions.ts`, routes `server.handlers`). Rien à auditer ici,
et rien à migrer si Supabase Edge Functions étaient un jour introduites.

### 1.3 RPC — inventaire et permissions

| RPC                                 | `SECURITY DEFINER` | `GRANT EXECUTE` réel (vérifié en production)  | Observation                                                     |
| ----------------------------------- | ------------------ | --------------------------------------------- | --------------------------------------------------------------- |
| `initiate_payout_secure`            | Oui                | `anon, authenticated, service_role, postgres` | Chemin manuel actif, protégé par `has_role()` interne           |
| `confirm_payout_secure`             | Oui                | `anon, authenticated, service_role, postgres` | idem                                                            |
| `dispute_payout_secure`             | Oui                | `anon, authenticated, service_role, postgres` | idem                                                            |
| `resolve_payout_dispute_secure`     | Oui                | `anon, authenticated, service_role, postgres` | idem                                                            |
| `create_pending_payout_secure`      | Oui                | `anon, authenticated, service_role, postgres` | **Voir R1 § 2** — devrait matcher le pattern des deux suivantes |
| `complete_pending_payout_secure`    | Oui                | `service_role, postgres` **uniquement**       | Correct — aucune session utilisateur ne peut l'appeler          |
| `fail_pending_payout_secure`        | Oui                | `service_role, postgres` **uniquement**       | Correct — idem                                                  |
| `log_payment_provider_error_secure` | Oui                | Non applicable — **pas encore en production** | —                                                               |

`create_pending_payout_secure`/`complete_pending_payout_secure`/
`fail_pending_payout_secure` sont **inatteignables en pratique
aujourd'hui** quel que soit leur GRANT : `direction:"disburse"` échoue
systématiquement dans `moncashProvider.initiatePayment()` avant qu'aucune
de ces RPC ne soit appelée (voir docs/PAYMENT_PROVIDERS.md). C'est la
garantie structurelle de fond de tout ce module.

### 1.4 Webhooks

Un seul endpoint : `POST /api/webhooks/moncash`
(`src/routes/api.webhooks.moncash.ts` → `moncash-webhook-handler.server.ts`).
Public, non authentifié par session (nécessairement — MonCash n'est pas
un utilisateur connecté), protégé uniquement par vérification de
signature HMAC-SHA256 (schéma non confirmé publiquement par MonCash — voir
docs/MONCASH_WEBHOOK_SECURITY.md). Idempotence en production aujourd'hui :
contrainte `UNIQUE(event_id)` uniquement (le trigger d'immutabilité de
`20260730130000` n'est pas encore appliqué).

### 1.5 Variables d'environnement et secrets

Vérifié directement dans cet audit (pas une réutilisation d'un résultat
ancien) :

- **Vercel Production** (`vercel env ls production`) : **aucune** des 5
  variables `MONCASH_*` n'existe. 10 variables présentes au total, toutes
  Supabase/Resend/Google Maps — rien MonCash.
- **`.env.local`** : **aucune** variable `MONCASH_*`.
- **Historique Git** (`git log`/`git grep` sur tout l'historique) :
  aucune valeur de secret MonCash n'a jamais été committée — seules des
  chaînes de test explicitement fictives (`"test-client-secret"` dans
  les fichiers de test Vitest) correspondent au motif.

**Conclusion : `isMonCashConfigured()` retourne `false` partout en
production aujourd'hui.** Le canal "MonCash Automatik" est inerte à
100 %, à la fois par absence de secrets ET par refus structurel du
décaissement — double garantie indépendante.

### 1.6 Notification Engine (`private.notify_secure`)

Moteur générique existant (Phase 7 d'un chantier précédent), déjà utilisé
par le chat, le partage GPS, l'annulation client. Le câblage MonCash
(`20260730120000`) suit exactement la même convention. **Non actif en
production** (migration non appliquée — voir § 1.1). Une fois appliquée,
aucune régression attendue sur les ~15 sites d'appel existants : cette
migration ne touche que les 3 RPC MonCash déjà créées la veille, jamais
`initiate_payout_secure`/`confirm_payout_secure`/etc.

### 1.7 Wallets

Modèle à 3 soldes (`available_balance`/`pending_balance`/`paid_balance`)

- `wallet_transactions` comme grand livre append-only (source de vérité,
  `recompute_wallet_secure()` peut reconstruire les soldes en sommant ce
  journal). **Zéro ligne en production aujourd'hui** (`SELECT count(*) FROM
wallets` = 0, vérifié dans cet audit) — la plateforme n'a pas encore de
  restaurant/livreur avec un solde réel. Cela signifie concrètement qu'**aucune
  donnée réelle n'est en jeu** pour tout test ou validation supplémentaire
  avant mise en production réelle du module financier lui-même (indépendant
  de MonCash).

### 1.8 Commission Engine

`commission_ledger` + `payout_commissions` (table de liaison,
"quel paiement a couvert quelle ligne de commission"). Le rattachement se
fait à la confirmation (`complete_pending_payout_secure`), jamais à la
création (`create_pending_payout_secure`) — décision déjà documentée :
seul un transfert confirmé doit être traité comme ayant réglé une
commission. Aucune modification de la logique de commission elle-même
dans tout le chantier MonCash — uniquement consommée en lecture.

---

## 2. Risques identifiés

### R1 — `create_pending_payout_secure` accepte un GRANT `anon` (Moyenne en principe, Faible en pratique) — ✅ CORRIGÉ

**Décision** : corrigé dans le périmètre de ce chantier, scope limité à
cette seule fonction — voir
`supabase/migrations/20260731100000_revoke_anon_create_pending_payout.sql`
(un simple `REVOKE EXECUTE ... FROM anon`, non appliquée, comme toute
migration de cette mission). Les 5 autres RPC préexistantes partageant
le même pattern restent volontairement hors périmètre — à traiter comme
un audit systémique séparé si souhaité.

**Constat** : contrairement à `complete_pending_payout_secure`/
`fail_pending_payout_secure` (correctement limitées à `service_role`),
`create_pending_payout_secure` a `EXECUTE` accordé à `anon` en
production. Vérifié : ce n'est **pas une régression introduite par le
chantier MonCash** — c'est un pattern systémique sur **cinq** autres RPC
`..._secure` préexistantes (`initiate_payout_secure`,
`confirm_payout_secure`, `dispute_payout_secure`,
`resolve_payout_dispute_secure`, `update_notification_preferences_secure`)
qui ont toutes le même `anon:EXECUTE`. Cause probable : privilège par
défaut au niveau projet Supabase (`ALTER DEFAULT PRIVILEGES`) qui accorde
`EXECUTE` à `anon`/`authenticated` sur toute nouvelle fonction du schéma
`public`, sauf révocation explicite _nommant ces rôles_, pas seulement
`PUBLIC` (`REVOKE ALL ... FROM PUBLIC` ne suffit pas, il faut
`REVOKE ALL ... FROM PUBLIC, anon`).

**Impact réel** : `create_pending_payout_secure` vérifie
`private.has_role(auth.uid(), 'admin')` en tout premier et lève
`Forbidden` sinon — un appel anonyme échoue donc bien aujourd'hui,
défense en profondeur intacte. Le risque est structurel/hygiène, pas une
brèche exploitable actuellement.

**Recommandation** : dans une future migration (non incluse ici — aucune
modification demandée dans cette phase), ajouter
`REVOKE ALL ON FUNCTION public.create_pending_payout_secure(...) FROM anon;`
pour aligner avec `complete_pending_payout_secure`/
`fail_pending_payout_secure`. Optionnel mais recommandé : un audit
systémique séparé des 5 RPC préexistantes partageant ce pattern — hors
périmètre MonCash, à traiter comme son propre chantier.

### R2 — Idempotence webhook non "append-only" tant que `20260730130000` n'est pas appliquée (Faible)

`moncash_webhook_events` a son `UNIQUE(event_id)` (idempotence
fonctionnelle, déjà vérifiée par test — voir docs/MONCASH_TEST_REPORT.md)
mais pas encore son trigger anti-suppression. Un `DELETE` via
`service_role` resterait possible aujourd'hui — improbable (aucun chemin
de code applicatif n'en émet un) mais pas structurellement impossible
avant application de `20260730130000`.

### R3 — Schéma webhook MonCash non confirmé (Moyenne, déjà documentée)

Rappel, pas une découverte de cet audit : l'en-tête de signature et le
format exact du payload webhook sont des conventions génériques, pas une
documentation MonCash confirmée. Voir docs/MONCASH_WEBHOOK_SECURITY.md
pour le détail complet — aucun changement d'état depuis ce rapport.

### R4 — Décaissement B2C non supporté par l'API publique MonCash (Bloquant externe, déjà documenté)

Rappel : racine de tout le reste. Voir
docs/PAYMENT_PROVIDERS.md § Ce qui n'est PAS fait.

### Aucun risque trouvé sur

- Fuite de secret (Git, logs, notifications, code React) — vérifié
  activement dans cet audit, rien trouvé.
- Wallets/Commission Engine — logique métier non touchée par tout le
  chantier MonCash, zéro donnée réelle en jeu actuellement.
- Paiements manuels — chemin de code inchangé, toujours actif, toujours
  le défaut dans `payout-pay-modal.tsx`.

---

## 3. Dépendances entre les 3 migrations non appliquées

```
20260730110000 (log_payment_provider_error_secure)
        │  aucune dépendance sur 120000/130000 — applicable seule
        ▼
20260730120000 (notify_secure + log_payment_provider_error_secure +1 param)
        │  DROP FUNCTION + CREATE sur log_payment_provider_error_secure
        │  → DOIT être appliquée APRÈS 110000 (la fonction doit déjà exister)
        ▼
20260730130000 (moncash_api_logs + triggers d'immutabilité)
        │  indépendante des deux précédentes au niveau schéma
        │  (nouvelle table + triggers sur une table déjà existante
        │  depuis 100000) — mais logiquement, l'audit financier devrait
        │  suivre le reste pour une mise en cohérence en un seul lot
        ▼
   (aucune dépendance en aval — dernière migration de la série)
```

`20260731100000` (correctif R1) est indépendante des 3 autres — un
simple `REVOKE` sur une fonction déjà créée par `20260730100000`, donc
applicable dès que celle-ci l'est, dans n'importe quel ordre par rapport
à 110000/120000/130000.

**Ordre obligatoire pour les 3 migrations du cycle de vie async :
110000 → 120000 → 130000.** 120000 fait un
`DROP FUNCTION IF EXISTS public.log_payment_provider_error_secure(text, text, uuid, uuid, numeric, text)`
— cette signature exacte (6 arguments) n'existe que si 110000 a déjà
tourné ; le `IF EXISTS` rend l'opération non bloquante si ce n'est pas le
cas (elle ne ferait juste rien), mais le `CREATE FUNCTION` suivant, à 7
arguments, créerait alors une **deuxième** fonction en parallèle plutôt
que de remplacer la première si 110000 n'a jamais tourné — **résultat
incorrect à éviter**, d'où l'ordre strict.

---

## 4. PHASE 2 — Validation des migrations non appliquées

| Migration                                                                          | Impact                                                                                                                                                                                                                                                                                                                                                                | Validation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Rollback possible                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **20260730110000**<br>`log_payment_provider_error_secure`                          | Ajout pur : 1 nouvelle fonction. Aucune table modifiée, aucune colonne ajoutée, aucune donnée touchée.                                                                                                                                                                                                                                                                | ✅ Testée en isolation via les tests unitaires (appelée par `initiate-provider-payout.functions.ts`, couvert par `moncash-provider.test.ts`). Aucun appelant vivant aujourd'hui (chemin `direction:"disburse"` toujours refusé avant d'y arriver côté succès — mais **le chemin d'échec synchrone, lui, EST atteignable dès aujourd'hui** dès qu'un admin sélectionne "MonCash Automatik" dans le sélecteur unifié, même sans secret configuré — c'est le seul appelant réel actuellement, et il fonctionne).                                                                                                                                                                                                                             | Oui — `DROP FUNCTION public.log_payment_provider_error_secure(text, text, uuid, uuid, numeric, text, text);` supprime proprement la fonction. Aucune donnée à restaurer (rien n'est écrit ailleurs que `audit_log`, table déjà existante, jamais modifiée en structure par cette migration).                                                                                                                                                                                 |
| **20260730120000**<br>notify_secure + `log_payment_provider_error_secure` +1 param | Modifie le **corps** de 3 fonctions déjà en production (`create/complete/fail_pending_payout_secure`) — signatures inchangées (`CREATE OR REPLACE`), donc aucun appelant TypeScript à modifier. Remplace (`DROP`+`CREATE`) `log_payment_provider_error_secure` pour ajouter `_code`.                                                                                  | ✅ Testée en isolation (mocks) — voir `moncash-provider.test.ts`/`moncash-webhook-handler.test.ts`. ⚠️ **Non re-testée en transaction rolled-back contre le schéma live** (le rapport de tests précédent l'a explicitement noté comme dette restante) — recommandé avant application : rejouer un script `BEGIN...ROLLBACK` équivalent aux groupes A/B de docs/MONCASH_TEST_REPORT.md une fois appliquée, pour confirmer que les nouvelles notifications (`payout_provider_sent`/`payout_provider_confirmed`/`payout_provider_admin_success`/etc.) sont bien créées.                                                                                                                                                                      | Oui, mais **pas un simple DROP** : il faut restaurer le corps _précédent_ de `create/complete/fail_pending_payout_secure` (celui de `20260730100000`, avec `INSERT INTO notifications` brut) via une nouvelle migration de rollback dédiée — ces 3 fonctions doivent continuer d'exister (elles sont la seule voie du cycle de vie asynchrone). `log_payment_provider_error_secure` peut revenir à sa version 6-arguments via un `DROP`+`CREATE` symétrique à l'application. |
| **20260730130000**<br>`moncash_api_logs` + triggers d'immutabilité                 | Ajout pur : 1 nouvelle table + 4 triggers (2 sur la nouvelle table, 2 sur `moncash_webhook_events` déjà existante). Les triggers sur `moncash_webhook_events` bloquent `DELETE`/`TRUNCATE` pour **tout rôle y compris service_role** — vérifier qu'aucun processus (backup/restore, script de maintenance) ne dépend d'un `DELETE` sur cette table avant application. | ✅ Le comportement des triggers est vérifiable par un test dédié en transaction rolled-back (tenter un `DELETE`/`UPDATE`, attendre l'exception) — recommandé avant application, pas encore fait (la table n'existe pas encore pour le tester). `moncash-client.server.ts` écrit déjà vers `moncash_api_logs` dans le code présent sur `main` — tant que la table n'existe pas, chaque tentative d'écriture échoue silencieusement (`console.warn`, jamais bloquant pour un paiement — comportement voulu, voir docs/MONCASH_FINANCIAL_AUDIT.md § Limite connue) : **le code déployé aujourd'hui fonctionne déjà correctement sans cette table**, l'appliquer n'est pas urgent pour la stabilité, seulement pour activer l'audit détaillé. | Table : `DROP TABLE public.moncash_api_logs;` (perte définitive du journal accumulé depuis son activation — à sauvegarder d'abord si des données s'y trouvent). Triggers sur `moncash_webhook_events` : `DROP TRIGGER moncash_webhook_events_no_delete ON public.moncash_webhook_events; DROP TRIGGER moncash_webhook_events_no_truncate ON public.moncash_webhook_events;` — réversible sans perte de données existantes.                                                   |

| **20260731100000**<br>Correctif R1 | `REVOKE` pur — retire un privilège, n'en ajoute aucun. Aucune table, aucune donnée touchée. | ✅ Le comportement observable ne change pas (l'appel anonyme était déjà rejeté par `has_role()` en interne) — seule la surface d'attaque théorique se réduit. Rien à tester fonctionnellement au-delà de "l'admin peut toujours appeler la fonction" (inchangé, `authenticated` garde son `GRANT`). | Oui, trivial : `GRANT EXECUTE ON FUNCTION public.create_pending_payout_secure(uuid, uuid, numeric, text, text, text, text) TO anon;` restaure l'état antérieur si nécessaire (aucune raison de le faire). |

**Compatibilité avec les données existantes** : les 3 migrations sont
**purement additives** (nouvelles fonctions/table/triggers) à l'exception
du remplacement de corps de fonction dans `20260730120000` — aucune n'a
de `ALTER TABLE ... DROP COLUMN`, aucune n'a de `UPDATE`/`DELETE` sur des
données existantes. Avec 0 ligne dans `wallets`/`payouts` en production
aujourd'hui (vérifié), le risque d'impact sur des données réelles est
nul dans l'état actuel — mais cesse d'être nul dès que le module
financier reçoit ses premières vraies données, d'où l'intérêt de refaire
ce même audit (§4) juste avant l'application réelle si elle intervient
après un délai significatif.

---

## 5. Conclusion

Phase 1 + 2 terminées sans modification du code métier — conforme à la
contrainte "commencer impérativement par un audit complet avant toute
modification". Décisions prises pour la suite :

- **R1 corrigé**, scope limité à `create_pending_payout_secure`
  (migration `20260731100000`, non appliquée) — les 5 autres RPC
  partageant le même pattern restent hors périmètre.
- **Phases 3 à 10 terminées** — voir
  [MONCASH_TECHNICAL_OVERVIEW.md](../../reference/MONCASH_TECHNICAL_OVERVIEW.md) pour
  l'index complet de tous les documents produits (runbook, rollback,
  monitoring, retry, environnements, secrets, résilience, performance,
  exploitation, guide développeur) et le schéma d'architecture global.
  Un gap réel supplémentaire a été trouvé et corrigé pendant la Phase 9
  (parsing JSON non protégé sur 3 points d'appel) — voir
  MONCASH_RESILIENCE_REPORT.md § Correctif. Toujours aucune migration
  appliquée, aucun commit effectué.
