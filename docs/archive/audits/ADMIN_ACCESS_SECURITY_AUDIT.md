# 🔒 Audit — Protection renforcée de l'accès au Dashboard Admin

**Date** : 2026-08-11
**Type** : **Phase 1 — Audit + Design uniquement. Aucun code modifié, aucune migration créée/appliquée, aucun commit, aucun push.**
**Méthode** : lecture complète du code (frontend, migrations SQL, RLS), introspection live de la configuration Supabase Auth (Management API, read-only) et de `auth.users`/`auth.identities`/`auth.mfa_factors` en production.

---

## 1. Architecture actuelle

### 1.1 Ce qui existe déjà (et qu'il ne faut pas dupliquer)

Ce projet a **déjà** une itération de durcissement de session admin, livrée le 2026-07-28 (commit `a39d194`, "admin idle lock, step-up reauthentication, and active-sessions management"). Trois mécanismes réels sont en place aujourd'hui :

| Mécanisme                               | Fichier                                                                                                                                   | Portée actuelle                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verrouillage d'écran par inactivité** | [src/components/dashboard/admin/admin-idle-lock.tsx](../../../src/components/dashboard/admin/admin-idle-lock.tsx)                         | Verrouille l'écran (pas la session) après 20 min d'inactivité, pour **toutes** les routes admin (monté une seule fois dans le layout). Déverrouillage par mot de passe ou re-déclenchement Google OAuth.                                                                                                                                                                                                                                 |
| **Step-up re-authentication**           | [src/hooks/useReauth.ts](../../../src/hooks/useReauth.ts) + [src/components/reauth-dialog.tsx](../../../src/components/reauth-dialog.tsx) | Wrapping ponctuel de **3 actions précises** : ajout/retrait de rôle ([dashboard.admin.users.tsx:283-316](../../../src/routes/_authenticated/dashboard.admin.users.tsx#L283-L316)), validation d'un décaissement ([payout-pay-modal.tsx](../../../src/components/dashboard/payouts/payout-pay-modal.tsx)), traitement d'un remboursement ([dashboard.admin.refunds.tsx](../../../src/routes/_authenticated/dashboard.admin.refunds.tsx)). |
| **Gestion des sessions actives**        | `src/components/active-sessions-section.tsx` + `useActiveSessions.ts`                                                                     | Lecture/révocation directe de `auth.sessions`, RPC `get_my_active_sessions_secure`/`revoke_my_session_secure`.                                                                                                                                                                                                                                                                                                                           |

**Ce qui n'existe PAS aujourd'hui** : aucun step-up n'est demandé **à l'entrée** du Dashboard Admin, juste après la connexion. Un admin/super_admin qui vient de se connecter accède **immédiatement** à tout le dashboard — le step-up n'intervient que (a) après 20 min d'inactivité, ou (b) au moment de cliquer sur l'une des 3 actions listées ci-dessus. C'est exactement le vide que ce prompt demande de combler.

### 1.2 Authentification (Supabase Auth)

- **Méthodes actives** : email/password ET Google OAuth (`external.email: true`, `external.google: true`, confirmé via `/auth/v1/settings`).
- **Sessions** : `persistSession`/`autoRefreshToken` activés côté client ([src/integrations/supabase/client.ts](../../../src/integrations/supabase/client.ts), non modifié depuis longtemps par design — voir commentaire de [_authenticated/route.tsx:19-27](../../../src/routes/_authenticated/route.tsx#L19-L27)). `_authenticated/route.tsx`'s `beforeLoad` utilise `getSession()` (jamais `getUser()`) pour admettre une session déjà valide sans aller-retour réseau — l'autorisation réelle repose sur RLS, pas ce guard.
- **Durée de vie du JWT** : `jwt_exp = 3600` (1h), `refresh_token_rotation_enabled = true`, `security_refresh_token_reuse_interval = 10`. **`sessions_timebox = 0` et `sessions_inactivity_timeout = 0`** — Supabase lui-même n'impose **aucune** expiration absolue ou d'inactivité côté serveur ; tout repose sur le refresh automatique du SDK + le verrou d'écran maison (idle-lock) décrit ci-dessus.
- **Récupération de mot de passe** : `auth.forgot-password.tsx` / `auth.reset-password.tsx`, flux Supabase standard (`resetPasswordForEmail` / `updateUser`), rien de spécifique admin.
- **MFA déjà configuré côté projet** (confirmé via `GET /v1/projects/{ref}/config/auth`, jamais utilisé côté code) :
  - `mfa_totp_enroll_enabled: true`, `mfa_totp_verify_enabled: true` — **TOTP est déjà activé et utilisable immédiatement**, sans aucun changement de configuration Supabase.
  - `mfa_phone_enroll_enabled: false`, `mfa_web_authn_enroll_enabled: false`, `passkey_enabled: false` — SMS, WebAuthn et Passkeys natifs sont **désactivés** au niveau du projet ; les activer serait un changement de configuration Supabase Dashboard, pas juste du code.
  - `mfa_allow_low_aal: false`, `mfa_max_enrolled_factors: 10`.
  - **Aucun facteur MFA n'est actuellement enrollé pour personne** (`auth.mfa_factors` avec `status='verified'` = 0 lignes, tous comptes confondus, vérifié en direct).
- **Compte admin réel** : `phanoraltes@gmail.com` — **Google OAuth uniquement, aucune identité `email` dans `auth.identities`** (confirmé en direct). C'est déjà documenté dans le commentaire de `useReauth.ts:20-22` — c'est précisément pourquoi le mécanisme existant supporte les deux cas (mot de passe et OAuth-only). **Toute solution qui suppose qu'un admin a un mot de passe casserait l'accès du seul admin réel du projet.**

### 1.3 Autorisation — comment les rôles sont stockés et vérifiés

- **Stockage** : table `public.user_roles` (`user_id`, `role app_role`), un utilisateur peut avoir **plusieurs lignes/rôles** (`UNIQUE(user_id, role)`, pas de contrainte à un seul rôle). Enum `app_role`: `customer | restaurant_owner | restaurant_staff | driver | admin | super_admin` ([20260702234435...sql:3](../../../supabase/migrations/20260702234435_7ddb3dc0-49c8-4482-a5e8-783b7ca6cbca.sql#L3)).
- **Fonctions sources de vérité** : `private.has_role(_user_id, _role)` et `private.get_primary_role(_user_id)` — `SECURITY DEFINER`, schéma `private` non exposé à l'API REST ([20260703070152...sql:6-38](../../../supabase/migrations/20260703070152_4f042d50-276b-4ea7-be87-6ba76c6046cb.sql#L6-L38)). Toutes les RLS policies et RPC du projet appellent ces fonctions (ou leur wrapper public `SECURITY INVOKER` `public.has_role`/`public.get_primary_role`, qui ajoute une vérification "soi-même ou admin" avant de déléguer — [20260704160000...sql](../../../supabase/migrations/20260704160000_47e8011e-8238-482a-9c56-456dec69d0da.sql)). **C'est un pattern cohérent et déjà bien conçu — aucune policy trouvée qui contourne ce mécanisme.**
- **Pas de "role switcher" dédié** — `allRoles` (liste complète des rôles d'un compte) sert uniquement à `requireRole()` pour admettre un utilisateur multi-rôles dans chaque famille de dashboard qu'il détient réellement, pas à "changer de casquette" via une UI.
- **Élévation de privilège protégée côté backend** : `add_user_role_secure`/`remove_user_role_secure` ([20260709100000_admin_user_management.sql](../../../supabase/migrations/20260709100000_admin_user_management.sql)) interdisent explicitement à un simple `admin` d'attribuer/retirer les rôles `admin`/`super_admin` — seul un `super_admin` le peut. Un `admin` ne peut pas retirer son propre rôle admin, et il doit toujours rester au moins un `super_admin` sur la plateforme. **Bonne pratique déjà en place.**

### 1.4 Routing — routes/guards admin

- **Point de passage unique** : [src/routes/_authenticated/dashboard.admin.tsx](../../../src/routes/_authenticated/dashboard.admin.tsx) — `beforeLoad: () => requireRole(context.allRoles, ["admin", "super_admin"])`. Par la convention de fichiers plats de TanStack Router, **toutes** les 18 routes `dashboard.admin.*.tsx` sont des enfants de cette route et héritent donc de ce guard — **un seul endroit à modifier** pour ajouter un step-up global (pas 18).
- [src/lib/auth-guard.ts](../../../src/lib/auth-guard.ts) — `requireRole()`, guard générique partagé par toutes les familles de dashboard (`throw redirect({ to: "/dashboard" })` si non autorisé).
- **Ce guard est purement client-side** (route `ssr: false` pour toute la famille `_authenticated`, confirmé par le commentaire explicite de `_authenticated/route.tsx:22-24` : _"the actual authorization boundary is Postgres RLS on every request, not this client-side guard"_). C'est un choix architectural assumé et documenté, pas un oubli — mais cela signifie que **le guard de route seul ne bloque jamais un appel RPC direct** (voir §5 — Risques).

### 1.5 Architecture frontend

- `AuthContext`/`useAuth()` ([src/hooks/useAuth.tsx](../../../src/hooks/useAuth.tsx)) — souscription unique `onAuthStateChange`, expose `session`, `user`, `role` (le plus prioritaire), `allRoles` (tous). Monté une fois dans `__root.tsx`.
- Pas de middleware serveur dédié — chaque `beforeLoad` de route fait sa propre vérification, et chaque RPC/mutation Supabase applique sa propre vérification `has_role()` côté SQL.
- États déjà gérés : `loading` (useAuth), `locked` (idle-lock), `dialogOpen`/`submitting`/`error` (reauth). Pas d'état `unauthorized` dédié visible à l'écran — un accès refusé redirige silencieusement vers `/dashboard`, sans message explicatif.

### 1.6 Architecture backend/Supabase

- Toutes les RPC administratives sensibles sont `SECURITY DEFINER`, avec une vérification `private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')` en première ligne (`add_user_role_secure`, `remove_user_role_secure`, `get_all_users_admin`, `review_refund_secure`, `complete_refund_secure`, `initiate_payout_secure`, etc. — vérifié directement dans chacune).
- **`audit_log`** (table + `private.log_audit_event(_user_id, _role, _action, _metadata)`, [20260722100000_payout_wallet_schema.sql:192-218](../../../supabase/migrations/20260722100000_payout_wallet_schema.sql#L192-L218)) — table générique déjà en place, lecture réservée admin/super_admin, écriture réservée aux fonctions `SECURITY DEFINER` (jamais exposée au client). **Réutilisable directement** pour journaliser les événements de step-up demandés en §11 du prompt, sans nouvelle table.
- **RGPD/secrets** : aucune policy RLS trouvée qui affaiblit ou contourne un contrôle existant pendant cet audit.

---

## 2. Mécanisme d'authentification actuel — résumé

```text
Login (password OU Google)
    ↓
Supabase Auth émet JWT (aal="aal1" — jamais aal2, aucun facteur MFA enrollé)
    ↓
getSession() côté client → beforeLoad (_authenticated/route.tsx) → role/allRoles résolus
    ↓
beforeLoad (dashboard.admin.tsx) → requireRole(["admin","super_admin"])
    ↓
Accès immédiat au Dashboard Admin — AUCUNE vérification supplémentaire
```

---

## 3. Mécanisme d'autorisation actuel — résumé

```text
public.user_roles (table)
    ↓
private.has_role() / private.get_primary_role()  [SECURITY DEFINER, schéma privé]
    ↓
├── RLS policies (ex: "Approved restaurants viewable by all")
└── RPC SECURITY DEFINER (ex: add_user_role_secure, initiate_payout_secure)
```

Cohérent, centralisé, testé dans le temps (utilisé depuis la migration initiale du projet). **Aucun changement recommandé ici.**

---

## 4. Routes admin — inventaire

18 routes, toutes enfants de `/dashboard/admin` (garde unique en §1.4). Sections les plus sensibles (visibles seulement pour `super_admin` dans `nav-items.ts`, ou financières pour `admin`+`super_admin`) :

`payout-settings` (paramètres de paiement), `payment-providers` (fournisseurs), `collect` (Peman Otomatik — MonCash/NatCash/Stripe), `payouts` (décaissements), `refunds`, `commissions`, `users` (gestion des rôles).

---

## 5. RLS pertinentes — synthèse

Toutes les tables administratives sensibles ont une policy `has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin')` (ou passent par une RPC `SECURITY DEFINER` équivalente). **C'est la vraie frontière de sécurité du projet, déjà correcte.**

---

## 6. Risques actuels (constat, pas encore de solution)

### 🔴 R1 — Aucun step-up à l'entrée du dashboard admin

Un admin/super_admin authentifié (session/JWT valide, `aal1`) obtient un accès complet immédiat à **tout** le dashboard admin dès la connexion. Rien ne prouve, à ce moment précis, que c'est bien le titulaire du compte qui est devant l'écran (session volée, appareil partagé, token exfiltré via XSS, etc.).

### 🔴 R2 — Le step-up existant (`useReauth`) n'est PAS appliqué côté serveur

Vérifié en lisant le corps SQL complet de `add_user_role_secure`, `remove_user_role_secure`, `review_refund_secure`, `complete_refund_secure`, `initiate_payout_secure` : **aucune** ne vérifie une preuve de ré-authentification récente, l'`aal` du JWT, ou un quelconque signal de step-up. La seule protection est `verifiedUntilRef` — une variable **en mémoire JavaScript côté client**, jamais transmise au serveur. Concrètement : un attaquant disposant d'une session admin valide (JWT volé, ou simplement DevTools ouvert) peut appeler `supabase.rpc("add_user_role_secure", {...})` **directement**, sans jamais passer par `ReauthDialog` — **la Règle 5 du prompt ("le contrôle d'accès ne doit pas reposer uniquement sur le frontend") est déjà violée par le mécanisme existant**, pas seulement par une éventuelle nouvelle fonctionnalité. C'est la découverte la plus importante de cet audit.

### 🟠 R3 — Re-authentification Google potentiellement silencieuse

`useReauth.continueWithOAuth()` et `AdminIdleLock.unlockWithOAuth()` appellent `signInWithOAuth({ provider: "google" })` **sans** paramètre `prompt`. Si le navigateur a encore une session Google active, Google peut renvoyer un code d'autorisation **sans jamais afficher de formulaire de connexion ni demander de confirmation** — le "re-auth" réussirait alors sans que la personne devant l'écran prouve quoi que ce soit qu'elle ne prouvait pas déjà (elle n'a qu'à avoir le navigateur ouvert). Ceci affaiblit directement la valeur du step-up OAuth pour le seul admin réel du projet (compte Google-only). Non testé en conditions réelles dans cet audit (nécessiterait un vrai navigateur avec session Google active), mais c'est le comportement documenté de l'implicit/silent OAuth flow sauf si `prompt=login` ou `prompt=consent` est explicitement demandé.

### 🟡 R4 — Pas d'écran "accès refusé" explicite

`requireRole()` redirige silencieusement vers `/dashboard` sans expliquer pourquoi (Règle 10 du prompt : messages clairs attendus).

### 🟡 R5 — Aucun test automatisé sur `auth-guard.ts`, `useReauth.ts`, `admin-idle-lock.tsx`

Aucun fichier `__tests__` trouvé pour ces 3 fichiers malgré leur rôle sécuritaire.

### 🟢 R6 — Points déjà sains, à ne pas régresser

RLS/RPC backend cohérentes (§1.6), séparation admin/super_admin déjà appliquée pour la gestion des rôles, idle-lock déjà en place, `sessions_single_per_user`/gestion des sessions actives déjà livrée.

---

## 7. Analyse de la proposition initiale (« redemander le même mot de passe »)

**Réponse directe à la question posée : non, ce n'est pas pertinent tel quel, pour deux raisons concrètes et propres à ce projet, pas juste théoriques.**

1. **Le seul admin réel n'a pas de mot de passe.** `phanoraltes@gmail.com` est Google-only (§1.2). Une solution "redemander le mot de passe" est **injouable** pour ce compte sans d'abord lui faire créer un mot de passe — un changement de compte non demandé, et une régression UX (`useReauth`/`admin-idle-lock` gèrent déjà ce cas correctement en basculant sur un re-déclenchement OAuth ; toute nouvelle solution doit faire pareil ou mieux).
2. **Même pour un compte avec mot de passe, redemander exactement le même mot de passe n'ajoute pas de facteur réellement indépendant.** Si la machine/navigateur est compromis (keylogger, session voisine, XSS qui intercepte le formulaire), le mot de passe est reproductible par le même attaquant qui a déjà obtenu l'accès initial — ça prouve seulement "je connais encore le mot de passe", pas "je suis bien la personne physique titulaire du compte". C'est mieux que rien (bloque un JWT volé isolément sans le mot de passe), mais c'est le facteur le plus faible de toutes les options listées dans le prompt.

**Conclusion : la proposition initiale n'est pas rejetée en bloc — le mécanisme `signInWithPassword` qu'elle implique existe déjà et reste utile comme fallback ou comme brique) — mais elle ne doit pas être le mécanisme _unique_ ni _principal_.** Une vraie amélioration doit ajouter un facteur réellement indépendant (TOTP) et surtout corriger R2 (l'absence d'enforcement serveur), ce que la proposition initiale ne fait pas non plus par elle-même.

---

## 8. Comparaison des solutions

### Option A — Deuxième saisie du même mot de passe

**Pour** : zéro nouvelle dépendance, implémentation triviale, `useReauth` le fait déjà pour les comptes password.
**Contre** : injouable pour le seul admin réel (Google-only) sans détour OAuth ; pas un facteur indépendant (§7) ; si implémenté seul, ne corrige pas R2.
**Verdict** : insuffisant seul, déjà partiellement présent comme fallback.

### Option B — Ré-authentification Supabase (re-`signInWithPassword`/`signInWithOAuth`)

**Pour** : utilise uniquement l'API Supabase officielle, déjà implémentée pour 3 actions (§1.1), gère déjà les deux types de compte.
**Contre** : c'est _exactement_ le mécanisme actuel — hérite de R2 (non vérifiable serveur) et R3 (silent OAuth) tel quel. Réutilisable et à corriger, pas à jeter.
**Verdict** : bonne base, insuffisante seule pour un vrai step-up "server-enforced".

### Option C — MFA / TOTP (Supabase natif)

**Pour** : **déjà activé au niveau du projet** (`mfa_totp_enroll_enabled/verify_enabled: true`, aucun changement de config Supabase requis) ; c'est un facteur _réellement_ indépendant (connaissance d'un secret TOTP, pas juste "avoir le navigateur ouvert") ; l'`aal` résultant est un **claim JWT signé par GoTrue**, vérifiable côté serveur dans une RLS/RPC (`auth.jwt()->>'aal' = 'aal2'`) — **seule option qui corrige réellement R2**, pas seulement au niveau UX ; fonctionne identiquement pour les comptes password et OAuth-only (l'enrôlement MFA est indépendant de la méthode de connexion primaire) ; API officielle Supabase (`supabase.auth.mfa.*`), zéro système cryptographique maison.
**Contre** : nécessite un enrôlement initial (l'admin doit scanner un QR code avec une app authenticator) — un pas de plus la première fois ; nécessite de vérifier/tester le comportement exact de `mfa_allow_low_aal` en conditions réelles avant de s'appuyer dessus en production (voir §12, Limitations) ; légèrement plus de code que réutiliser `useReauth` tel quel.
**Verdict** : **la seule option qui satisfait pleinement la Règle 5 du prompt (enforcement serveur réel).**

### Option D — Passkey / WebAuthn

**Pour** : UX moderne, résistant au phishing par design.
**Contre** : **désactivé au niveau du projet** (`mfa_web_authn_enroll_enabled: false`, `passkey_enabled: false`) — activer serait un changement de config Supabase Dashboard supplémentaire, hors du périmètre "juste écrire une migration" ; support navigateur/appareil plus variable qu'un TOTP ; un seul admin réel aujourd'hui, la complexité de récupération de compte (perte de clé physique) est un risque disproportionné pour la taille actuelle de l'équipe.
**Verdict** : pertinent comme **extension future documentée**, pas pour cette itération.

### Option E — Combinaison (recommandée)

Voir §9.

---

## 9. Solution recommandée

**TOTP MFA (Supabase natif) comme step-up obligatoire à l'entrée du Dashboard Admin, avec repli explicite sur le mécanisme `useReauth` existant (mot de passe/OAuth) pour la fenêtre de transition avant qu'un admin ait enrôlé un facteur TOTP — et correction de R2 en ajoutant une vérification `aal`/step-up réel côté RPC pour les 3 actions déjà wrappées par `useReauth`.**

Pourquoi cette combinaison plutôt qu'une seule option pure :

- **TOTP est la seule option qui corrige réellement R2** (vérifiable côté serveur via le claim `aal` du JWT) sans nécessiter de changement de configuration Supabase (contrairement à WebAuthn/Passkey, actuellement désactivés).
- **Un repli est nécessaire** : le seul admin réel n'a aujourd'hui aucun facteur TOTP enrollé. Exiger un step-up TOTP _avant même de pouvoir l'enrôler_ créerait un verrouillage total (personne ne pourrait plus jamais entrer dans le dashboard admin pour aller enrôler son premier facteur). La solution doit donc prévoir un **flux d'enrôlement obligatoire mais non-bloquant au premier accès** (proposer l'enrôlement, autoriser un accès step-up via `useReauth` classique en attendant, avec une bannière/rappel visible tant que l'enrôlement n'est pas fait) — pas un big-bang qui bloque tout le monde le jour du déploiement.
- **Ne pas jeter `useReauth`/`ReauthDialog`** — ce code est déjà propre, gère déjà les deux types de compte, et sert déjà de fallback légitime + de mécanisme pour les step-up _par action_ (§7 du prompt : superadmin + opérations extrêmement sensibles). Il doit être **corrigé** (R2, R3) et **réutilisé**, pas remplacé par un nouveau système.
- Respecte explicitement la Règle 13 du prompt : _"Si Supabase fournit déjà une capacité MFA/re-authentication adaptée, l'utiliser plutôt que créer une implémentation cryptographique maison"_ — TOTP via `supabase.auth.mfa` est exactement ça.

### Niveaux (§7 du prompt)

| Niveau          | Exigence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin**       | Step-up obligatoire (TOTP si enrollé, sinon repli `useReauth`) à l'entrée du dashboard. Durée de confiance : voir §10.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Super_admin** | Identique + step-up **supplémentaire, immédiat, sans fenêtre de confiance** pour : changer un rôle admin/super_admin, actions irréversibles (suppression), configuration financière critique (`payout-settings`, `payment-providers`). Ces actions passent déjà par `useReauth` aujourd'hui pour 2 des 3 cas — l'extension est d'ajouter le même wrapping sur les endpoints financiers restants et de retirer la fenêtre de grâce de 5 min pour ce sous-ensemble précis (contrairement au step-up d'entrée, qui lui garde une fenêtre — voir §10). |

**Documenté comme extension possible, non développée maintenant** : Passkey/WebAuthn si l'équipe grandit et que la perte-de-facteur devient un risque opérationnel gérable (nécessite d'abord d'activer `mfa_web_authn_enroll_enabled` côté Supabase Dashboard).

---

## 10. Architecture cible — flow détaillé

```text
User Login (password ou Google)
        ↓
Supabase Session émise (aal1)
        ↓
_authenticated/route.tsx beforeLoad → role, allRoles résolus
        ↓
dashboard.admin.tsx beforeLoad → requireRole(["admin","super_admin"])
        ├── NON admin/super_admin → comportement actuel inchangé (redirect /dashboard)
        │
        └── OUI (admin/super_admin)
              ↓
        step_up_required ? (pas de step-up valide en cours — voir durée §10.1)
              ├── NON (step-up encore valide) → Admin Dashboard direct
              │
              └── OUI
                    ↓
              A-t-il un facteur TOTP enrollé (verified) ?
                    ├── OUI → Challenge TOTP (supabase.auth.mfa.challengeAndVerify)
                    │           ├── Succès → aal2 obtenu → Admin Dashboard
                    │           └── Échec → verification_failed, retry (limité)
                    │
                    └── NON → Écran "Vérification de sécurité requise"
                                → Propose l'enrôlement TOTP (recommandé, non bloquant)
                                → Repli : useReauth classique (mot de passe/OAuth)
                                → Bannière persistante tant que non-enrollé
```

### 10.1 Durée de validité du step-up

Ne pas re-vérifier à chaque changement de page (Règle 8 du prompt). Proposition, à valider avec vous avant implémentation :

- **Step-up d'entrée (admin/super_admin)** : valide **15 minutes glissantes** pendant la session du dashboard, réinitialisé silencieusement par l'activité (même fenêtre que l'idle-lock existant à 20 min, légèrement plus courte pour rester la contrainte active). **Preuve liée à un événement réel** — un timestamp `aal2` server-truth (le JWT lui-même porte l'`aal`, pas un flag client) pour TOTP ; pour le repli `useReauth`, un flag signé côté serveur (voir §10.2) plutôt qu'un `localStorage`/variable JS, conformément à l'interdiction explicite de la Règle 8.
- **Step-up d'action sensible (super_admin, opérations irréversibles)** : **aucune fenêtre de confiance** — re-vérifié à chaque action, comme c'est déjà le comportement voulu (mais pas totalement atteint côté serveur, R2) pour les 3 cas existants.

### 10.2 Où vivre la preuve de step-up (évite le piège `localStorage.setItem`)

Deux mécanismes différents selon le facteur, tous deux serveur-vérifiables :

- **TOTP** : la preuve est l'`aal` du JWT lui-même (`aal2`), rafraîchi automatiquement par le SDK Supabase après un `challengeAndVerify` réussi — aucun état custom à inventer, RLS/RPC peuvent lire `(auth.jwt()->>'aal')` directement.
- **Repli mot de passe/OAuth (`useReauth` corrigé)** : actuellement 100 % client (`verifiedUntilRef`). Pour corriger R2 sans TOTP, la piste la plus simple compatible avec l'architecture existante (à confirmer en Phase 2) est une **table serveur courte durée** (`admin_step_up_verifications` ou équivalent, `user_id`, `verified_at`, `expires_at`), écrite uniquement par une nouvelle RPC `SECURITY DEFINER` appelée juste après un `signInWithPassword`/callback OAuth réussi, et lue par les RPC sensibles avant d'agir. **À dimensionner et documenter précisément en Phase 2**, pas improvisée ici.

---

## 11. Plan d'implémentation (Phase 2, pas encore fait)

1. **Backend/Supabase** (migration(s), à documenter et présenter avant application — Règle 15) :
   - Table de step-up serveur pour le repli non-TOTP (§10.2), avec append-only/expiration cohérente avec les patterns déjà en place (`private.prevent_log_mutation()` si pertinent).
   - RPC `record_admin_step_up_secure()` (ou nom équivalent) — écrit la preuve après re-auth réussie.
   - RPC `check_admin_step_up_secure()` ou logique équivalente réutilisable dans les RPC sensibles existantes (`add_user_role_secure`, `remove_user_role_secure`, `review_refund_secure`, `complete_refund_secure`, `initiate_payout_secure`) — corrige R2.
   - Réutiliser `private.log_audit_event()` existant pour les 5 événements demandés en §11 du prompt (`admin_step_up_started/success/failed/expired`, `admin_dashboard_access_denied`) — aucune nouvelle table de log nécessaire.
2. **Frontend** :
   - Nouveau composant d'écran de vérification (`components/admin/StepUpGate.tsx` ou équivalent — nom exact à confirmer selon la structure réelle du dossier `components/dashboard/admin/` déjà utilisée pour `admin-idle-lock.tsx`), monté dans `dashboard.admin.tsx` aux côtés d'`AdminIdleLock`.
   - Extension de `useReauth`/nouveau hook `useAdminStepUp` pour gérer le flux TOTP (`supabase.auth.mfa.enroll`/`challengeAndVerify`) en plus du repli existant.
   - Écran d'enrôlement TOTP (QR code — `supabase.auth.mfa.enroll` retourne directement le QR/secret, pas de lib tierce nécessaire).
   - Message "accès refusé" explicite (corrige R4).
   - `prompt: "login"` ou `"consent"` ajouté à `signInWithOAuth` dans `useReauth`/`admin-idle-lock` (corrige R3) — changement isolé, faible risque.
3. **Tests** — voir §13.

---

## 12. Risques de régression

| Risque                                                                                                                                                                            | Mitigation prévue                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Casser l'accès du seul admin réel (Google-only, aucun TOTP enrollé) le jour du déploiement                                                                                        | Repli non-bloquant explicite (§9) — jamais de déploiement qui exige un facteur non encore enrollé pour un compte existant                                     |
| `mfa_allow_low_aal: false` a un effet secondaire non anticipé une fois un premier facteur TOTP enrollé (comportement Supabase pas 100% vérifié dans cet audit — voir Limitations) | Tester en environnement contrôlé avant d'enrôler le compte admin réel ; documenter le comportement observé dans le rapport de Phase 2                         |
| Régression sur login/signup/Google OAuth/reset password                                                                                                                           | Aucun de ces flux n'est touché par le plan — seul le point d'entrée _après_ connexion, au moment d'accéder au dashboard admin, est concerné                   |
| Casser les 3 usages existants de `useReauth` (payout/refund/rôles) en les faisant pointer vers le nouveau mécanisme                                                               | Migration en place, pas en remplacement sec — garder la compatibilité, migrer un call site à la fois, avec tests de non-régression avant/après chacun         |
| Nouvelle table/RPC mal scopée exposant un moyen de forger un step-up                                                                                                              | Suivre exactement le pattern `SECURITY DEFINER` + `auth.uid()` déjà utilisé partout ailleurs dans ce projet, jamais de logique côté client comme seule preuve |

---

## 13. Plan de tests (Phase 2)

### Authentication

Utilisateur authentifié / non authentifié / admin / super_admin — reprendre exactement les 4 cas déjà listés dans le prompt.

### Authorization

Client, restaurant, livreur ne peuvent pas accéder ; admin sans step-up ne peut pas accéder ; admin vérifié peut accéder ; super_admin sans step-up ne peut pas accéder ; super_admin vérifié peut accéder.

### Expiration

Step-up expiré (15 min), session expirée, déconnexion.

### Bypass (le plus important, vu R2)

- Appel RPC direct (`add_user_role_secure` etc.) avec une session admin valide mais **sans step-up récent** → doit maintenant échouer côté serveur, pas seulement être caché côté UI.
- Accès direct à `/dashboard/admin` sans jamais passer par l'écran de vérification.
- F5, nouvel onglet, navigation arrière/avant après step-up.

### Non-régression

Login, inscription, Google OAuth, logout, reset password, dashboards non-admin, les 3 usages existants de `useReauth`.

---

## 14. Limitations de cet audit

- **`mfa_allow_low_aal` et le comportement exact de `aal` après premier enrôlement TOTP n'ont pas été testés en conditions réelles** dans cette session (aucun facteur MFA n'existe actuellement sur le projet) — la Phase 2 doit inclure un test contrôlé (compte de test, pas le compte admin réel en premier) avant de généraliser.
- **Le comportement "silent OAuth" (R3) est documenté d'après le comportement standard de Google OAuth, pas vérifié en conditions réelles dans cette session** (nécessiterait un navigateur avec session Google active, hors du périmètre d'un audit read-only).
- Aucun accès Dashboard Supabase/navigateur dans cette session — toute lecture de configuration passe par la Management API (lecture seule, comme pour l'incident SMTP du même jour).

---

## 🚦 Statut

**Phase 1 terminée — aucun code modifié.** En attente de votre validation sur :

1. La solution recommandée (§9 — TOTP + repli `useReauth` corrigé) ;
2. La durée de step-up proposée (§10.1 — 15 min glissantes pour l'entrée, aucune fenêtre pour les actions super_admin sensibles) ;
3. Le périmètre exact des "opérations extrêmement sensibles" additionnelles à wrapper (§9, niveau super_admin) au-delà des 3 déjà couvertes.

Dites-moi si je passe à la Phase 2 (implémentation) sur cette base, ou si vous voulez ajuster l'un de ces trois points avant.
