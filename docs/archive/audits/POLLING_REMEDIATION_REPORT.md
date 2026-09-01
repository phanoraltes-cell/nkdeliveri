# Rapport — Remédiation P2 : Polling Collect (`useCollectPaymentPoll`)

Date : 2026-08-08 · Portée stricte : la couche de polling client (`src/hooks/useCollectPaymentPoll.ts`). **RPC, SQL, PLOP et checkout n'ont pas été touchés** — confirmé ci-dessous par `git status`.

---

## 1. Résumé exécutif

Un vrai bug de **double polling / réentrance** a été trouvé et corrigé : lors de basculements rapides d'onglet (caché→visible→caché→visible), rien n'empêchait un deuxième `tick()` de démarrer alors que le premier attendait encore sa réponse réseau — chacun aurait ensuite indépendamment reprogrammé son propre cycle, dupliquant le polling à partir de ce moment. Corrigé avec un simple verrou de réentrance (`inFlight`).

Tout le reste (4 phases dégressives, jitter, pause/reprise sur visibilité, arrêt à 15 minutes, arrêt immédiat après règlement, nettoyage à l'unmount) était déjà correct.

**Aucune infrastructure de test pour les hooks React n'existait dans ce projet** (environnement Vitest configuré en `"node"`, sans jsdom/React-Testing-Library — vérifié, pas supposé). Plutôt que d'ajouter une nouvelle dépendance pour une mission au périmètre volontairement étroit, la machine à états (`schedule`/`tick`/`visibilitychange`) a été extraite dans une fonction pure et injectable, `createPollController` — **API publique du hook strictement identique, comportement strictement identique**, mais maintenant testable en Node pur avec des faux timers et un faux `document`. 18 nouveaux tests, tous verts.

---

## 2. Le bug trouvé — preuve directe

### Où

`tick()`, appelée soit par le `setTimeout` planifié par `schedule()`, soit immédiatement par `handleVisibilityChange()` au retour de visibilité.

### Séquence du bug (avant correctif)

1. Onglet caché depuis un moment → aucun tick programmé activement (`tick()` retourne tôt tant que `document.hidden`, sans jamais se reprogrammer pendant qu'il l'est).
2. Onglet redevient visible → `handleVisibilityChange` efface le timer en attente et appelle `tick()` immédiatement. `tick()` démarre, envoie la requête réseau (`await pollRef.current(...)`) — **en attente**.
3. **Avant que cette requête ne réponde**, l'onglet est caché puis revisible une seconde fois (bascule rapide, plausible : changement d'app mobile, écran qui se verrouille/déverrouille vite, alt-tab rapide) → `handleVisibilityChange` se déclenche à nouveau et appelle `tick()` **une deuxième fois** — rien ne l'empêchait, aucun verrou de réentrance n'existait.
4. Les deux `tick()` s'exécutent en parallèle, chacun avec son propre appel réseau. À la fin, **chacun** appelle indépendamment `schedule()` — le second écrase la référence `timeoutHandle` du premier, rendant ce dernier orphelin et non annulable : il se déclenchera quand même plus tard, créant une deuxième chaîne de polling parallèle à partir de cet instant.

### Correctif appliqué

Un verrou de réentrance simple (`inFlight`) dans `tick()` :

```ts
async function tick() {
  if (cancelled) return;
  if (inFlight) return; // <-- nouveau : bloque tout tick() concurrent
  if (doc.hidden) return;
  inFlight = true;
  try {
    // ... appel réseau inchangé ...
  } finally {
    inFlight = false;
  }
  schedule();
}
```

Un deuxième `handleVisibilityChange` pendant qu'un tick est en vol devient un no-op sûr — le tick légitime, à sa résolution, reprogramme normalement la suite. Aucun autre comportement n'est modifié : le cas courant (un seul retour de visibilité, pas de bascule rapide) n'est jamais affecté par ce verrou.

