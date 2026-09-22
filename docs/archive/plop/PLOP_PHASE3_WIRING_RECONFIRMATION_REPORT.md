# PLOP Phase 3 — Reconfirmation du branchement Collect

**Date** : 2026-08-05
**Portée** : Étape 1 de cette mission ("Auditer tous les points de branchement... Ne rien modifier avant cette vérification") — exécutée intégralement. Les étapes 2+ (« brancher PlopProvider ») n'ont **pas** eu lieu : elles sont déjà faites, dans une mission antérieure. **Aucun fichier de code modifié. Aucune migration. Aucun commit. Aucun push. Aucun déploiement.**

## Statut

**PRÉMISSE OBSOLÈTE — TRAVAIL DÉJÀ LIVRÉ EN PRODUCTION**

---

## ⚠️ Correction nécessaire — la prémisse de cette mission ne correspond pas à l'état réel du dépôt

Cette mission part du principe que :

> "Aucun comportement client n'a encore changé. Le checkout continue volontairement d'utiliser l'ancien provider [Digicel]."

**Ce n'est pas exact.** Le branchement réel de PLOP comme moteur Collect a déjà été réalisé, testé, validé par vous, et est en production depuis le 4 août 2026 :

| Preuve                              | Constat                                                                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git log`                           | `9ff9f28 feat(payments): wire PLOP as the MonCash Automatik backend (Collect only)` — commit déjà poussé sur `main`                                                     |
| `docs/PLOP_PHASE3_WIRING_REPORT.md` | Existe déjà sur disque (10 876 octets, écrit le 4 août), fait partie du commit `9ff9f28` — c'est le rapport de _ce même_ travail de branchement, déjà livré             |
| Activation                          | `moncash_auto.enabled` a été passé à `true` par vous-même via le dashboard admin après le commit `b11a433` (rebranding "Peman Otomatik")                                |
| Test réel                           | Une vraie commande a été passée après activation — redirection PLOP confirmée, capturée dans `vercel logs --json` (l'incident `plop_api_logs` manquant, depuis corrigé) |
| Travail postérieur                  | `036a186 feat(payments): dynamic PLOP wallet selection per transaction` — une couche _supplémentaire_ a même déjà été construite par-dessus ce branchement              |

**Conséquence** : refaire "Phase 3" depuis zéro serait non seulement redondant, mais risqué — cela reviendrait à retravailler par-dessus du code déjà en production et déjà durci par la Phase de sélection dynamique de wallet, avec un risque réel de régression sur ce qui fonctionne aujourd'hui. Conformément à la propre règle de cette mission ("_En cas de découverte d'une incohérence architecturale, arrêter immédiatement... documenter le problème... avant de poursuivre_"), ce tour a été traité comme une **ré-audit de confirmation** : vérifier, point par point, que l'état réel du code satisfait bien chacune des 10 étapes demandées — pas comme une nouvelle implémentation.

Aucun fichier n'a été modifié. Le rapport ci-dessous documente ce qui est **déjà vrai**, avec preuves à l'appui (lecture directe du code, pas une supposition).

---

## Étape 1 — Points de branchement identifiés

| Composant                            | Fichier                                                                                           | Rôle réel constaté                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry historique                  | [`src/lib/payment-providers/index.server.ts`](../../../src/lib/payment-providers/index.server.ts) | `moncash_api → moncashProvider` (Digicel legacy) — **délibérément inchangé**, partagé avec le décaissement (`initiate-provider-payout.functions.ts`)                             |
| Injection réelle du provider Collect | [`src/lib/initiate-collect-payment.logic.ts`](../../../src/lib/initiate-collect-payment.logic.ts) | Importe `plopProvider` directement (`await import("@/lib/payment-providers/plop-provider.server")`), **jamais** via le registry ci-dessus — c'est le seul point d'entrée Collect |
| Provider PLOP                        | `src/lib/payment-providers/plop-provider.server.ts`                                               | Implémente `PaymentProvider`, `code: "moncash_api"` conservé                                                                                                                     |
| Gate d'activation métier             | `src/lib/payment-provider-availability.ts` → `isProviderEnabled()`                                | Lit `payment_provider_settings.enabled` en base, RLS-scopé, aucune autorité frontend                                                                                             |
| Gate de configuration secrets        | `src/lib/payment-providers/plop-config.server.ts` → `isPlopConfigured()`                          | Vrai seulement si `PLOP_CLIENT_ID`/`PLOP_CLIENT_SECRET` sont définis                                                                                                             |
| Mapping d'affichage admin            | `src/lib/payment-provider-display.ts`                                                             | `moncash_api → "PLOP"` — présentation seule, aucune donnée changée                                                                                                               |
| Checkout                             | `src/routes/checkout.tsx`                                                                         | 4 méthodes (`moncash_auto`, `moncash`, `natcash`, `kach`) toutes présentes, structure intacte                                                                                    |
| Poll côté client                     | `src/hooks/useCollectPaymentPoll.ts` + `src/lib/poll-collect-payment.{logic,functions}.ts`        | Mécanisme de confirmation primaire                                                                                                                                               |
| Cron de réconciliation               | `src/lib/payment-providers/plop-reconcile.server.ts` + `src/routes/api.cron.plop-reconcile.ts`    | Filet de sécurité quotidien                                                                                                                                                      |

**Aucune modification effectuée à cette étape** — audit en lecture seule, exactement comme demandé.

---

## Étapes 2–4 — Branchement, provider_code, activation (déjà faits, revérifiés)

- **`provider_code` inchangé** : `plopProvider.code === "moncash_api"` (`plop-provider.server.ts` ligne 51) — aucune migration de données nécessaire, confirmé.
- **Code Digicel toujours présent et compilable** : `moncash-provider.server.ts` existe, non supprimé, non renommé, toujours référencé par `index.server.ts` (utilisé pour le décaissement). `npm run typecheck` (ci-dessous) le confirme.
- **Double condition d'activation, vérifiée dans le code** (`initiate-collect-payment.logic.ts` lignes 71–103) :
  1. `isProviderEnabled(settings, "moncash_auto")` — lu depuis `payment_provider_settings` en base, **avant** tout import du provider.
  2. `plopProvider.isConfigured()` — lu depuis les variables d'environnement serveur.

  Les deux échouent séparément avec un message client distinct et un enregistrement `create_collect_payment_secure(_status:'failed', ...)` — **aucun des deux ne peut être contourné côté frontend** : cette logique tourne entièrement dans une fonction serveur (`.logic.ts`, jamais importée par un composant), le frontend ne fait qu'afficher `settings.enabled`/`settings.visible` pour l'UX, sans jamais décider lui-même si l'appel PLOP a lieu.

---

## Étape 5 — Checkout : Cash / NatCash Manuel / MonCash Manuel inchangés

`grep` de contrôle sur `checkout.tsx` :

```
id: "moncash_auto"   (Payment Global / PLOP)
id: "moncash"        (MonCash Manyèl)
id: "natcash"        (NatCash)
id: "kach"           (Kach nan livrezon / Cash)
```

Les 4 méthodes existent toujours, structure de tableau intacte. Seule `moncash_auto` route vers `plopProvider` — les 3 autres ne passent jamais par `initiate-collect-payment.logic.ts` (ce fichier refuse explicitement tout `payment.method !== "moncash"`, ligne 54).

---

## Étape 6 — Polling : conforme, non réécrit

Lecture directe de `useCollectPaymentPoll.ts` :

| Exigence de la mission            | Constat                                                                                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5s → 10s → 30s → 60s sur 15 min   | ✅ `PHASES` (lignes 25–30) : exactement ces 4 paliers                                                                                                                      |
| Jitter                            | ✅ `withJitter()` — ±20 %                                                                                                                                                  |
| Pause onglet caché                | ✅ `document.hidden` vérifié à chaque tick, écouteur `visibilitychange`                                                                                                    |
| Reprise après refresh             | ✅ Cadencé sur `createdAt` (`payment_transactions.created_at`), jamais sur l'heure de montage du composant — un refresh recalcule le bon palier au lieu de redémarrer à 5s |
| Arrêt immédiat après confirmation | ✅ `if (result.status !== "pending") { onSettledRef.current(); return; }`                                                                                                  |

Rien n'a été réécrit — c'est le mécanisme déjà en place depuis la Phase 3 originale.

---

## Étape 7 — Cron : filet de sécurité, idempotent

Lecture directe de `plop-reconcile.server.ts` :

- Ne traite que les lignes `status='pending'` vieilles d'au moins 10 min (`MIN_AGE_MS`) — laisse le poll client agir en premier.
- Finalise via `complete_collect_payment_secure` (même RPC que le poll et que le webhook dormant) — **jamais** d'écriture directe sur `payment_transactions`/`payments`.
- Cette RPC ne modifie que les lignes encore `status='pending'` (garde en base, héritée sans changement depuis `20260731130000`) : un paiement déjà confirmé par le poll client, puis revu par le cron, ne peut pas être confirmé une seconde fois — **aucune double confirmation possible**, par construction de la RPC, pas par une vérification ad hoc dans ce fichier.
- Ne marque jamais `failed` automatiquement — un silence prolongé (>3 jours) est loggé pour revue manuelle, jamais transformé en échec deviné.
- Toujours via `plopProvider.checkStatus()` (couche provider), jamais `verifyPayment()` (client bas niveau) directement — cohérent avec `moncash-reconcile.server.ts`.

---

## Étape 8 — Sécurité

| Vérification                                                               | Résultat                                                                                                                                                                          |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLOP_CLIENT_SECRET` jamais dans les logs                                  | ✅ `grep` sur `plop-client.server.ts`/`plop-reconcile.server.ts` : le terme n'apparaît que dans un commentaire, jamais dans un appel `console.*` ou une insertion `plop_api_logs` |
| `client_id` (seul identifiant que PLOP exige) redacté avant journalisation | ✅ `redactId()` — 4 premiers/derniers caractères seulement, appliqué avant `requestSummary` (lignes 312/405)                                                                      |
| Aucun secret envoyé au frontend                                            | ✅ `plop-config.server.ts`/`plop-client.server.ts` sont `.server.ts` — le build échoue si un composant/route les importe directement (règle déjà en place, pas nouvelle)          |
| Aucun token dans les exceptions                                            | ✅ `getPlopConfig()` ne liste, en cas d'échec, que les **noms** de variables manquantes (`PLOP_CLIENT_ID, PLOP_CLIENT_SECRET`), jamais une valeur                                 |
| Aucune URL sensible dans les réponses API                                  | ✅ `PLOP_BASE_URL` est une constante publique documentée (`plopplop.solutionip.app`), aucune URL de callback/secret à exposer (PLOP n'a pas de webhook, § Contexte)               |

---

## Compatibilité — aucune régression identifiée

| Domaine                                    | Constat                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cash                                       | Méthode `kach` intacte dans `checkout.tsx`, ne passe jamais par `initiate-collect-payment.logic.ts`                                                                                                          |
| NatCash Manuel                             | Méthode `natcash` intacte, provider `natcashProvider` toujours dans le registry, non touché                                                                                                                  |
| MonCash Manuel                             | Méthode `moncash` intacte                                                                                                                                                                                    |
| Décaissements                              | `index.server.ts` (registry partagé) confirmé inchangé — `moncash_api → moncashProvider` reste la route de décaissement, jamais `plopProvider`                                                               |
| Dashboard financier / wallets / commission | Aucun de ces fichiers n'apparaît dans le chemin Collect PLOP (`initiate-collect-payment.logic.ts`, `plop-provider.server.ts`, `plop-client.server.ts`, `poll-collect-payment.*`, `plop-reconcile.server.ts`) |
| Notifications existantes                   | Non touchées — aucun fichier de notification modifié                                                                                                                                                         |
| Realtime                                   | Non touché                                                                                                                                                                                                   |
| Chat / GPS                                 | Sans rapport avec ce périmètre, non touchés                                                                                                                                                                  |

---

## Vérifications techniques — exécutées réellement

| Commande                   | Résultat                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`        | ✅ Propre, aucune erreur                                                                                                                       |
| `npm run lint`             | ✅ 0 erreur (12 avertissements préexistants `react-refresh/only-export-components`, sans rapport avec PLOP)                                    |
| `npm run check:migrations` | ✅ "117 migrations scanned, 2 historical overload(s) all later cleaned up, no unresolved hazards"                                              |
| `npx vitest run`           | ✅ **98/98 tests**, 9 fichiers                                                                                                                 |
| `npx vite build`           | ✅ Réussi — 252 entrées precache PWA (inclut les nouveaux assets `public/payment-global/` de la mission précédente, sans rapport avec ce tour) |

Les 5 commandes de `npm run verify` ont donc chacune été exécutées avec succès (individuellement, pour un diagnostic plus lisible qu'un seul log concaténé).

---

## Performances

Aucune modification de code dans ce tour → aucun impact de performance à mesurer. Le comportement runtime (temps de réponse checkout, cadence de polling, fréquence du cron) reste strictement celui déjà en production depuis le 4 août.

---

## Risques résiduels

| Niveau          | Risque                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Négligeable** | Cette mission elle-même repose sur une prémisse obsolète (déjà signalé plus haut) — aucun risque technique, mais un risque de confusion si une future mission répète la même hypothèse sans vérifier l'état réel du dépôt d'abord. Recommandation : toujours confirmer `git log`/l'existence des rapports `docs/PLOP_PHASE*` avant de lancer une nouvelle "phase" de branchement PLOP. |
| **Aucun autre** | Tous les points du cahier des charges (10 étapes) sont déjà satisfaits par le code existant, revérifiés ligne par ligne dans ce rapport.                                                                                                                                                                                                                                               |

Aucun risque bloquant. Aucun bug critique ni incohérence architecturale découvert — seule la prémisse de la mission (pas le code) était erronée.

---

## Verdict

**Le branchement PLOP Collect demandé par cette mission est déjà en place, déjà en production, déjà validé par vous, et reconfirmé ici point par point sans qu'aucune modification n'ait été nécessaire.**

Rien à appliquer, committer, pousser ou déployer dans ce tour — conforme à la règle de livraison de cette mission, qui s'applique de toute façon puisqu'aucun changement n'a été fait.

**Si votre intention était de déclencher un nouveau chantier** (ex. router un nouveau volume vers PLOP pour NatCash, corriger un bug spécifique observé en production, ou revalider après un incident réel), précisez lequel — ce rapport ne referme aucune porte, il documente seulement que "Phase 3 : brancher PLOP" au sens littéral de cette mission n'a plus de travail restant à faire.
