# PLOP Dynamic Wallet Phase 1 Revalidation Report

**Date** : 2026-08-04
**Portée** : revalidation indépendante post-remédiation (`docs/PLOP_DYNAMIC_WALLET_PHASE1_SECURITY_REMEDIATION_REPORT.md`). Audit uniquement — aucune modification de fichier, aucune migration appliquée, aucun commit créé, aucune correction supplémentaire.

## Résultat

**APPROVED**

---

## Vérification sécurité SQL

Comparaison ligne par ligne des trois versions de `create_collect_payment_secure` (`20260731130000` original → `20260803130000` hardening production → `20260804130000` remédiation actuelle) :

| Élément | 08-03 (production, référence) | 08-04 (remédié, actuel) | Identique ? |
|---|---|---|---|
| Condition de déclenchement | `IF _status = 'pending' THEN` | `IF _status = 'pending' THEN` | ✅ |
| Requête de vérification | `SELECT 1 FROM public.payment_provider_settings WHERE provider = 'moncash_auto' AND enabled = true` | Identique caractère pour caractère | ✅ |
| Message d'erreur | `'MonCash Automatik pa disponib pou kounye a.'` | Identique | ✅ |
| Code d'exception | `USING ERRCODE = '42501'` | Identique | ✅ |
| Position dans le corps | Après la vérification de doublon `pending`, immédiatement avant l'`INSERT` | Identique | ✅ |
| Portée (`pending` uniquement) | Ne s'applique jamais à `_status='failed'` | Identique | ✅ |

**Aucune simplification, aucune reformulation, aucune altération.** Le bloc a été réinséré verbatim.

**Note sur l'ordre des vérifications** — le diagramme "Ordre attendu" de cette mission (`Validation sécurité provider → Check duplicate pending → ...`) place le contrôle provider *avant* le contrôle de doublon. **L'ordre réel dans le fichier — identique entre la version 08-03 (production) et la version 08-04 (remédiée) — est l'inverse** : doublon `pending` vérifié en premier, contrôle provider ensuite, tous deux avant l'`INSERT`. Ce n'est pas un écart introduit par la remédiation : c'est l'ordre exact déjà en production depuis le 3 août, préservé à l'identique. Sur le plan sécurité, l'ordre entre ces deux gardes n'a pas d'incidence : ce sont deux `RAISE EXCEPTION` indépendants et inconditionnels — n'importe lequel des deux, seul, empêche déjà l'`INSERT` d'être atteint. Aucune action requise.

**Vérification de la porte pré-existante** (non touchée par le hardening ni par cette remédiation, revérifiée pour complétude) : `IF EXISTS (SELECT 1 FROM payment_transactions WHERE payment_id = _payment_id AND status = 'pending')` — protection anti-doublon, présente et inchangée dans les trois versions.

---

## Vérification wallet traceability

| Point de contrôle | Constat |
|---|---|
| Paramètre RPC `_payment_method_requested text DEFAULT NULL` | Présent, 5ᵉ paramètre de `create_collect_payment_secure` |
| Paramètre RPC `_payment_method_used text DEFAULT NULL` | Présent, 6ᵉ paramètre de `complete_collect_payment_secure` |
| Colonnes table | `payment_transactions.payment_method_requested text`, `payment_method_used text` — présentes, additives, `NULL` par défaut |
| `INSERT` dans `create_collect_payment_secure` | Colonne et valeur `payment_method_requested` correctement alignées positionnellement (7 colonnes / 7 valeurs, vérifié) |
| `UPDATE` dans `complete_collect_payment_secure` | `payment_method_used = COALESCE(_payment_method_used, payment_method_used)` — cohérent avec le pattern déjà utilisé pour `provider_transaction_id`/`webhook_data` |
| `log_audit_event` (les deux fonctions) | Les deux nouvelles valeurs sont incluses dans le `jsonb_build_object` de l'audit trail |
| Appelants applicatifs (TypeScript, non modifiés dans cette remédiation, revérifiés) | `initiate-collect-payment.logic.ts` (4 appels, `_payment_method_requested`), `plop-reconcile.server.ts` + `poll-collect-payment.logic.ts` (`_payment_method_used`) — tous cohérents avec la signature finale |

**Aucune régression sur la traçabilité wallet.**

---

## Vérification RPC

### Fonctions modifiées par cette migration

| Fonction | Signature finale | Permissions | `SECURITY DEFINER` |
|---|---|---|---|
| `create_collect_payment_secure` | `(uuid, text, text, text, text)` — `_payment_id, _external_reference, _status, _error, _payment_method_requested` | `REVOKE ALL FROM PUBLIC, anon` / `GRANT EXECUTE TO authenticated` | ✅ Préservé |
| `complete_collect_payment_secure` | `(text, text, text, text, jsonb, text)` — `_external_reference, _decision, _provider_transaction_id, _error, _webhook_data, _payment_method_used` | `REVOKE ALL FROM PUBLIC, anon, authenticated` / `GRANT EXECUTE TO service_role` | ✅ Préservé |