**Prouvé par un test dédié** (`REGRESSION — rapid hidden→visible→hidden→visible never starts a second overlapping tick...`) : avec un `poll()` dont la résolution est contrôlée manuellement (pour garder un tick "en vol"), le test déclenche exactement la séquence ci-dessus et vérifie que `poll` n'a été appelé **qu'une seule fois** malgré les deux retours de visibilité. Un second test vérifie que `onSettled` n'est jamais appelé plus d'une fois dans le même scénario si le tick en vol se termine par un règlement.

---

## 3. Refactor de testabilité — pourquoi, et ce qui n'a pas changé

**Constat vérifié, pas supposé** : `vitest.config.ts` a `environment: "node"` ; ni `jsdom`, ni `happy-dom`, ni `@testing-library/react`, ni `react-test-renderer` ne sont présents dans `node_modules` — ce hook n'avait jamais eu de test unitaire (`src/hooks/__tests__/` n'existait même pas). Ajouter une dépendance de test DOM pour une mission au périmètre strictement limité à cette couche n'était pas justifié.

La machine à états interne (auparavant piégée dans le corps du `useEffect`, dépendant directement des globales `document`/`setTimeout`) a été extraite en une fonction exportée `createPollController({ externalReference, createdAt, poll, onSettled, doc?, now?, setTimeoutFn?, clearTimeoutFn? })`, où `doc`/`now`/les timers sont **optionnels** et retombent sur les vraies globales en production. Le hook React devient un fin wrapper :

```ts
useEffect(() => {
  if (!enabled || !externalReference || !createdAt) return;
  const controller = createPollController({
    externalReference,
    createdAt,
    poll: (a) => pollRef.current(a),
    onSettled: () => onSettledRef.current(),
  });
  controller.start();
  return () => controller.stop();
}, [enabled, externalReference, createdAt]);
```

**Ce qui n'a PAS changé** : la signature publique du hook (`useCollectPaymentPoll({enabled, externalReference, createdAt, onSettled})`), les 4 phases et leurs seuils, la formule de jitter, la logique de pause/reprise sur `visibilitychange`, le comportement de nettoyage à l'unmount, le traitement des erreurs de tick (jamais fatal). Vérifié par lecture croisée ligne à ligne de l'ancienne et de la nouvelle version, et par le build de production (voir § 5) qui confirme que `orders.$id.tsx` (seul consommateur de ce hook) continue de compiler et de s'intégrer sans changement de son côté.

---

## 4. Vérification, point par point

