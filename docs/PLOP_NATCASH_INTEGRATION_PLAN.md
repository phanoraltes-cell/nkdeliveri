# Plan — Intégration NatCash Otomatik (via PLOP) + retour à des boutons séparés

**Date** : 2026-08-05
**Statut** : 📋 **PLAN UNIQUEMENT** — aucun code écrit, aucune migration créée, aucun fichier modifié. Ce document décrit ce qu'il faudra faire, dans quel ordre, et pourquoi — à valider avant tout chantier de code.

---

## 0. Décisions produit déjà prises par vous (rappel, pour éviter toute ambiguïté)

1. Le bouton unique "Payment Global" (qui abstrayait MonCash/NatCash derrière un seul choix) **disparaît**. Retour à des boutons distincts, un par wallet — comme c'était le cas avant le chantier de rebranding "Payment Global".
2. Le bouton actuellement `moncash_auto` reprend le libellé **"MonCash Otomatik"**.
3. Un **nouveau bouton** `natcash_auto` ("NatCash Automatik") est ajouté, séparé, avec son propre état activé/désactivé.
4. Le logo du bouton NatCash Automatik doit être **le même fichier** que celui déjà utilisé pour "NatCash" (manuel) — `/natcash-logo-new.png`, pas un nouveau logo à créer.

**Confirmé par vous (2026-08-05)** : le bouton "MonCash Automatik" reprend lui aussi le logo déjà utilisé pour "MonCash Manyèl" (`/moncash-logo-hero.png`), par symétrie avec NatCash Automatik — chaque bouton automatique affiche le logo de son propre wallet manuel. `/payment-global-logo.svg` n'est donc plus utilisé du tout sur `checkout.tsx` une fois ce plan exécuté.

