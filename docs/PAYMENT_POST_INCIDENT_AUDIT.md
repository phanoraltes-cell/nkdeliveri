# Audit ciblé et validation post-incident — Infrastructure de paiement NK Deliveri

**Date** : 2026-08-05
**Portée** : audit uniquement — recherche de bug réel, préparation NatCash, revalidation post-incident. **Aucun fichier de code modifié, aucune migration, aucun commit, aucun push, aucun déploiement.**

---

## Résumé exécutif

L'infrastructure de paiement Collect (PLOP derrière "Payment Global") est **stable, saine et conforme à ce qu'elle prétend faire**. Aucun bug critique ou majeur n'a été trouvé. Tous les tests automatisés pertinents passent (98 tests unitaires, 6/7 tests Playwright de paiement — le 7ᵉ échoue *parce que* le rebranding a réussi, pas à cause d'une régression). La production répond normalement (logs récents 100% `200`), les secrets PLOP sont bien configurés côté Vercel, et le dernier déploiement est `Ready`.

Cinq écarts réels et vérifiés ont été trouvés — **tous de sévérité Faible, aucun bloquant** : deux textes obsolètes ("MonCash Automatik" au lieu de "Payment Global", un en base de données, un en SQL admin), un contrôle admin ("Kache") qui ne fait rien aujourd'hui côté client (déjà documenté comme volontairement différé dans l'architecture d'origine), une notification push manquante pour un type d'événement (gap déjà connu), et un texte client codé en dur qui deviendra trompeur le jour où NatCash sera activé via PLOP.

Le passage à NatCash est **architecturalement prêt à ~80 %** : l'interface `PaymentProvider`, le registre, la table de paramètres, les logs, le polling et le cron sont déjà génériques et multi-wallet par conception. Deux verrous durs subsistent : le garde-fou métier dans `initiate-collect-payment.logic.ts` et — découverte de cet audit, plus stricte que ce que documentait l'audit multi-wallet précédent — un garde-fou **identique et indépendant** codé en dur dans la fonction SQL `create_collect_payment_secure` elle-même, qui nécessite une vraie migration (pas seulement du code) pour être élargi.

---

## Score global

### 🟢 96 / 100 — CONFORME, prêt pour production, aucune action requise dans l'immédiat