| Point demandé                     | Constat                                                                                                                                                                                                                                                                                                                                                                                                   | Preuve                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **5s** (0–30s)                    | ✅ Intact                                                                                                                                                                                                                                                                                                                                                                                                 | `intervalForElapsed(0..29999)` → 5000ms — testé aux bornes                                                                                                                        |
| **10s** (30s–2min)                | ✅ Intact                                                                                                                                                                                                                                                                                                                                                                                                 | `intervalForElapsed(30000..119999)` → 10000ms — testé aux bornes                                                                                                                  |
| **30s** (2–5min)                  | ✅ Intact                                                                                                                                                                                                                                                                                                                                                                                                 | `intervalForElapsed(120000..299999)` → 30000ms — testé aux bornes                                                                                                                 |
| **60s** (5–15min)                 | ✅ Intact                                                                                                                                                                                                                                                                                                                                                                                                 | `intervalForElapsed(300000..899999)` → 60000ms — testé aux bornes                                                                                                                 |
| **Jitter**                        | ✅ Intact — ±20%, plancher 1000ms                                                                                                                                                                                                                                                                                                                                                                         | 200 itérations testées sur chaque borne                                                                                                                                           |
| **Pause onglet caché**            | ✅ Intact — `tick()` ne fait rien tant que `doc.hidden`, jamais de reprogrammation pendant que caché                                                                                                                                                                                                                                                                                                      | Test : 5 minutes simulées, onglet caché en permanence → 0 appel réseau                                                                                                            |
| **Reprise**                       | ✅ Intact — `visibilitychange` (visible) efface le timer en attente et déclenche une vérification immédiate                                                                                                                                                                                                                                                                                               | Test : caché 60s (0 appel), puis visible → 1 appel immédiat                                                                                                                       |
| **Timeout** (15 min)              | ✅ Intact — au-delà, `intervalForElapsed` renvoie `null`, plus aucune programmation                                                                                                                                                                                                                                                                                                                       | Test : 20 minutes simulées puis +1h → aucun appel supplémentaire après la fenêtre                                                                                                 |
| **Arrêt immédiat après paiement** | ✅ Intact — un tick non-`pending` appelle `onSettled()` puis ne se reprogramme jamais                                                                                                                                                                                                                                                                                                                     | Test : réponse `paid` au 1er tick → 1 seul appel, `onSettled` appelé 1 fois, +10 min sans nouvel appel                                                                            |
| **Arrêt après Realtime**          | ✅ Intact, au niveau `controller.stop()` — le vrai déclencheur (`enabled` passe à `false` dans `orders.$id.tsx` quand Realtime invalide la requête) est hors périmètre de cette couche mais vérifié par lecture : `useRealtimeTableSync("payments", ...)` invalide `["order", id]`, ce qui fait disparaître `pendingCollectTransaction` au rendu suivant, donc `enabled:false`, donc démontage de l'effet | Test : `controller.stop()` puis +10 min → aucun appel supplémentaire                                                                                                              |
| **Polling infini**                | ❌ Aucun risque trouvé — arrêt garanti à 15 min                                                                                                                                                                                                                                                                                                                                                           | Voir "Timeout" ci-dessus                                                                                                                                                          |
| **Double polling**                | 🔴 **Bug réel trouvé et corrigé**                                                                                                                                                                                                                                                                                                                                                                         | § 2                                                                                                                                                                               |
| **Memory leak**                   | ❌ Aucun trouvé — `stop()` retire bien le listener `visibilitychange` ET annule le timer en attente                                                                                                                                                                                                                                                                                                       | Test : `removeEventListener` appelé avec exactement la même référence que `addEventListener` ; aucun appel réseau possible après `stop()` même si l'événement se déclenche encore |
| **Duplication**                   | 🔴 Même cause que "double polling", même correctif                                                                                                                                                                                                                                                                                                                                                        | § 2                                                                                                                                                                               |

Bonus vérifié en cours d'audit : une valeur `createdAt` malformée (`NaN` après `Date.parse`) ne provoque ni crash ni boucle — `intervalForElapsed(NaN)` retourne `null` (échec fermé, jamais une boucle serrée). Testé explicitement.

---

## 5. Tests — résultats

- Nouveau fichier `src/hooks/__tests__/useCollectPaymentPoll.test.ts` : **18 tests**, tous verts (frontières des 4 phases, jitter ×2, tapering réel sur 3 minutes simulées, arrêt à 15 min + au-delà, pause complète sur onglet caché, reprise immédiate, arrêt après règlement, arrêt après `stop()`, nettoyage listener/timer, tick en échec non fatal, **2 tests de régression pour le bug de réentrance**).
- Suite complète du projet : **128/128** ✅ (110 pré-existants + 18 nouveaux).
- `npm run typecheck` : ✅ aucune erreur.
- `npm run lint` : ✅ 0 erreur (12 warnings pré-existants sans rapport).
- `npm run check:migrations` : ✅ 122 migrations, 0 hazard (aucune migration touchée).
- `npx vite build` (build de production complet) : ✅ réussi — confirme que `orders.$id.tsx`, seul consommateur de ce hook, continue de s'intégrer sans aucune modification de son côté.

---

## 6. Conformité au périmètre imposé

Confirmé via `git status` :

```
 M src/hooks/useCollectPaymentPoll.ts
?? src/hooks/__tests__/useCollectPaymentPoll.test.ts
```

Aucun fichier RPC/SQL (`supabase/migrations/*`), aucun fichier PLOP (`plop-*.server.ts`), et `checkout.tsx`/`orders.$id.tsx` n'ont été **ni modifiés ni même effleurés** — `orders.$id.tsx` a été lu pour confirmer le câblage `enabled`/Realtime (§ 4, "Arrêt après Realtime"), jamais édité.

---

## Statut

Correctif appliqué et testé, périmètre strictement respecté. **Aucun commit effectué** — en attente de votre feu vert, comme pour les remédiations P0/P1 précédentes de cette même chaîne.
