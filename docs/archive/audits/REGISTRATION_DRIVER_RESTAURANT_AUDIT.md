# 🔎 Audit ciblé — Inscription Livreur & Restaurant retourne `{}`

**Date** : 2026-08-11
**Type** : Audit uniquement — **aucun fichier de code modifié, aucune migration créée/appliquée, aucun commit, aucun push.**
**Méthode** : lecture de code (frontend, `node_modules/@supabase/auth-js`, migrations SQL), introspection **read-only** de la base de production (`supabase inspect db …`, `supabase migration list --linked`), et **reproduction réelle en direct** contre l'API Supabase de production (`auth/v1/signup`, `auth/v1/token`) avec 2 comptes de test jetables (email fourni par l'utilisateur : `clubcodinggonaives@gmail.com`, tagué `+restaurant…`/`+driver…`). Chaque affirmation ci-dessous est reliée à une preuve directe (fichier:ligne ou sortie HTTP/SQL brute), jamais à une supposition.

---

## 1. Résumé exécutif

**🔴 ROOT CAUSE IDENTIFIÉE — reproduite à volonté, à 100 %, pour Restaurant, Livreur et Client (customer) indifféremment.**

Ce n'est **pas** le bug déjà corrigé le 2026-08-09 (`opening_hours` toujours `{}`, `docs/DRIVER_RESTAURANT_REGISTRATION_AUDIT.md`, commit `759958b`) — celui-là reste corrigé et vérifié live. C'est un **bug distinct, plus grave, actif en ce moment même en production** :

1. **Cause racine serveur** : Supabase Auth (GoTrue) n'arrive plus à envoyer l'email de confirmation d'inscription. Chaque appel à `supabase.auth.signUp()` — le tout premier appel réseau de **n'importe quel** formulaire d'inscription (Client, Livreur, Restaurant, tous les trois passent par la même fonction `baseSignUp()`) — échoue avec **HTTP 500**, `error_code: "unexpected_failure"`, `msg: "Error sending confirmation email"`. Confirmé par preuve HTTP directe (§3). La création du compte est **entièrement annulée** (rollback propre — aucune ligne orpheline, voir §5) : aucun compte, aucun restaurant, aucun livreur n'est créé tant que ce blocage persiste.
2. **Cause racine client (aggravante, indépendante)** : la librairie `@supabase/auth-js` (v2.110.6, utilisée par ce projet) traite **tout code HTTP 500-504** comme une "erreur réseau retryable" et, dans ce cas précis, **ne lit jamais le corps JSON de la réponse** — donc jamais le message `"Error sending confirmation email"` pourtant présent et informatif. Elle retombe sur `JSON.stringify()` de l'objet `Response` brut lui-même, qui n'a aucune propriété énumérable utile → produit littéralement la chaîne **`"{}"`**. Ce `"{}"` remonte tel quel jusqu'au `toast.error()` affiché à l'utilisateur final. Preuve directe §4.

Résultat observable pour l'utilisateur : il clique "Kreye kont restoran"/"Kreye kont livrè", rien ne se passe visiblement de significatif, et le message d'erreur affiché est littéralement **`{}`** — exactement le symptôme rapporté.

**Ce bug n'est PAS spécifique à Restaurant ou Livreur** — il est en amont de toute logique métier (avant même que `handle_new_user()` s'exécute), donc il bloque également l'inscription Client (`customer-form.tsx`), qui partage le même `baseSignUp()`.

---

## 2. Reproduction — Livreur

**Méthode** : appel direct, en Node, de la fonction `baseSignUp()` telle qu'elle existe réellement dans `src/components/auth/register-shared.logic.ts` (RPC de rate-limit + `supabase.auth.signUp()`), avec la clé publique anon (jamais la service role), avec le payload exact que `driver-form.tsx:36-44` construit.

