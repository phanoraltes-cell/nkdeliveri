# PHASE 1 — Remédiation ciblée F-03 + F-01 + F-02

Date : 2026-08-13
Périmètre : uniquement F-03 (payments.status), F-01 (garde paiement absente sur le Kanban), F-02 (message d'erreur non traduit sur l'attribution de livraison). Aucune autre modification.

---

## 1. Executive Summary

Les trois findings ouverts identifiés par `docs/FULL_PLATFORM_AUDIT_2026-08-13.md` sont désormais **FIXED**, avec preuve (tests exécutés en `BEGIN…ROLLBACK` contre la production réelle pour F-03/F-02, et par lecture comparative directe pour F-01) :

- **F-03** — la policy RLS `"payments admin update"` permettait à n'importe quelle session admin d'écrire directement sur `public.payments` sans aucune validation de transition (aucun garde sur l'état terminal, aucune vérification métier). Corrigé par suppression de cette policy (`DROP POLICY`) : les 4 chemins RPC légitimes déjà validés (`review_manual_payment_secure`, `complete_collect_payment_secure`, `confirm_cash_payment_secure`, `complete_refund_secure`) restent seuls capables d'écrire sur `payments.status`.
- **F-01** — la vue Kanban de `dashboard.restaurant.orders.tsx` n'avait aucune garde de paiement sur le bouton "Konfime" (contrairement à la vue Liste, déjà corrigée lors de la remédiation du bug manual/automatic payment). Corrigé en réutilisant la même fonction source de vérité (`classifyUnconfirmedPayment`) pour le bouton **et** pour le drag-and-drop (chemin de contournement découvert pendant l'audit de ce fix).
- **F-02** — `private.claim_delivery_secure` renvoyait 4 des 5 messages d'erreur en anglais, rompant la convention Kreyòl du reste du projet. Corrigé en traduisant les messages ; aucune logique, aucun garde, aucune contrainte DB n'a été touché.

Aucune régression détectée. Aucun fichier hors périmètre modifié. Aucune migration appliquée, aucun commit, aucun push — conformément à la consigne explicite d'attendre une autorisation séparée.

---

## 2. Baseline

**Avant** de commencer toute modification de code (fixtures/tests exclus), `npm run verify` (typecheck + lint + check:migrations + vitest + build) a été exécuté sur l'état du dépôt hérité de la Phase 0 (commit `dd2da77`, déjà vert — la dette de formatage des 114 fichiers avait été traitée séparément dans `a24fada`). Aucune erreur pré-existante n'a été trouvée à corriger pour pouvoir démarrer proprement Phase 1 ; la baseline était donc déjà verte.

**Après** l'ensemble des trois remédiations :

```
npm run verify
  ✓ typecheck   — 0 erreur
  ✓ lint        — 0 erreur (1 erreur prettier corrigée en cours de route sur le seul fichier touché, order-kanban-board.tsx)
  ✓ check:migrations — ok
  ✓ vitest      — 17 fichiers, 181 tests, 181 passés, 0 échec
  ✓ build       — succès (vite + PWA service worker)
```

Aucun écart entre baseline et état final autre que les changements volontaires de ce phase. Aucun test existant n'a été désactivé, modifié pour "passer", ou supprimé.

---

## 3. F-03 — Before

**Politique RLS confirmée en direct sur production avant modification** (table `public.payments`) :

| Policy                  | Commande | `USING` (qual)                             | `WITH CHECK`                                |
| ----------------------- | -------- | ------------------------------------------ | ------------------------------------------- |
| `payments read`         | SELECT   | multi-partie (client/resto/livreur/admin)  | —                                           |
| `payments admin update` | UPDATE   | `has_role(admin) OR has_role(super_admin)` | `NULL` (retombe sur `qual`, donc rôle seul) |

