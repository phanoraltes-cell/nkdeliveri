# Rapport — Remédiation P1 : dialogue PLOP (`plop-client.server.ts`)

Date : 2026-08-08 · Portée stricte : le client HTTP bas-niveau qui parle à PLOP (`paiement-marchand`/`paiement-verify`), rien d'autre. **`checkout.tsx`, le SQL (RPC/migrations), et l'interface `PaymentProvider` (`types.ts`) n'ont pas été touchés** — confirmé ci-dessous par `git status`. `plop-provider.server.ts` a été lu/audité mais **pas modifié** (aucun bug n'y a été trouvé qui justifierait un changement).

---

## 1. Résumé exécutif

Un bug réel a été trouvé et corrigé dans `parseJsonOrThrow()` (utilisée par `createPayment`/`verifyPayment`) : **le corps brut de la réponse PLOP était systématiquement perdu (`raw: undefined`) chaque fois que PLOP renvoyait un 2xx avec un corps invalide ou vide** — exactement les deux scénarios de test explicitement demandés par cette mission ("réponse vide", "JSON invalide"). Ce n'était pas un crash (le code de secours avalait l'erreur silencieusement), mais une vraie perte de preuve de diagnostic : en production, si PLOP renvoyait un jour une page d'erreur HTML ou un corps tronqué, ni les logs (`plop_api_logs.response_summary`) ni l'erreur remontée à l'appelant n'auraient jamais montré ce que PLOP avait réellement envoyé.

Tout le reste du dialogue (retry, timeout, mapping JSON, erreurs HTTP, erreurs métier, journalisation, `payment_method_requested`→`payment_method_used`) a été audité en détail et **s'est révélé déjà correct** — aucune autre correction n'a été nécessaire ni appliquée.

5 nouveaux tests + 1 test renforcé ajoutés. 110/110 tests passent (105 pré-existants + 5 nouveaux). Typecheck et lint propres. **Aucun commit.**

---

## 2. Le bug trouvé — preuve directe, pas supposée

### Où

`parseJsonOrThrow()`, appelée par `createPayment()` et `verifyPayment()` uniquement lorsque `response.ok` est vrai (2xx) mais que le corps doit encore être parsé.

### Ancien code

```ts
async function parseJsonOrThrow(response: Response, context: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PlopApiError(
      `... `,
      response.status,
      await safeReadBody(response), // <-- toujours undefined, voir plus bas
    );
  }
}
```

### Pourquoi c'était cassé (vérifié empiriquement, pas deviné)

La spécification Fetch marque le corps d'une `Response` comme **"disturbed"** (déjà lu) dès qu'une méthode comme `.json()` est appelée — **même si cette méthode lève une exception** (JSON invalide). Une fois "disturbed", tout appel ultérieur sur le même objet — y compris `.clone()` — ne peut plus rien récupérer.

Séquence réelle :

1. `response.json()` est appelée directement sur l'objet original (pas un clone) → échoue sur un JSON invalide, mais **marque déjà le corps comme lu**.
2. Le `catch` appelle `safeReadBody(response)`, qui tente `response.clone().json()` puis, en cas d'échec, `response.text()` — les deux échouent silencieusement (corps déjà "disturbed"), et `safeReadBody` retourne `undefined` sans jamais lever d'exception (son propre `try/catch` imbriqué avale tout).

**Test isolé, reproduisant exactement cette séquence** (Node, avant correctif) :

```
result: {"threw":"Unexpected token 'o', \"not valid json {{{\" is not valid JSON"}
empty-body result: {"threw":"Unexpected end of JSON input"}
```

→ Dans les deux cas, `raw` était absent de l'objet (donc `undefined`) — confirmé, pas supposé.

### Correctif appliqué

Lire le corps **une seule fois**, en texte, puis tenter `JSON.parse` sur ce texte capturé — plus jamais de double-lecture, donc plus jamais de perte :

```ts
async function parseJsonOrThrow(response: Response, context: string): Promise<unknown> {
  const rawText = await response.text();
  try {
    return JSON.parse(rawText);
  } catch {
    throw new PlopApiError(
      `Repons PLOP pa nan fòma JSON ki atann pou ${context} (HTTP ${response.status})`,
      response.status,
      rawText,
    );
  }
}
```

**Re-testé après correctif** (même script) :

```
invalid-json raw: "not valid json {{{"
empty-body raw: ""
valid-json parsed: {"status":true,"url":"x"}
```

