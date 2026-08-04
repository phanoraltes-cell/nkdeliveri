# PLOP Dynamic Wallet Phase 1 Security Remediation Report

**Date** : 2026-08-04
**Portée** : correction unique de la régression identifiée dans `docs/PLOP_DYNAMIC_WALLET_PHASE1_VALIDATION_REPORT.md`. **Seul le fichier de migration a été modifié.** Aucun fichier TypeScript, aucun test, aucune nouvelle architecture. Migration toujours **non appliquée**. Aucun commit.

---

## Problème identifié

`supabase/migrations/20260804130000_plop_wallet_traceability.sql` reconstruisait `create_collect_payment_secure` sans le contrôle de sécurité introduit par `20260803130000_harden_create_collect_payment_provider_check.sql`, déjà en production. Appliquer la migration telle quelle aurait rouvert un chemin de contournement : un appel RPC direct à `create_collect_payment_secure` (hors orchestrateur `initiate-collect-payment.logic.ts`) aurait pu fabriquer une ligne `payment_transactions` en statut `pending` même avec "Peman Otomatik" désactivé (`payment_provider_settings.moncash_auto.enabled = false`).

---

## Cause racine

`create_collect_payment_secure` a **deux définitions antérieures distinctes**, pas une seule :

1. `20260731130000_moncash_collect_payments.sql` — version originale.
2. `20260803130000_harden_create_collect_payment_provider_check.sql` — `CREATE OR REPLACE` ajoutant le contrôle `payment_provider_settings.moncash_auto.enabled` — **version réellement en production**.

La première version de `20260804130000_plop_wallet_traceability.sql` a été construite à partir de la version **(1)**, pas de la version **(2)**. `npm run check:migrations` ne pouvait pas détecter cette erreur : ce script compare uniquement les **signatures** de fonctions entre elles pour repérer un risque de surcharge (deux signatures différentes coexistant sous le même nom) — il ne compare jamais le **contenu logique** d'un corps de fonction reconstruit d'une migration à l'autre. Une régression de sécurité par oubli d'un bloc `IF` est structurellement hors de son périmètre de détection.

---

## Correction appliquée

Fusion manuelle des deux éléments, à l'identique de chacun, sans rien réinventer :

- **Sécurité (bloc du 03 août)** — réinséré **verbatim**, à sa position d'origine exacte (immédiatement avant l'`INSERT`, après la vérification de doublon `pending`) : même condition (`_status = 'pending'`), même requête (`payment_provider_settings WHERE provider = 'moncash_auto' AND enabled = true`), même message d'erreur, même `ERRCODE = '42501'`.
- **Traçabilité wallet (cette phase)** — conservée à l'identique : paramètre `_payment_method_requested text DEFAULT NULL`, colonne dans l'`INSERT`, champ dans `log_audit_event`.

Aucune autre ligne de la fonction n'a été modifiée. Le reste du fichier de migration (colonnes `ALTER TABLE`, fonction `complete_collect_payment_secure`) est resté inchangé.

---

## Fonction SQL corrigée

`create_collect_payment_secure` — ordre des vérifications dans le corps final, tel que relu ligne par ligne :

```
1. auth.uid() IS NULL           → 42501
2. _status NOT IN (pending,failed) → erreur générique
3. check_rate_limit_secure()    → 42901
4. SELECT payment ... FOR UPDATE → 42501 si introuvable
5. v_payment.method <> 'moncash' → erreur générique
6. v_payment.status déjà traité → erreur générique
7. doublon pending existant     → erreur générique
8. [RESTAURÉ] _status='pending' ET moncash_auto désactivé → 42501  ← hardening 08-03
9. INSERT (+ payment_method_requested)  ← traçabilité 08-04
10. log_audit_event (+ payment_method_requested)
11. notify_secure si _status='failed'
```