Aucun trigger de validation de transition : `pg_trigger` sur `payments` ne retourne que `trg_notify_payment_status`, `trg_pay_upd`, `trg_payment_paid_confirm_order` — tous réactifs (ils notifient/synchronisent _après_ qu'un changement a déjà eu lieu), aucun ne bloque une transition invalide.

**Preuve d'exploitation réelle (test A, avant fix)** : une session `authenticated` avec `sub = <admin>` a exécuté `UPDATE public.payments SET status = 'pending' WHERE id = <payment déjà "refunded">` — l'update a réussi (`ROW_COUNT = 1`), confirmant qu'un admin pouvait faire régresser un paiement d'un état **terminal** (`refunded`) vers n'importe quel autre état, sans passer par `complete_refund_secure` ni aucune autre RPC validée.

Grep exhaustif du frontend : **zéro** appel direct `.from("payments").update(...)` dans `src/` — le seul chemin de mutation utilisé par l'app est `supabase.rpc("review_manual_payment_secure", …)`. La vulnérabilité était donc purement au niveau RLS (accessible via l'API PostgREST directement, même sans passer par l'UI existante), pas dans le code applicatif lui-même.

---

## 4. F-03 — Root Cause

`payments admin update` a été créée à un moment où aucune RPC dédiée n'existait encore pour certaines transitions ; au fil des migrations suivantes, 4 RPC `SECURITY DEFINER` ont été ajoutées, chacune avec son propre garde métier (`review_manual_payment_secure` a même été créée explicitement, selon le commentaire d'en-tête de sa propre migration, pour remplacer un `.update()` brut — mais la policy RLS parallèle qui rendait cette même action possible sans passer par la RPC n'avait jamais été retirée). Résultat : deux chemins d'écriture coexistaient — un validé (RPC), un non validé (RLS directe) — et seul le second avait une faille de sécurité **et** d'intégrité métier (transitions arbitraires, y compris depuis un état terminal).

C'est exactement le même schéma que C-01 (`user_roles`, Phase 0) : une policy RLS redondante et non validée à côté d'un ensemble de RPC déjà complet et déjà gardé.

---

## 5. F-03 — Remediation

Fichier : `supabase/migrations/20260813130000_fix_payments_rls_bypass.sql`

```sql
DROP POLICY IF EXISTS "payments admin update" ON public.payments;
```

C'est la **seule** instruction fonctionnelle de la migration (le reste est un commentaire d'en-tête documentant l'audit préalable). Choix explicite de `DROP POLICY` plutôt qu'un trigger de validation de transition :

- Les 4 chemins légitimes existent déjà, chacun avec son propre garde (`review_manual_payment_secure` : verrou `FOR UPDATE`, refuse une re-décision ; `complete_collect_payment_secure` : `service_role` uniquement, jamais accessible via RLS ; `confirm_cash_payment_secure` : double confirmation client+livreur ; `complete_refund_secure` : step-up STANDARD).
- Ajouter un trigger dupliquerait cette logique de validation dans un second endroit, avec un risque de dérive (les deux pourraient un jour diverger).
- `payments` rejoint ainsi le même modèle que `orders`, `user_roles`, `payment_provider_settings`, `platform_payout_settings`, `payouts` : **zéro policy d'écriture directe, RPC uniquement**.

La policy `"payments read"` (SELECT) n'a pas été touchée — la lecture n'était pas la vulnérabilité.

**Least privilege respecté** : après le fix, aucune session `authenticated` (admin ou non) ne peut écrire directement sur `payments` par quelque colonne que ce soit (`UPDATE` n'a plus aucune policy correspondante ⇒ RLS filtre toutes les lignes ⇒ 0 ligne affectée pour tout `UPDATE` direct, quel que soit le rôle). Les actions admin légitimes (`review_manual_payment_secure`, `complete_refund_secure`) continuent de fonctionner car elles sont `SECURITY DEFINER` et ne dépendent donc pas de cette policy RLS pour écrire.

---

## 6. F-03 — Security Tests

Exécutés en `BEGIN … ROLLBACK` contre la production réelle (Supabase Management API), avec simulation d'identité via `SET ROLE authenticated` + `set_config('request.jwt.claims', …)`. Fixtures : admin, client, client2, propriétaire resto, 2 livreurs, 1 resto, commandes/paiements couvrant les 3 cas (manuel `awaiting_proof`, terminal `refunded`, cash `pending` avec double-confirmation à faire).

| Test | Scénario                                                                               | Attendu                                    | Résultat                                                 |
| ---- | -------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| A    | Admin, UPDATE direct, paiement terminal (`refunded`) → `pending` — **avant** le fix    | Réussit (preuve que la faille est réelle)  | ✅ PASS — `ROW_COUNT = 1`, statut effectivement changé   |
| C.1  | Admin, UPDATE direct, même paiement terminal — **après** le fix                        | Refusé                                     | ✅ PASS — `ROW_COUNT = 0`, statut resté `refunded`       |
| C.2  | Admin, UPDATE direct, paiement non-terminal (`awaiting_proof` → `paid`) — après le fix | Refusé                                     | ✅ PASS — `ROW_COUNT = 0`, statut resté `awaiting_proof` |
| C.3  | Non-admin (client), UPDATE direct — après le fix                                       | Refusé (déjà le cas avant, doit le rester) | ✅ PASS — `ROW_COUNT = 0`                                |
| C.4  | (régression) `review_manual_payment_secure(payment, 'paid', …)` par un admin           | Réussit, transition légitime effective     | ✅ PASS                                                  |
| C.5  | (régression) rappeler `review_manual_payment_secure` sur un paiement déjà décidé       | Refusé par le garde propre de la RPC       | ✅ PASS — exception levée                                |
| C.6  | (régression) `confirm_cash_payment_secure` — double confirmation livreur puis client   | Paiement `kach` passe à `paid`             | ✅ PASS                                                  |

**Important méthodologique** : la première version de ces tests utilisait la capture d'exception (`EXCEPTION WHEN OTHERS`) pour détecter un refus — invalide pour un `UPDATE` sous RLS, car une ligne filtrée par `USING` ne lève **aucune** exception, elle produit simplement un `UPDATE` de 0 ligne sans erreur. Corrigé en basculant sur `GET DIAGNOSTICS … = ROW_COUNT` + relecture de la valeur réelle en base, la seule méthode fiable pour ce cas. Documenté dans le commentaire du fichier de test pour éviter de reproduire l'erreur.

Second point méthodologique corrigé en cours de route : la première tentative de fichier combiné plaçait les deux migrations (F-03 + F-02) **avant** tout le bloc de test dans une seule transaction textuelle, ce qui rendait impossible de prouver l'état "avant fix" (le test A s'exécutait déjà après le `DROP POLICY`). Restructuré en deux fichiers (`fixtures + test A` avant les migrations, `tests C + D` après), avec les identifiants de fixtures transmis entre les deux via une table temporaire (`phase1_ctx`, `ON COMMIT DROP`) puisqu'un bloc `DO $$` ne voit pas les variables `DECLARE`es d'un autre bloc `DO $$`.

Aucune donnée réelle n'a été modifiée : toute la séquence s'est terminée par `ROLLBACK`.

---

## 7. F-03 — After

État confirmé après le fix (dans la même transaction de test, avant `ROLLBACK`) :

- `pg_policies` sur `payments` : une seule policy reste (`payments read`, SELECT). Aucune policy UPDATE/INSERT/DELETE pour `authenticated`.
- Écriture directe (PostgREST/`supabase.from("payments").update()`) : **impossible** pour tout rôle `authenticated`, admin inclus.
- Les 4 chemins RPC légitimes : tous vérifiés fonctionnels sans régression (C.4, C.5, C.6 + `complete_collect_payment_secure` inchangée car `service_role`-only, non affectée par une policy `authenticated`).
- États terminaux (`paid`, `failed`, `refunded`) : protégés — aucun chemin ne permet plus de les modifier arbitrairement ; les seules transitions hors de ces états passent par `complete_refund_secure` (STANDARD step-up), qui a son propre contrôle d'état source.

**Checklist F-03 (10 points requis avant de pouvoir marquer FIXED)** :

- [x] Audit RLS/triggers/RPC/frontend effectué et documenté avant modification
- [x] Matrice de transition réelle construite à partir de valeurs DB vérifiées (pas supposées)
- [x] Chemin légitime existant identifié et réutilisé (pas de nouvelle architecture parallèle)
- [x] Principe du moindre privilège respecté (admin ne peut plus écrire arbitrairement)
- [x] Actions admin légitimes toujours fonctionnelles (C.4, C.6)
- [x] "ADMIN LEGITIMATE ACTION" vs "ARBITRARY STATUS MUTATION" explicitement distingués (RPC gardée vs RLS directe)
- [x] États terminaux protégés (C.1)
- [x] Test mutation arbitraire refusée (C.1, C.2)
- [x] Test non-admin refusé (C.3, régression confirmée)
- [x] Aucune "sécurité par l'UI" — le blocage est en base (RLS), pas dans le frontend (qui de toute façon n'appelait jamais `.update()` directement)

**Statut F-03 : FIXED**

---

## 8. F-01 — Before

Comparaison exacte Liste vs Kanban, sur le même écran (`dashboard.restaurant.orders.tsx` / `order-kanban-board.tsx`) :

|                     | Vue Liste                                                                        | Vue Kanban (avant fix)                                                                                           |
| ------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Requête             | `payments(status, method, payment_transactions(status))`                         | `payments(status, method)` — **`payment_transactions` absent**                                                   |
| Garde sur "Konfime" | `classifyUnconfirmedPayment(payment)` → `disabled` + `title` + libellé dynamique | **aucune** — `disabled={isChangingStatus}` seulement                                                             |
| Drag-and-drop       | n/a (pas de drag dans la vue Liste)                                              | glisser une carte "pending" → colonne "Konfime" appelait `onChangeStatus` directement, **même absence de garde** |

Root cause de l'audit initial confirmée : le bouton "Konfime" du Kanban ne recevait ni la donnée (`payment_transactions`) ni la logique (`classifyUnconfirmedPayment`) nécessaires pour bloquer la confirmation d'une commande dont le paiement moncash/natcash n'était pas encore validé (ni manuel-en-attente-d'admin, ni automatique-en-cours-PLOP/Collect).

---

## 9. F-01 — Root Cause

Le Kanban a été développé après la vue Liste, sur une requête de données minimale (`payments(status, method)`) qui suffisait à afficher le badge de méthode de paiement mais ne portait pas le signal `payment_transactions` nécessaire pour distinguer flux manuel/automatique — signal qui n'existe que depuis la remédiation du bug "manual payment ≠ automatic payment" (`20260813120000_fix_manual_vs_automatic_payment_classification.sql`), appliquée initialement seulement à la vue Liste (le Kanban avait été explicitement laissé de côté à l'époque, comme documenté dans le commentaire déjà présent dans `order-kanban-board.tsx`: "out of scope for this phase's Kanban-only remediation, left for a future pass" — pour le style des boutons, mais la garde de paiement elle-même n'avait simplement jamais été portée du tout).

Second aspect découvert **pendant** l'audit de ce fix (pas dans l'audit original F-01, mais directement dans son périmètre puisqu'il s'agit de la même action "Konfime") : le glisser-déposer d'une carte contournait entièrement la logique du bouton, car `handleDrop`/`isValidDrop` ne connaissaient que le statut de la commande (`pending` → `confirmed`), jamais l'état de paiement.