Le corps réel est maintenant toujours préservé, y compris la chaîne vide (jamais confondue avec `undefined`), et le chemin JSON valide n'est pas affecté.

**Le chemin `!response.ok` (erreurs HTTP) n'a pas ce bug** — vérifié séparément : à cet endroit, seul un _clone_ du corps a été lu jusque-là (par `logAttempt`, voir § 5), donc l'original reste intact et `safeReadBody(response)` y récupère bien le vrai contenu. Confirmé par un test isolé équivalent (`HTTP-error path raw: {"status":false,"message":"Client introuvable"}`). Aucune modification nécessaire sur ce chemin.

---

## 3. Audit détaillé — point par point

| Point à vérifier                          | Constat                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`paiement-marchand`** (`createPayment`) | Requête (`client_id`, `refference_id`, `montant`, `payment_method`) conforme à la doc PLOP. Réponse : `status`/`url`/`transaction_id` correctement lus, `data.status` ou `data.url` manquant → erreur propre. Validation du wallet (`isValidPaymentMethod`) faite **avant** tout appel réseau — aucun appel gaspillé sur une entrée invalide. |
| **`paiement-verify`** (`verifyPayment`)   | Requête (`client_id`, `refference_id`) conforme. `status` (succès de l'appel) et `trans_status` (statut du paiement — `"ok"`/`"no"`/tout le reste → `"unknown"`, jamais deviné) correctement distingués — c'est la bonne architecture : un `trans_status:"no"` est un résultat normal, pas une exception.                                     |
| **Mapping JSON**                          | Chaque champ PLOP → champ typé interne vérifié un par un (`url`→`redirectUrl`, `transaction_id`→`providerTransactionId`, `id_transaction`→`providerTransactionId` côté verify, `montant`→`amount`, `method`→`walletUsed`, `trans_status`→`transStatus` normalisé). Aucune perte, aucun renommage incohérent trouvé.                           |
| **Timeout**                               | `AbortController` + `setTimeout(15000ms)`, `clearTimeout` dans un `finally` (pas de timer qui fuit). `AbortError` correctement distingué de toute autre erreur réseau (`code:"timeout"` seulement dans ce cas).                                                                                                                               |
| **Retry**                                 | 3 tentatives, backoff exponentiel (300ms/600ms). `isRetryableStatus` limité à 429/5xx (conforme à la doc PLOP + filet de sécurité générique 5xx) — un 4xx n'est jamais retenté (testé : 1 seul appel réseau). Chaque tentative, y compris les reprises, journalisée séparément (§ vérifié par un nouveau test, voir § 6).                     |
| **Parse JSON**                            | Bug trouvé et corrigé — § 2. Après correctif : plus aucune perte, pour `createPayment` et `verifyPayment` (fonction partagée).                                                                                                                                                                                                                |
| **Erreurs HTTP**                          | `!response.ok` → `PlopApiError` propre avec `httpStatus` et le corps réel préservé (déjà correct, § 2 dernier paragraphe).                                                                                                                                                                                                                    |
| **Erreurs métier**                        | `data.status === false` (PLOP répond 2xx mais refuse) → `PlopApiError` avec le message de PLOP lui-même, jamais un message générique qui masquerait la vraie raison. Testé explicitement (§ 6).                                                                                                                                               |
| **Journalisation**                        | Chaque tentative (y compris les reprises) écrit une ligne `plop_api_logs` distincte, avant tout retry — vérifié par un nouveau test comptant exactement les insertions (§ 6). Écriture toujours _best-effort_ (`console.warn`, jamais une exception qui casserait le paiement réel) — comportement déjà correct, non modifié.                 |

---

## 4. `payment_method_requested` → `payment_method_used` : vérifié sans perte

Tracé de bout en bout (lecture seule, rien modifié en dehors de `plop-client.server.ts`) :

1. `createPayment(reference, amount, paymentMethod)` envoie `payment_method: requestedMethod` à PLOP et renvoie `paymentMethodRequested: requestedMethod` — c'est ce que l'appelant (`initiate-collect-payment.logic.ts`, hors périmètre, non touché) persiste comme `payment_method_requested`.
2. `verifyPayment(reference)` lit **PLOP's own `method` field** de la réponse `paiement-verify` (le wallet réellement utilisé par le client — pertinent notamment quand `payment_method:"all"` avait été envoyé) et le renvoie typé comme `walletUsed: string | null` — jamais silencieusement laissé de côté (`typeof data.method === "string" ? data.method : null`, testé explicitement à la fois pour un wallet différent de celui demandé et pour son absence).
3. `plop-provider.server.ts` (lu, non modifié) relaie fidèlement `walletUsed` dans `InitiatePaymentResult`/`PaymentStatusResult` (l'interface `PaymentProvider` le prévoit déjà, non modifiée).
4. `poll-collect-payment.logic.ts`/`plop-reconcile.server.ts` (lus, hors périmètre, non modifiés) passent `_payment_method_used: status.walletUsed ?? undefined` à la RPC — colonne `payment_transactions.payment_method_used`, type `text` (aucune contrainte ENUM), donc **toute valeur que PLOP renvoie est stockable sans risque de rejet**, même si elle diffère de nos propres valeurs internes.

**Conclusion** : aucune perte à aucune étape. `null` (wallet inconnu) est toujours distingué honnêtement d'une vraie valeur — jamais une valeur par défaut inventée.

---

## 5. Détail technique complémentaire (journalisation, non modifié)

`logAttempt()` lit le corps de la réponse via `response.clone().json()` — **elle utilise déjà `.clone()` correctement**, donc ne perturbe jamais le flux original que `parseJsonOrThrow`/le code appelant lira ensuite. C'est cette asymétrie (logging via clone, `parseJsonOrThrow` via lecture directe) qui causait le bug du § 2 — corrigé en alignant `parseJsonOrThrow` sur le même principe de lecture unique.

---

## 6. Tests — les 6 scénarios demandés, tous couverts

| Scénario            | Test(s)                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Succès**          | `createPayment: happy path...` / `verifyPayment: normalizes trans_status 'ok'...` (déjà existants, re-vérifiés verts)                                                                                                                                                             |
| **Timeout**         | `createPayment: a timeout is retried up to 3 attempts and reported with code 'timeout'` (déjà existant)                                                                                                                                                                           |
| **Erreur HTTP**     | `createPayment: a 4xx response is never retried` (existant) + **nouveau** `verifyPayment: a non-retryable HTTP error (404) is never retried and surfaces the real body`                                                                                                           |
| **Réponse vide**    | **Nouveau** `createPayment: a 200 response with a completely empty body raises a clean PlopApiError with the empty string preserved as raw, never undefined` + **nouveau** `verifyPayment: a completely empty response body raises a clean PlopApiError, never a raw SyntaxError` |
| **JSON invalide**   | Existant renforcé : `createPayment: a 200 response with a malformed (non-JSON) body...` **+ nouvelle assertion sur `.raw`** (preuve du correctif) + **nouveau** `verifyPayment: a 200 response with a malformed (non-JSON) body preserves the raw body for diagnostics`           |
| **Paiement refusé** | **Nouveau** `createPayment: PLOP declines at creation time (status:false on an otherwise-2xx response)...` (refus métier à la création, jamais retenté) — le refus au moment de la vérification (`trans_status:"no"`) était déjà couvert par un test existant                     |

**Journalisation (bonus, explicitement demandée dans le checklist)** : test existant renforcé — `createPayment: retries a 503 and succeeds if a later attempt returns 200, journaling every attempt including the retry` — vérifie maintenant `insertMock` appelé exactement 2 fois, avec `attempt:1/http_status:503` puis `attempt:2/http_status:200`, dans cet ordre.

**Résultats** :

- `plop-client.test.ts` + `plop-provider.test.ts` + `plop-reconcile.test.ts` : **51/51** ✅
- Suite complète du projet : **110/110** ✅ (105 pré-existants + 5 nouveaux)
- `npm run typecheck` : ✅ aucune erreur
- `npm run lint` : ✅ 0 erreur (12 warnings pré-existants sans rapport)
- `npm run check:migrations` : ✅ 122 migrations, 0 hazard (aucune migration touchée de toute façon)

---

## 7. Conformité au périmètre imposé

Confirmé via `git status` — **seuls deux fichiers modifiés** :

```
 M src/lib/payment-providers/__tests__/plop-client.test.ts
 M src/lib/payment-providers/plop-client.server.ts
```

`checkout.tsx`, tout fichier `.sql`/migration, et `src/lib/payment-providers/types.ts` (interface `PaymentProvider`) sont **inchangés** — confirmé par lecture directe, pas seulement par `git status`. `plop-provider.server.ts` a été entièrement relu dans le cadre de cet audit mais n'a nécessité aucune modification.

---

## Statut

Correctif appliqué et testé, périmètre strictement respecté. **Aucun commit effectué**, comme demandé.
