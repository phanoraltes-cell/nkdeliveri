# NatCash Otomatik — Rapport d'implémentation

**Date** : 2026-08-05
**Portée** : exécution de `docs/PLOP_NATCASH_INTEGRATION_PLAN.md`. **Aucune migration appliquée, aucun commit, aucun push.**

## Statut

**PRÊT POUR VALIDATION**

---

## Résumé

Le plan a été exécuté intégralement : retour à deux boutons séparés ("MonCash Otomatik", logo `/moncash-logo-hero.png` ; "NatCash Otomatik", logo `/natcash-logo-new.png`), et le vrai correctif métier identifié par le plan (le garde `moncash_auto` codé en dur, partagé par erreur entre les deux méthodes) a été appliqué à la fois côté TypeScript et côté SQL. Toutes les vérifications sont vertes, y compris deux nouveaux tests qui prouvent explicitement que les deux méthodes sont maintenant indépendantes l'une de l'autre (le bug que ce chantier corrige).

---

## Fichiers modifiés

| Fichier                                                                | Changement                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/routes/checkout.tsx`                                              | `METHODS` : `moncash_auto` renommé "MonCash Otomatik" (logo MonCash Manyèl) ; nouvelle entrée `natcash_auto` ("NatCash Otomatik", logo NatCash) ; `orderMethod` étendu ; `submit()` gère les deux ids ; encadré explicatif dédoublé et rendu spécifique à chaque wallet ; `PLACEHOLDER_PROVIDER_SETTINGS` complété |
| `src/lib/payment-provider-availability.ts`                             | `CheckoutProviderId` += `"natcash_auto"`                                                                                                                                                                                                                                                                           |
| `src/routes/_authenticated/dashboard.admin.payment-providers.tsx`      | `PROVIDER_LABELS` : `moncash_auto` → "MonCash Otomatik", + `natcash_auto` → "NatCash Otomatik"                                                                                                                                                                                                                     |
| `src/lib/initiate-collect-payment.logic.ts`                            | **Le vrai correctif** : gate de méthode élargi (`moncash`/`natcash`) ; `providerKey`/`providerLabel` dérivés dynamiquement de `payment.method` au lieu du hardcode `"moncash_auto"` ; messages d'erreur génériques mis à jour                                                                                      |
| `src/lib/payment-providers/plop-provider.server.ts`                    | Commentaire d'en-tête mis à jour (aucune logique touchée)                                                                                                                                                                                                                                                          |
| `supabase/migrations/20260805120000_natcash_automatik_integration.sql` | **Nouveau** — seed `natcash_auto` (désactivé par défaut) ; `create_collect_payment_secure` : même généralisation côté SQL (gate de méthode + gate de provider dynamique) ; notifications admin des deux RPC rendues spécifiques au wallet                                                                          |
| `src/lib/__tests__/initiate-collect-payment.test.ts`                   | Fixtures + 2 nouveaux tests clés (voir § Tests)                                                                                                                                                                                                                                                                    |
| `e2e/fixtures/data.ts`                                                 | + ligne `natcash_auto` dans `paymentProviderSettings`                                                                                                                                                                                                                                                              |
| `e2e/client/moncash-auto-disabled.spec.ts`                             | Réécrit pour les deux boutons ; sélecteurs corrigés (voir § Anomalie trouvée)                                                                                                                                                                                                                                      |
| `e2e/admin/payment-providers.spec.ts`                                  | Réécrit pour 5 lignes ; 2 nouveaux tests (activation indépendante de chaque méthode)                                                                                                                                                                                                                               |

Aucun autre fichier touché — confirmé par `git status` (le reste de l'arbre correspond exactement à l'état déjà connu avant ce chantier : travail de rebranding/remédiation antérieur, toujours non commité, non ré-ouvert ici).

---

## Le correctif central (rappel du plan)

`initiate-collect-payment.logic.ts` et `create_collect_payment_secure` vérifiaient tous deux, en dur, la ligne `moncash_auto` de `payment_provider_settings` — **quel que soit le wallet réellement demandé**. Sans correction, désactiver "MonCash Otomatik" depuis le dashboard admin aurait aussi désactivé silencieusement "NatCash Otomatik" (et inversement). Corrigé aux deux endroits en dérivant la clé de vérification (`moncash_auto`/`natcash_auto`) à partir de `payment.method`/`v_payment.method`. Prouvé par un test dédié (§ Tests).

---

## Anomalie trouvée et corrigée pendant l'implémentation

En écrivant `e2e/client/moncash-auto-disabled.spec.ts`, un test a échoué : `getByRole("button", { name: "NatCash", exact: true })` ne trouvait jamais le bouton NatCash manuel. Cause : l'nom accessible d'un bouton Playwright est tout son contenu textuel — "NatCash Peman manyèl ak prèv" (label + sous-texte), pas seulement "NatCash". `exact: true` sur la seule chaîne "NatCash" ne pouvait donc jamais matcher. Corrigé avec une regex à lookahead négatif (`/^NatCash(?!\s*Otomatik)/`) qui exclut explicitement "NatCash Otomatik" sans dépendre du texte exact du sous-libellé. Reproduit et vérifié : le test échouait avant le correctif, passe après.

---

## Vérifications

| Commande                                            | Résultat                                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                 | ✅ Propre                                                                                                                                                                                                  |
| `npm run lint`                                      | ✅ 0 erreur (12 avertissements préexistants, sans rapport ; 8 erreurs prettier introduites par mes propres modifications ont été trouvées et corrigées via `npx prettier --write` avant ce résultat final) |
| `npm run check:migrations`                          | ✅ "120 migrations scanned, 2 historical overload(s) all later cleaned up, no unresolved hazards"                                                                                                          |
| `npx vitest run`                                    | ✅ **101/101 tests**, 9 fichiers (1 échec transitoire sur un test de concurrence sans rapport avec ce chantier, `moncash-client.test.ts`, reconfirmé stable en ré-exécution isolée puis en suite complète) |
| `npx vite build`                                    | ✅ Réussi, 252 entrées precache PWA                                                                                                                                                                        |
| `npx playwright test` (4 fichiers liés au paiement) | ✅ **8/8 tests** après correction de l'anomalie ci-dessus                                                                                                                                                  |

### Tests unitaires nouveaux/modifiés (les plus importants)

- **"accepts a NatCash payment"** — confirme que `paymentMethod: "natcash"` est transmis tel quel au provider et enregistré dans `_payment_method_requested`.
- **"disabling moncash_auto never blocks a NatCash payment, and disabling natcash_auto never blocks a MonCash payment"** — preuve directe que le bug central (gate partagé) est corrigé : désactive `moncash_auto` seul → un paiement NatCash aboutit quand même ; désactive `natcash_auto` seul → un paiement MonCash aboutit quand même.
- **"refuses a NatCash payment when natcash_auto is disabled, with a NatCash-specific message"** — le message d'erreur nomme bien "NatCash Otomatik", jamais un texte générique ou celui de MonCash.

### Tests e2e nouveaux/modifiés

- Admin : "enabling NatCash Otomatik calls the RPC with `_provider:'natcash_auto'`, independently of MonCash Otomatik" — clique précisément sur le bouton "Aktive" de la bonne carte (scoping via `.rounded-2xl` + heading), confirmant qu'aucune ambiguïté de sélecteur ne fausse la préséduction du test lui-même.
- Client : les deux méthodes automatiques s'affichent désactivées avec leur propre message ; les deux méthodes manuelles restent pleinement sélectionnables.

---

## Compatibilité — confirmé inchangé

| Domaine                                           | Statut                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Cash                                              | 🟢 Intact                                                                                        |
| MonCash Manyèl / NatCash Manyèl (preuve manuelle) | 🟢 Intacts — aucun de ces flux ne passe par `initiate-collect-payment.logic.ts`                  |
| Décaissements / `index.server.ts` (registre)      | 🟢 Non touché                                                                                    |
| `plop-client.server.ts`/`plopProvider`            | 🟢 Non touchés — déjà prêts pour NatCash avant ce chantier                                       |
| Polling / Cron                                    | 🟢 Non touchés — déjà agnostiques du wallet                                                      |
| `orders.$id.tsx`                                  | 🟢 Non touché — déjà générique depuis la remédiation post-incident                               |
| RLS / grants / `SECURITY DEFINER`                 | 🟢 Inchangés — seule la condition interne des gates change, jamais leur existence ni permissions |

---

## Risques résiduels

| Niveau      | Risque                                                                                                                                                                                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Faible      | `natcash_auto` est seedé désactivé — aucun trafic réel possible tant qu'un admin ne l'active pas explicitement (même précaution que `moncash_auto` à l'origine)                                                                                                                                                            |
| Faible      | Migration non encore appliquée — la ligne `natcash_auto` n'existe pas encore en base réelle ; le code déployé sans cette migration afficherait le bouton NatCash Otomatik comme "Byento disponib" en permanence (aucune ligne trouvée = `enabled: false` par défaut côté `isProviderEnabled`), un état sûr, pas une erreur |
| Négligeable | `public/payment-global/` (chantier de branding antérieur) reste orphelin de tout point d'usage — déjà signalé dans le plan, décision assumée                                                                                                                                                                               |

Aucun risque de sécurité, aucune régression identifiée.

---

## Ce qui reste à faire (hors de cette implémentation, sur votre validation)

1. Appliquer `supabase/migrations/20260805120000_natcash_automatik_integration.sql`.
2. Activer `natcash_auto` via le dashboard admin quand vous serez prêt pour du trafic réel.
3. Tests réels en sandbox/conditions réelles avant tout trafic client NatCash (comme prévu à l'étape 8 du plan).
4. Décider si/quand committer ce travail — actuellement, comme le reste du travail PLOP en cours, tout est en attente dans l'arbre de travail, non commité.

---

## Verdict

**🟢 PRÊT — implémentation complète, testée, vérifiée. Aucune migration appliquée, aucun commit créé, en attente de votre validation.**
