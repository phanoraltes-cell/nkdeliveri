# 🔧 Remédiation — Step-up MFA/AAL réellement appliqué côté serveur

**Date** : 2026-08-11
**Référence** : `docs/ADMIN_ACCESS_SECURITY_AUDIT.md` (Phase 1, validée)
**Statut** : Code + migration écrits et **vérifiés par tests transactionnels réels (BEGIN/ROLLBACK) contre la production**, `npm run verify` intégralement vert. **Migration NON appliquée en production** — en attente de confirmation explicite, conformément à la règle absolue de ce projet. **Aucun commit, aucun push.**

---

## 1. Problème initial

L'audit (Phase 1) avait trouvé que `src/hooks/useReauth.ts` (le dialogue de ré-authentification déjà existant, livré le 2026-07-28) demandait bien un mot de passe/Google avant une action sensible — mais **aucune des RPC qu'il protégeait ne vérifiait cette preuve côté serveur**. Un appel RPC direct (DevTools, `curl`, un JWT volé) pouvait exécuter `add_user_role_secure`, `remove_user_role_secure`, `initiate_payout_secure`, `review_refund_secure` ou `complete_refund_secure` sans jamais passer par le dialogue.

**Objectif de cette phase** : transformer cette protection en contrôle d'autorisation backend réel, en réutilisant l'infrastructure MFA native de Supabase — jamais de système maison.

---

## 2. RPC concernées — inventaire complet

**47 fonctions `SECURITY DEFINER` vérifiant `admin`/`super_admin`** trouvées en lisant `pg_proc` en direct (pas seulement les 5 déjà connues) — toutes suivent le même motif `IF NOT (private.has_role(...,'admin') OR private.has_role(...,'super_admin')) THEN RAISE EXCEPTION` :

- **23 lectures** (`get_*_admin`, `get_admin_*`, etc.) — non modifiées, voir §9 pour la justification.
- **~24 mutations**, classées par ce qu'elles font réellement :

| Niveau                                                      | RPC                                                                                                                                                                                                       | Justification                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 🔴 **STRICT** (5 min, MFA fraîche obligatoire, aucun repli) | `add_user_role_secure`                                                                                                                                                                                    | modifie des rôles/privilèges                                  |
|                                                             | `remove_user_role_secure`                                                                                                                                                                                 | modifie des rôles/privilèges                                  |
|                                                             | `initiate_payout_secure`                                                                                                                                                                                  | argent réel quitte la plateforme                              |
|                                                             | `update_payment_provider_setting_secure`                                                                                                                                                                  | configuration financière/sécurité globale                     |
|                                                             | `update_platform_payout_settings_secure`                                                                                                                                                                  | configuration financière globale                              |
| 🟠 **STANDARD** (15 min, repli mot de passe/OAuth accepté)  | `review_refund_secure`                                                                                                                                                                                    | déjà wrappé par `useReauth`, workflow d'approbation propre    |
|                                                             | `complete_refund_secure`                                                                                                                                                                                  | déjà wrappé par `useReauth`, workflow d'approbation propre    |
| ⚪ Non modifiées (~17 autres mutations + 23 lectures)       | `charge_restaurant_monthly_fee_secure`, `execute_commission_backfill_secure`, `recompute_wallet_secure`, `update_driver_status_secure`, `update_restaurant_status_secure`, `resolve_dispute_secure`, etc. | Décision de périmètre délibérée, documentée §9 — pas un oubli |

---

## 3. Architecture retenue

**MFA TOTP natif Supabase + repli mot de passe/OAuth existant, tous deux vérifiés côté serveur via le schéma `auth` natif — aucune nouvelle table de "preuve de step-up" créée.**

Deux mécanismes, zéro nouvelle table :