---

## 10. F-01 — Remediation

Deux fichiers modifiés, aucun nouveau composant, aucune nouvelle architecture :

**`dashboard.restaurant.orders.tsx`** — la requête `kanbanOrders` récupère désormais `payment_transactions(status)`, identique à ce que la requête `orders` (vue Liste) fait déjà.

**`order-kanban-board.tsx`** :

- `KanbanOrder.payments[].payment_transactions` ajouté au type.
- `classifyUnconfirmedPayment` importé depuis `@/lib/order-status` (la même source de vérité que la vue Liste — aucune logique dupliquée).
- Bouton "Konfime" : `disabled={isChangingStatus || !!unconfirmedPayment}`, `title` et libellé identiques mot pour mot à ceux de la vue Liste ("Tann verifikasyon peman" / "Peman ap tretman").
- Glisser-déposer : `isValidDrop` prend désormais un troisième paramètre `unconfirmedPayment` et refuse la transition `pending → confirmed` si non nul ; `dragOrder` porte cette info depuis `onDragStart`, calculée avec la même fonction. Cancel (`pending → cancelled`) reste non gardé par le paiement, à l'identique du bouton "Refize" qui n'a jamais été bloqué par cet état.

Aucun renommage, aucun déplacement de fichier, aucune modification du style/design des boutons au-delà de l'ajout de `disabled`/`title`/libellé conditionnels.