| Domaine | Score | Statut |
|---|---|---|
| Checkout | 95/100 | 🟢 |
| Paiement Collect (création, doublons) | 100/100 | 🟢 |
| Polling | 100/100 | 🟢 |
| Cron | 100/100 | 🟢 |
| RPC (permissions/grants/RLS) | 100/100 | 🟢 |
| Logs | 90/100 | 🟡 (textes obsolètes, jamais un secret) |
| Frontend (secrets/bundle) | 100/100 | 🟢 |
| NatCash Readiness | 80/100 | 🟡 (prêt, 2 verrous SQL/code à lever) |
| Sécurité | 98/100 | 🟢 |
| Performance | 92/100 | 🟢 (mesurée partiellement, voir limites) |
| Compatibilité | 100/100 | 🟢 |
| Tests | 95/100 | 🟢 (1 assertion e2e obsolète, sans rapport avec l'app) |

---

## Bugs confirmés

Aucun bug **Critique** ou **Haut**. 5 écarts réels, tous **Faible**, avec preuve directe pour chacun.

### 1. 🟡 Faible — Message de maintenance obsolète en base de données (branding)

- **Reproduction** : requête REST publique sur `payment_provider_settings` (RLS-scopée, lecture publique documentée) :
  ```
  GET https://dcsnmvbtsmdbwrwbutph.supabase.co/rest/v1/payment_provider_settings?select=provider,maintenance_message&provider=eq.moncash_auto
  → { "maintenance_message": "MonCash Automatik ap retounen byento." }
  ```
- **Fichiers concernés** : donnée en base (table `payment_provider_settings`), pas de fichier de code. Le fallback local dans `checkout.tsx` (ligne 60) dit déjà correctement `"Payment Global ap retounen byento."`.
- **Cause racine** : le rebranding "Peman Otomatik" → "Payment Global" a mis à jour le code (labels, fallback local) mais personne n'a ensuite utilisé le panneau admin existant (`dashboard.admin.payment-providers.tsx`, champ "Mesaj antretyen" + bouton "Sove") pour mettre à jour la valeur réellement stockée en base.
- **Gravité** : Faible — actuellement invisible (`moncash_auto.enabled = true`, ce texte ne s'affiche que si le fournisseur est désactivé) mais dormant : si un admin désactive "Payment Global" pour maintenance, les clients verront l'ancien nom.
- **Impact métier** : cosmétique, pas financier.
- **Risque de régression si corrigé** : nul — c'est une simple mise à jour de donnée via l'UI admin existante, aucun code à toucher.
- **Correctif proposé** : ouvrir `/dashboard/admin/payment-providers`, éditer le message de "Payment Global", cliquer "Sove". Aucune intervention technique requise.

### 2. 🟡 Faible — Notifications admin SQL toujours au nom "MonCash Automatik"

- **Reproduction** : lecture directe de `supabase/migrations/20260804130000_plop_wallet_traceability.sql` :
  - Ligne 124 : `'Yon tantativ peman MonCash Automatik ' || v_payment.amount || ' HTG echwe imedyatman: ...'`
  - Ligne 193 : `'Yon peman kliyan ' || v_row.amount || ' HTG atravè MonCash Automatik echwe: ...'`
- **Fichiers concernés** : `create_collect_payment_secure`/`complete_collect_payment_secure` (corps de fonction SQL).
- **Cause racine** : le rebranding n'a touché que la couche TypeScript/React — ces deux chaînes de notification interne (visibles uniquement par les admins via `notify_secure`) n'ont jamais été incluses dans son périmètre.
- **Gravité** : Faible — jamais vu par un client, seulement par les admins/super-admins recevant une alerte d'échec de paiement.
- **Impact métier** : aucun, confusion mineure possible pour un admin qui ne connaît pas l'historique du renommage.
- **Correctif proposé** : nouvelle migration (hors périmètre de cet audit) remplaçant ces deux littéraux — nécessite `DROP FUNCTION IF EXISTS` avant `CREATE OR REPLACE` par la convention de ce projet, sans changement de signature.

### 3. 🟡 Faible (déjà documenté, non nouveau) — Le bouton admin "Kache" ne cache rien côté client

- **Reproduction** : état réel en production (requête ci-dessus) : `moncash_auto.visible = false` **et pourtant** "Payment Global" reste sélectionnable sur `/checkout` — confirmé par lecture directe de `checkout.tsx` : `grep ".visible" src/routes/checkout.tsx` → **aucun résultat**. Le rendu de `METHODS.map()` ne calcule `isDisabled` qu'à partir de `.enabled`, jamais de `.visible`.
- **Fichiers concernés** : `src/routes/checkout.tsx` (rendu), `src/lib/payment-provider-availability.ts` (le champ est bien lu et exposé, juste jamais consommé pour cacher quoi que ce soit).
- **Cause racine** : déjà documentée dans `docs/PAYMENT_PROVIDER_HARDENING_ARCHITECTURE.md` ligne 90 : *"`visible` — Affiché dans la grille checkout (non utilisé aujourd'hui, `true` partout — prévu pour un futur 'masquer entièrement')"*. C'est une fonctionnalité sciemment différée depuis la conception d'origine, pas une régression.
- **Ce qui est nouveau dans cet audit** : ce flag est **actuellement exploité en production** pour `moncash_auto` (`visible=false`) sans aucun effet, et le panneau admin ne prévient pas l'administrateur que "Kache" est un no-op aujourd'hui — un admin pourrait raisonnablement croire que la méthode est masquée alors qu'elle est toujours pleinement sélectionnable.
- **Gravité** : Faible — pas de risque financier ou de sécurité, seulement un risque de confusion opérationnelle.
- **Correctif proposé** (non appliqué) : soit implémenter le filtrage `.visible` dans `checkout.tsx` (feature réelle), soit a minima désactiver/annoter le bouton "Kache" dans le dashboard admin avec un texte du type "Fonctionnalité pas encore active côté client".

### 4. 🟡 Faible — `orders.$id.tsx` : texte client codé en dur "MonCash" (deviendra trompeur avec NatCash)

- **Reproduction** : `src/routes/orders.$id.tsx:257` → `"N ap tann konfimasyon MonCash — paj sa a ap mete ajou otomatikman."`, affiché inconditionnellement dès que `isCollect && collectTransaction?.status === "pending"`, sans lire `payment_method_requested`/`payment_method_used` (colonnes qui existent déjà depuis la migration Phase 1 dynamique, mais que cette page ne consulte jamais).
- **Fichiers concernés** : `src/routes/orders.$id.tsx`.
- **Gravité** : Faible aujourd'hui (exact, puisque seul `moncash` est actif) — deviendra un vrai defaut UX le jour où un paiement NatCash via PLOP sera possible (le client verrait "attente MonCash" en attendant une confirmation NatCash).
- **Correctif proposé** : dériver ce texte de `collectTransaction.payment_method_requested` (déjà en base) plutôt que de le coder en dur, ou utiliser un texte générique ("konfimasyon Payment Global").

### 5. 🟡 Faible (déjà connu, reconfirmé) — Pas de notification push pour `collect_payment_admin_error`

- **Reproduction** : `grep -rl "collect_payment_admin_error" src/lib/*.functions.ts` → aucun résultat, alors que 9 autres types d'événements (`send-dispute-push`, `send-payout-push`, `send-refund-push`, etc.) ont chacun leur `send-*-push.functions.ts`.
- **Cause racine** : gap préexistant, déjà noté dans la mémoire projet lors de la Phase 2 de l'intégration PLOP — jamais corrigé depuis car hors périmètre de chaque mission successive.
- **Gravité** : Faible/Moyenne — l'admin reçoit bien une notification **in-app** (`notify_secure`) à chaque échec de paiement automatique, mais aucun push mobile — un admin qui ne regarde pas activement le tableau de bord peut manquer un échec pendant un certain temps.
- **Correctif proposé** : créer `send-collect-payment-admin-error-push.functions.ts` suivant le patron déjà établi par les 9 autres fichiers du genre.

---

## Faux positifs — hypothèses écartées après vérification réelle

| Hypothèse initialement plausible | Vérification effectuée | Conclusion |
|---|---|---|
| L'échec de 7 tests Playwright liés au paiement indique une régression applicative | Diagnostic : le build avait été fait en mode production (`vite build`) au lieu de `vite build --mode e2e`, donc les tests SSR tapaient la vraie base de production au lieu du mock. Après `npm run build:e2e`, **6/7 passent**. | **Faux positif** — problème d'exécution du test, pas de l'application. |
| Le seul test Playwright encore rouge (`payment-providers.spec.ts:22`, cherche "MonCash Automatik") indique que le rebranding n'a pas été déployé | Lu le code réel de `dashboard.admin.payment-providers.tsx` : `PROVIDER_LABELS.moncash_auto = "Payment Global"` — le rebranding est bien réel et actif. | **Faux positif** — le test échoue *parce que* le renommage a réussi ; c'est le test (non maintenu) qui est obsolète, pas l'app. |
| Une commande créée sans ligne `payments` correspondante pourrait laisser le client bloqué (`checkout.tsx` gère ce cas défensivement) | Lu `create_order_secure` (migration `20260723090000`) : l'`INSERT INTO orders` et l'`INSERT INTO payments` sont dans la **même fonction PL/pgSQL**, donc la même transaction — ce cas ne peut pas se produire en pratique aujourd'hui. | **Faux positif** — garde défensive saine, mais le scénario qu'elle couvre n'est pas atteignable avec le code actuel. |
| Un double-clic sur "Konfime kòmand" pourrait créer deux commandes / deux tentatives de paiement en parallèle | Le bouton est désactivé via `disabled={submitting}` pendant l'appel ; côté base, `create_collect_payment_secure` verrouille la ligne `payments` via `FOR UPDATE OF p`, sérialisant toute tentative concurrente pour le même paiement. | **Faux positif** — protégé à deux niveaux (UI + verrou SQL). |
| Le fournisseur PLOP pourrait avoir été branché à la place de Digicel dans le registre partagé, risquant le décaissement | Lu `index.server.ts` : `moncash_api: moncashProvider` (legacy Digicel) — inchangé, documenté comme partagé avec `initiate-provider-payout.functions.ts`. `plopProvider` n'est importé que directement dans `initiate-collect-payment.logic.ts`. | **Faux positif** — déjà vérifié dans un audit précédent, reconfirmé ici. |

---

## Régressions

**Aucune régression détectée** entre le dernier "Go Live" (commit `9ff9f28`, Phase 3) et l'état actuel.

```
git log --oneline 9ff9f28..HEAD -- src/ supabase/migrations
036a186 feat(payments): dynamic PLOP wallet selection per transaction
697b20d chore(supabase): regenerate types.ts after applying plop_api_logs migration
b11a433 feat(checkout): rename customer-facing "MonCash Automatik" label to "Peman Otomatik"

git diff --stat 9ff9f28..HEAD -- src/ supabase/migrations
14 files changed, 590 insertions(+), 125 deletions(-)
```

Les 125 suppressions sont concentrées dans des tests (mise à jour de fixtures), des commentaires, et le corps de fonction SQL reconstruit (dans le même fichier que ses 202 lignes d'ajout) — aucune suppression de garde de sécurité ou de logique métier existante. Trois commits, tous additifs, tous déjà connus et documentés.

**Travail non commité actuellement dans l'arbre de travail** (`git status`) : suite du rebranding "Payment Global" sur 5 fichiers (`checkout.tsx`, `dashboard.admin.payment-providers.tsx`, `initiate-collect-payment.logic.ts`, `plop-provider.server.ts`, le fichier de test correspondant) — déjà signalé dans un rapport précédent, en attente de validation avant commit, sans lien avec un incident.

---

## NatCash Readiness

**Ne développe pas NatCash — analyse de préparation uniquement**, comme demandé.

### Architecture

`PaymentProvider` (`src/lib/payment-providers/types.ts`) supporte déjà un champ `paymentMethod?: string` générique, ajouté spécifiquement pour qu'"un fournisseur multi-wallet (PLOP) ne soit jamais forcé de dépendre d'une seule config globale par transaction" (commentaire du fichier, ligne 34-39). **`plopProvider.initiatePayment()` accepte déjà `paymentMethod: "natcash"` et le valide correctement** (`isValidPaymentMethod`, `VALID_PAYMENT_METHODS` inclut `"natcash"`). Aucune modification d'interface nécessaire.

### Checkout

Le rendu (`METHODS.map()`) est déjà générique — ajouter une méthode ne demande pas de refactoring du composant. **Mais** deux verrous métier codés en dur bloquent NatCash aujourd'hui, à des couches différentes :

1. `initiate-collect-payment.logic.ts:54` — `if (payment.method !== "moncash")` refuse tout payment.method autre que `"moncash"` avant même d'appeler PLOP.
2. **Découverte de cet audit** — `create_collect_payment_secure` (la fonction SQL elle-même, ligne 80-82 de `20260804130000_plop_wallet_traceability.sql`) a son **propre** garde indépendant : `IF v_payment.method <> 'moncash' THEN RAISE EXCEPTION ...`. Même si le verrou n°1 était levé côté application, cette RPC refuserait quand même la tentative. **Contrairement à ce que suggérait `docs/PLOP_MULTIWALLET_PHASE0_AUDIT.md` §7 Option B** (qui présentait l'activation de NatCash comme "code-only, sans migration"), ce garde SQL nécessite bien une vraie migration (`DROP FUNCTION IF EXISTS` puis `CREATE FUNCTION` avec la condition élargie) — pas seulement un changement TypeScript. Correction à apporter à cette hypothèse pour toute future mission NatCash.

### Provider Registry

`index.server.ts` n'a pas besoin de changer — PLOP n'y a jamais été ; il est appelé directement. Une intégration NatCash-via-PLOP réutiliserait exactement le même chemin (`plopProvider` avec `paymentMethod: "natcash"`), sans nouvelle entrée de registre.

### Tables

- `payment_method` (ENUM Postgres) contient déjà `'natcash'` — **aucun `ALTER TYPE` nécessaire**.
- `payment_provider_settings.provider` est une colonne `text` libre (pas de CHECK/enum) — une nouvelle ligne (ex. `natcash_auto`) s'ajoute par un simple `INSERT`, sans migration de schéma.
- `update_payment_provider_setting_secure` valide `_provider` contre les lignes existantes de la table (`WHERE provider = _provider` + `IF NOT FOUND`), pas contre une liste figée dans le code — aucune modification RPC nécessaire pour accepter une nouvelle ligne.
- `payment_transactions`/`plop_api_logs` sont déjà génériques (colonnes texte, pas d'enum fournisseur) — **aucune nouvelle table `natcash_transactions`/`natcash_api_logs` nécessaire**, contrairement à ce que la question de cadrage de cette mission envisageait.

### Polling

`useCollectPaymentPoll` est 100% agnostique du fournisseur/wallet (ne connaît que `externalReference`/`createdAt`) — **directement réutilisable, aucune modification**.

### Notifications

**Pas encore générique** — deux textes trouvés dans "Bugs confirmés" (n°2 et n°4) disent encore "MonCash"/"MonCash Automatik" en dur. Ces deux textes devront être rendus génériques ou dynamiques (lire `payment_method_used`/`payment_method_requested`) avant un vrai lancement NatCash, sans quoi un client/admin verrait une confirmation NatCash annoncée comme "MonCash".

### Dashboard

`PROVIDER_LABELS` (Record TypeScript) et la boucle `.map()` sur les lignes de `payment_provider_settings` sont déjà génériques — ajouter NatCash ne demande qu'une entrée de plus dans ce Record, aucun refactoring.

### Matrice de préparation NatCash

| Élément | Réutilisable | À modifier | Nouveau |
|---|---|---|---|
| `PaymentProvider` interface | ✅ | | |
| `plopProvider`/`plop-client.server.ts` | ✅ (déjà valide `"natcash"`) | | |
| Provider Registry (`index.server.ts`) | ✅ | | |
| Client poll (`useCollectPaymentPoll`) | ✅ | | |
| Cron (`plop-reconcile.server.ts`) | ✅ | | |
| `payment_method` ENUM Postgres | ✅ (`natcash` existe déjà) | | |
| `payment_provider_settings` (schéma) | ✅ (colonne texte libre) | | (1 nouvelle ligne si bouton dédié) |
| `update_payment_provider_setting_secure` | ✅ | | |
| `payment_transactions`/`plop_api_logs` (schéma) | ✅ | | |
| Checkout — rendu `METHODS.map()` | ✅ | | (1 entrée si bouton dédié) |
| Checkout — gate business (`.logic.ts`) | | ✏️ ligne 54 | |
| RPC `create_collect_payment_secure` | | ✏️ ligne 80-82 (migration requise) | |
| Notifications SQL (admin) | | ✏️ textes n°2 | |
| `orders.$id.tsx` (texte client) | | ✏️ texte n°4 | |
| Dashboard admin (`PROVIDER_LABELS`) | ✅ | ✏️ (1 ligne ajoutée) | |
| Tests unitaires/e2e | | | (cas NatCash à ajouter) |

### Question ouverte (non tranchée ici, décision produit)

Le texte déjà présent dans `checkout.tsx` ("Payment Global — yon sèl pòtay pou plizyè rezo peman... lòt rezo tankou NatCash pi devan") laisse deux architectures possibles, non départagées par cet audit :
- **(A)** Un seul bouton "Payment Global" existant, qui deviendrait multi-wallet — nécessiterait un sélecteur de wallet à l'intérieur du même flux (n'existe pas aujourd'hui).
- **(B)** Un nouveau bouton dédié "NatCash Otomatik", parallèle à "Payment Global" — plus simple à câbler avec l'architecture actuelle (une ligne `payment_provider_settings` de plus, une entrée `METHODS` de plus), mais moins fidèle au message marketing déjà écrit dans le checkout.

---

## PLOP Health Check

| Vérification | Résultat |
|---|---|
| Secrets Vercel (`PLOP_CLIENT_ID`/`SECRET`/`PAYMENT_METHOD`) | ✅ Présents, chiffrés, Preview + Production (`vercel env ls`) |
| Dernier déploiement | ✅ `Ready`, Production, il y a 19h (`vercel ls`) |
| État live `payment_provider_settings.moncash_auto` | `enabled: true`, `visible: false` (sans effet, voir Bug n°3), `maintenance_message` obsolète (Bug n°1) |
| Logs production récents | ✅ 100% `200` sur la fenêtre observée (~50 dernières minutes) — aucune erreur PLOP visible |
| Cron `plop-reconcile` | ✅ Enregistré (`vercel.json`, `15 3 * * *`, décalé de 15 min après `moncash-reconcile` pour éviter tout chevauchement) |
| `plop_api_logs` | ✅ Table existante, RLS admin-only, append-only (triggers), `client_id` toujours redacté avant écriture |

**Limite honnête** : `vercel logs` ne renvoie qu'une fenêtre récente/en direct, pas un historique complet interrogeable — aucun incident n'a été détecté sur la fenêtre observée, mais cette vérification ne couvre pas rétroactivement toute la période depuis l'activation.

---

## Sécurité

| Contrôle | Résultat |
|---|---|
| RLS activée (`payment_transactions`, `plop_api_logs`, `payment_provider_settings`) | 🟢 Oui, sur les 3 tables |
| `REVOKE ALL ... FROM PUBLIC, anon` | 🟢 Appliqué systématiquement |
| `create_collect_payment_secure` — grants | 🟢 `authenticated` uniquement |
| `complete_collect_payment_secure` — grants | 🟢 `service_role` uniquement |
| `SECURITY DEFINER` + `SET search_path = public` | 🟢 Sur les deux RPC (protège contre le détournement de `search_path`) |
| Contrainte anti-doublon | 🟢 `UNIQUE (external_reference)` en base + verrou `FOR UPDATE OF p` empêchant toute double création concurrente |
| Anti-double-confirmation | 🟢 `WHERE ... AND status = 'pending'` dans `complete_collect_payment_secure` — un paiement déjà décidé ne peut plus être réécrit |
| Injection SQL | 🟢 Aucune requête dynamique (`EXECUTE format`/`EXECUTE '...'`) trouvée dans les migrations de paiement |
| XSS | 🟢 Aucun `dangerouslySetInnerHTML` dans les routes de paiement |
| CSRF | 🟢 Modèle d'authentification par Bearer token (`Authorization: Bearer <jwt>`), jamais par cookie ambiant — une requête forgée cross-origin ne peut pas porter le token de la victime |
| Secrets dans les logs | 🟢 `client_secret` jamais journalisé (absent de tout `console.*`/insertion `plop_api_logs`) ; `client_id` toujours tronqué (`redactId`, 4 premiers/derniers caractères) avant stockage |
| Secrets dans le frontend | 🟢 Recherche directe dans `.vercel/output/static` (bundle client) et `.vercel/output/functions` (bundle serveur) — aucune valeur de secret trouvée dans les deux |
| `client_secret`/`client_id` hors du bundle client | 🟢 `plop-config.server.ts`/`plop-client.server.ts` en `.server.ts` — le build échoue si un composant les importe |
| Headers HTTP (`vercel.json`) | 🟢 HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy (dont `payment=()`, désactivant délibérément l'API Payment Request native — non utilisée ici) |

**Score sécurité : 98/100** — les 2 points retirés correspondent aux Bugs n°1/n°2 (textes obsolètes), sans impact de sécurité réel, classés ici uniquement par souci d'exhaustivité de la checklist demandée.

---

## Performance

| Mesure | Résultat | Méthode |
|---|---|---|
| Cadence de polling | 5s → 10s → 30s → 60s, jitter ±20 %, pause onglet caché | Lecture directe de `useCollectPaymentPoll.ts` |
| Volume réseau max par session de polling | ≤ 31 requêtes sur 15 min (6 @5s + 9 @10s + 6 @30s + 10 @60s) | Calcul à partir des `PHASES` réelles du code |
| Appels PLOP par tentative de paiement | 1 (+ jusqu'à 2 relances internes du client HTTP, `MAX_ATTEMPTS = 3`) + 1 vérification de réconciliation si la création échoue (A1) | Lecture de `plop-client.server.ts`/`plop-provider.server.ts` |
| Requêtes SQL de `create_collect_payment_secure` | 1 `SELECT ... FOR UPDATE` (jointure indexée) + 1 `EXISTS` (indexé sur `payment_id`) + 1 `INSERT` | Lecture directe de la migration ; index confirmés (`payment_transactions_order_id_idx`, `_payment_id_idx`, `_created_at_idx`) |
| Bundle client — chunk `checkout` | 12.29 kB (4.27 kB gzip) | Mesuré sur un vrai build (`vite build`) |
| Code PLOP dans le bundle client | 0 kB — `plop-provider.server.ts` (15.70 kB), `plop-client.server.ts`, `plop-reconcile.server.ts` n'apparaissent que sous `_ssr`/`__server.func`, jamais sous `static/assets` | Mesuré directement sur la sortie du build |
| Build PWA precache | 252 entrées (5633 KiB) | Mesuré sur le dernier build |
| Realtime | 1 canal `postgres_changes` par page commande, filtré `order_id=eq.<id>` — léger | Lecture de `orders.$id.tsx` |

**Limite honnête** : aucune mesure Lighthouse n'a été exécutée dans cet audit — lancer un audit Lighthouse réel contre `www.nkdeliveri.com` (production) constituerait une charge non sollicitée sur le site live, hors du périmètre strictement "lecture/audit" demandé ; le lancer contre un aperçu local aurait nécessité un budget de temps supplémentaire pour un chantier déjà volumineux. Recommandation : si un score Lighthouse chiffré est souhaité, le demander comme mission dédiée avec `npx playwright test` + `playwright-lighthouse` (déjà en dépendance, jamais invoqué ici) contre un aperçu local, jamais contre la production. De même, aucune mesure de "temps moyen" de confirmation n'a pu être établie — `vercel logs` n'expose pas de colonne de durée exploitable pour ce calcul et aucun APM dédié n'est configuré.

---

## Compatibilité

Aucune régression trouvée sur les domaines suivants (vérifiés par lecture directe du code, pas par supposition) :

| Domaine | Statut |
|---|---|
| Cash | 🟢 Intact — jamais acheminé par le chemin PLOP |
| MonCash Manyèl / NatCash Manyèl | 🟢 Intacts — flux de preuve manuelle inchangé |
| Décaissements (`initiate-provider-payout.functions.ts`) | 🟢 Registre (`index.server.ts`) confirmé non modifié |
| Dashboard financier / wallets / commission | 🟢 Aucun fichier de ces domaines dans le chemin Collect PLOP |
| Notifications existantes (hors les 2 textes obsolètes ci-dessus) | 🟢 |
| Realtime | 🟢 Souscription `payments` intacte, complémentaire au polling |
| Chat / GPS | 🟢 Sans rapport, non touchés |

---

## Risques résiduels

| Niveau | Risque |
|---|---|
| Faible | Message de maintenance "Payment Global" obsolète en base — visible seulement si le fournisseur est désactivé |
| Faible | Notifications admin SQL toujours au nom "MonCash Automatik" |
| Faible | Toggle admin "Kache" sans effet client — déjà documenté comme différé, mais l'UI admin ne le signale pas |
| Faible | Texte client `orders.$id.tsx` deviendra trompeur le jour où NatCash-via-PLOP est activé |
| Faible/Moyen | Pas de push pour `collect_payment_admin_error` — l'admin dépend de la notification in-app |
| Faible | Hypothèse antérieure ("NatCash = code-only") à corriger : le garde SQL de `create_collect_payment_secure` nécessite bien une migration |

**Aucun risque Critique ou Haut.**

---

## Recommandations

1. Mettre à jour le message de maintenance de "Payment Global" via le panneau admin existant (aucun code à écrire).
2. Planifier une migration (future, hors de cet audit) pour renommer les 2 textes SQL "MonCash Automatik" → "Payment Global" dans les notifications admin.
3. Décider si le toggle "Kache" doit devenir fonctionnel (implémenter le filtrage `.visible` dans `checkout.tsx`) ou rester annoté comme non actif dans le dashboard admin, pour éviter toute confusion opérationnelle.
4. Avant tout lancement NatCash réel : rendre `orders.$id.tsx` et les 2 notifications SQL génériques (lire `payment_method_requested`/`payment_method_used` au lieu de coder "MonCash" en dur).
5. Créer `send-collect-payment-admin-error-push.functions.ts` pour fermer le dernier gap de convention de notification push.
6. Trancher la question d'architecture NatCash ouverte (bouton dédié vs. sélecteur de wallet dans "Payment Global") avant de lancer un chantier de développement NatCash.
7. Si un score Lighthouse ou un temps de confirmation moyen chiffré est nécessaire, le demander comme mission dédiée avec un aperçu local — jamais contre la production.
8. Mettre à jour l'unique assertion Playwright obsolète (`payment-providers.spec.ts:22`, "MonCash Automatik" → "Payment Global") pour que la suite e2e reflète l'état réel de l'app.

Aucune de ces recommandations n'est bloquante ; toutes peuvent attendre une mission dédiée future.

---

## Verdict

**🟢 CONFORME — Infrastructure de paiement PLOP saine, stable et non régressée.**

Aucun bug critique ou haut. Cinq écarts réels, tous faibles, avec cause racine et correctif identifiés — aucun ne nécessite d'action immédiate. Tests, sécurité, permissions et compatibilité tous vérifiés en lecture directe du code et de l'état réel de production, jamais supposés. NatCash est architecturalement prêt à ~80 %, avec une correction importante apportée à une hypothèse antérieure (le garde SQL nécessite une vraie migration, pas seulement du code).

**Aucune modification n'a été effectuée. Conformément à la règle de cette mission, cet audit attend votre validation avant toute correction, migration, commit ou déploiement.**
