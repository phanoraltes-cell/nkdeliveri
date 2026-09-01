# 🔎 Audit — Inscription Restaurant & Livreur + Pièces d'identité Admin

**Date** : 2026-08-09
**Type** : Audit uniquement — **aucun code modifié, aucune migration appliquée, aucun commit, aucun push**.
**Méthode** : lecture de code (frontend, RPC, migrations), introspection live **read-only** de la base de production (`pg_policies`, `information_schema`, `storage.objects`, `storage.buckets`, `pg_proc`), corrélation avec les données réelles existantes (1 restaurant, 1 livreur — c'est tout le volume de production actuel). Chaque affirmation ci-dessous est reliée à une preuve (fichier:ligne ou requête SQL), jamais à une supposition.

---

## 1. Executive Summary

Deux bugs réels, distincts, tous deux confirmés avec des données de production réelles :

1. **`{}` restaurant** — le champ `opening_hours` (jsonb) de **chaque** restaurant créé est **toujours** un objet vide `{}`, par construction. Le formulaire d'inscription collecte un champ "Orè ouvèti" mais ne l'envoie **jamais** au backend — la colonne jsonb n'est donc jamais alimentée. Confirmé sur le seul restaurant réel en production ("AC Resto") : tous les autres champs (nom, description, cuisine, téléphone, adresse, logo, cover) sont correctement remplis ; seul `opening_hours` est `{}`.
2. **Documents d'identité livreur invisibles/absents** — la chaîne technique pour _afficher_ un document existant à l'admin est correcte (RPC, RLS, signed URL). Le vrai problème est **en amont** : le seul livreur réel en production a `id_doc_url: null` — **aucun document n'a jamais été rattaché à son dossier**, et pourtant son statut est `online` (approuvé). Deux failures combinées l'expliquent :
   - `update_driver_status_secure` (RPC d'approbation) n'a **aucune vérification** de la présence d'un document, ni côté UI ni côté base de données.
   - Une fois le dossier approuvé (ou juste après l'expiration de 2h), `finalizeRegistrationDocuments` refuse **définitivement** toute nouvelle tentative d'upload ("Kont sa a deja trete") — il n'existe **aucun chemin de rattrapage** dans tout le code applicatif pour attacher un document manquant après coup.
3. **Bug systémique confirmé, distinct des deux precedents** : `stampOwner()` (le mécanisme censé attribuer la propriété `storage.objects.owner` après un upload service-role) échoue silencieusement en production — **100% des objets échantillonnés (2/2)** dans `restaurant-assets` ont `owner: NULL`. Cela ne bloque pas l'admin (sa policy RLS a un OR indépendant du owner) mais casse définitivement l'accès futur du propriétaire réel (restaurant/livreur) à son propre fichier.

**Verdict global** : 🟠 **CORRECTIONS NÉCESSAIRES** (voir § 18).

---

## 2. Restaurant Registration Audit

### Cartographie

```
src/routes/auth.register.tsx
  └─ src/components/auth/restaurant-form.tsx
       ├─ register-shared.tsx: baseSignUp() → supabase.auth.signUp({ options: { data } })
       │     ↳ trigger public.handle_new_user() (SECURITY DEFINER, on auth.users INSERT)
       │           ↳ INSERT INTO public.restaurants (...)
       └─ src/lib/register-documents.functions.ts: finalizeRegistrationDocuments()
             ↳ storage.upload('restaurant-assets', ...) + UPDATE restaurants SET logo_url/cover_url
```

### Champs du formulaire → métadonnées envoyées

[restaurant-form.tsx:33-41](../../../src/components/auth/restaurant-form.tsx#L33-L41) :

| Champ formulaire         | Envoyé dans `signUp({data})` ?                         | Clé metadata             |
| ------------------------ | ------------------------------------------------------ | ------------------------ |
| ownerName                | ✅                                                     | `first_name`             |
| restaurantName           | ✅                                                     | `restaurant_name`        |
| description              | ✅                                                     | `restaurant_description` |
| cuisine                  | ✅                                                     | `restaurant_cuisine`     |
| phone                    | ✅                                                     | `phone`                  |
| address                  | ✅                                                     | `restaurant_address`     |
| email/password           | ✅ (params directs de `signUp`, pas metadata)          | —                        |
| **hours** ("Orè ouvèti") | **❌ JAMAIS envoyé**                                   | —                        |
| logo, cover (fichiers)   | envoyés séparément via `finalizeRegistrationDocuments` | —                        |

Le champ `hours` est collecté dans le state React ([restaurant-form.tsx:18](../../../src/components/auth/restaurant-form.tsx#L18), input à la ligne 137-143) mais **n'apparaît nulle part** dans l'objet passé à `baseSignUp()`. C'est un champ mort — visible à l'utilisateur, jamais transmis.

### Trigger `handle_new_user()`

[20260720100000_fix_restaurant_slug_generation.sql:51](../../../supabase/migrations/20260720100000_fix_restaurant_slug_generation.sql#L51) (version actuellement live, confirmée — voir § 8) :

```sql
COALESCE((NEW.raw_user_meta_data->'restaurant_hours')::jsonb, '{}'::jsonb),
```

La clé `restaurant_hours` n'étant jamais présente dans `raw_user_meta_data` (puisque jamais envoyée), le `COALESCE` tombe systématiquement sur `'{}'::jsonb`.

### Autres champs — vérifiés OK

`name`, `description`, `cuisine`, `phone`, `address` sont tous correctement transmis et persistés (confirmé avec des données réelles, § 8). `logo_url`/`cover_url` sont `NULL` à la création (normal — uploadés dans une étape séparée après) puis correctement remplis par `finalizeRegistrationDocuments`.

---

## 3. Driver Registration Audit

### Cartographie

```
src/routes/auth.register.tsx
  └─ src/components/auth/driver-form.tsx
       ├─ register-shared.tsx: baseSignUp() → supabase.auth.signUp({ options: { data } })
       │     ↳ trigger public.handle_new_user()
       │           ↳ INSERT INTO public.drivers (..., status='pending')
       └─ finalizeRegistrationDocuments() → storage.upload('driver-documents', ...) + UPDATE drivers SET id_doc_url/...
```

### Champs du formulaire → métadonnées

[driver-form.tsx:34-42](../../../src/components/auth/driver-form.tsx#L34-L42) : `first_name`, `last_name`, `phone`, `address`, `vehicle_type`, `license_plate` — **tous transmis, aucun champ manquant** (contrairement au restaurant). `handle_new_user()` les lit tous correctement pour l'INSERT dans `drivers`. Le rôle `driver` est correctement assigné via `user_roles`.

### Documents — flux réel

`idDoc` est **obligatoire** côté UI ([driver-form.tsx:32](../../../src/components/auth/driver-form.tsx#L32)), `license`/`vehiclePhoto` optionnels. Envoyés en base64 via `finalizeRegistrationDocuments` (§ 4), **jamais** dans les metadata de `signUp` (les colonnes `id_doc_url` etc. de `handle_new_user()` restent donc toujours `NULL` à la création — c'est le design voulu, l'upload réel arrive juste après dans le même clic).

### Séparation intentionnelle des erreurs (bon pattern, confirmé sain)

[driver-form.tsx:53-71](../../../src/components/auth/driver-form.tsx#L53-L71) : le `try/catch` autour de `finalizeDocs()` est **volontairement séparé** de celui autour de `baseSignUp()` — un échec d'upload ne fait jamais annuler/masquer la création du compte (déjà réussie à ce stade). C'est un choix délibéré et documenté en commentaire, pas un oubli. **Mais** cela signifie aussi qu'un échec d'upload silencieux laisse le compte créé, `pending`, sans aucun document — et c'est exactement l'état trouvé sur le seul livreur réel en production (§ 9).

---

## 4. Identity Documents Architecture

| Élément           | Valeur confirmée en direct                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bucket            | `driver-documents`                                                                                                                                                                                            |
| Public ou privé   | **privé** (`public: false`, confirmé via `storage.buckets`)                                                                                                                                                   |
| Chemin            | `${userId}/${prefix}-${Date.now()}-${filename}` — prefix ∈ {`id`, `license`, `vehicle`}                                                                                                                       |
| MIME acceptés     | `image/jpeg, image/png, image/webp, image/heic, image/heif, application/pdf` (confirmé live)                                                                                                                  |
| Taille max        | 8 388 608 octets (8MB), confirmé live                                                                                                                                                                         |
| Référence en base | `public.drivers.id_doc_url` / `license_doc_url` / `vehicle_photo_url` — **chemin brut stocké, pas une URL** ([register-documents.functions.ts:222-224](../../../src/lib/register-documents.functions.ts#L222-L224)) |
| Lecture           | `ProofThumb` génère une **signed URL** à la volée (`createSignedUrl(path, 300)`, 5 min) — jamais d'URL publique pour ce bucket                                                                                |

Pour le restaurant (comparaison) : bucket `restaurant-assets`, **public: true**, 5MB, images seulement, `logo_url`/`cover_url` stockent une **URL publique complète** (`getPublicUrl()`), pas un chemin.

---

## 5. Storage Audit

### Bucket config (live, `storage.buckets`)

| Bucket              | public | limite | MIME                          |
| ------------------- | ------ | ------ | ----------------------------- |
| `restaurant-assets` | true   | 5MB    | image/jpeg,png,webp,heic,heif |
| `driver-documents`  | false  | 8MB    | + application/pdf             |

Conforme à ce que le code suppose — **pas d'incohérence trouvée ici**.

### Policies RLS live sur `storage.objects` (confirmées via `pg_policies`, identiques aux migrations — aucune dérive détectée)

| Bucket            | Policy               | Condition                                                                                       |
| ----------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| driver-documents  | SELECT/UPDATE/DELETE | `owner = auth.uid() OR has_role(admin) OR has_role(super_admin)`                                |
| driver-documents  | INSERT               | `owner = auth.uid()`                                                                            |
| restaurant-assets | UPDATE/DELETE        | `owner = auth.uid() OR has_role(admin) OR has_role(super_admin)`                                |
| restaurant-assets | INSERT               | `owner = auth.uid()`                                                                            |
| restaurant-assets | SELECT               | **aucune policy** — normal, bucket public : Storage sert les objets publics sans passer par RLS |

**Point important** : la policy SELECT admin sur `driver-documents` **ne dépend pas** de `owner` — `has_role(admin) OR has_role(super_admin)` suffit seul. Donc même avec `owner = NULL` (bug § 6), un vrai admin peut toujours générer une signed URL pour n'importe quel document. **Ce n'est donc pas la cause du problème "admin ne voit pas les documents".**

### 🔴 Bug confirmé : `stampOwner()` ne fonctionne pas en production

[register-documents.functions.ts:84-105](../../../src/lib/register-documents.functions.ts#L84-L105) — après chaque upload service-role, le code tente :

```ts
await supabaseAdmin
  .schema("storage")
  .from("objects")
  .update({ owner: userId })
  .match({ bucket_id, name: path });
```

**Preuve directe** — les 2 seuls objets réels dans `restaurant-assets` (logo + cover du restaurant "AC Resto", upload confirmé réussi car `logo_url`/`cover_url` sont bien peuplés) ont tous les deux `owner: NULL` et `owner_id: NULL` :

```
0f2fefd1-.../cover-1785308301340-1000320191.webp  → owner: null
0f2fefd1-.../logo-1785308300743-1000320184.png    → owner: null
```

Le code appelle bien `stampOwner()` juste après chaque upload réussi (§ code ci-dessus) — donc soit l'appel échoue systématiquement (caught, `console.error` seulement — voir [register-documents.functions.ts:99-104](../../../src/lib/register-documents.functions.ts#L99-L104), aucune trace persistée nulle part), soit une incompatibilité de schéma/colonne l'empêche d'avoir effet. **Cause précise non confirmable à distance sans logs Vercel du moment exact de l'upload** (aucun tel log n'existe — ce chemin n'a aucune table d'audit, contrairement à `plop_api_logs`/`newsletter_send_log`). Hypothèse la plus probable, non confirmée : le schéma `storage` n'est pas dans la liste des schémas exposés par PostgREST pour ce projet, ce qui ferait échouer `.schema("storage")` avec une erreur `PGRST106`.

**Impact réel** : le propriétaire (restaurant/livreur) ne peut jamais lire/modifier/supprimer son propre fichier plus tard via les policies `owner = auth.uid()` — silencieux, non bloquant pour l'admin, mais une vraie régression fonctionnelle pour l'utilisateur final si une fonctionnalité future en dépend (aujourd'hui, rien dans l'app ne le fait encore, donc impact actuel = 0 fonctionnalité cassée, mais latent).

### Objet orphelin trouvé (hygiène, non bloquant)

Un objet dans `driver-documents` (`29dddb0d-.../id-...-prod-id.png`, 68 octets, `owner: NULL`, daté 2026-07-29) ne correspond à **aucun** `user_id` de livreur existant — très probablement un artefact de test laissé lors du développement de la migration du même jour. Sans impact fonctionnel, mais confirme qu'aucun nettoyage/rétention n'existe pour ce bucket.

---

## 6. Database / RLS Audit

### Tables `drivers` / `restaurants` (live, `pg_policies`)

| Table       | Policy                                 | Condition                                                                              |
| ----------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| drivers     | `drivers_admin_all` (ALL)              | `has_role(admin) OR has_role(super_admin)`                                             |
| drivers     | `drivers_self_select`                  | `user_id = auth.uid() OR has_role(admin) OR has_role(super_admin)`                     |
| drivers     | `drivers_self_update`                  | `user_id = auth.uid() OR has_role(admin)`                                              |
| restaurants | `Approved restaurants viewable by all` | `status='approved' OR owner_id=auth.uid() OR has_role(admin) OR has_role(super_admin)` |
| restaurants | `Admin deletes restaurant`             | `has_role(super_admin)`                                                                |

**Aucun problème trouvé ici** — l'admin a un accès complet aux deux tables. Les RPC (`get_drivers_admin`, `get_restaurants_admin`, `update_driver_status_secure`) sont de toute façon `SECURITY DEFINER` avec leur propre vérification de rôle interne, donc elles ne dépendent pas de ces policies RLS.

### `get_drivers_admin` — confirmé retourner les documents (live, `pg_proc`)

Signature live confirmée inclure `id_doc_url text, license_doc_url text, vehicle_photo_url text` dans son `RETURNS TABLE`. Une version antérieure ([20260722170000_drivers_admin.sql](../../../supabase/migrations/20260722170000_drivers_admin.sql)) **ne les retournait pas** — corrigé par [20260729210000_admin_document_review_columns.sql](../../../supabase/migrations/20260729210000_admin_document_review_columns.sql), dont le commentaire même documente le bug antérieur : _"Admin's full driver/restaurant profile dialogs... never returned the uploaded logo/cover/ID document columns... leaving admin with no way to re-open the documents afterward."_ **Ce bug est déjà corrigé et vérifié live** — ce n'est plus la cause du problème actuel.

### 🔴 Aucune vérification de document avant approbation

`update_driver_status_secure` ([20260722170000_drivers_admin.sql:130-170](../../../supabase/migrations/20260722170000_drivers_admin.sql#L130-L170)) — le corps complet ne contient **aucune** clause vérifiant `id_doc_url IS NOT NULL` avant d'autoriser une transition vers `'approved'`. La vérification de rôle (`admin`/`super_admin`) est la seule garde. C'est vrai à la fois côté UI ([driver-detail-dialog.tsx:293-300](../../../src/components/dashboard/admin/driver-detail-dialog.tsx#L293-L300) — le bouton "Apwouve" n'a **aucune condition `disabled` liée aux documents**) et côté base de données (RPC ci-dessus).

---

## 7. Admin Dashboard Audit

### Livreur — `dashboard.admin.drivers.tsx` → `DriverDetailDialog`

Le composant [driver-detail-dialog.tsx:136-165](../../../src/components/dashboard/admin/driver-detail-dialog.tsx#L136-L165) affiche bien une section "Dokiman" avec `ProofThumb` pour les 3 documents, et un placeholder visuel rouge explicite ("Pa gen pyès idantite!") quand `id_doc_url` est `null`. **La UI fonctionne correctement pour afficher un document qui existe** — le problème n'est jamais dans l'affichage lui-même, toujours en amont (document jamais attaché, § 9).

`ProofThumb` ([proof-thumb.tsx:67-82](../../../src/components/proof-thumb.tsx#L67-L82)) génère la signed URL côté client avec la session de l'admin connecté — repose donc sur la policy RLS `driver_docs_owner_select`, confirmée correcte (§ 5). Aucune erreur silencieuse trouvée dans ce composant — `createSignedUrl` échouerait de façon visible (`url` reste `null`, le bouton reste désactivé avec "Chajman…" affiché indéfiniment, pas un crash silencieux caché).

### Restaurant — deux surfaces distinctes, aucune ne montre `opening_hours`

1. `PendingRestaurantsSection` (widget "Restoran an atant valdasyon" sur l'accueil admin) — logo/cover/nom/cuisine/téléphone/adresse/description, **pas d'heures d'ouverture affichées**.
2. `dashboard.admin.restaurants.tsx` — page de gestion des **commissions**, pas d'approbation ni de documents ; ne touche pas non plus à `opening_hours`.

**Conclusion** : `{}` n'est **jamais rendu visuellement comme texte brut** dans l'interface admin de ce projet — il ne peut être "vu" que via une lecture directe de la table (Supabase Studio / requête API brute), ce qui correspond exactement à la façon dont ce bug a probablement été repéré.

---

## 8. `{}` Root Cause Analysis

**Question** : _pourquoi certaines données reviennent-elles `{}` lors de la création d'un restaurant ?_

**Réponse, avec preuve directe** :

1. Colonne concernée : `public.restaurants.opening_hours` (jsonb) — **seule colonne jsonb de toute la table** (confirmé via `information_schema.columns`, 20 colonnes au total, une seule `jsonb`).
2. Le formulaire d'inscription restaurant collecte un champ texte libre "Orè ouvèti" ([restaurant-form.tsx:137-143](../../../src/components/auth/restaurant-form.tsx#L137-L143)) mais **ne l'inclut jamais** dans l'objet passé à `supabase.auth.signUp({options:{data}})` ([restaurant-form.tsx:33-41](../../../src/components/auth/restaurant-form.tsx#L33-L41)).
3. Le trigger `handle_new_user()` lit `NEW.raw_user_meta_data->'restaurant_hours'` — une clé qui n'existe jamais — et retombe systématiquement sur `COALESCE(NULL, '{}'::jsonb)` = `{}`.
4. **Preuve en production** : le seul restaurant réel (`AC Resto`, créé 2026-07-29) a `opening_hours: {}` alors que **tous** ses autres champs (nom, description, cuisine, téléphone, adresse, logo, cover) sont correctement remplis — confirmant que ce n'est pas une perte de données générale, mais un problème **précis et unique** à ce champ.
5. Même si le champ avait été transmis, il aurait de toute façon été incompatible : la vraie forme attendue par `opening_hours` est `Record<'mon'|'tue'|...,{open,close,closed}>` (validée strictement par `update_restaurant_hours_secure`, [20260720100100_validate_restaurant_hours_shape.sql](../../../supabase/migrations/20260720100100_validate_restaurant_hours_shape.sql)) — pas une chaîne libre comme "Lendi-Sam 10h-22h". Le champ du formulaire d'inscription est donc **structurellement incompatible** avec la vraie colonne, indépendamment du bug de transmission.

**Ce n'est pas un problème de** : RPC, `.select()`, relation manquante, policy RLS, ou sérialisation — la chaîne technique de création elle-même (trigger → INSERT) fonctionne correctement pour tous les autres champs. C'est un problème unique et isolé : **un champ de formulaire jamais câblé**, sur une colonne dont la forme réelle attendue diffère de toute façon de ce que ce champ pourrait produire.

**Non-impact confirmé** : la page publique du restaurant ([restaurants.$slug.tsx:31-35](../../../src/routes/restaurants.$slug.tsx#L31-L35)) et la page d'édition du propriétaire ([dashboard.restaurant.profile.tsx:77-78](../../../src/routes/_authenticated/dashboard.restaurant.profile.tsx#L77-L78)) gèrent déjà `{}` proprement (comportement documenté, valeurs par défaut à l'édition) — aucun crash, aucun texte brut affiché à un utilisateur final.

---

## 9. Driver Documents Root Cause Analysis

**Question** : _pourquoi le compte est-il créé mais les pièces d'identité ne sont-elles pas visibles par l'Admin ?_

**Réponse, avec preuve directe** : ce n'est **pas** un problème de visibilité (RPC/RLS/signed URL — tous confirmés fonctionnels § 5-7). C'est un problème de **non-persistance** en amont, combiné à l'**absence totale de rattrapage**.

Preuve — le seul livreur réel en production :

```
driver_id: 94e6de0d-...  user_id: c7626bfd-...  status: online  id_doc_url: null
```

Aucun objet dans `storage.objects` (bucket `driver-documents`) n'a de préfixe de chemin correspondant à `c7626bfd-...` — **aucune tentative d'upload n'a laissé de trace**, ni réussie ni échouée.

Chaîne de cause identifiée :

1. **Aucun garde-fou n'empêche l'approbation sans document** — ni dans `DriverDetailDialog` (bouton "Apwouve" jamais désactivé), ni dans `update_driver_status_secure` (aucune clause SQL vérifiant `id_doc_url`). Un admin peut cliquer "Apwouve" sur un dossier affichant "Pa gen pyès idantite!" sans aucun blocage — **c'est exactement ce qui s'est produit** pour ce livreur (status = `online`, donc déjà passé par une approbation).
2. **Aucun chemin de rattrapage n'existe** — `finalizeRegistrationDocuments` ([register-documents.functions.ts:196](../../../src/lib/register-documents.functions.ts#L196)) rejette toute tentative dès que `driver.status !== 'pending'` ("Kont sa a deja trete"), et rejette aussi tout appel après 2h ([register-documents.functions.ts:197-199](../../../src/lib/register-documents.functions.ts#L197-L199)) même si le statut est resté `pending`. Une fois l'un ou l'autre de ces seuils dépassé, **il n'existe littéralement aucun code, aucune route, aucun bouton dans toute l'application permettant d'attacher un document manquant après coup** — ni pour le livreur, ni pour l'admin.
3. **Aucune trace d'échec n'est conservée** — si l'upload initial a échoué (réseau, base64 trop lent sur mobile, etc.), la seule preuve est un `toast.warning` éphémère côté navigateur du livreur au moment des faits ([driver-form.tsx:66-70](../../../src/components/auth/driver-form.tsx#L66-L70)) — rien n'est journalisé côté serveur. Impossible de confirmer a posteriori _pourquoi_ ce livreur précis n'a pas de document — seulement _que_ c'est le cas.

**Ce que la chaîne technique fait correctement, confirmé** : bucket privé + MIME/taille corrects, policy RLS admin indépendante de `owner`, RPC `get_drivers_admin` retourne bien les 3 colonnes, `ProofThumb` génère correctement une signed URL. **Si un document avait réellement été persisté en base (`id_doc_url` non-null), l'admin le verrait** — ce n'est donc jamais le scénario qui s'est produit en réalité.

---

## 10. Security Findings

| #   | Constat                                                                                                                                                                                                                                                                                                                                               | Sévérité                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| S1  | Approbation d'un livreur possible sans aucune pièce d'identité, ni via l'UI ni via le RPC lui-même (`update_driver_status_secure`) — lacune KYC réelle, pas hypothétique (confirmée sur le seul livreur réel).                                                                                                                                        | 🔴 Critique (métier/conformité)       |
| S2  | `stampOwner()` échoue silencieusement (100% des échantillons) — pas une faille d'accès (l'admin garde son accès via l'OR de rôle), mais une régression de confidentialité/contrôle pour le propriétaire réel du fichier, non détectée faute de log.                                                                                                   | 🟠 Moyen                              |
| S3  | Aucune policy `restaurant_assets` SELECT explicite — **attendu et correct** puisque le bucket est public ; vérifié que rien ne suppose par erreur un comportement privé ailleurs dans le code.                                                                                                                                                        | Non-problème (documenté pour mémoire) |
| S4  | Objet orphelin dans `driver-documents` sans lien à un utilisateur existant — aucune politique de rétention/nettoyage identifiée pour ce bucket.                                                                                                                                                                                                       | 🟢 Faible                             |
| S5  | `finalizeRegistrationDocuments` n'a aucune table d'audit (contrairement à `plop_api_logs`/`newsletter_send_log` récemment ajoutés pour d'autres flux) — un échec silencieux d'upload est aujourd'hui totalement invisible après coup, ce qui a directement empêché ce présent audit de confirmer la cause exacte de l'échec du seul cas réel observé. | 🟠 Moyen (observabilité)              |

Aucune faille d'élévation de privilège, d'accès croisé entre utilisateurs, ni de fuite de document privé trouvée — les policies RLS `driver-documents`/`restaurant-assets` sont correctement scopées (`owner = auth.uid() OR admin/super_admin`), confirmées live.

---

## 11. Data Integrity Findings

| #   | Constat                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `restaurants.opening_hours` = `{}` pour 100% des restaurants créés via le formulaire d'inscription (1/1 échantillon réel, et structurellement garanti pour tout futur signup tant que le bug § 8 n'est pas corrigé).                    |
| D2  | `drivers.id_doc_url/license_doc_url/vehicle_photo_url` peuvent rester `NULL` indéfiniment sur un compte déjà `approved`/`online`, sans qu'aucune contrainte DB (CHECK) ni logique applicative ne l'empêche ou ne le signale après coup. |
| D3  | `storage.objects.owner` = `NULL` pour 100% des objets échantillonnés issus du flux service-role (`restaurant-assets`, 2/2) — écart entre l'intention du code (`stampOwner`) et l'état réel en base.                                     |
| D4  | 1 objet orphelin dans `driver-documents` sans propriétaire identifiable — donnée resiudelle, sans owner traçable.                                                                                                                       |

---

## 12. Reproduction Steps

**{} restaurant** (lecture seule, aucune création de compte réelle nécessaire — déjà observable) :

```sql
SELECT id, name, opening_hours FROM public.restaurants;
-- opening_hours = '{}' pour toute ligne créée via le formulaire d'inscription
```

Reproductible en code sans toucher la prod : dans `restaurant-form.tsx`, le payload construit à la ligne 33-41 ne contient jamais `restaurant_hours` — vérifiable par simple lecture, aucune exécution nécessaire.

**Documents livreur manquants** (lecture seule) :

```sql
SELECT id, user_id, status, id_doc_url FROM public.drivers WHERE id_doc_url IS NULL AND status IN ('approved','online');
-- Le seul livreur réel de ce projet apparaît ici
```

Reproductible en code : `update_driver_status_secure` (§ 6) et `DriverDetailDialog`'s bouton "Apwouve" (§ 7) — aucune des deux ne référence `id_doc_url` dans sa condition d'exécution ; vérifiable par simple lecture.

---

## 13. Root Cause Matrix

| ID  | Problème                                      | Sévérité | Cause                                                                                           | Preuve                                                                                                           |
| --- | --------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| R1  | `opening_hours` toujours `{}`                 | 🟠 P1    | Champ formulaire jamais envoyé dans les metadata de `signUp`                                    | restaurant-form.tsx:33-41 + données réelles (AC Resto)                                                           |
| R2  | Livreur approuvé sans pièce d'identité        | 🔴 P0    | Aucun garde-fou UI ni RPC sur `id_doc_url` avant approbation                                    | driver-detail-dialog.tsx:293-300, update_driver_status_secure (20260722170000) + donnée réelle (le seul livreur) |
| R3  | Aucun rattrapage possible après coup          | 🔴 P0    | `finalizeRegistrationDocuments` verrouille dès `status≠'pending'` ou après 2h, sans alternative | register-documents.functions.ts:196-199                                                                          |
| R4  | `stampOwner()` ne fonctionne pas              | 🟠 P1    | Écriture sur `storage.objects.owner` via `.schema("storage")` sans effet constaté               | register-documents.functions.ts:84-105 + storage.objects réel (2/2 owner=NULL)                                   |
| R5  | Aucune traçabilité des échecs d'upload signup | 🟠 P1    | Pas de table de log pour `finalizeRegistrationDocuments` (contrairement aux flux payment)       | absence confirmée dans le fichier + schéma                                                                       |
| R6  | Objet orphelin `driver-documents`             | 🟢 P3    | Probable artefact de test, aucune politique de rétention                                        | storage.objects réel                                                                                             |

---

## 14. Recommended Fixes

_(Recommandations uniquement — rien n'est appliqué dans cette mission.)_

**R1 — `opening_hours` toujours `{}`**

- Soit retirer le champ "Orè ouvèti" du formulaire d'inscription (les heures sont de toute façon éditées plus tard via `update_restaurant_hours_secure` avec la vraie forme structurée) — le champ est aujourd'hui trompeur (collecté, jamais utilisé).
- Soit, si on veut le garder utile dès l'inscription, le remplacer par les mêmes contrôles jour-par-jour que `dashboard.restaurant.profile.tsx` utilise déjà, et le sérialiser dans la forme `Record<jour,{open,close,closed}>` avant de l'inclure dans les metadata — pas une chaîne libre.
- Recommandation : **option 1** (retrait), la plus simple et la moins risquée — aucune promesse UX rompue puisque `{}` est déjà géré proprement partout ailleurs.

**R2/R3 — Approbation sans document + aucun rattrapage**

- Ajouter une vérification explicite dans `update_driver_status_secure` : refuser la transition vers `'approved'` si `id_doc_url IS NULL` (erreur claire, pas un blocage silencieux).
- Miroir côté UI : désactiver le bouton "Apwouve" avec un tooltip explicite quand `id_doc_url` est absent (défense en profondeur, la vraie garde doit être en base).
- Ajouter un chemin de rattrapage : soit une nouvelle RPC admin-only `attach_driver_document_secure` (sans les contraintes de fenêtre 2h/statut pending — l'admin est déjà authentifié, pas besoin du système de gates conçu pour un utilisateur sans session), soit assouplir `finalizeRegistrationDocuments` pour accepter un statut `pending` sans limite de temps tant qu'aucun document n'est présent (en gardant la limite de 2h uniquement pour le cas déjà documenté).

**R4 — `stampOwner()` cassé**

- D'abord confirmer la cause exacte (probable : schéma `storage` non exposé à PostgREST) via un test isolé en environnement de dev, avant tout correctif — ne pas deviner.
- Alternative plus robuste si confirmé : utiliser l'API Admin Storage dédiée (`supabaseAdmin.storage...`) plutôt que `.schema("storage").from("objects")` si une méthode équivalente existe côté SDK, ou une fonction Postgres `SECURITY DEFINER` appelée via RPC (contourne complètement la question d'exposition de schéma PostgREST).

**R5 — Absence de traçabilité**

- Réutiliser exactement le pattern déjà éprouvé cette semaine sur `newsletter_send_log`/`plop_api_logs` : une table d'audit append-only pour chaque tentative d'upload de `finalizeRegistrationDocuments` (bucket, path, succès/échec, message d'erreur, durée) — admin-read-only, service_role-write-only.

**R6 — Objet orphelin**

- Suppression manuelle ponctuelle (hors scope de cette mission, action destructive) ou tâche de nettoyage périodique future — non urgent.

---

## 15. Migration Requirements

_(Listées à titre de recommandation — aucune n'est écrite ni appliquée dans cette mission, conformément à la règle absolue.)_

| Migration proposée                                                                     | Contenu                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `YYYYMMDDHHMMSS_require_driver_document_before_approval.sql`                           | Ajoute la vérification `id_doc_url IS NOT NULL` dans `update_driver_status_secure` avant d'autoriser `'approved'` (DROP+CREATE si signature identique suffit, sinon CREATE OR REPLACE). |
| `YYYYMMDDHHMMSS_driver_document_attach_secure.sql`                                     | Nouvelle RPC admin-only pour rattacher un document après coup, sans les contraintes de fenêtre conçues pour le flux signup.                                                             |
| `YYYYMMDDHHMMSS_registration_upload_log.sql`                                           | Nouvelle table `registration_upload_log`, même schéma/RLS/trigger append-only que `newsletter_send_log`.                                                                                |
| `YYYYMMDDHHMMSS_remove_restaurant_hours_from_signup.sql` (si option 1 retenue pour R1) | Aucune migration DB nécessaire à proprement parler — c'est un changement frontend uniquement (retrait du champ + de la clé metadata).                                                   |

---

## 16. Test Plan

Pour chaque correctif, avant application en production (cohérent avec la discipline déjà établie sur ce projet — BEGIN/ROLLBACK, dry-run, jamais de compte réel) :

1. **R1** : test unitaire vérifiant que le payload `signUp` ne contient plus `hours`/`restaurant_hours` (ou, si option 2, qu'il contient une structure jour-par-jour valide) ; test manuel visuel du formulaire.
2. **R2/R3** : test transactionnel BEGIN/ROLLBACK simulant un admin tentant d'approuver un livreur `id_doc_url IS NULL` → doit lever une exception explicite ; test symétrique avec un document présent → doit réussir normalement (non-régression).
3. **R4** : test isolé (script Node ou fonction de test dédiée) appelant `stampOwner()` contre un objet de test, vérifiant que `owner` est effectivement mis à jour après l'appel — avant tout déploiement du correctif.
4. **R5** : tests unitaires sur la nouvelle table de log (mêmes assertions que `send-newsletter.test.ts` : append-only, RLS admin-only, écriture service_role).

---

## 17. Regression Risks

- **R2 (garde d'approbation)** : risque de bloquer une approbation légitime si un admin a une raison métier valable d'approuver sans document (aujourd'hui inconnu si un tel cas existe) — recommandé de vérifier avec le métier avant d'appliquer, pas seulement techniquement.
- **R1 (retrait du champ hours)** : aucun risque de régression identifié — le champ n'est utilisé nulle part en aval.
- **R4 (fix stampOwner)** : risque faible — changement isolé à une fonction best-effort, déjà non-bloquante par design.
- **R3 (nouvelle RPC de rattrapage)** : nécessite une revue de sécurité dédiée avant implémentation (nouvelle surface d'écriture sur `storage`/`drivers` pour un rôle admin) — pas à sous-estimer.

---

## 18. Go/No-Go Recommendation

## 🟠 CORRECTIONS NÉCESSAIRES

Aucun des deux bugs trouvés n'est un incident actif en cours (le volume de production est minimal — 1 restaurant, 1 livreur), mais **R2/R3 (approbation livreur sans pièce d'identité + aucun rattrapage possible)** est une vraie lacune de conformité déjà matérialisée sur le seul cas réel existant, et **doit être corrigée avant toute croissance du volume d'inscriptions livreur**. R1 (`{}`) est cosmétique/sans risque métier mais facile à corriger. R4/R5 sont des dettes techniques réelles mais non bloquantes à court terme.

Aucune modification n'a été appliquée dans le cadre de cette mission, conformément à la règle absolue.
