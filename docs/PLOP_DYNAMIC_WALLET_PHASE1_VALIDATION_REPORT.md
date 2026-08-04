# PLOP Dynamic Wallet Phase 1 Validation Report

**Date** : 2026-08-04
**Portée** : audit de validation uniquement — lecture, comparaison, tests d'exécution des commandes qualité, aucune modification de fichier, aucune migration appliquée, aucun commit créé.

## Résumé exécutif

Statut : **BLOCKED**

Le code applicatif TypeScript de la Phase 1 est correct, testé et vérifié — mais **la migration SQL contient une régression de sécurité confirmée** : elle supprime silencieusement un contrôle d'autorisation déjà en production (migration `20260803130000_harden_create_collect_payment_provider_check.sql`) en reconstruisant `create_collect_payment_secure` à partir de sa version *pré-hardening*. Appliquer cette migration telle quelle réintroduirait la vulnérabilité que ce hardening avait fermée. **Ne pas appliquer la migration, ne pas commit, tant que ce point n'est pas corrigé.**

Aucun autre problème bloquant trouvé. Une fois ce point corrigé (ajout du bloc manquant, décrit § Validation database), le reste du dossier est prêt.

---

## Validation architecture

✅ Conforme à `docs/PLOP_MULTIWALLET_PHASE0_AUDIT.md` : aucun adapter par wallet créé, un seul client HTTP paramétré (`plop-client.server.ts`). Aucune route webhook créée. `index.server.ts` (registre partagé avec le décaissement) non touché — confirmé par lecture, absent de tout diff. `checkout.tsx`, `payout-pay-modal.tsx`, `useCollectPaymentPoll.ts`, `orders.$id.tsx` non modifiés — confirmé (`git status` : aucun de ces fichiers dans la liste des fichiers modifiés).

Flux réellement implémenté, conforme au flux attendu de la mission :
```
Order (payment.method = "moncash")
  → initiate-collect-payment.logic.ts (paymentMethod: payment.method)
  → plopProvider.initiatePayment({..., paymentMethod})
  → plop-client.server.ts createPayment(reference, amount, paymentMethod)
  → POST /api/paiement-marchand { payment_method: paymentMethod }
```
La porte métier `payment.method !== "moncash"` (`initiate-collect-payment.logic.ts:54`) limite aujourd'hui ce flux au seul rail `moncash` en pratique — décision de périmètre distincte (Option B de l'audit précédent), non traitée par cette phase, correctement documentée comme telle. Le wallet **est** techniquement dynamique par appel (`natcash` fonctionne, testé), mais rien dans le flux métier actuel ne l'exerce encore.

---

## Validation code

### `plop-client.server.ts`
- ✅ `PLOP_PAYMENT_METHOD` **ne contrôle plus** les paiements — `createPayment(reference, amountHtg, paymentMethod?)`, le paramètre l'emporte, la config globale n'est plus qu'un défaut de repli (`plop-client.server.ts:288-289`).
- ✅ `VALID_PAYMENT_METHODS = ["moncash","kashpaw","natcash","all"]` — liste strictement conforme à la documentation PLOP (page 1 du PDF fourni), rien de deviné.
- ✅ Validation **avant tout appel réseau** — `isValidPaymentMethod()` vérifiée avant `requestWithRetry()` (`plop-client.server.ts:290-294`) ; un wallet invalide lève immédiatement, `fetch` jamais appelé (confirmé par test, § Validation tests).

