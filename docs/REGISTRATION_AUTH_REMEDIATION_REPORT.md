# 🔧 Remédiation — Supabase Auth Email (SMTP) + fallback `{}` frontend

**Date** : 2026-08-11
**Référence** : `docs/REGISTRATION_DRIVER_RESTAURANT_AUDIT.md` (audit initial, même jour)
**Statut** : **cause racine corrigée et re-vérifiée formellement (Phases 1-6) via les vrais logs Auth/GoTrue**, pas seulement des tests protocole. Filet de sécurité frontend livré, testé, **commité et poussé sur `main` (`e324fc7`)**, avec l'accord explicite de l'utilisateur.

---

## 1. Cause racine

**Le mot de passe SMTP configuré dans Supabase Auth (GoTrue) pour le relais `smtp.resend.com` était une clé Resend invalide/révoquée.**

Preuve directe, au niveau protocole (pas une supposition) : un test `AUTH LOGIN` SMTP réel contre `smtp.resend.com:465` avec les identifiants alors configurés (`user: resend`, mot de passe = celui stocké dans Supabase) a retourné :

```
535 Authentication credentials invalid
```

C'est cette étape d'envoi d'email de confirmation, obligatoire à chaque `signUp()` (`mailer_autoconfirm: false`), qui échouait et faisait échouer — avec rollback complet — la création de compte tout entière. C'est cette config **précise** (Supabase Dashboard → Authentication → Emails → SMTP), **distincte** de la variable d'application `RESEND_API_KEY` (Vercel), qui était en cause — confirmant l'hypothèse posée dans l'audit initial.

**Complication rencontrée en cours de route** : la variable d'app `RESEND_API_KEY` (celle utilisée par la newsletter, `.env.local`) s'est aussi révélée invalide au moment du diagnostic (`401` sur `/domains` de l'API Resend). Cette clé est **hors périmètre** de cette mission (système de notifications, explicitement exclu) — signalée à l'utilisateur mais **non touchée**.

### Impact réel confirmé (pas seulement hypothétique)

Les logs GoTrue (§1bis ci-dessous) montrent qu'un **vrai utilisateur externe** (`desulmadavid1961@gmail.com`, aucun rapport avec les comptes de test de cet audit) a tenté de s'inscrire pendant la panne, le **2026-08-11T17:26:25Z**, et a été bloqué par la même erreur `500`/`unexpected_failure`. Ce n'était donc pas une panne uniquement théorique constatée en test — un client réel a été impacté avant la correction.

---

## 1bis. Preuve par les vrais logs Auth/GoTrue (Phase 2)

Au-delà du test protocole SMTP direct (§3), les logs Auth réels du projet (récupérés en lecture seule via la Management API, `analytics/endpoints/logs.all`, table `auth_logs`) confirment **exactement** la même cause, avec l'erreur SMTP brute capturée par GoTrue lui-même :

| Horodatage (UTC)        | Événement                                                                                             | Détail                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `17:26:25`              | `/signup` → **500** (utilisateur réel, `desulmadavid1961@gmail.com`)                                  | `"error":"535 \"Authentication credentials invalid\"","error_code":"unexpected_failure"`                  |
| `17:54:50` → `18:27:08` | `/signup` → **500** (×6, comptes de test de cet audit)                                                | même erreur `535 "Authentication credentials invalid"` à chaque fois                                      |
| `18:48:51`              | `reloader` : _"env GOTRUE_RATE_LIMIT_EMAIL_SENT changed, updating Email limiter from 30 to 2/1h"_     | **horodatage exact de mon PATCH partiel erroné** (§4)                                                     |
| `18:50:10`              | `reloader` : _"env GOTRUE_RATE_LIMIT_EMAIL_SENT changed, updating Email limiter from 2/1h to 30"_     | **horodatage exact de ma correction** (79 secondes plus tard)                                             |
| `18:50:51`              | `/verify` → **303**, `action:"user_signedup"` (compte test Client)                                    | **preuve qu'un email de confirmation a été réellement reçu et cliqué**, pas seulement accepté par le SMTP |
| `18:50:53` – `18:50:54` | `/signup` → **200** (Restaurant, Livreur, comptes de test)                                            | succès, juste après la correction                                                                         |
| `18:52:44`              | `/token` → **400**, `error_code:"email_not_confirmed"`                                                | confirme la persistance réelle du compte Restaurant (pas un rollback)                                     |
| `19:28:24`              | `/callback` → **302**, `action:"user_signedup"`, `provider:"google"` (`clubcodinggonaives@gmail.com`) | confirme aussi la correction du secret Google OAuth (fuite/rotation traitée séparément)                   |

Cette table remplace toute hypothèse par des preuves directes issues du système lui-même — GoTrue journalise verbatim l'erreur SMTP (`535 "Authentication credentials invalid"`), ce qui correspond exactement à ce que le test protocole manuel avait déjà trouvé (§3), avec en plus la trace exacte de l'incident de correction (§4) et une preuve de réception réelle d'email (pas seulement d'acceptation SMTP).

