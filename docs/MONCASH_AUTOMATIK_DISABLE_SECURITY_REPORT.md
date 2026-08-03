# MonCash Automatik — Désactivation temporaire — Rapport de Sécurité

**Date** : 2026-08-03
**Portée** : vérifier qu'aucun utilisateur ne peut déclencher un paiement MonCash Automatik depuis l'interface, et documenter honnêtement ce que la protection backend garantit — et ne garantit pas — indépendamment de ce changement frontend.

---

## 1. Ce qui a été vérifié

### 1.1 Le bouton est un vrai `<button disabled>`, pas une simulation visuelle

`src/routes/checkout.tsx` — le bouton "MonCash Automatik" reçoit l'attribut HTML natif `disabled` (et `aria-disabled="true"`) quand `getPaymentMethodAvailability("moncash_auto").enabled === false`. Un `<button disabled>` :
- ne déclenche **aucun** événement `click` (vérifié : `page.locator(...).click({ force: true })` en E2E ne change pas la sélection, voir `e2e/client/moncash-auto-disabled.spec.ts`) ;
- n'est **pas atteignable au clavier** via Tab dans la plupart des navigateurs — cohérent avec "cette option ne peut pas être utilisée maintenant", pas juste visuellement grisée.

Donc : dans l'usage normal (interface non manipulée), **aucun utilisateur ne peut sélectionner cette méthode**, et `initiateCollectPayment()` n'est donc jamais appelé depuis ce chemin.

### 1.2 Ce que le backend garantit **indépendamment** de ce changement

`src/lib/initiate-collect-payment.logic.ts` (fichier non modifié par cette mission) contient déjà deux gardes, actives avant même ce changement frontend :

```ts
if (payment.method !== "moncash") { return { outcome: "failed", ... }; }
...
if (!moncashProvider.isConfigured()) { return { outcome: "failed", ... }; }
```

`moncashProvider.isConfigured()` appelle `isMonCashConfigured()`, qui vérifie la présence des 5 variables d'environnement `MONCASH_*`. **Constat vérifié en direct aujourd'hui** (`vercel env ls production`) : seules 2 des 5 sont présentes (`MONCASH_WEBHOOK_SECRET`, `MONCASH_CLIENT_SECRET`) — `isConfigured()` retourne donc `false` en production, indépendamment de tout ce qui se passe côté frontend.

**Conséquence** : aujourd'hui, même un utilisateur qui manipulerait le DOM (retirer l'attribut `disabled` via les DevTools, ou appeler `initiateCollectPayment` directement via `fetch()`) recevrait un échec — pas parce que ce changement frontend l'en empêche, mais parce que le backend est déjà, indépendamment, dans un état non configuré.

## 2. Limite honnête de cette protection — à ne pas ignorer

**Le désactivage frontend et la protection backend ne sont pas couplés.** Si les 5 variables `MONCASH_*` étaient un jour restaurées en production (par exemple par erreur, ou parce que quelqu'un ne sait pas que cette désactivation est volontaire) **sans** que ce changement frontend soit également retiré, alors :
- Le bouton resterait désactivé pour un utilisateur normal → **aucun risque dans l'usage normal**.
- Mais un utilisateur manipulant le frontend (DevTools, requête directe vers la fonction serveur) **pourrait** alors réellement déclencher un paiement MonCash Automatik, puisque le backend n'a plus de raison de le refuser.

**Cette mission n'a délibérément pas ajouté de garde backend supplémentaire** — la consigne était stricte : "ne jamais modifier le moteur de paiement", "ne jamais modifier les RPC". Le blocage actuel tient donc à **deux causes indépendantes qui se trouvent, aujourd'hui, pointer dans la même direction** (frontend désactivé ET secrets absents), pas à une garantie architecturale unique et durable.

**Recommandation, pour une future itération, hors périmètre de cette mission** : si la désactivation doit rester fiable même après restauration des secrets (par exemple pendant toute la durée de la migration Bouspam), la garde devrait à terme vivre aussi côté backend (ex. `initiate-collect-payment.logic.ts` vérifie un flag de disponibilité, pas seulement `isConfigured()`) — c'est exactement ce que la couche d'abstraction créée en Phase 4 (`payment-method-availability.ts`) prépare, sans l'implémenter côté serveur pour l'instant.

## 3. Ce qui n'a pas été touché (confirmé)

- `PaymentProvider`, `moncashProvider`, `moncash-client.server.ts`, `moncash-config.server.ts` — aucun diff.
- `create_collect_payment_secure`, `complete_collect_payment_secure` — aucun diff, aucune RPC modifiée.
- Aucune policy RLS, aucun trigger, aucune migration.
- `payout-pay-modal.tsx` (décaissement admin, `provider_code: "moncash_api"` distinct) — non concerné, non modifié.

## 4. Vérification des 3 autres méthodes — aucune régression de sécurité

- **Cash** : aucune interaction avec un provider externe, RPC `create_order_secure` avec `_method: "kach"` inchangée.
- **MonCash Manuel / NatCash** : flux de preuve de paiement manuelle, entièrement côté `payments`/`payment_proofs` existants, non touché par ce changement (`orderMethod = method === "moncash_auto" ? "moncash" : method` — la branche `moncash_auto` ne peut simplement plus être atteinte, les deux autres branches sont inchangées).

---

## Conclusion

Aucun utilisateur ne peut déclencher MonCash Automatik depuis l'interface normale — confirmé par test E2E direct (clic forcé sans effet). La protection backend existante (`isConfigured()`) reste, aujourd'hui, une seconde barrière indépendante et suffisante. **Mais elle n'est pas liée à cette désactivation frontend** — si les secrets étaient restaurés sans revoir ce point, la garantie reposerait uniquement sur le frontend, qui n'est jamais infalsifiable face à un utilisateur qui manipule son propre navigateur. C'est un compromis assumé, imposé par la contrainte explicite de ne pas toucher au moteur de paiement dans cette mission — pas un oubli.