| Étape                                                  | Attendu                             | Réel observé                                                                          |
| ------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------- |
| `check_auth_rate_limit_secure` RPC                     | `true`                              | ✅ `true`                                                                             |
| `supabase.auth.signUp()`                               | `{data:{user,session}, error:null}` | ❌ `data:{user:null,session:null}`, `error` = `AuthRetryableFetchError`, `status:500` |
| Message affiché à l'utilisateur (`translateAuthError`) | message clair                       | ❌ **`{}`** (littéral)                                                                |
| Ligne créée dans `public.drivers` ?                    | 1 nouvelle                          | ❌ Aucune — compte jamais créé (§5)                                                   |

Payload utilisé (non sensible) :

```json
{
  "email": "clubcodinggonaives+driver<timestamp>@gmail.com",
  "account_type": "driver",
  "first_name": "Audit",
  "last_name": "Driver",
  "phone": "+50987654321",
  "address": "456 Audit Ave, Gonaïves",
  "vehicle_type": "moto",
  "license_plate": "AUDIT-001"
}
```

---

## 3. Reproduction — Restaurant

Identique, avec le payload de `restaurant-form.tsx:45-54` :

```json
{
  "email": "clubcodinggonaives+restaurant<timestamp>@gmail.com",
  "account_type": "restaurant",
  "first_name": "Audit Owner",
  "phone": "+50912345678",
  "restaurant_name": "Audit Test Resto",
  "restaurant_description": "Audit reproduction — safe to delete",
  "restaurant_cuisine": "Kreyòl",
  "restaurant_address": "123 Audit St, Gonaïves"
}
```

Réponse brute HTTP obtenue via `curl` direct sur `POST /auth/v1/signup` (aucun SDK, pour éliminer toute transformation côté client) :

```
HTTP/1.1 500 Internal Server Error
Content-Type: application/json
sb-project-ref: dcsnmvbtsmdbwrwbutph
x-sb-error-code: unexpected_failure

{"code":500,"error_code":"unexpected_failure","msg":"Error sending confirmation email","error_id":"019ff1f7-160a-7bfc-9bbf-5d73d357a46b"}
```

Résultat identique au Livreur : le SDK (`@supabase/auth-js`) transforme cette réponse pourtant explicite en `AuthRetryableFetchError` avec `.message === "{}"`.

**Retest immédiat avec le même email** (pour vérifier si un compte fantôme a été créé au 1er essai) → **même erreur 500 "Error sending confirmation email"**, pas de "user already exists" :

```
{"code":500,"error_code":"unexpected_failure","msg":"Error sending confirmation email", ...}
```

---

## 4. Origine exacte de `{}` — trace complète

```
UI (restaurant-form.tsx / driver-form.tsx / customer-form.tsx)
  → submit() → wrap(async () => { … baseSignUp(email, password, metadata) … })
     [register-shared.logic.ts:9]

baseSignUp()
  → supabase.auth.signUp({ email, password, options: { data } })
     [register-shared.logic.ts:19-26]
  → SDK fait POST https://…supabase.co/auth/v1/signup
     ↓
GoTrue (serveur Supabase Auth)
  → crée l'utilisateur (transaction) → tente d'envoyer l'email de confirmation
    (obligatoire ici : mailer_autoconfirm = false, confirmé via GET /auth/v1/settings)
  → **l'envoi d'email échoue** → GoTrue ROLLBACK la transaction entière,
    répond HTTP 500 { "msg": "Error sending confirmation email", "error_code": "unexpected_failure" }
     ↓
@supabase/auth-js v2.110.6 — node_modules/@supabase/auth-js/dist/main/lib/fetch.js
  → _handleRequest() reçoit result.ok === false → appelle handleError(result)  [fetch.js:127]
  → handleError():
      NETWORK_ERROR_CODES = [500,501,502,503,504,520-530]   [fetch.js:32-34]
      if (NETWORK_ERROR_CODES.includes(error.status))        [fetch.js:40]
        throw new AuthRetryableFetchError(_getErrorMessage(error), error.status)   [fetch.js:42]
      ⚠️ Cette branche ne fait JAMAIS `await error.json()` — le corps JSON contenant
      "Error sending confirmation email" n'est **jamais lu**.
  → _getErrorMessage(error) reçoit l'objet Response brut (pas encore parsé) :
      checks .msg / .message / .error_description / .error → AUCUN n'existe comme
      propriété énumérable propre d'un objet Response  [fetch.js:15-27]
      → fallback : `return JSON.stringify(err)`         [fetch.js:26]
      → JSON.stringify(Response) === "{}"   ⟵⟵⟵ **PREMIÈRE APPARITION DE "{}"**
     ↓
baseSignUp(): `if (error) throw error;`   [register-shared.logic.ts:27]
  → propage l'AuthRetryableFetchError avec .message === "{}" tel quel
     ↓
useSubmit.wrap()'s catch: `toast.error(translateAuthError(e))`   [useSubmit.ts:28-29]
     ↓
translateAuthError(e)   [src/lib/auth-errors.ts]
  → code = e.code → undefined (AuthRetryableFetchError n'a pas de champ `code`)
  → aucun des `case` (ligne 12-30) ne matche
  → aucun des fallback `.includes(...)` (ligne 36-49) ne matche la chaîne "{}"
  → `return message || "Yon erè pase. Eseye ankò.";`   [auth-errors.ts:52]
  → message = "{}" (chaîne non-vide, donc **retournée telle quelle**)
     ↓
UI : toast.error("{}")  ⟵⟵⟵ **CE QUE L'UTILISATEUR VOIT LITTÉRALEMENT**
```