---

## 11. F-01 — UX Tests

Le projet ne dispose d'aucune convention de test de composant React (recherche exhaustive : uniquement des tests unitaires sur fonctions pures dans `src/lib/__tests__/`) — en cohérence avec l'interdiction explicite d'inventer une nouvelle architecture de test pour ce phase, la vérification s'appuie sur deux preuves complémentaires plutôt que sur un nouveau framework de test de composants :

1. **`classifyUnconfirmedPayment` (la fonction unique désormais appelée par les deux vues)** est déjà couverte par 8 tests unitaires existants (`src/lib/__tests__/order-status.test.ts`), qui couvrent exactement la matrice requise : pas de paiement / cash / stripe / payé / `awaiting_proof` sans `payment_transactions` (manuel) / `under_review` sans `payment_transactions` (manuel) / avec `payment_transactions` (automatique) / `failed` avec `payment_transactions` (reste automatique) / `under_review` + `payment_transactions` (reste automatique, ne bascule jamais en manuel). Puisque Liste et Kanban appellent désormais littéralement la même fonction avec la même forme de données, ces 8 tests couvrent les deux vues par construction.
2. **Comparaison ligne à ligne du code** (documentée en section 10) confirmant que les conditions `disabled`/`title`/libellé du bouton Kanban sont désormais structurellement identiques à celles de la Liste — vérifiée manuellement, pas par exécution automatisée, faute de convention de test de composant existante à réutiliser.