Permissions identiques, rôle pour rôle, à celles déjà en place avant cette migration — seule la liste de types dans le `REVOKE`/`GRANT` a été mise à jour pour refléter la nouvelle signature (obligatoire en PostgreSQL, une révocation doit cibler la signature exacte).

### `complete_collect_payment_secure` — confirmation d'absence de modification involontaire

Cette fonction n'a **qu'une seule définition antérieure** à cette phase (`20260731130000`, jamais retouchée depuis — reconfirmé par recherche exhaustive sur tout `supabase/migrations/`). Comparaison ligne par ligne : validation de `_decision`, `UPDATE ... WHERE status = 'pending'` (garde d'idempotence), branche de replay (`IF NOT FOUND`), mise à jour de `payments.status`, notification admin sur échec — **tout identique**, à l'exception du nouveau paramètre et de son usage dans le `SET`/`jsonb_build_object`. Signature étendue de façon strictement additive (nouveau paramètre en dernière position, `DEFAULT NULL`). Permissions inchangées. Logique métier inchangée.

### Appelants réels (recherche exhaustive, hors tests)

| RPC | Appelants |
|---|---|
| `create_collect_payment_secure` | `initiate-collect-payment.logic.ts` (3 emplacements de gestion d'échec + 1 de création réussie) |
| `complete_collect_payment_secure` | `plop-reconcile.server.ts`, `poll-collect-payment.logic.ts`, `moncash-collect-webhook-handler.server.ts` (dormant, jamais appelé par PLOP) |

**Aucun appel existant cassé** — tous les nouveaux paramètres sont optionnels (`DEFAULT NULL`), tout appelant qui les omet (ex. `moncash-collect-webhook-handler.server.ts`) continue de fonctionner sans modification.

**RLS** : non affecté — ces fonctions sont `SECURITY DEFINER` (contournent RLS par conception, comportement inchangé) ; les politiques RLS de `payment_transactions` elle-même (lecture propriétaire/admin) ne référencent aucune colonne spécifique et s'appliquent automatiquement aux deux nouvelles colonnes sans modification requise.

**Aucune perte de `SECURITY DEFINER`** sur les deux fonctions — confirmé par lecture directe des deux `CREATE FUNCTION`.

---

## Vérification tests

| Commande | Résultat (ré-exécutée indépendamment dans cette revalidation) |
|---|---|
| `npm run check:migrations` | ✅ 117 migrations scannées, 0 hazard de surcharge non résolu — **complété par la revue manuelle ci-dessus**, non traité comme preuve suffisante à lui seul |
| `npm run typecheck` | ✅ Propre |
| `npm run lint` | ✅ 0 erreur (12 avertissements préexistants, sans rapport, fichiers non touchés) |
| `npx vitest run` | ✅ **98/98 tests**, 9 fichiers |
| `npx vite build` | ✅ Réussi |

Résultats strictement identiques à ceux de la remédiation précédente — cohérent avec le fait qu'aucun fichier TypeScript/test n'a été modifié depuis (confirmé par `git status` : la liste des fichiers `.ts`/`.tsx` modifiés est inchangée).

---

## Risques restants

| Niveau | Risque |
|---|---|
| **Faible** | Absence de contrainte `CHECK` sur `payment_method_requested`/`payment_method_used` limitant aux 4 valeurs PLOP documentées — défense en profondeur manquante, pas un vecteur d'attaque réel (seul du code serveur déjà validé écrit ces colonnes). Non bloquant. |
| **Faible** | Aucun test SQL direct (transaction `BEGIN`/`ROLLBACK` contre une vraie base) des deux scénarios critiques — création normale et tentative de contournement avec `moncash_auto.enabled=false` — avant application réelle. Recommandé en complément, pas requis pour ce GO. |
| **Négligeable** | Message d'erreur `'MonCash Automatik disponib sèlman pou peman MonCash'` (à l'intérieur de la fonction, sur le rail non-moncash) non renommé en "Peman Otomatik" — cosmétique, déjà noté deux fois, sans impact fonctionnel ou sécurité. |

Aucun risque bloquant identifié.

---

## Décision migration

**READY**

La régression de sécurité identifiée lors de la validation précédente est confirmée corrigée, sans effet de bord, sans nouvelle régression introduite. La traçabilité wallet reste pleinement fonctionnelle. Les signatures et permissions RPC sont cohérentes et compatibles avec tous les appelants existants. La suite qualité complète est verte.

**Prochaine étape recommandée** (hors périmètre de cette revalidation, à votre discrétion) : application de la migration `20260804130000_plop_wallet_traceability.sql`, puis test en conditions réelles (MonCash/NatCash), puis commit — selon la séquence déjà établie.