**FIRST SOURCE OF `{}`** : `node_modules/@supabase/auth-js/dist/main/lib/fetch.js:26` (`_getErrorMessage`'s `JSON.stringify(err)` fallback), déclenché par la branche `NETWORK_ERROR_CODES` de `handleError()` à la ligne 40-42 du même fichier. C'est un bug/comportement de la librairie tierce `@supabase/auth-js`, pas du code applicatif de ce projet — mais le code applicatif (`translateAuthError`, §10 ci-dessous) n'a aucun filet de sécurité pour l'intercepter avant affichage.

---

## 5. Différenciation des 3 cas (§12 de la mission)

**✅ CAS A confirmé** : _Opération échoue → erreur masquée → `{}`._

Preuve que c'est bien un **rollback complet**, pas un cas B (succès partiel sans donnée) ni C (étape intermédiaire réussie) :

- Retest du `signup` avec le **même email** → toujours `"Error sending confirmation email"`, jamais `"user_already_exists"`/`email_exists`.
- Test décisif : `POST /auth/v1/token?grant_type=password` avec cet email+password → `400 invalid_credentials` ("Invalid login credentials"), **pas** `email_not_confirmed`. Si un compte non-confirmé existait réellement, GoTrue répondrait `email_not_confirmed`, pas `invalid_credentials`. Ceci prouve qu'**aucun utilisateur n'a été créé**, donc aucune ligne `restaurants`/`drivers`/`profiles`/`user_roles` (qui dépendent toutes du trigger `handle_new_user()` sur `auth.users`) n'a pu être insérée non plus.
- Confirmé côté base : `supabase inspect db vacuum-stats --linked`, avant/après les 3 tentatives de cette session : `public.restaurants` reste à **1**, `public.drivers` reste à **2**, `public.profiles` reste à **7**, `public.user_roles` reste à **10** — aucune variation.

**Conclusion** : pas de données orphelines créées par ce bug (bonne nouvelle pour l'intégrité des données), mais **l'inscription est intégralement bloquée** — c'est pire qu'un problème d'affichage, c'est une panne fonctionnelle complète.

---

## 6. Cause racine — classement

| Composant                                                                  | Rôle dans le bug                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supabase Auth (GoTrue) — configuration SMTP/mailer du projet**           | 🔴 **Cause racine primaire.** L'envoi de l'email de confirmation échoue systématiquement (`msg: "Error sending confirmation email"`). Ce réglage vit dans Supabase Dashboard → Authentication → Emails/SMTP (ou l'intégration mailer par défaut du projet) — **hors du code de ce dépôt**, non lisible via les outils disponibles dans cette session (pas d'accès Dashboard/Management API Auth-config). |
| **`@supabase/auth-js` (dépendance tierce, v2.110.6)**                      | 🟠 **Cause racine secondaire, dans le code.** `handleError()` (fetch.js) ignore le corps JSON pour tout statut 500-530 et fabrique `"{}"` via `JSON.stringify(Response)`. Comportement de la librairie, pas de ce projet, mais directement responsable du symptôme visuel exact rapporté.                                                                                                                |
| **`src/lib/auth-errors.ts` (`translateAuthError`)**                        | 🟠 **Aggravant applicatif.** Aucun cas ne traite spécifiquement une erreur "réseau/serveur" (5xx, `AuthRetryableFetchError`) — elle retombe sur le message brut au lieu d'un message générique clair ("problème temporaire, réessayez"). C'est la seule pièce de ce bug qui est du code du projet et directement corrigible.                                                                             |
| Frontend (formulaires, `baseSignUp`, `handle_new_user()`, RLS, RPC métier) | ✅ **Non impliqués.** Toute la chaîne applicative métier fonctionne correctement — le blocage survient **avant** qu'elle ne soit jamais atteinte.                                                                                                                                                                                                                                                        |
| `opening_hours` / `buildRestaurantHoursMetadata` (`{}` intentionnel)       | ✅ **Vérifié, non impliqué.** `restaurant-form.logic.ts:17` retourne bien `{}` quand l'owner ne touche pas les horaires — mais c'est un objet de métadonnées interne jamais affiché à l'utilisateur, comportement voulu et déjà audité/corrigé le 2026-08-09 (ne produit plus `opening_hours` toujours vide, seulement quand réellement non renseigné). Sans rapport avec le `{}` visible aujourd'hui.   |

---

## 7. Preuves

- `src/components/auth/register-shared.logic.ts:9-33` (`baseSignUp`)
- `src/hooks/useSubmit.ts:16-33` (`wrap`, catch → `translateAuthError`)
- `src/lib/auth-errors.ts:7-53` (`translateAuthError`)
- `src/components/auth/restaurant-form.tsx:44-54`, `src/components/auth/driver-form.tsx:35-44`, `src/components/auth/customer-form.tsx:25-35` (les 3 appelants de `baseSignUp`)
- `node_modules/@supabase/auth-js/dist/main/lib/fetch.js:15-27` (`_getErrorMessage`), `:32-42` (`NETWORK_ERROR_CODES` / `handleError`)
- `GET https://dcsnmvbtsmdbwrwbutph.supabase.co/auth/v1/settings` → `mailer_autoconfirm: false`, `disable_signup: false` (confirmation obligatoire à chaque signup, signup lui-même autorisé)
- `POST /auth/v1/signup` (×3, 2 emails distincts + 1 retest) → HTTP 500 à chaque fois, `{"code":500,"error_code":"unexpected_failure","msg":"Error sending confirmation email", ...}`
- `POST /auth/v1/token?grant_type=password` avec l'email du test → `400 invalid_credentials` (pas `email_not_confirmed`) → confirme rollback complet
- `supabase migration list --linked` → 137/137 migrations `local == remote`, aucune dérive — confirme que le code lu dans `supabase/migrations/` est bien ce qui tourne réellement en production (le bug n'est pas une dérive de schéma)
- `supabase inspect db vacuum-stats --linked` (avant/après) → `restaurants`, `drivers`, `profiles`, `user_roles` inchangés

---

## 8. Impact

- **Livreur** : 100 % des inscriptions échouent, message `{}`.
- **Restaurant** : 100 % des inscriptions échouent, message `{}`.
- **Client (customer)** : même code partagé (`baseSignUp`), même point de blocage GoTrue — quasi certainement affecté aussi (non testé en direct pour éviter de créer un 3ᵉ compte inutile, mais le mécanisme est strictement identique et en amont de toute branche `account_type`).
- **Connexion (login) d'utilisateurs déjà existants** : non affectée — `signUp()` seul déclenche l'envoi d'email de confirmation ; un login (`grant_type=password`) ne l'exige pas (confirmé au §5, la requête de login a répondu normalement avec `invalid_credentials`, pas 500).
- **Mot de passe oublié / autres flux envoyant un email** (`auth/v1/recover`, invitations, magic link) : probablement affectés par la même cause racine (échec d'envoi d'email), non testés dans cet audit (hors périmètre de la mission, mais à vérifier en priorité vu la gravité).

---

## 9. Risque de régression

Aucun risque de régression identifié pour une correction du problème SMTP côté Dashboard (pure config, ne touche aucun code). Pour la correction applicative recommandée (§10, `translateAuthError`) : risque très faible, changement additif (nouveau `case`/condition), ne modifie aucun comportement existant pour les erreurs déjà bien gérées.

---

## 10. Recommandation de remédiation _(non implémentée — recommandation uniquement)_

**Priorité 1 — Cause racine réelle (hors code, config Supabase Dashboard)** :

- Vérifier Supabase Dashboard → Authentication → Emails / SMTP Settings du projet `dcsnmvbtsmdbwrwbutph`. Le pattern déjà rencontré deux fois sur ce projet (incident Stripe `mk_`, incident `RESEND_API_KEY` du 2026-08-09, voir mémoire `project_newsletter_email_remediation`) est une **clé API invalide/expirée/mal collée** — très probablement la même classe de problème ici, mais sur une **surface de configuration différente** (le SMTP de GoTrue est réglé dans le Dashboard Supabase, indépendamment de la variable d'environnement `RESEND_API_KEY` de l'app Vercel qui, elle, a déjà été corrigée le 2026-08-09 pour un usage différent — la newsletter). Il est très plausible que la clé SMTP de GoTrue n'ait jamais été mise à jour lors de cette rotation.
- Vérifier aussi les quotas d'envoi du projet Supabase (le mailer par défaut de Supabase a des limites basses, pensé pour le développement, pas la production).

**Priorité 2 — Filet de sécurité applicatif (`src/lib/auth-errors.ts`)** :

- Ajouter, avant le fallback final, un cas explicite pour les erreurs réseau/serveur (`error instanceof AuthRetryableFetchError` ou `status >= 500`, ou une chaîne de message qui ressemble à du JSON vide/illisible) → retourner un message générique clair en Kreyòl (ex. _"Sèvè a gen yon pwoblèm tanporè. Tanpri eseye ankò nan kèk minit."_) au lieu de laisser passer le message brut tel quel.
- Optionnellement, journaliser côté client (Sentry, déjà présent dans le projet — `@sentry/react`) le message brut original (`"{}"`, status, etc.) pour garder la visibilité technique tout en montrant un message propre à l'utilisateur — évite de reproduire l'aveuglement qui avait ralenti le diagnostic de l'incident newsletter avant l'ajout de `newsletter_send_log`.

**Ne pas faire** : activer `mailer_autoconfirm` comme contournement permanent — cela supprimerait la vérification d'email pour tous les comptes (risque sécurité/anti-abus), ce n'est pas un correctif, seulement un masquage du symptôme.

---

## 11. Tests recommandés après correction

1. Une fois la config SMTP corrigée : refaire exactement les 2 mêmes appels `signUp()` (restaurant + livreur) avec des emails jetables neufs → attendre `error: null`, `data.user` non-null, `data.session` selon confirmation email.
2. Vérifier qu'une ligne apparaît bien dans `public.restaurants`/`public.drivers` (et `profiles`, `user_roles`) après un signup réussi.
3. Tester explicitement le cas d'échec SMTP simulé (si possible en environnement de test) pour confirmer que le nouveau message de `translateAuthError` (§10 Priorité 2) s'affiche correctement au lieu de `{}`.
4. Retester `auth/v1/recover` (mot de passe oublié) — probablement affecté par la même cause racine, à confirmer une fois le SMTP réparé.
5. Test de non-régression sur les messages d'erreur déjà bien traduits (email déjà utilisé, mauvais mot de passe, etc.) — aucun ne doit changer de comportement.

---

## 12. Limitations de l'audit

- **Pas d'accès à Supabase Dashboard / Management API Auth-config** dans cette session (aucun token de gestion trouvé permettant de lire `GET /v1/projects/{ref}/config/auth`) — impossible de confirmer à distance _lequel_ des réglages SMTP (host, clé API, quota) est en cause précisément. La preuve que c'est bien un échec d'envoi d'email côté GoTrue est en revanche **directe et certaine** (message d'erreur explicite du serveur, deux fois, sur deux emails différents).
- Le flux Client (customer) n'a pas été testé en direct (seulement audité par lecture de code) pour éviter de créer un 3ᵉ compte de test inutile — le mécanisme partagé rend la conclusion "probablement affecté aussi" solide mais non vérifiée par preuve HTTP directe comme pour Restaurant/Livreur.
- `auth/v1/recover` et les autres flux email (invitation, magic link) n'ont pas été testés — hors périmètre strict de la mission (inscription uniquement).
- Les 2 comptes de test créés via `clubcodinggonaives@gmail.com` (`+restaurant<timestamp>`, `+driver<timestamp>`) **n'ont abouti à aucune création de compte** (confirmé §5) — rien à nettoyer côté base de données. Aucun email n'a donc été réellement envoyé à cette adresse par ces tentatives (c'est précisément l'échec d'envoi qui a fait échouer tout le reste).

---

## 🚦 Décision finale

### 🔴 ROOT CAUSE IDENTIFIÉE

**Pourquoi Livreur retourne `{}` ?** Parce que `supabase.auth.signUp()` échoue avec HTTP 500 ("Error sending confirmation email"), et que `@supabase/auth-js` transforme cette erreur 500 en `JSON.stringify()` d'un objet `Response` vide au lieu de lire le vrai message — exactement la même cause que pour Restaurant.

**Pourquoi Restaurant retourne `{}` ?** Identique, mot pour mot — même fonction (`baseSignUp`), même point d'échec (l'appel `signUp()` lui-même, avant toute logique restaurant/driver).

**Où `{}` est-il créé ?** `node_modules/@supabase/auth-js/dist/main/lib/fetch.js:26`, dans `_getErrorMessage()`, fallback `JSON.stringify(err)` sur l'objet `Response` HTTP brut, déclenché par la branche `NETWORK_ERROR_CODES` (statuts 500-530) de `handleError()` qui ne lit jamais le corps JSON de la réponse.

**L'opération database réussit-elle ?** Non. Rollback complet et propre, confirmé par 2 méthodes indépendantes (retest même email → pas de "already exists" ; tentative de login → `invalid_credentials` et non `email_not_confirmed`) et par les compteurs de lignes en base, inchangés avant/après.

**Si elle échoue, quelle erreur exacte ?** `{"code":500,"error_code":"unexpected_failure","msg":"Error sending confirmation email"}` — un échec d'envoi d'email de confirmation par Supabase Auth (GoTrue), pas une erreur RLS/RPC/base de données.

**Si elle réussit, pourquoi aucune donnée n'est retournée ?** Sans objet — elle ne réussit pas dans l'état actuel du projet.

**La cause est-elle commune aux deux workflows ?** Oui, à 100 % — et au workflow Client également (même fonction partagée, non spécifique à un `account_type`).

**Quel fichier/fonction doit être corrigé ?**

1. Configuration SMTP du projet Supabase (Dashboard Authentication → Emails) — hors dépôt de code, cause racine réelle.
2. `src/lib/auth-errors.ts` (`translateAuthError`) — filet de sécurité applicatif pour ne plus jamais afficher un message brut de type `{}`/JSON illisible à l'utilisateur, quelle que soit la cause sous-jacente future.

**Quelle est la correction minimale recommandée ?** Rotation/vérification de la clé/config SMTP dans Supabase Dashboard (probable clé API mailer invalide, même classe d'incident que `RESEND_API_KEY` le 2026-08-09 mais sur une surface de config différente) + ajout d'un cas de repli générique dans `translateAuthError` pour les erreurs réseau/serveur 5xx.