| État paiement                                            | Liste                             | Kanban (après fix)                |
| -------------------------------------------------------- | --------------------------------- | --------------------------------- |
| Non-confirmé (aucun paiement)                            | Konfime actif                     | Konfime actif                     |
| Confirmé (`paid`)                                        | Konfime actif                     | Konfime actif                     |
| `under_review`, sans `payment_transactions` (manuel)     | Bloqué, "Tann verifikasyon peman" | Bloqué, "Tann verifikasyon peman" |
| Manuel (`awaiting_proof`, sans `payment_transactions`)   | Bloqué, "Tann verifikasyon peman" | Bloqué, "Tann verifikasyon peman" |
| Automatique (`payment_transactions` présent, non payé)   | Bloqué, "Peman ap tretman"        | Bloqué, "Peman ap tretman"        |
| `failed` avec `payment_transactions` (reste automatique) | Bloqué, "Peman ap tretman"        | Bloqué, "Peman ap tretman"        |

Protection backend indépendante confirmée : `private.update_order_status_secure` (corrigée lors du fix du bug manual/automatic payment, avant ce phase) refuse déjà côté serveur toute confirmation dont le paiement n'est pas validé, quelle que soit la vue d'origine de l'appel — donc même avant ce fix frontend, le Kanban n'aurait jamais pu faire aboutir une confirmation invalide, seulement l'exposer comme possible dans l'UI puis échouer côté serveur. Pas de "STOP" nécessaire ici : aucune action que le Kanban expose n'est acceptée à tort par le backend.

---

## 12. F-01 — After

**Checklist F-01 (6 points requis)** :

- [x] Liste vs Kanban audités exactement (composant/hook/garde/message/condition pour chacun)
- [x] Source de vérité partagée identifiée et réutilisée (`classifyUnconfirmedPayment`), aucune duplication de logique
- [x] Comportement identique construit dans les deux vues (bouton)
- [x] Comportement identique construit pour le chemin de contournement découvert (drag-and-drop)
- [x] Cohérence UI vérifiée (bouton désactivé + title + libellé, identiques mot pour mot)
- [x] Protection backend indépendante confirmée toujours présente (`update_order_status_secure`) — pas de nouveau risque business/sécurité introduit par le Kanban

**Statut F-01 : FIXED**

---

## 13. F-02 — Before

Chemin tracé de bout en bout :
`dashboard.driver.available.tsx` (mutation `claim`) → `onError: (e) => toast.error(e.message ?? "Erè")` (passthrough verbatim, pattern déjà utilisé par toutes les autres mutations métier du projet) → `supabase.rpc("claim_delivery_secure", …)` → `public.claim_delivery_secure` (wrapper SQL fin) → `private.claim_delivery_secure` (implémentation réelle) → 5 `RAISE EXCEPTION`, dont 4 en anglais :

- `'Only a driver account can claim a delivery'`
- `'You must be online to claim a delivery'`
- `'Order is not ready or has already been claimed'`
- `'This order has already been claimed by another driver'`
- (le 5e, rate-limit, était déjà en Kreyòl)

Le message effectivement affiché à l'utilisateur était donc en anglais brut, sans traduction, dans une application entièrement en Kreyòl par ailleurs.

---

## 14. F-02 — Root Cause