Signature : `(_payment_id uuid, _external_reference text, _status text DEFAULT 'pending', _error text DEFAULT NULL, _payment_method_requested text DEFAULT NULL)` — inchangée par rapport à la version précédente de cette phase (le correctif ne touche qu'au corps, jamais à la signature).

---

## Hardening restauré

| Aspect | Version 08-03 (production) | Version corrigée (cette remédiation) | Identique ? |
|---|---|---|---|
| Condition de déclenchement | `_status = 'pending'` | `_status = 'pending'` | ✅ |
| Requête de vérification | `SELECT 1 FROM payment_provider_settings WHERE provider = 'moncash_auto' AND enabled = true` | Identique | ✅ |
| Message d'erreur | `'MonCash Automatik pa disponib pou kounye a.'` | Identique | ✅ |
| Code d'erreur | `ERRCODE = '42501'` | Identique | ✅ |
| Position dans la fonction | Immédiatement avant l'`INSERT` | Identique | ✅ |
| Portée (`pending` seulement, jamais `failed`) | ✅ | ✅ | ✅ |

---

## Vérifications

**Typecheck** : ✅ propre (`npm run typecheck`)
**Lint** : ✅ 0 erreur, 12 avertissements préexistants sans rapport (`npm run lint`)
**Tests** : ✅ **98/98** (`npx vitest run`, 9 fichiers) — identique à avant, cohérent avec le fait qu'aucun fichier TypeScript/test n'a été touché
**Build** : ✅ réussi (`npx vite build`)
**Migration** : ✅ `npm run check:migrations` → 117 migrations scannées, 0 hazard de surcharge non résolu — **complété par la revue manuelle ci-dessus**, non traité comme suffisant à lui seul, conformément à l'instruction

**Vérification manuelle additionnelle** (au-delà des outils automatisés, puisque c'est précisément leur angle mort qui a causé le problème initial) :
- Comparaison ligne par ligne du bloc restauré contre `20260803130000_harden_create_collect_payment_provider_check.sql:68-82` → identique caractère pour caractère (hors commentaires).
- Confirmation que `complete_collect_payment_secure` n'a aucune régression équivalente possible : recherche exhaustive (`grep`) confirme qu'elle n'a jamais été définie qu'une seule fois avant cette phase (`20260731130000`), jamais retouchée depuis — aucun hardening à perdre pour cette fonction.
- Confirmation qu'aucun fichier TypeScript ni test n'a été modifié dans cette remédiation (`git status` avant/après identique sur tous les fichiers `.ts`/`.tsx`).

---

## Impact

- **Sécurité** : le contrôle d'accès du 3 août est de nouveau présent dans la version qui sera appliquée — plus de régression.
- **Fonctionnel** : aucun changement de comportement au-delà de la restauration — la traçabilité wallet (`payment_method_requested`/`payment_method_used`) reste pleinement fonctionnelle, les appelants existants (`initiate-collect-payment.logic.ts`, `plop-reconcile.server.ts`, `poll-collect-payment.logic.ts`, `moncash-collect-webhook-handler.server.ts` dormant) restent compatibles sans aucune modification de leur côté.
- **Signatures RPC** : inchangées par cette remédiation (déjà correctes dans la version précédente — seul le corps de `create_collect_payment_secure` a changé).
- **Permissions** : inchangées (`REVOKE`/`GRANT` identiques, non touchés par cette remédiation).
- **Code TypeScript** : zéro changement nécessaire, confirmé.

---

## Décision

**READY FOR REVALIDATION**

---

## Critères de réussite

| Critère | Statut |
|---|---|
| Le bloc de hardening du 03 août est restauré | ✅ |
| La traçabilité wallet reste fonctionnelle | ✅ |
| Les signatures RPC restent compatibles | ✅ |
| Les permissions restent intactes | ✅ |
| Aucun changement TypeScript nécessaire | ✅ — confirmé, zéro fichier `.ts`/`.tsx` modifié |
| Tous les tests passent | ✅ 98/98 |

---

**Migration toujours non appliquée. Aucun commit créé. Prêt pour une nouvelle validation Phase 1 avant application réelle et commit.**