---

## 2. Configuration Supabase — avant / après (sans exposer les secrets)

| Champ                       | Avant                                           | Après                                                                                                |
| --------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `smtp_host`                 | `smtp.resend.com`                               | `smtp.resend.com` (inchangé)                                                                         |
| `smtp_port`                 | `465`                                           | `465` (inchangé)                                                                                     |
| `smtp_user`                 | `resend`                                        | `resend` (inchangé)                                                                                  |
| `smtp_admin_email` (sender) | `noreply@nkdeliveri.com`                        | `noreply@nkdeliveri.com` (inchangé)                                                                  |
| `smtp_sender_name`          | `NK Deliveri`                                   | `NK Deliveri` (inchangé)                                                                             |
| `smtp_pass`                 | clé Resend invalide (`535` au test SMTP direct) | nouvelle clé Resend, **validée avant écriture** (test SMTP direct → `235 Authentication successful`) |
| `rate_limit_email_sent`     | `30`/heure                                      | `30`/heure (restauré — voir incident §4)                                                             |

Aucun secret (clé, mot de passe, token) n'est reproduit dans ce document ou n'a été affiché à l'utilisateur à aucun moment.

---

## 3. Méthode de correction

Accès en lecture/écriture obtenu via la **Management API Supabase**, authentifiée avec le token déjà stocké par `supabase login` sur cette machine (Gestionnaire d'identifiants Windows) — **autorisation explicite obtenue de l'utilisateur avant toute utilisation** de ce token. Aucun accès Dashboard/navigateur n'était disponible autrement.

Étapes réelles (dans l'ordre, y compris l'incident) :

1. Lecture de la config Auth (`GET /v1/projects/{ref}/config/auth`) → confirmation que SMTP personnalisé est actif (`smtp.resend.com`), tous les champs non-secrets lisibles, `smtp_pass` retourné chiffré/opaque (illisible, comme attendu — Supabase ne restitue jamais un secret en clair).
2. Test direct `AUTH LOGIN` SMTP avec le mot de passe alors configuré → `535`, cause confirmée.
3. Deux tentatives de l'utilisateur de coller une nouvelle clé dans le Dashboard : la 1ʳᵉ n'a pas été sauvegardée (config inchangée au relecture) ; la 2ᵉ a bien changé la valeur stockée mais échouait encore au test SMTP (`535`) — clé elle-même invalide ou mal copiée, indéterminé à distance.
4. L'utilisateur a fourni directement une clé Resend fraîchement générée. **Validée avant toute écriture** : `AUTH LOGIN` direct → `235 Authentication successful`, et confirmé restreinte "sending only" (échoue volontairement sur `/domains` avec `401`, ce qui est normal et sans rapport avec sa validité SMTP).
5. Écriture via `PATCH /v1/projects/{ref}/config/auth`.

## 4. Incident pendant la correction (transparence, corrigé immédiatement)

**Deux erreurs opérationnelles de ma part, corrigées dans la foulée, à documenter honnêtement :**

- **PATCH partiel dangereux** : mon premier `PATCH` n'envoyait que `smtp_pass`. Cet endpoint **remplace le groupe SMTP entier plutôt que de fusionner** — `smtp_host`, `smtp_port`, `smtp_user`, `smtp_sender_name`, `smtp_admin_email` sont tous repassés à `null` (= SMTP personnalisé désactivé, retour silencieux au mailer par défaut de Supabase), et `rate_limit_email_sent` a été automatiquement réduit à `2`/heure (valeur par défaut du mailer intégré, pensée pour le développement). **Détecté immédiatement** par une relecture de vérification, **corrigé dans la minute** par un second `PATCH` renvoyant l'ensemble complet des champs SMTP (host/port/user/pass/sender/admin_email) + `rate_limit_email_sent: 30` en un seul appel. Confirmé restauré avant de poursuivre.
- **Exposition accidentelle d'un secret non lié** : en inspectant la réponse brute du premier `PATCH` (qui renvoie l'objet de config complet, pas seulement les champs modifiés), un `cat | head` non filtré a fait apparaître un `external_google_secret` en clair dans ma propre sortie d'outil (jamais reproduit dans mes messages). Fichier supprimé immédiatement. **Recommandation transmise à l'utilisateur** : faire tourner ce secret OAuth Google par précaution — action hors périmètre de cette mission, non effectuée ici.

Aucune autre écriture n'a été faite sur ce projet Supabase. Tous les fichiers temporaires locaux contenant le token ou des extraits de config (`C:\tmp\.sb_pat`, `auth_config*.json`, `patch_result*.json`) ont été supprimés en fin de session.