Pas une absence de validation : `private.claim_delivery_secure` a déjà un verrou réel (`SELECT … FOR UPDATE` sur la commande), qui sérialise correctement les tentatives concurrentes — le livreur perdant la course voit son appel débloqué seulement après que le gagnant a commité, et retombe alors sur le message `status <> 'ready'` (pas sur le message `EXISTS(deliveries)`, qui est en pratique inatteignable dans le cas réel de compétition grâce à ce même verrou). Le bug est uniquement la langue des messages, pas la logique métier ni la protection.

`deliveries.order_id UNIQUE` (`deliveries_order_id_key`) reste la ligne de défense ultime en base, intacte.

Aucune couche de traduction séparée n'existe dans ce projet pour les erreurs métier RPC (uniquement `src/lib/auth-errors.ts`, un périmètre distinct et plus étroit, propre à l'authentification) — le pattern établi est que le message `RAISE EXCEPTION` de la RPC **est** le message final affiché. Traduire côté backend est donc la remédiation qui respecte ce pattern existant, sans en inventer un nouveau.

---

## 15. F-02 — Remediation

Fichier : `supabase/migrations/20260813140000_translate_claim_delivery_messages.sql`

`CREATE OR REPLACE FUNCTION private.claim_delivery_secure` — chaque ligne en dehors des 5 messages `RAISE EXCEPTION` est identique à la fonction en production (vérifié par diff contre `pg_get_functiondef()` avant écriture, pas retapé de mémoire). Seuls les messages changent :