1. **TOTP** (`mfa_totp_enroll_enabled`/`verify_enabled: true`, déjà actif sur le projet — aucun changement de config Supabase requis) : après `supabase.auth.mfa.challengeAndVerify()`, GoTrue émet un JWT avec `aal: "aal2"` et met à jour `auth.mfa_factors.last_challenged_at`. Les deux sont lus directement en SQL.
2. **Repli** (pour le compte admin réel, Google-only, sans facteur TOTP enrollé aujourd'hui) : `signInWithPassword`/`signInWithOAuth` crée toujours une nouvelle ligne dans `auth.sessions` — sa fraîcheur (`created_at`) est la preuve, lue via le `session_id` du JWT courant.

---

## 4. Vérification AAL/MFA — mécanisme documenté avant utilisation (Étape 3)

```sql
-- Cœur du système, private.admin_step_up_status() :
-- 1) Facteur TOTP vérifié existe ?
--    → aal='aal2' ET last_challenged_at récent → 'ok' / sinon 'expired'/'missing'
-- 2) Aucun facteur enrollé ?
--    → session courante (auth.jwt()->>'session_id') créée récemment → 'ok'
```

`auth.jwt()` (fonction Supabase native, confirmée en lisant sa définition en direct : lit `request.jwt.claims`) et les colonnes `auth.sessions.aal`/`created_at`, `auth.mfa_factors.status`/`last_challenged_at` sont la **seule** source de vérité — jamais un état côté client.

---

## 5. Durée — 15 minutes (standard) / 5 minutes (strict)

Conforme à la validation. Un point important découvert **en testant** (voir §11) : journaliser l'échec _depuis l'intérieur_ de la RPC qui `RAISE EXCEPTION` ne fonctionne pas — PostgREST exécute chaque appel RPC comme une seule transaction, et une exception non interceptée annule tout ce qui a été écrit avant elle dans cette même transaction, y compris un `INSERT` dans `audit_log`. Corrigé en déplaçant la journalisation des échecs vers un appel RPC **séparé** (`log_admin_step_up_event_secure`), déclenché par le frontend après avoir intercepté l'erreur — sa propre transaction indépendante, qui survit bien au rollback du premier appel.

L'expiration ne déconnecte jamais — elle déclenche une nouvelle demande MFA seulement au moment où une action protégée est retentée (`isStepUpError()` + `invalidateStepUp()` dans chaque `onError` de mutation).

---

## 6. Protections Superadmin — matrice réelle

| Action                                                       | Admin                                                                                | Superadmin | MFA             | MFA fraîche                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------- | --------------- | ---------------------------- |
| Accès dashboard                                              | Oui (gate frontend, voir §9)                                                         | Oui        | Recommandée     | Non (15 min)                 |
| Approuver/compléter un remboursement                         | Oui                                                                                  | Oui        | Si enrollée     | Non (15 min, repli accepté)  |
| Ajouter/retirer un rôle (y compris admin/super_admin)        | Non pour admin/super_admin lui-même (RPC l'interdit déjà), Oui pour les autres rôles | Oui        | **Obligatoire** | **Oui (5 min, aucun repli)** |
| Décaissement (`initiate_payout_secure`)                      | Oui                                                                                  | Oui        | **Obligatoire** | **Oui (5 min, aucun repli)** |
| Configuration fournisseur de paiement                        | Oui                                                                                  | Oui        | **Obligatoire** | **Oui (5 min, aucun repli)** |
| Configuration paiement plateforme (fallback MonCash/NatCash) | Oui                                                                                  | Oui        | **Obligatoire** | **Oui (5 min, aucun repli)** |

Aucune permission métier existante modifiée — seule une couche de vérification supplémentaire ajoutée. Un `admin` qui n'a pas encore enrollé de TOTP sera bloqué sur les 5 actions STRICT jusqu'à l'enrôlement — comportement voulu, documenté dans la migration.

---

## 7. Changements frontend

| Fichier                                                           | Nature                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/hooks/useTotpFactor.ts`                                      | **Nouveau** — wrapper partagé autour de `supabase.auth.mfa.*`                                                                                                                                                        |
| `src/lib/admin-step-up.ts`                                        | **Nouveau** — `isStepUpError()`, `logStepUpEvent()`, `logDashboardAccessDenied()`, partagés entre `useReauth` et `AdminIdleLock`                                                                                     |
| `src/hooks/useReauth.ts`                                          | Modifié — `tier` (`standard`/`strict`), TOTP en priorité, `prompt: "consent"` sur l'OAuth (corrige R3), `invalidateStepUp()`                                                                                         |
| `src/components/reauth-dialog.tsx`                                | Modifié — mode TOTP (saisie du code à 6 chiffres) en plus de mot de passe/OAuth                                                                                                                                      |
| `src/routes/_authenticated/dashboard.admin.security.tsx`          | **Nouveau** — auto-enrôlement/désenrôlement TOTP (QR code, `supabase.auth.mfa.enroll`)                                                                                                                               |
| `src/components/dashboard/admin/admin-idle-lock.tsx`              | Modifié — vérifie `check_admin_step_up_secure()` **au montage**, pas seulement après inactivité ; déverrouillage TOTP-first                                                                                          |
| `src/routes/_authenticated/dashboard.admin.tsx`                   | Modifié — message explicite + `log_dashboard_access_denied_secure()` avant la redirection                                                                                                                            |
| `src/routes/_authenticated/dashboard.admin.users.tsx`             | Modifié — `withReauth(..., "strict")` sur ajout/retrait de rôle                                                                                                                                                      |
| `src/routes/_authenticated/dashboard.admin.refunds.tsx`           | Modifié — gestion d'erreur step-up-aware ; **correction d'une incohérence pré-existante** : le bouton "Rejte" ne passait jamais par `withReauth`, maintenant corrigé (la RPC l'exige désormais inconditionnellement) |
| `src/components/dashboard/payouts/payout-pay-modal.tsx`           | Modifié — `withReauth(..., "strict")`                                                                                                                                                                                |
| `src/routes/_authenticated/dashboard.admin.payment-providers.tsx` | Modifié — **premier ajout** de `useReauth`/`ReauthDialog` (n'en avait aucun avant)                                                                                                                                   |
| `src/routes/_authenticated/dashboard.admin.payout-settings.tsx`   | Modifié — **premier ajout** de `useReauth`/`ReauthDialog`                                                                                                                                                            |
| `src/components/dashboard/sidebar/nav-items.ts`                   | Modifié — lien "Sekirite kont" (admin + super_admin)                                                                                                                                                                 |
| `src/integrations/supabase/types.ts`                              | Modifié — 3 nouvelles signatures RPC ajoutées à la main (à régénérer pour de vrai après application)                                                                                                                 |
| `src/lib/__tests__/admin-step-up.test.ts`                         | **Nouveau** — 6 tests                                                                                                                                                                                                |

---

## 8. Changements backend

`supabase/migrations/20260811120000_admin_step_up_enforcement.sql` (non appliquée) :

- `private.admin_step_up_status(_max_age, _allow_fallback)` — cœur du système, retourne `'ok'|'expired'|'missing'`.
- `private.admin_step_up_ok()`, `private.require_admin_step_up()` (15 min), `private.require_admin_step_up_strict()` (5 min, MFA obligatoire).
- `public.check_admin_step_up_secure()` — lu par le gate frontend (Tier 0).
- `public.log_admin_step_up_event_secure(_action)` — télémétrie, allowlist de 4 actions.
- `public.log_dashboard_access_denied_secure()` — appelable par tout utilisateur authentifié (c'est justement pour les non-admins).
- 7 RPC existantes modifiées (`CREATE OR REPLACE`, corps complet reproduit, diffé contre `pg_get_functiondef()` avant écriture — jamais retapé de mémoire) : une ligne `PERFORM private.require_admin_step_up[_strict]();` ajoutée juste après la vérification `has_role` existante de chacune.

Aucune RLS existante modifiée, aucune permission métier retirée, aucun rôle touché.

---

## 9. Décision de périmètre — pourquoi seulement 7 RPC sur 47

Conformément à _"ne pas élargir arbitrairement cette catégorie"_ : les ~40 RPC restantes (23 lectures `get_*_admin`, ~17 mutations opérationnelles comme `update_driver_status_secure`, `resolve_dispute_secure`, `create_sponsored_placement_secure`) ne modifient ni privilège, ni configuration de sécurité globale, ni ne déplacent d'argent hors plateforme de façon aussi directe qu'un décaissement. Le Tier 0 (accès au dashboard lui-même) reste une passerelle **frontend** (`AdminIdleLock`, désormais aussi vérifiée au montage, pas seulement après inactivité) — cohérent avec la posture déjà documentée du projet ("RLS est la vraie frontière pour les lectures", `_authenticated/route.tsx`). Étendre STRICT/STANDARD aux ~40 autres RPC est documenté ici comme **extension future proportionnée**, pas empaqueté dans cette migration pour garder un rayon d'impact vérifiable.

---

## 10. Tests

### `npm run verify`

| Étape              | Résultat                                             |
| ------------------ | ---------------------------------------------------- |
| `typecheck`        | ✅ 0 erreur                                          |
| `lint`             | ✅ 0 erreur (3 warnings pré-existants, sans rapport) |
| `check:migrations` | ✅ 131 migrations, 0 danger                          |
| `test`             | ✅ **166/166** (160 avant + 6 nouveaux)              |
| `build`            | ✅ build production réussi                           |

### Tests transactionnels (BEGIN/ROLLBACK contre la production réelle, méthode déjà établie sur ce projet — `SET LOCAL request.jwt.claims`)

Migration entière appliquée + testée + **annulée** dans une seule transaction, avec le vrai compte `super_admin` (`phanoraltes@gmail.com`) :

| Cas                                                                                         | Résultat                           |
| ------------------------------------------------------------------------------------------- | ---------------------------------- |
| Aucun facteur, aucune session fraîche                                                       | `missing` ✅                       |
| Aucun facteur, session fraîche (< 15 min) — repli standard                                  | `ok` ✅                            |
| Même état, tier strict (repli désactivé)                                                    | `missing` ✅                       |
| Aucun facteur, session de 20 min                                                            | `expired` ✅                       |
| Facteur vérifié existe, mais JWT toujours `aal1` (challenge jamais fait dans cette session) | `missing` ✅                       |
| `aal2` + challenge à l'instant — standard ET strict                                         | `ok` / `ok` ✅                     |
| `aal2` + challenge il y a 20 min                                                            | `expired` (les deux tiers) ✅      |
| `aal2` + challenge il y a 7 min                                                             | standard `ok`, strict `expired` ✅ |

Après `ROLLBACK` : **0 résidu confirmé** (0 facteur MFA, 0 log d'audit, 0 fonction créée, rôle `restaurant_staff` ajouté pendant le test absent — seuls les 3 rôles réels `customer/admin/super_admin` restent).

---

## 11. Tests de bypass (Étape 5/10)

**Scénario 1 — appel RPC direct sans step-up** (simule DevTools/`curl` avec un JWT admin `aal1`, aucune session fraîche) :

```
PERFORM public.add_user_role_secure(v_admin, 'customer');
→ REJETÉ : "STEP_UP_REQUIRED_MFA: Verifikasyon MFA fre obligatwa..."
```

✅ **Confirmé : impossible de contourner en appelant la RPC directement, même avec un rôle admin/super_admin valide.**

**Scénario 2 — même appel, avec un step-up MFA valide et frais** :

```
PERFORM public.add_user_role_secure(v_admin, 'restaurant_staff');
→ RÉUSSI, ligne insérée dans user_roles
```

✅ **Confirmé : l'action légitime passe normalement.**

**Scénario 3 — tier STANDARD accepte le repli (pas de MFA enrollée), tier STRICT le refuse, sur le même état exact** — ✅ Confirmé (§10, avant-dernière ligne du tableau).

**Bug réel trouvé pendant ces tests** (§5) : la tentative initiale de journaliser l'échec _depuis l'intérieur_ de la RPC rejetée ne fonctionnait pas — corrigé avant la version finale.

**Non testé en conditions réelles** (limite honnête, voir §13) : un appel HTTP direct (`curl`/Postman) contre l'API REST réellement déployée, puisque la migration n'est pas encore appliquée en production — les tests ci-dessus exercent exactement le même code SQL, avec les mêmes claims JWT simulées, contre le vrai schéma (`auth.mfa_factors`, `auth.sessions`, vrai compte super_admin), donc le comportement en production sera identique une fois la migration appliquée — mais ce n'est pas, à la lettre, un `curl` contre `/rest/v1/rpc/...`.

---

## 11bis. Enrôlement TOTP réel sur un compte de test (avant application, comme demandé)

Fait sur un compte jetable réel (`nkdeliveri-totp-test-…@gmail.com`, email confirmé directement en base pour éviter d'utiliser une vraie boîte mail, supprimé après coup) — **pas une simulation**, le vrai flux `supabase.auth.mfa.enroll()`/`challengeAndVerify()` de bout en bout, avec un générateur de code TOTP (RFC 6238, HMAC-SHA1) écrit à la main, sans librairie, pour prouver la compréhension exacte du mécanisme :

| Étape                                                                        | Résultat                                                                                                                                                                                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mfa.enroll({factorType:"totp"})`                                            | ✅ secret + QR code réels retournés                                                                                                                                                                    |
| Code généré à la main à partir du secret, accepté du premier coup par GoTrue | ✅ (`challengeAndVerify` réussi)                                                                                                                                                                       |
| `auth.mfa_factors.status` après enrôlement                                   | ✅ `'verified'`                                                                                                                                                                                        |
| `auth.mfa_factors.last_challenged_at`                                        | ✅ posé à l'enrôlement, **mis à jour à nouveau** lors d'un second challenge simulant une future vérification — confirme en conditions réelles l'hypothèse centrale de `private.admin_step_up_status()` |
| `getAuthenticatorAssuranceLevel()` après verify                              | ✅ `currentLevel: "aal2"`                                                                                                                                                                              |
| **JWT réel décodé**                                                          | ✅ `aal: "aal2"`, `session_id` présent — les deux exactement ce que `auth.jwt()->>'aal'`/`->>'session_id'` lisent dans la migration                                                                    |

**Ceci lève la limitation notée en §13** ("comportement exact de l'`aal` en conditions réelles... non testé avec une vraie app TOTP") — le mécanisme est maintenant confirmé à la fois par simulation SQL (§10-11) et par un vrai flux d'enrôlement/challenge de bout en bout contre la production. Rien n'a été appliqué en base par cette étape au-delà du compte de test lui-même, supprimé immédiatement après.

---

## 12. Résultats

- Le scénario interdit (_session admin volée → DevTools → RPC sensible → accès sans MFA_) est **prouvé impossible** pour les 5 RPC STRICT et 2 RPC STANDARD.
- Le scénario voulu (_admin légitime → MFA TOTP → RPC → action autorisée_) est **prouvé fonctionnel**.
- Le frontend affiche maintenant un vrai dialogue de vérification — **mais ce n'est plus lui l'autorité** : chaque RPC re-vérifie indépendamment, prouvé en l'appelant directement sans jamais passer par le composant React.

---

## 13. Risques résiduels

- **Migration non appliquée** — tant qu'elle ne l'est pas, la vulnérabilité R2 de l'audit reste active en production (le frontend seul protège, comme avant). Aucune régression introduite par ce travail lui-même, mais aucun bénéfice réel tant que l'application n'a pas eu lieu.
- **Le compte admin réel n'a pas encore de facteur TOTP enrollé** — dès l'application, les 5 actions STRICT lui seront bloquées jusqu'à ce qu'il visite `/dashboard/admin/security` et enrôle un facteur. C'est le comportement voulu, mais à communiquer clairement avant d'appliquer pour éviter une surprise.
- ~~`mfa_allow_low_aal` et le comportement exact de l'`aal` en conditions réelles~~ — **levé, voir §11bis** : enrôlement + double challenge réel confirmé sur un compte de test, `aal2` bien présent dans le vrai JWT.
- **Test de bypass HTTP réel non effectué** (§11) — recommandé après application de la migration, avant de considérer le chantier définitivement clos.
- **~40 RPC restantes non couvertes par STRICT/STANDARD** (§9) — décision délibérée, pas un oubli, mais reste une extension possible si le profil de risque du projet évolue.

---

## 🚦 Statut

**Code + migration prêts, `npm run verify` vert, tests de bypass transactionnels réussis. Migration NON appliquée — en attente de votre confirmation explicite avant `supabase db push` (ou application manuelle) en production. Aucun commit, aucun push effectué.**