---

## 5. Validation (Phase 5-6)

Tests réels contre l'API de production, avec des comptes jetables (`clubcodinggonaives+…@gmail.com`, fournis par l'utilisateur), **après** correction :

| Test                                                     | Résultat                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/v1/signup` — Client                          | ✅ `200 OK`, objet utilisateur complet, `confirmation_sent_at` peuplé                                                                                                                                                                                                                                                                                                              |
| `baseSignUp()` réel — Restaurant                         | ✅ succès, `userId` retourné, `hasSession:false` (attendu, confirmation email requise)                                                                                                                                                                                                                                                                                             |
| `baseSignUp()` réel — Livreur                            | ✅ succès, `userId` retourné                                                                                                                                                                                                                                                                                                                                                       |
| Preuve de persistance réelle (pas un simple 200 fantôme) | ✅ `POST /auth/v1/token?grant_type=password` sur le compte Restaurant fraîchement créé → `email_not_confirmed` (et non plus `invalid_credentials` comme pendant la panne) — **preuve directe que la ligne `auth.users` existe désormais réellement**, contrairement à l'état cassé où tout était rollback silencieusement (voir `docs/REGISTRATION_DRIVER_RESTAURANT_AUDIT.md` §5) |
| Test SMTP direct (`AUTH LOGIN`) après correction         | ✅ `235 Authentication successful`                                                                                                                                                                                                                                                                                                                                                 |

Les 3 workflows (Client / Restaurant / Livreur) partagent tous `baseSignUp()` — la correction, faite une seule fois côté Supabase Auth, les corrige tous les trois simultanément, comme prévu par le diagnostic initial (cause commune, pas 3 bugs séparés).

### 5bis. Deuxième round de validation formelle (Phase 5-6, re-demandée explicitement)

Refait intégralement avec 3 comptes jetables **neufs** (`clubcodinggonaives+p5client…`, `+p5resto…`, `+p6driver…`), après le round initial, pour une preuve fraîche et indépendante :

| Compte     | `signUp()` | `confirmation_sent_at` | Test de persistance (`grant_type=password`)       |
| ---------- | ---------- | ---------------------- | ------------------------------------------------- |
| Client     | ✅ succès  | ✅ peuplé              | ✅ `email_not_confirmed` (compte réellement créé) |
| Restaurant | ✅ succès  | ✅ peuplé              | ✅ `email_not_confirmed`                          |
| Livreur    | ✅ succès  | ✅ peuplé              | ✅ `email_not_confirmed`                          |

Les trois retournent systématiquement `email_not_confirmed` (jamais `invalid_credentials`) à la tentative de connexion — confirmation indépendante, sur un tout nouveau lot de comptes, que la persistance fonctionne de bout en bout pour les 3 workflows.

---

## 6. Frontend — `src/lib/auth-errors.ts`

Filet de sécurité ajouté **en plus** de la correction racine (défense en profondeur pour toute panne infra future) :

- Nouvelle détection `isRetryableInfraError()` : reconnaît les erreurs `AuthRetryableFetchError` / statuts 500-504 et Cloudflare 520-530 (la même liste que `@supabase/auth-js` utilise en interne) — **par type/statut, pas par contenu du message**, donc robuste à toute variation future du message brut.
- Nouveau filtre `isExploitableMessage()` : rejette explicitement `"{}"`, `"[]"`, `"[object Object]"`, `"null"`, `"undefined"` et les chaînes vides/blanches — plus aucun de ces cas ne peut atteindre l'utilisateur tel quel.
- Nouveau message générique unique : _"Nou pa kapab trete demann lan kounye a. Tanpri eseye ankò pita."_
- **Aucun** des cas déjà traduits (email déjà utilisé, mauvais mot de passe, rate limit, email non confirmé, etc.) n'est modifié — le fallback n'intervient qu'en tout dernier recours, après le `switch(code)` et tous les `includes(...)` existants.
- Vérifié contre la **vraie** erreur de production (pas seulement un mock) : rejoué un `signUp()` réel pendant la panne, capturé le véritable `AuthRetryableFetchError` (`status:500`, `message:"{}"`), confirmé que `isRetryableInfraError()` le détecte correctement.

---

## 7. Tests

### Nouveaux (`src/lib/__tests__/auth-errors.test.ts`, 17 tests)

- Erreurs déjà connues (code + substring) → traduction inchangée (non-régression)
- 5xx / `AuthRetryableFetchError` (y compris la forme réelle rencontrée en prod) → message générique, jamais `{}`
- `{}`, `null`, `undefined`, objet nu (`[object Object]`), chaîne vide/blanche → message générique
- Un message légitime mais non traduit reste préservé tel quel (pas écrasé par le fallback)
- Assertion explicite : `translateAuthError` ne retourne jamais la chaîne littérale `"{}"`, pour aucune des entrées testées

### `npm run verify` (résultats)

| Étape              | Résultat                                                              |
| ------------------ | --------------------------------------------------------------------- |
| `typecheck`        | ✅ 0 erreur                                                           |
| `lint`             | ✅ 0 erreur (3 warnings pré-existants, sans rapport, déjà documentés) |
| `check:migrations` | ✅ 130 migrations, 0 danger (aucune migration touchée)                |
| `test`             | ✅ **160/160** (143 avant + 17 nouveaux)                              |
| `build`            | ✅ build production réussi                                            |

---

## 8. Non-régression

- Client / Restaurant / Livreur : les 3 workflows testés en direct post-correction, tous fonctionnels (§5).
- Connexion (login) : non affectée par cette correction (n'a jamais dépendu du mailer).
- Autres messages d'erreur déjà traduits : tous couverts par les tests de non-régression (§7), aucun changement de comportement.
- Aucun fichier de formulaire, de logique métier, de RLS, de RPC, de migration, de paiement, de notification ou de cartographie n'a été modifié — conforme aux contraintes de la mission.

---

## 9. Sécurité

- Aucun secret (clé Resend, token Management API, mot de passe SMTP) n'a été écrit dans un fichier du dépôt, un commit, ou reproduit dans ce rapport.
- Le token Management API et les extraits de config JSON téléchargés localement pendant l'intervention ont tous été supprimés en fin de session (`C:\tmp\.sb_pat`, `auth_config*.json`, `patch_result*.json`, scripts `_smtp_probe*.mjs`).
- **Incident mineur documenté en toute transparence** (§4) : un `external_google_secret` en clair est apparu brièvement dans ma propre sortie d'outil (jamais dans un message affiché) suite à un affichage non filtré de la réponse complète du premier `PATCH`. Fichier supprimé immédiatement. **Action recommandée à l'utilisateur, non effectuée ici** : faire tourner ce secret OAuth Google par précaution.
- Aucune policy RLS, aucune permission, aucun rôle n'a été modifié.

---

## 10. Limitations

- Je ne peux pas confirmer à distance _pourquoi_ la clé SMTP d'origine était invalide (rotation oubliée, expiration, révocation manuelle) — seulement _qu'elle l'était_, avec preuve directe.
- Je ne peux pas lire la valeur en clair d'un champ secret déjà stocké dans Supabase (`smtp_pass` reste toujours opaque en lecture) — chaque validation de nouvelle clé a dû se faire par test direct (SMTP `AUTH LOGIN`), pas par comparaison de valeurs.
- La variable d'app `RESEND_API_KEY` (newsletter, Vercel) reste dans un état non vérifié/probablement invalide — **signalée, non corrigée**, hors périmètre explicite de cette mission.
- ~~Les emails de confirmation envoyés pendant les tests n'ont pas été ouverts/cliqués~~ — **partiellement levé** : les logs (§1bis, `18:50:51`, `action:"user_signedup"` sur `/verify`) prouvent qu'au moins un email de confirmation a été réellement reçu et cliqué, pas seulement accepté au niveau SMTP. Les comptes du round de re-vérification (§5bis) n'ont, eux, pas été cliqués (non nécessaire pour prouver la persistance, déjà établi via `email_not_confirmed`).

---

## 🚦 Verdict

## 🟢 READY FOR VALIDATION

- Supabase Auth envoie de nouveau les emails de confirmation — confirmé à **trois niveaux indépendants** : test SMTP protocole direct (`235`), logs GoTrue réels (`535` avant / succès après, avec l'horodatage exact de la correction), et un vrai clic de confirmation observé dans les logs (`user_signedup`/`/verify`).
- Les 3 workflows d'inscription (Client, Restaurant, Livreur) fonctionnent de bout en bout — vérifié **deux fois**, sur deux lots de comptes jetables distincts, contre la production réelle, avec preuve de persistance (`email_not_confirmed`, jamais `invalid_credentials`) à chaque fois.
- Un vrai utilisateur externe (`desulmadavid1961@gmail.com`) avait été impacté par la panne avant correction — confirmé dans les logs, pas seulement supposé.
- Plus aucun `{}` ne peut atteindre l'utilisateur pour une erreur Auth, quelle qu'en soit la cause future (`npm run verify` intégralement vert, 160/160 tests, re-exécuté une seconde fois pour cette phase).
- `git status` : le correctif frontend (`src/lib/auth-errors.ts` + `src/lib/__tests__/auth-errors.test.ts`) ainsi que les deux rapports d'audit/remédiation sont **commités et poussés sur `main`** (`e324fc7`), avec l'accord explicite de l'utilisateur. Aucun autre fichier du dépôt modifié.
