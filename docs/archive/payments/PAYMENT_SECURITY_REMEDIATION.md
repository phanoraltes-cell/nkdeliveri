# Rapport — Remédiation P4 : Sécurité Payment

Date : 2026-08-08 · Portée : RLS, GRANT, `SECURITY DEFINER`, `search_path`, rôles `service_role`/`authenticated`/`anon`, ownership — sur tout le domaine paiement (collect + manuel + payout + refund). **Tests exclusivement en `BEGIN`/`ROLLBACK`, aucune donnée réelle modifiée, aucune migration appliquée.**

---

## 1. Résumé exécutif

Audit exhaustif de **~30 fonctions `SECURITY DEFINER`** et **7 tables** du domaine paiement, par lecture intégrale du code SQL puis **preuve empirique directe** (pas de raisonnement seul) via 10 tests transactionnels simulant des attaquants réels : client anonyme, client authentifié non-admin, client essayant d'agir sur le paiement d'un autre client, tentative de contournement de `PaymentProvider`, de double paiement, de replay de webhook.

**Aucune vulnérabilité activement exploitable trouvée.** Chaque tentative de contournement testée a été correctement bloquée — soit par une vérification interne (`auth.uid() IS NULL`, ownership, rôle admin), soit par le comportement par défaut de RLS (refus quand aucune police ne s'applique à la commande).

**Un vrai problème confirmé, corrigé** : des `GRANT` excessifs et incohérents — `anon` avec `EXECUTE` sur 17 fonctions qui n'ont structurellement aucune raison d'être appelées sans session, et `anon`/`authenticated` avec des privilèges de table (`INSERT`/`UPDATE`/`DELETE`) qu'aucune police RLS ne gouverne jamais. Rien de tout cela n'était exploitable en pratique (les gardes internes/RLS tenaient déjà), mais c'est une vraie dette de défense en profondeur, incohérente avec la convention plus récente et plus rigoureuse déjà établie sur les tables/fonctions Collect (`plop_api_logs`, `stripe_api_logs`, `create_collect_payment_secure`, etc.). Corrigé par une migration `REVOKE`-only, testée en transaction avant d'être laissée non appliquée.

---

## 2. Méthode

1. Lecture intégrale (`pg_get_functiondef`) de chaque fonction `SECURITY DEFINER` du domaine paiement/payout/refund — vérification systématique de `search_path`, de la présence d'une garde d'authentification/ownership/rôle, et des `GRANT`.
2. Introspection directe des `GRANT`/`REVOKE` de table (`information_schema.role_table_grants`) et des polices RLS (`pg_policies`) pour `payments`, `payment_transactions`, `payment_provider_settings`, `payment_proofs`, `refunds`, `plop_api_logs`, `stripe_api_logs`, `moncash_api_logs`.
3. **10 tests transactionnels réels** (`BEGIN` ... `ROLLBACK`), simulant un vrai appelant via `SET LOCAL role` + `set_config('request.jwt.claim.sub', ...)` — jamais de simple lecture de code sans vérification.
4. Chaque test confirmé sans résidu après coup (comptages/valeurs re-vérifiés en dehors de toute transaction).

---

## 3. `search_path` — aucun problème trouvé

**Les ~30 fonctions auditées ont toutes `SET search_path TO 'public'` explicitement.** Aucune fonction `SECURITY DEFINER` du domaine paiement ne s'exécute avec un `search_path` mutable — le vecteur classique d'escalade par shadowing de schéma n'existe pas ici.

## 4. Tests transactionnels — résultats détaillés

| #   | Test                                                    | Scénario                                                                                                                                                                                                                                                              | Résultat                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | **Création frauduleuse**                                | Un client authentifié tente `create_collect_payment_secure` pour le `payment_id` d'un **autre** client                                                                                                                                                                | 🟢 Bloqué : `"Payment not found"` — le `JOIN orders o ... AND o.customer_id = v_user` empêche toute création hors de ses propres commandes                                                                                                                                                                 |
| B   | **Escalade**                                            | Un client authentifié **réellement non-admin** (vérifié sans aucun rôle admin/super_admin) tente `update_payment_provider_setting_secure` (admin uniquement)                                                                                                          | 🟢 Bloqué : `"Forbidden"`. _(Un premier essai avait semblé échouer — faux positif : le compte de test choisi détenait en fait aussi les rôles `admin`/`super_admin` en plus de `customer`, un compte de développement dual-usage. Refait avec un client authentiquement non-admin — bloqué correctement.)_ |
| C   | **Bypass anon → argent réel**                           | Un appelant **totalement anonyme** (`role=anon`, aucune session) tente de réécrire les numéros MonCash/NatCash **de la plateforme elle-même** via `update_platform_payout_settings_secure` — la fonction au plus fort impact potentiel trouvée avec un `GRANT` `anon` | 🟢 Bloqué : `"Forbidden"`                                                                                                                                                                                                                                                                                  |
| D   | **Bypass PaymentProvider (statut fabriqué)**            | Tentative de créer directement une ligne `payment_transactions` avec `_status:='paid'` — sans jamais passer par un vrai fournisseur                                                                                                                                   | 🟢 Bloqué : `"Estati envalid"` — seuls `pending`/`failed` sont acceptés à la création ; `paid` n'existe que via `complete_collect_payment_secure`                                                                                                                                                          |
| E   | **Bypass RPC (auto-finalisation)**                      | Le client propriétaire du paiement tente d'appeler directement `complete_collect_payment_secure` (réservée `service_role`) pour finaliser son propre paiement sans confirmation réelle du fournisseur                                                                 | 🟢 Bloqué au niveau `GRANT` : `"permission denied for function"` — ni `anon` ni `authenticated` n'ont jamais eu `EXECUTE` sur cette fonction                                                                                                                                                               |
| F   | **Bypass table directe — `payments`**                   | `anon` tente un `INSERT` brut dans `payments` (contournant toute RPC)                                                                                                                                                                                                 | 🟢 Bloqué par RLS : `"new row violates row-level security policy"`                                                                                                                                                                                                                                         |
| G   | **Bypass table directe — `payment_transactions`**       | Le client tente un `UPDATE` brut de **son propre** `payment_transactions` vers `status='paid'`                                                                                                                                                                        | 🟢 Bloqué par RLS (par défaut, aucune police ne couvre `UPDATE`) : 0 ligne affectée                                                                                                                                                                                                                        |
| H   | **Bypass table directe — création**                     | Le client tente un `INSERT` brut dans `payment_transactions`                                                                                                                                                                                                          | 🟢 Bloqué par RLS : `"new row violates row-level security policy"`                                                                                                                                                                                                                                         |
| I   | **Bypass Payment Global / porte fournisseur désactivé** | La porte `payment_provider_settings.natcash_auto.enabled` désactivée **dans la même transaction** ; le client authentifié appelle directement `create_collect_payment_secure` (contournant entièrement la vérification côté TypeScript)                               | 🟢 Bloqué : `"NatCash Otomatik pa disponib pou kounye a."` — la porte existe aussi côté SQL, pas seulement côté client                                                                                                                                                                                     |
| J   | **Double paiement + replay**                            | Cycle complet : création → finalisation `paid` → 2ᵉ tentative de paiement automatique sur le même paiement déjà payé → rejeu de la **même** finalisation webhook                                                                                                      | 🟢 2ᵉ tentative bloquée (`"Peman sa a deja an kou trete"`) ; rejeu accepté silencieusement comme no-op sûr (`WHERE status='pending'` — la ligne déjà `'paid'` ne correspond plus, aucune double notification, aucun double crédit)                                                                         |

Chaque test a été re-vérifié comme n'ayant laissé **aucun résidu** en production après le `ROLLBACK` (notamment le test B, où une confusion initiale avec l'état réel `payment_provider_settings.stripe.enabled` — changé entre-temps par une action légitime de l'admin — a été activement écartée en comparant un champ que le test aurait modifié, `maintenance_message`, resté intact).

## 5. Le vrai problème trouvé — `GRANT` excessifs (confirmé, corrigé)

### Fonctions : `EXECUTE` accordé à `anon` sans raison structurelle

**17 fonctions** du domaine paiement/payout/refund accordent `EXECUTE` à `anon`, alors que **chacune** commence par une vérification qui rejette systématiquement un appelant sans session (`auth.uid() IS NULL`, une jointure d'ownership qui ne matche jamais `NULL`, ou un contrôle de rôle admin explicite) :

```
complete_refund_secure, confirm_cash_payment_secure, confirm_payout_secure,
dispute_cash_payment_secure, dispute_payout_secure, get_admin_payout_kpis,
get_payouts_monthly_series, initiate_payout_secure, log_payment_provider_error_secure,
request_refund_secure, resolve_payout_dispute_secure, review_manual_payment_secure,
review_refund_secure, submit_payment_proof_secure, update_driver_payout_secure,
update_platform_payout_settings_secure, update_restaurant_payout_secure
```

**Non touché délibérément** : `get_platform_payout_public()` — accès `anon` légitime par conception (les numéros MonCash/NatCash de la plateforme sont censés être publics, comme les coordonnées de paiement de n'importe quelle entreprise).

### Tables : privilèges qu'aucune police RLS ne gouverne jamais

| Table                       | Privilège excessif                  | Rôle            | Pourquoi c'est mort                                                                                                                             |
| --------------------------- | ----------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `payments`                  | `SELECT`/`INSERT`/`UPDATE`/`DELETE` | `anon`          | Toutes les polices RLS existantes sont `TO authenticated` uniquement — `anon` n'a accès à **aucune** ligne, quel que soit le privilège de table |
| `payment_transactions`      | `INSERT`/`UPDATE`/`DELETE`          | `authenticated` | Seules 2 polices `SELECT` existent — aucune police `INSERT`/`UPDATE`/`DELETE`, donc RLS refuse tout par défaut                                  |
| `payment_provider_settings` | `INSERT`/`UPDATE`/`DELETE`          | `authenticated` | Seule une police `SELECT` publique existe                                                                                                       |
| `payment_proofs`            | tous                                | `anon`          | Seule police existante : `SELECT`, `TO authenticated`                                                                                           |
| `payment_proofs`            | `INSERT`/`UPDATE`/`DELETE`          | `authenticated` | Le vrai chemin d'écriture est `submit_payment_proof_secure`                                                                                     |
| `refunds`                   | `INSERT`/`UPDATE`/`DELETE`          | `authenticated` | Le vrai chemin d'écriture est `request_refund_secure`/`review_refund_secure`/`complete_refund_secure`                                           |

**Non touché** : les privilèges `REFERENCES`/`TRIGGER`/`TRUNCATE` restants sur `payments` pour `anon` — inatteignables par la vraie surface d'attaque (l'API REST de PostgREST n'expose jamais `TRUNCATE`/DDL, quel que soit le `GRANT` ; ces privilèges ne seraient exploitables qu'avec une connexion SQL directe en tant que rôle `anon`, chose que ni Supabase ni PostgREST n'exposent jamais à un appelant externe). Corriger ces trois-là n'aurait rien fermé de réellement atteignable — laissé de côté pour rester strictement sur les problèmes confirmés atteignables.

## 6. Correctif appliqué

**Nouvelle migration `supabase/migrations/20260808210000_payment_security_least_privilege.sql`** — uniquement des `REVOKE`, **aucune** modification de corps de fonction, de signature, de police RLS, ou de structure de table :

- `REVOKE EXECUTE ... FROM anon` sur les 17 fonctions listées § 5.
- `REVOKE INSERT, UPDATE, DELETE, SELECT ON payments FROM anon`.
- `REVOKE INSERT, UPDATE, DELETE ON payment_transactions FROM authenticated`.
- `REVOKE INSERT, UPDATE, DELETE ON payment_provider_settings FROM authenticated`.
- `REVOKE INSERT, UPDATE, DELETE, SELECT ON payment_proofs FROM anon` + `REVOKE INSERT, UPDATE, DELETE ON payment_proofs FROM authenticated`.
- `REVOKE INSERT, UPDATE, DELETE ON refunds FROM authenticated`.

**Testée en `BEGIN`/`ROLLBACK` avant d'être laissée non appliquée** — la migration complète a été rejouée dans une transaction contre la production réelle, avec vérification post-application que : `payments` n'a plus aucun `GRANT` `SELECT`/`INSERT`/`UPDATE`/`DELETE` pour `anon`, `payment_transactions` n'a plus aucun `GRANT` d'écriture pour `authenticated`, `update_platform_payout_settings_secure` n'a plus `EXECUTE` pour `anon`, et — vérification négative importante — `get_platform_payout_public` conserve bien son `EXECUTE` `anon` (non cassé par erreur). Puis `ROLLBACK` ; re-vérifié après coup que la production est restée inchangée (le compte `anon` sur `payments` affiche toujours 7 privilèges, l'état d'avant correctif).

`npm run check:migrations` : ✅ 124 migrations scannées, 0 hazard (aucun changement de signature).

## 7. `service_role`/`authenticated`/`anon` — synthèse par rôle

- **`service_role`** : conserve `EXECUTE`/table access complet partout où c'est nécessaire — `complete_collect_payment_secure`, les webhooks, les crons. Aucun changement.
- **`authenticated`** : conserve exactement les privilèges que les polices RLS/gardes internes gouvernent réellement (lecture de ses propres paiements, actions RPC scoped à soi-même ou à son rôle). Perd uniquement les privilèges de table morts (jamais gouvernés par une police).
- **`anon`** : après correctif, n'a plus aucun accès table/fonction sur le domaine paiement, sauf ce qui est explicitement public par conception (`payment_provider_settings` lecture, `get_platform_payout_public`).

## 8. Conformité au périmètre imposé

`git status` :

```
?? supabase/migrations/20260808210000_payment_security_least_privilege.sql
```

Aucun autre fichier touché par cette mission (les fichiers `types.ts`/`plop-reconcile.server.ts`/son test/la migration `20260808200000` visibles dans l'arbre de travail proviennent de la mission P3 précédente, toujours en attente de son propre feu vert, non touchés ici).

---

## Verdict

## 🟢 AUCUNE VULNÉRABILITÉ EXPLOITABLE CONFIRMÉE

10 scénarios d'attaque réels testés en transaction, tous correctement bloqués par les gardes existantes. Un vrai problème de dette de défense en profondeur (`GRANT` excessifs, jamais exploitables mais incohérents avec la rigueur du reste du schéma) trouvé et corrigé par une migration `REVOKE`-only, testée puis laissée **non appliquée**, **aucun commit effectué** — en attente de votre validation, même discipline que les remédiations P0/P1/P2/P3 précédentes.