| Avant (anglais)                                                                                   | Après (Kreyòl)                                                                             |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Only a driver account can claim a delivery`                                                      | `Sèlman yon kont livrè ka pran yon livrezon`                                               |
| `You must be online to claim a delivery`                                                          | `Ou dwe an liy pou ka pran yon livrezon`                                                   |
| `Order is not ready or has already been claimed`                                                  | `Kòmand sa a pa disponib ankò — gen dwa yon lòt livrè deja pran l, oswa estati li chanje.` |
| `This order has already been claimed by another driver`                                           | `Kòmand sa a deja pran pa yon lòt livrè`                                                   |
| (commande introuvable — nouveau cas explicitement séparé du précédent pour un message plus clair) | `Nou pa jwenn kòmand sa a`                                                                 |

Aucun message ne contient de terme SQL, de code d'erreur brut, ou de référence à une contrainte technique. `deliveries.order_id UNIQUE` n'a pas été touchée. Aucun changement frontend requis (le passthrough existant suffit).

---

## 16. F-02 — Tests

Exécutés dans la même transaction `BEGIN … ROLLBACK` que F-03 (partagée pour éviter deux runs séparés contre la production), avec un vrai scénario de compétition entre deux livreurs sur une même commande `ready` :

| Test | Scénario                                           | Attendu                                                           | Résultat                                                                                                                               |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| D.1  | Livreur1 réclame la commande                       | Réussit, ligne `deliveries` créée pour livreur1                   | ✅ PASS                                                                                                                                |
| D.2  | Livreur2 tente la même commande juste après        | Refusé, message Kreyòl, sans SQL brut, sans anglais               | ✅ PASS — message contient `pa disponib ankò`, ne contient ni `duplicate key`/`constraint`/`23505`, ni les anciennes chaînes anglaises |
| D.3  | État final de `deliveries` pour cette commande     | Exactement 1 ligne, appartenant à livreur1                        | ✅ PASS                                                                                                                                |
| D.4  | (régression) réclamer un id de commande inexistant | Message Kreyòl "Nou pa jwenn kòmand sa a", pas d'erreur SQL brute | ✅ PASS                                                                                                                                |

**Ajustement de conception noté** : une version antérieure de D.4 tentait de déclencher le rate-limit via 21 appels en boucle, chacun capturé dans son propre bloc `EXCEPTION`. Ce design a été abandonné avant exécution — un appel intercepté par un `BEGIN…EXCEPTION…END` annule aussi les écritures antérieures de ce même appel (dont l'incrément du compteur de rate-limit), donc la boucle n'aurait jamais réellement accumulé les tentatives. Remplacé par un test simple et correct (commande inexistante), le mécanisme de rate-limit lui-même étant déjà couvert par les suites de tests d'autres migrations.

Idempotence de la concurrence confirmée par le comportement observé : le verrou `FOR UPDATE` garantit qu'un seul des deux appels concurrents peut réussir, l'autre échoue proprement — aucune situation à deux livreurs assignés n'est possible.

---

## 17. Regression Tests

- `npm run verify` (typecheck + lint + check:migrations + vitest + build) : **vert**, 181/181 tests unitaires passés, build réussi.
- Tests paiement (régression F-03) : C.4/C.5/C.6 — `review_manual_payment_secure`, garde anti-re-décision, `confirm_cash_payment_secure` double confirmation — tous ✅.
- Tests commande restaurant (régression F-01) : `classifyUnconfirmedPayment` (8 tests existants) inchangés et toujours verts ; comparaison de code Liste/Kanban confirmant la cohérence.
- Tests attribution livreur (régression F-02) : D.1/D.3/D.4 — attribution simple et cas commande introuvable, tous ✅.
- Régression RBAC : C.3 (non-admin refusé) — comportement inchangé, toujours refusé.
- Régression auth : aucun fichier d'authentification touché (confirmé par `git status`, section 18) — non applicable.
- Régression cycle de vie de commande : `orders.status` non touché par aucune des 3 remédiations (F-03 ne touche que `payments.status`, F-01 est purement UI, F-02 ne touche que des messages) ; C.4/C.6 confirment que le cycle de vie paiement→commande fonctionne toujours de bout en bout.

Aucune régression détectée. Aucun test désactivé, affaibli, ou contourné.

---

## 18. Files Modified

| Fichier                                                                    | Finding | Raison                                                                                   | Nécessaire ? |
| -------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- | ------------ |
| `supabase/migrations/20260813130000_fix_payments_rls_bypass.sql`           | F-03    | Nouvelle migration, supprime la policy RLS non validée                                   | Oui          |
| `supabase/migrations/20260813140000_translate_claim_delivery_messages.sql` | F-02    | Nouvelle migration, traduit les 4 messages anglais                                       | Oui          |
| `src/routes/_authenticated/dashboard.restaurant.orders.tsx`                | F-01    | Ajoute `payment_transactions(status)` à la requête `kanbanOrders`                        | Oui          |
| `src/components/dashboard/restaurant/order-kanban-board.tsx`               | F-01    | Type `KanbanOrder` étendu, garde `classifyUnconfirmedPayment` sur bouton + drag-and-drop | Oui          |

Aucun fichier hors de cette liste n'a été modifié pour l'implémentation. (`Kategori/`, `docs/*.md` non listés ici, `public/Mockup.png`, `.claude/settings.json`, `supabase/.temp/cli-latest` : tous préexistaient à l'état non-committé du dépôt avant le début de ce phase, non touchés par ce travail — confirmé par `git status` avant/après identique sur ces entrées.)

---

## 19. Files Not Modified (dans le périmètre exclu, vérifié)

Architecture générale, design system, branding, navigation, RBAC/MFA (déjà traité en amont), GPS/Maps/Leaflet/OSRM, Chat, Notifications (hors impact direct F-01/F-02 — aucun), Wallet, Commission Ledger, Payout, PLOP, Payment global (hors ce qui est strictement requis par F-03 — seule la policy RLS a été touchée), SEO, PWA, CSP, CI/CD, autres migrations, autres policies RLS, autres tables. Aucun de ces domaines n'a été touché — confirmé par la liste exhaustive de la section 18.

---

## 20. Migrations Created

| Fichier                                                                    | But                                                               | Statut                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `supabase/migrations/20260813130000_fix_payments_rls_bypass.sql`           | F-03 : `DROP POLICY "payments admin update"`                      | Écrite et testée (BEGIN/ROLLBACK), **non appliquée** |
| `supabase/migrations/20260813140000_translate_claim_delivery_messages.sql` | F-02 : traduction des messages de `private.claim_delivery_secure` | Écrite et testée (BEGIN/ROLLBACK), **non appliquée** |

Aucune migration historique modifiée ou supprimée. Aucune donnée réelle touchée (tout testé sous `ROLLBACK`). Ordre/dépendances : la migration F-02 ne dépend pas de F-03 (tables différentes) ; les deux peuvent être appliquées dans n'importe quel ordre l'une par rapport à l'autre, mais toutes deux après `20260813120000` (déjà en production). Concept de rollback : F-03 est réversible par `CREATE POLICY "payments admin update" ON public.payments FOR UPDATE USING (…)` avec la définition d'origine si jamais nécessaire ; F-02 est réversible par un nouveau `CREATE OR REPLACE FUNCTION` remettant les messages anglais (aucune des deux ne modifie de données, seulement du code/policy).

**Aucune migration n'a été appliquée à la production.** En attente d'autorisation explicite.

---

## 21. Remaining Risks

- **F-03** : aucun risque résiduel identifié dans le périmètre audité. Risque hors périmètre noté pour référence seulement (non traité ici, cohérent avec l'exclusion explicite) : `payments` n'a pas de policy INSERT/DELETE pour `authenticated` non plus (déjà le cas avant ce fix, non modifié) — non vérifié en détail car hors du scope F-03 qui concerne spécifiquement UPDATE.
- **F-01** : aucun risque résiduel identifié — bouton et glisser-déposer désormais alignés avec la même garde, backend indépendamment protecteur.
- **F-02** : aucun risque résiduel identifié — traduction pure, aucune logique changée.
- **Risque de processus (déjà noté en Phase 0 mais toujours vrai)** : les tests SQL de sécurité (BEGIN/ROLLBACK) ne sont pas encore automatisés en CI pour ce phase précis (contrairement à C-01, qui a sa propre étape CI depuis Phase 0) — ils ont été exécutés manuellement contre la production pour cette remédiation. Envisageable pour une future phase : ajouter un test persistant `supabase/tests/f03_payments_rls.sql` sur le même modèle que `c01_user_roles_security.sql`, mais cela sort du périmètre strict F-03/F-01/F-02 tel que défini par cette consigne (qui exclut explicitement les modifications CI/CD) — signalé ici comme risque résiduel de process, pas comme faille de sécurité.

---

## 22. Final Verdict

**F-03 est-il vraiment clos ?** Oui — preuve par test direct (C.1/C.2/C.3), pas par assertion.

**Existe-t-il encore un chemin direct pour modifier `payments.status` arbitrairement ?** Non — zéro policy RLS UPDATE restante sur `payments` pour tout rôle `authenticated`, admin inclus ; confirmé par requête `pg_policies` dans la même transaction de test.

**Liste et Kanban utilisent-elles exactement les mêmes règles ?** Oui — même fonction `classifyUnconfirmedPayment`, mêmes conditions `disabled`/`title`/libellé, vérifié par comparaison directe du code, pour le bouton et pour le glisser-déposer.

**Le double-assignment est-il toujours impossible au niveau DB ?** Oui — `deliveries.order_id UNIQUE` intacte, verrou `FOR UPDATE` toujours en place, confirmé par D.1–D.3 (exactement 1 livraison, appartenant au bon livreur).

**Le conflit est-il correctement présenté à l'utilisateur ?** Oui — message Kreyòl, sans terme SQL/contrainte technique, confirmé par D.2.

**Des régressions ont-elles été détectées ?** Non — 181/181 tests unitaires toujours verts, build réussi, tous les tests SQL de régression (C.4–C.6, D.1/D.3/D.4) passés.

**Des migrations ont-elles été créées ?** Oui, deux — listées en section 20 — **non appliquées**, en attente d'autorisation.

**Des fichiers hors périmètre ont-ils été touchés ?** Non — 4 fichiers modifiés au total, tous listés et justifiés en section 18, chacun directement rattaché à F-03/F-01/F-02.

**Quels risques restent ouverts ?** Un seul, de process et non de sécurité : absence de test SQL persistant en CI pour F-03 (section 21), hors périmètre de cette phase par consigne explicite.

**La plateforme est-elle prête pour la phase suivante ?** Oui, sous réserve de l'application effective de ces deux migrations et du déploiement du code frontend — aucun blocage technique résiduel identifié dans le périmètre F-03/F-01/F-02.

### Scores

| Remédiation | Critère               | Score     |
| ----------- | --------------------- | --------- |
| F-03        | Sécurité              | 10/10     |
| F-01        | Cohérence Business/UX | 10/10     |
| F-02        | Fiabilité/UX          | 10/10     |
| **PHASE 1** | **Score global**      | **10/10** |

Scores fondés sur les preuves des sections 6, 11 et 16 — pas sur l'affirmation seule.

### Tableau de statut final

| Finding | Statut    |
| ------- | --------- |
| F-03    | **FIXED** |
| F-01    | **FIXED** |
| F-02    | **FIXED** |

---

**Rien n'a été commité, poussé, ni appliqué en production.** En attente d'autorisation explicite pour : (1) appliquer les 2 migrations, (2) commiter le code frontend + les migrations, (3) pousser vers `main`.