**Conséquence assumée, à noter** : `public/payment-global-logo.svg` et toute sa déclinaison (`public/payment-global/`, 36 fichiers — favicons, icônes PWA, images sociales, produits d'un chantier antérieur validé) **ne serait plus affichée sur la page checkout** une fois ce plan exécuté. Rien ne serait supprimé (ces fichiers restent disponibles, potentiellement réutilisables ailleurs — un futur tableau de bord admin, une page marketing), mais leur seul point d'usage actuel (`checkout.tsx`) disparaîtrait. À valider que c'est bien votre intention.

---

## 1. Ce qui est déjà prêt — aucun changement nécessaire

Confirmé par relecture directe du code, pas supposé :

| Composant                                             | État                                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plop-client.server.ts`                               | Valide déjà `"natcash"` comme `payment_method` PLOP légitime (`VALID_PAYMENT_METHODS = ["moncash", "kashpaw", "natcash", "all"]`) — aucune modification nécessaire |
| `plopProvider.initiatePayment()`                      | Transmet déjà `paymentMethod` tel quel à PLOP, quel que soit le wallet — aucune modification nécessaire                                                            |
| `payment_method` (ENUM Postgres)                      | Contient déjà `'natcash'` (`CREATE TYPE public.payment_method AS ENUM ('stripe','moncash','natcash','kach')`) — **aucun `ALTER TYPE` nécessaire**                  |
| `payment_provider_settings` (schéma de table)         | Colonne `provider` en texte libre, sans contrainte `CHECK`/enum — une nouvelle ligne s'ajoute par un simple `INSERT`, pas de migration de schéma                   |
| `update_payment_provider_setting_secure` (RPC)        | Valide `_provider` contre les lignes existantes de la table, pas contre une liste figée dans le code — fonctionnera avec `natcash_auto` dès que la ligne existe    |
| `useCollectPaymentPoll` (polling client)              | 100% agnostique du wallet — aucune modification                                                                                                                    |
| `plop-reconcile.server.ts` (cron)                     | 100% agnostique du wallet — aucune modification                                                                                                                    |
| `orders.$id.tsx` (texte "en attente de confirmation") | Déjà rendu générique lors de la remédiation post-incident (ne nomme plus aucun wallet) — aucune modification nécessaire                                            |
| `payment_transactions`/`plop_api_logs` (schéma)       | Déjà génériques (colonnes texte, pas d'enum fournisseur) — aucune nouvelle table                                                                                   |

---

## 2. Ce qui doit changer — fichier par fichier

### 2.1 `src/routes/checkout.tsx`

- **`METHODS`** : remplacer l'entrée `moncash_auto` (libellé "Payment Global", logo `/payment-global-logo.svg`) par le libellé "MonCash Automatik" avec le logo `/moncash-logo-hero.png` ; ajouter une nouvelle entrée `natcash_auto` ("NatCash Automatik", logo `/natcash-logo-new.png`).
- **`CheckoutMethod`** (type dérivé de `METHODS`) : se met à jour automatiquement puisqu'il est dérivé du tableau — pas de changement de type séparé ici.
- **`orderMethod`** : actuellement `method === "moncash_auto" ? "moncash" : method`. Doit devenir :
  ```ts
  const orderMethod =
    method === "moncash_auto" ? "moncash" : method === "natcash_auto" ? "natcash" : method;
  ```
- **`payNumber`/`payName`** : déjà branchés sur `orderMethod === "moncash"`/`"natcash"` — fonctionneront sans changement une fois `orderMethod` correctement dérivé ci-dessus, MAIS ces variables ne servent qu'à l'affichage du flux **manuel** (numéro à qui envoyer l'argent) — un flux automatique n'en a pas besoin. Vérifier qu'elles ne s'affichent pas par erreur pour `natcash_auto` (actuellement, le bloc qui les affiche est gardé par `method === "moncash" || method === "natcash"`, donc `natcash_auto` n'est déjà pas concerné — à reconfirmer une fois le code écrit).
- **Encadré explicatif** (actuellement affiché quand `method === "moncash_auto"`, mentionne "Payment Global") : à dupliquer/adapter pour les deux boutons automatiques séparément, avec un texte propre à chacun (ne plus mentionner "plizyè rezo peman" puisque ce n'est plus un seul pòtay multi-wallet du point de vue du client).
- **`initiateCollect`/`sendCollectPaymentAdminErrorPushFn`** : aucun changement de logique, ces appels sont déjà génériques (paramétrés par `paymentId`, jamais par le nom du bouton).

### 2.2 `src/lib/payment-provider-availability.ts`

- **`CheckoutProviderId`** : `"kach" | "moncash" | "natcash" | "moncash_auto"` → ajouter `"natcash_auto"`.
- Le reste du fichier (`fetchPaymentProviderSettings`, `isProviderEnabled`, `getProviderSetting`, `getDefaultProvider`) est déjà générique (opère sur un tableau de lignes, pas sur des noms câblés en dur) — aucun changement de logique.

### 2.3 `src/routes/_authenticated/dashboard.admin.payment-providers.tsx`

- **`PROVIDER_LABELS`** : renommer `moncash_auto: "Payment Global"` → `"MonCash Automatik"`, ajouter `natcash_auto: "NatCash Automatik"`.
- Le reste (rendu, mutations `toggleVisible`/`toggleEnabled`/`setDefault`/`saveMessage`) est déjà générique, boucle sur les lignes de la table — aucun changement de logique.

### 2.4 `src/lib/initiate-collect-payment.logic.ts` — le vrai cœur du changement métier

Deux hardcodes précis à généraliser :

1. **Ligne ~54** : `if (payment.method !== "moncash")` → doit devenir `if (payment.method !== "moncash" && payment.method !== "natcash")` (refuse toujours tout ce qui n'est ni MonCash ni NatCash — `kach` reste inchangé, jamais concerné par ce chemin).
2. **Lignes ~74/76** : `isProviderEnabled(settings, "moncash_auto")` et `getProviderSetting(settings, "moncash_auto")` sont câblés en dur sur `moncash_auto`, **quel que soit le wallet réellement demandé**. Doit devenir dépendant de `payment.method` :
   ```ts
   const providerKey = payment.method === "natcash" ? "natcash_auto" : "moncash_auto";
   if (!isProviderEnabled(settings, providerKey)) { ... }
   ```
   **C'est le changement le plus important de ce fichier** — sans lui, désactiver "MonCash Automatik" depuis le dashboard admin désactiverait aussi silencieusement NatCash Automatik (et vice-versa), les deux partageant aujourd'hui le même verrou.

### 2.5 Migration SQL (nouvelle, à créer)

Trois éléments dans une seule migration (ou éventuellement deux, si vous préférez séparer la donnée de la logique — à votre préférence) :

1. **Nouvelle ligne `payment_provider_settings`** pour `natcash_auto`, seedée désactivée par défaut (même précaution que `moncash_auto` à l'origine — activation manuelle explicite requise avant tout trafic réel) :
   ```sql
   INSERT INTO public.payment_provider_settings (provider, visible, enabled, default_provider, maintenance_message) VALUES
     ('natcash_auto', true, false, false, 'NatCash Automatik ap retounen byento.');
   ```
2. **`create_collect_payment_secure`** — deux hardcodes à généraliser (même principe que § 2.4, mais côté base) :
   - `IF v_payment.method <> 'moncash' THEN RAISE EXCEPTION ...` → `IF v_payment.method NOT IN ('moncash', 'natcash') THEN ...`
   - Le bloc de garde ajouté lors du hardening du 3 août (`WHERE provider = 'moncash_auto' AND enabled = true`) → doit devenir conditionnel au wallet :
     ```sql
     IF _status = 'pending' THEN
       DECLARE
         v_provider_key text := CASE WHEN v_payment.method = 'natcash' THEN 'natcash_auto' ELSE 'moncash_auto' END;
       BEGIN
         IF NOT EXISTS (
           SELECT 1 FROM public.payment_provider_settings
           WHERE provider = v_provider_key AND enabled = true
         ) THEN
           RAISE EXCEPTION '% pa disponib pou kounye a.', (CASE WHEN v_payment.method = 'natcash' THEN 'NatCash Automatik' ELSE 'MonCash Automatik' END) USING ERRCODE = '42501';
         END IF;
       END;
     END IF;
     ```
     (syntaxe exacte à affiner à l'écriture réelle — l'idée : ce garde doit vérifier la ligne `payment_provider_settings` correspondant au wallet réel de la transaction, jamais `moncash_auto` en dur.)
   - `CREATE OR REPLACE FUNCTION` (même signature qu'aujourd'hui) suffit — pas de nouveau paramètre nécessaire, `_payment_method_requested` existe déjà et porte déjà l'information nécessaire pour dériver `v_provider_key`.
3. **Notifications admin** (`notify_secure` dans `create_collect_payment_secure`/`complete_collect_payment_secure`) : actuellement corrigées pour dire "Payment Global" (remédiation post-incident du 2026-08-05) — à revoir une troisième fois pour devenir **spécifiques au wallet réellement concerné** (ex. `'Yon tantativ peman ' || (CASE WHEN _payment_method_requested = 'natcash' THEN 'NatCash Automatik' ELSE 'MonCash Automatik' END) || ' ...'`), sinon un admin ne pourra plus distinguer un échec MonCash d'un échec NatCash dans ses notifications.

### 2.6 Tests

- `initiate-collect-payment.test.ts` : dupliquer/adapter les scénarios existants (disabled-provider, not-configured, success, failure, already_confirmed) pour `natcash_auto`/`payment.method === "natcash"`, en plus des scénarios `moncash_auto` déjà couverts — vérifier en particulier que désactiver `moncash_auto` seul ne bloque pas une tentative NatCash, et vice-versa (le bug que § 2.4/2.5 corrigent).
- Tests e2e (`e2e/client/moncash-auto-disabled.spec.ts`, `e2e/admin/payment-providers.spec.ts`) : à mettre à jour pour refléter les nouveaux libellés ("MonCash Automatik"/"NatCash Automatik" au lieu de "Payment Global") — ces fichiers sont déjà connus comme non maintenus depuis le dernier rebranding (audit post-incident), l'occasion de les remettre à jour en une fois plutôt que de laisser la dette s'accumuler une troisième fois.

---

## 3. Ce qui NE change PAS (périmètre explicitement exclu)

- `payment-providers/types.ts` (`PaymentProvider` interface) — déjà générique, `paymentMethod`/`walletUsed` couvrent déjà ce besoin.
- `index.server.ts` (registre) — toujours pas concerné, PLOP continue d'être appelé directement, jamais via ce registre partagé avec le décaissement.
- `plop-provider.server.ts`/`plop-client.server.ts` — déjà prêts (§ 1).
- Cash, MonCash Manyèl, NatCash Manyèl (flux de preuve manuelle) — aucun changement, aucun de ces flux ne passe par `initiate-collect-payment.logic.ts`.
- Décaissements, wallets, commissions, dashboard financier — aucun rapport avec ce chantier.
- Cron, polling — déjà agnostiques du wallet (§ 1).

---

## 4. Séquence de mise en œuvre proposée

1. **Confirmer avec vous** le point ouvert du § 0 (logo MonCash Automatik).
2. Écrire le code (§ 2.1-2.4) — pas de migration, pas de commit à cette étape, exactement le même rythme que les chantiers précédents.
3. Écrire la migration (§ 2.5) — versionnée dans `supabase/migrations/`, **non appliquée** sans votre validation explicite (convention constante de ce projet).
4. Écrire/adapter les tests (§ 2.6).
5. Faire tourner `npm run verify` (typecheck/lint/migration check/tests/build).
6. Produire un rapport de vérification (même format que les chantiers PLOP précédents : fichiers modifiés, justification, risques, tests, GO/NO-GO).
7. Sur votre validation : appliquer la migration, activer `natcash_auto` (`enabled = true`) via le dashboard admin — **jamais automatiquement**, exactement comme `moncash_auto` l'a été.
8. Tests réels en sandbox/conditions réelles avant tout trafic client NatCash.

---

## 5. Risques identifiés à ce stade (avant tout code)

| Risque                                                                                                                                    | Sévérité                                               | Mitigation prévue                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Le garde RPC actuel (`moncash_auto` en dur) bloquerait silencieusement NatCash même une fois activé côté admin, si § 2.4/2.5 sont oubliés | 🔴 Élevé si non corrigé                                | Corrigé explicitement dans ce plan (§ 2.4, § 2.5) — point de vigilance n°1 de toute revue de code sur ce chantier |
| Désactiver un des deux boutons (MonCash ou NatCash Automatik) affecterait l'autre par erreur, si le garde reste partagé                   | 🔴 Élevé si non corrigé                                | Même correctif que ci-dessus — un seul bug racine couvre les deux risques                                         |
| Notifications admin ambiguës (ne distinguant pas MonCash de NatCash) après un 3ᵉ changement de libellé                                    | 🟡 Moyen                                               | § 2.5.3 — rendre les 2 messages `notify_secure` dépendants du wallet réel                                         |
| `public/payment-global/` (36 fichiers, chantier de branding déjà livré) deviendrait orphelin                                              | 🟢 Faible (cosmétique, aucune perte de fonctionnalité) | Signalé § 0 pour votre décision — rien à faire techniquement, aucune suppression proposée                         |
| Tests e2e déjà obsolètes (rebranding précédent) accumuleraient une 2ᵉ couche de dette si non mis à jour ici                               | 🟡 Moyen                                               | § 2.6 — inclus dans ce chantier plutôt que différé une nouvelle fois                                              |

Aucun risque de sécurité identifié (RLS, grants, `SECURITY DEFINER` restent inchangés — seule la condition interne d'un garde déjà existant change, pas son existence ni ses permissions).

---

## 6. Ce que ce plan NE fait PAS

Conformément à votre demande ("prepare yon plan") : **aucun fichier n'a été modifié, aucune migration créée, aucun code écrit.** Ce document décrit uniquement ce qu'il faudra faire. Dites-moi si ce plan vous convient (en particulier le point ouvert § 0) pour que je passe à l'écriture réelle du code, en suivant la même discipline que les chantiers précédents (pas de migration appliquée ni de commit sans votre validation explicite à chaque étape).