**Test manuel de traçage du code** (lecture, pas d'exécution réseau réelle — confirmé cohérent avec les tests automatisés déjà en place) :
| Scénario | Comportement du code |
|---|---|
| `payment_method="moncash"` | `requestedMethod = "moncash"` → validé → `payment_method: "moncash"` envoyé dans le body JSON. ✅ |
| `payment_method="natcash"` | `requestedMethod = "natcash"` → validé → `payment_method: "natcash"` envoyé. ✅ |
| `payment_method="random"` | `isValidPaymentMethod("random")` → `false` → `PlopApiError` levée **avant** `requestWithRetry()` → **aucun appel HTTP**. ✅ |

### `plop-provider.server.ts` — ordre validation / try-catch / réconciliation
Vérifié ligne par ligne (`plop-provider.server.ts:54-72`) :
```
1. isPlopConfigured() check
2. direction === "disburse" check
3. isValidPaymentMethod(input.paymentMethod) check   ← AVANT le try/catch
4. try { createPayment(...) } catch { verifyPayment(...) réconciliation }
```
✅ **Conforme au flux exigé.** Un wallet invalide retourne `{status:"failed", code:"invalid_wallet"}` au step 3, **sans jamais entrer dans le `try/catch`** — `createPayment()` et `verifyPayment()` ne sont **jamais appelés** pour ce cas (confirmé par le test dédié avec des mocks qui échoueraient le test s'ils étaient invoqués, § Validation tests). Le flux interdit ("Wallet invalide → Erreur locale → Tentative verify PLOP") **n'existe pas** dans le code.

### `initiate-collect-payment.logic.ts`
✅ `payment.method` transmis à `plopProvider.initiatePayment()` (ligne 116-121) et à **4 appels distincts** de `create_collect_payment_secure` comme `_payment_method_requested` (lignes 83, 98, 131, 153) — fournisseur désactivé, non configuré, rejeté, et création réussie/pending. Porte métier `payment.method !== "moncash"` inchangée (ligne 54).

### Capture du champ `method` PLOP
✅ `verifyPayment()` capture `data.method` → `PlopVerifyResult.walletUsed` (`plop-client.server.ts:463`) — n'est plus perdu dans `raw` uniquement (toujours présent dans `raw` aussi, mais désormais également exposé comme champ typé). Propagé jusqu'à :
- `plopProvider.checkStatus()` → `PaymentStatusResult.walletUsed` ✅
- `plop-reconcile.server.ts::finalizeAsPaid()` → `_payment_method_used` sur `complete_collect_payment_secure` ✅
- `poll-collect-payment.logic.ts` → `_payment_method_used` sur `complete_collect_payment_secure` ✅

---

## Validation database

### Colonnes ajoutées
`payment_transactions.payment_method_requested text NULL`, `payment_method_used text NULL` — additives, `NULL` par défaut, aucune ligne existante affectée. Pas de contrainte `CHECK` limitant ces colonnes aux 4 valeurs PLOP documentées (mineur — ces colonnes ne sont alimentées que par du code serveur qui valide déjà en amont ; une contrainte `CHECK` serait une défense en profondeur supplémentaire, non bloquante).

Pas d'index ajouté sur ces colonnes — cohérent, aucune requête actuelle ne filtre dessus.

Backfill : impossible et non tenté à raison — l'information n'existe pas pour les lignes historiques, `NULL` est la seule valeur honnête.

**Migration "safe" au sens strict (additive, pas de perte de données) : oui. Migration sûre à appliquer telle quelle : NON — voir ci-dessous.**

### 🔴 Régression critique confirmée — `create_collect_payment_secure`

Historique réel des définitions de cette fonction (vérifié via `grep` sur tout `supabase/migrations/`) :

1. `20260731130000_moncash_collect_payments.sql` — version originale.
2. `20260803130000_harden_create_collect_payment_provider_check.sql` — **`CREATE OR REPLACE`** ajoutant un contrôle de sécurité : refuse un `_status='pending'` fabriqué (appel RPC direct, hors orchestrateur) si `payment_provider_settings.moncash_auto.enabled = false` (bloc `IF _status = 'pending' THEN ... RAISE EXCEPTION ... END IF;`, immédiatement avant l'`INSERT`). **C'est la version actuellement en production.**
3. `20260804130000_plop_wallet_traceability.sql` (cette phase) — reconstruit la fonction à partir du corps de **l'étape 1** (l'original de juillet), **sans le bloc de hardening de l'étape 2**.

**Conséquence si appliquée telle quelle** : un appelant qui invoquerait `create_collect_payment_secure` directement (en contournant `initiate-collect-payment.logic.ts`) pourrait de nouveau créer une ligne `pending` pendant que "Peman Otomatik" est désactivé — exactement le scénario que le hardening du 3 août avait fermé. Aucun impact financier direct immédiat (seule `complete_collect_payment_secure`, service_role-only, peut faire passer un paiement à `paid`), mais c'est une régression de contrôle d'accès réelle et vérifiée, pas hypothétique.

**Pourquoi `npm run check:migrations` ne l'a pas détecté** : ce script vérifie uniquement les *hazards de surcharge* (deux signatures différentes coexistant pour un même nom de fonction) — il a correctement confirmé que le `DROP FUNCTION IF EXISTS` avant chaque `CREATE OR REPLACE` évite toute surcharge. Il ne vérifie **jamais** le contenu logique du corps de fonction — cette classe de régression (perte silencieuse d'une clause de sécurité lors d'une reconstruction manuelle) est structurellement hors de sa portée.

**Correctif requis avant application** (localisation précise) : dans `supabase/migrations/20260804130000_plop_wallet_traceability.sql`, réinsérer le bloc suivant immédiatement avant `INSERT INTO public.payment_transactions` (reproduit depuis `20260803130000_harden_create_collect_payment_provider_check.sql:68-82`) :
```sql
IF _status = 'pending' THEN
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_provider_settings
    WHERE provider = 'moncash_auto' AND enabled = true
  ) THEN
    RAISE EXCEPTION 'MonCash Automatik pa disponib pou kounye a.' USING ERRCODE = '42501';
  END IF;
END IF;
```

### `complete_collect_payment_secure`
✅ **Aucune régression** — cette fonction n'a été définie qu'une seule fois avant cette phase (`20260731130000`, jamais retouchée depuis) ; le corps repris dans la migration de cette phase correspond exactement à l'unique version existante. Confirmé par recherche exhaustive (`grep` sur tous les fichiers de migration).

### Rollback
- Colonnes : trivialement réversibles (`ALTER TABLE ... DROP COLUMN`), aucune perte de donnée puisque nullable et non consommées ailleurs.
- RPC : un rollback demanderait une nouvelle migration restaurant l'ancienne signature — **et, une fois le correctif ci-dessus appliqué, devrait restaurer à la fois la nouvelle traçabilité ET le hardening**, pas seulement l'un ou l'autre. Techniquement possible, pas automatique (le projet n'a pas de migrations "down").

---

## Validation RPC

| RPC | Avant | Après (cette migration) | `DROP FUNCTION` correct ? | Permissions | RLS | Compat. frontend |
|---|---|---|---|---|---|---|
| `create_collect_payment_secure` | `(uuid, text, text, text)` | `(uuid, text, text, text, text)` | ✅ `DROP FUNCTION IF EXISTS ...(uuid, text, text, text)` avant `CREATE` | ✅ `REVOKE ALL FROM PUBLIC, anon` / `GRANT EXECUTE TO authenticated` — identique, juste re-déclaré pour la nouvelle signature | Non affecté (RLS est au niveau ligne, pas colonne) | ✅ nouveau paramètre optionnel `DEFAULT NULL` — tout appelant existant (dont `moncash-collect-webhook-handler.server.ts`, dormant) continue de fonctionner sans modification |
| `complete_collect_payment_secure` | `(text, text, text, text, jsonb)` | `(text, text, text, text, jsonb, text)` | ✅ `DROP FUNCTION IF EXISTS ...(text, text, text, text, jsonb)` avant `CREATE` | ✅ `REVOKE ALL FROM PUBLIC, anon, authenticated` / `GRANT EXECUTE TO service_role` — identique | Non affecté | ✅ même raisonnement, nouveau paramètre optionnel |

**Appelants réels recensés** (hors tests) pour les deux RPC : `initiate-collect-payment.logic.ts`, `plop-provider.server.ts` (mention dans commentaire, pas d'appel direct), `plop-reconcile.server.ts`, `poll-collect-payment.logic.ts`, `moncash-collect-webhook-handler.server.ts` (dormant, jamais appelé par PLOP). Tous compatibles avec la nouvelle signature, à l'exception du problème de contenu logique décrit ci-dessus (qui n'est pas un problème de compatibilité de signature).

---

## Validation tests

98/98 tests verts (suite complète, pas seulement les nouveaux). Les 3 cas minimum exigés sont couverts, et au-delà :

| Cas exigé | Test(s) correspondant(s) | Qualité de l'assertion |
|---|---|---|
| MonCash | `plop-client.test.ts` "an explicit 'moncash' still works..." | Vérifie le corps JSON envoyé (`payment_method: "moncash"`), pas seulement l'absence d'erreur |
| NatCash | `plop-client.test.ts` "dynamic wallet selection — an explicit 'natcash'..." + `plop-provider.test.ts` "dynamic wallet selection — passes input.paymentMethod..." | Vérifie la transmission bout en bout (client ET provider) |
| Wallet invalide | `plop-client.test.ts` "an unrecognized wallet is rejected before any network call" + `plop-provider.test.ts` "invalid wallet — rejected immediately..." | **Vérifie explicitement l'absence d'appel réseau** (`fetchMock` non appelé) et **l'absence de tentative de réconciliation** (`createPaymentMock`/`verifyPaymentMock` non appelés) — couvre exactement le flux interdit décrit dans la mission |

**Cas non couverts identifiés** (mineurs, non bloquants) :
- Aucun test n'exerce le chemin `payment_method:"all"` de bout en bout à travers `initiate-collect-payment.logic.ts` (seulement au niveau `plop-client.test.ts`/`verifyPayment`) — cohérent avec le fait que ce chemin n'est pas encore atteignable métier (Option B non implémentée).
- Aucun test SQL/RPC direct (BEGIN/ROLLBACK contre une vraie base) pour `create_collect_payment_secure`/`complete_collect_payment_secure` avec les nouveaux paramètres — cohérent avec le fait que la migration n'est pas appliquée ; **recommandé après correction et avant application réelle**, conformément à la pratique déjà établie sur ce projet (mémoire "Simulate auth for RPC debugging").

---

## Validation qualité (résultats d'exécution, obtenus dans cette session)

| Commande | Résultat |
|---|---|
| `npm run typecheck` | ✅ Propre, aucune erreur |
| `npm run lint` | ✅ 0 erreur (12 avertissements préexistants, sans rapport avec cette phase — `react-refresh/only-export-components` sur des fichiers non touchés) |
| `npx vitest run` (`npm run test`) | ✅ **98/98 tests**, 9 fichiers |
| `npx vite build` (`npm run build`) | ✅ Réussi |
| `npm run check:migrations` | ✅ 117 migrations scannées, 0 hazard de surcharge non résolu (**ne détecte pas** la régression logique décrite § Validation database — hors de sa portée par conception) |
| `npm run verify` | Non exécuté séparément — équivalent aux 5 commandes ci-dessus, toutes exécutées individuellement avec succès (`verify` = typecheck + lint + check:migrations + test + build) |

---

## Validation sécurité

| Contrôle | Statut |
|---|---|
| Validation uniquement côté serveur | ✅ — `isValidPaymentMethod()` dans `plop-client.server.ts`/`plop-provider.server.ts`, tous deux `.server.ts` (build échoue si importé côté client). `payment.method` vient d'une lecture DB, jamais d'un input client direct (seul `paymentId`, UUID validé par zod, vient du client). |
| Aucun secret exposé | ✅ — inchangé par cette phase, confirmé par test existant (`A5 fix`) toujours vert. `PLOP_CLIENT_SECRET` jamais journalisé, `client_id` toujours tronqué dans les logs. |
| Logs sécurisés | ✅ — `payment_method`/`walletUsed` ajoutés aux résumés journalisés (`plop_api_logs`) ne sont pas des secrets, journalisation inchangée par ailleurs. |
| Idempotence paiement | ✅ — contrainte `UNIQUE(external_reference)` sur `payment_transactions` (inchangée), garde `WHERE status='pending'` dans `complete_collect_payment_secure` (reproduite fidèlement, § Validation database confirme l'absence de régression sur cette fonction). |
| Protection contre double paiement | ✅ — `IF EXISTS (... WHERE payment_id = _payment_id AND status = 'pending')` dans `create_collect_payment_secure` **préservé** dans la nouvelle migration (vérifié ligne par ligne). |
| Aucune confiance excessive au frontend | ✅ — le wallet n'est aujourd'hui jamais choisi par le client (la porte `payment.method !== "moncash"` et le flux de commande existant sont la seule source), donc aucune nouvelle surface d'attaque introduite par le paramètre `paymentMethod` tant qu'aucune UI ne l'expose. |
| **Contrôle d'autorisation existant** | 🔴 **RÉGRESSION** — voir § Validation database. Le hardening du 3 août (refus d'un `pending` fabriqué via appel RPC direct quand `moncash_auto` est désactivé) est absent de la nouvelle version de `create_collect_payment_secure`. C'est le seul point de sécurité qui échoue dans cet audit. |

---

## Risques production

| Niveau | Risque |
|---|---|
| **🔴 Critique** | Application de la migration telle quelle = perte du hardening d'accès du 3 août sur `create_collect_payment_secure`. Corrigible en une seule insertion de bloc `IF`, localisation précise fournie ci-dessus. |
| **Faible** | Absence de contrainte `CHECK` sur `payment_method_requested`/`payment_method_used` — défense en profondeur manquante, pas un vecteur d'attaque réel vu que seul du code serveur déjà validé écrit ces colonnes. |
| **Faible** | Aucun test SQL direct des nouveaux paramètres RPC contre une vraie base avant application. |
| **Négligeable** | Message d'erreur `'MonCash Automatik...'` non renommé en "Peman Otomatik" dans le SQL — cosmétique, déjà noté dans le rapport Phase 1 lui-même. |

---

## Migration

Décision : **NEEDS CHANGES**

Corriger `supabase/migrations/20260804130000_plop_wallet_traceability.sql` en réinsérant le bloc de hardening manquant (§ Validation database) avant toute application. Une fois corrigée, ré-exécuter `npm run check:migrations` (confirmera de nouveau 0 hazard de surcharge — inchangé, ce n'est pas ce qui était en cause) et idéalement une validation SQL directe (transaction `BEGIN`/`ROLLBACK` simulant les deux scénarios : création normale, et tentative de contournement avec `moncash_auto.enabled=false`) avant application réelle.

## Commit

Décision : **BLOCKED**

Bloqué par la même cause que la migration — commit le code TypeScript (déjà validé, sans réserve) séparément de la migration corrigée si vous préférez ne pas attendre, mais **ne jamais commit la migration SQL dans son état actuel** sans le correctif ci-dessus, pour éviter qu'une relecture future du fichier de migration seul (sans ce rapport sous les yeux) ne la considère à tort comme prête à appliquer.
