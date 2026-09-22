# CF-01 — POST-REMEDIATION VERIFICATION

**NK Deliveri — Origin Bypass / Vercel Default Domain**

**Date de vérification** : 2026-08-14, ~05:00–05:03 UTC (≈8h après l'audit initial CF-01 du 2026-08-13, ~20:50–20:52 UTC)
**Type** : VÉRIFICATION UNIQUEMENT — aucun fichier, DNS, config Cloudflare/Vercel/Supabase modifié pendant cette session, à l'exception de la création du présent rapport.
**Méthode** : requêtes HTTP réelles à très faible volume (GET/HEAD/POST non signé, unitaires, aucun fuzzing/scan/brute force), comparaison directe avec les preuves brutes capturées lors de l'audit `docs/SECURITY_PERIMETER_AUDIT_2026-08-13.md` (mêmes commandes, mêmes cibles, horodatage différent).

---

## 1. Executive Summary

L'action de remédiation déclarée (suppression/désactivation manuelle de `nkdelivery.vercel.app` dans le dashboard Vercel) **n'est pas confirmée comme effective** au moment de cette vérification. `https://nkdelivery.vercel.app/` continue de répondre `200 OK` et de servir **le contenu réel de production** (même page d'accueil NK Deliveri, 33 767 octets), avec un `Etag` et un `Last-Modified` **strictement identiques** à ceux capturés dans l'audit initial d'hier, et un compteur `Age` qui a continué de croître de façon continue sur toute la période observée (29 151 s → 29 424 s, cohérent avec le temps réel écoulé, jamais remis à zéro). Un test explicite de contournement de cache (paramètre de requête aléatoire) n'a **pas** produit de réponse fraîche : `X-Vercel-Cache: HIT` reste présent à chaque tentative.

Les routes dynamiques (`/robots.txt`, `/restaurants`) restent `404` sur ce hostname — **inchangé par rapport à avant**, ce n'est donc pas une nouvelle protection, c'était déjà le cas hier.

Le domaine officiel (`www.nkdeliveri.com`) reste sain : Cloudflare actif, CSP dynamique confirmé (nonce différent à chaque requête, sur deux requêtes consécutives), TLS inchangé, endpoints sensibles toujours correctement protégés.

**Verdict : `NOT REMEDIATED`** — voir §9 et §12 pour le raisonnement complet, y compris la nuance importante sur la cause probable (cache figé côté edge Vercel, pas nécessairement un rattachement de domaine toujours actif) qui n'invalide pas le constat : le contenu de production reste, factuellement, servi publiquement sur ce hostname, hors du périmètre Cloudflare, au moment de cette vérification.

---

## 2. Remediation Tested

Action déclarée par l'opérateur : **suppression/désactivation manuelle de `nkdelivery.vercel.app` du projet de production**, effectuée dans le dashboard Vercel entre l'audit initial (2026-08-13 ~20:52 UTC) et cette vérification (2026-08-14 ~05:00 UTC). Aucune trace de cette action n'est visible dans le repository (attendu — c'est un réglage de plateforme Vercel, pas un fichier versionné) ; cette vérification teste donc son **effet observable**, pas sa configuration.

---

## 3. BEFORE State _(repris de `docs/SECURITY_PERIMETER_AUDIT_2026-08-13.md`, 2026-08-13 ~20:51 UTC)_

| Test                                           | Résultat BEFORE                                                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET https://nkdelivery.vercel.app/`           | `200 OK`, `Server: Vercel`, aucun `CF-RAY`, aucun CSP, aucun `X-Frame-Options`, `Access-Control-Allow-Origin: *`, corps = page d'accueil réelle (33 767 octets, `<title>NK Delivery — Livraison de repas aux Gonaïves</title>`) |
| `GET /robots.txt` sur ce hostname              | `404 NOT_FOUND`                                                                                                                                                                                                                 |
| `GET /restaurants` sur ce hostname             | `404 NOT_FOUND`                                                                                                                                                                                                                 |
| `GET /auth`, `/api/csp-report` sur ce hostname | `404 NOT_FOUND`                                                                                                                                                                                                                 |
| `www.nkdeliveri.com`                           | `200 OK`, `Server: cloudflare`, `CF-RAY` présent, CSP nonce présent                                                                                                                                                             |

---

## 4. AFTER State _(cette vérification, 2026-08-14 ~05:00–05:03 UTC)_

| Test                                                                    | Résultat AFTER                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET https://nkdelivery.vercel.app/`                                    | `200 OK`, `Server: Vercel`, aucun `CF-RAY`, aucun CSP, aucun `X-Frame-Options`, `Access-Control-Allow-Origin: *`, corps = page d'accueil réelle (33 767 octets, **Etag `07cd427cc879c647c3888d188a3d6df0` identique à BEFORE**, `Last-Modified: Thu, 13 Aug 2026 20:51:14 GMT` identique) |
| `HEAD https://nkdelivery.vercel.app/`                                   | `200 OK`, mêmes en-têtes                                                                                                                                                                                                                                                                  |
| `GET /?cachebust=<timestamp aléatoire>` (×2, clés de cache différentes) | `200 OK`, **toujours `X-Vercel-Cache: HIT`**, même `Etag`, `Age` continue de croître (29 151 → 29 422 → 29 424 s) — la tentative de contournement de cache n'a produit aucune réponse fraîche                                                                                             |
| `GET /robots.txt`                                                       | `404 NOT_FOUND` — inchangé                                                                                                                                                                                                                                                                |
| `GET /restaurants`                                                      | `404 NOT_FOUND` — inchangé                                                                                                                                                                                                                                                                |
| `www.nkdeliveri.com`                                                    | `200 OK`, `Server: cloudflare`, `CF-RAY` présent, CSP présent avec nonce, TLS inchangé                                                                                                                                                                                                    |
| `nkdeliveri.com` (apex)                                                 | `308` vers `https://www.nkdeliveri.com/`, `Server: cloudflare`, `CF-RAY` présent                                                                                                                                                                                                          |

---

## 5. HTTP Evidence

```text
GET https://nkdelivery.vercel.app/  (AFTER, 2026-08-14 05:57:06 UTC — heure serveur)
HTTP/1.1 200 OK
Server: Vercel
Age: 29151
Etag: "07cd427cc879c647c3888d188a3d6df0"
Last-Modified: Thu, 13 Aug 2026 20:51:14 GMT
X-Vercel-Cache: HIT
Content-Length: 33767
Access-Control-Allow-Origin: *
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
(aucun CF-RAY, aucun Content-Security-Policy, aucun X-Frame-Options)

GET https://nkdelivery.vercel.app/?cachebust=1786683697  (contournement de cache tenté)
HTTP/1.1 200 OK
X-Vercel-Cache: HIT   ← toujours un HIT malgré une clé de requête différente
Age: 29422            ← continue de croître, jamais remis à zéro
Etag: "07cd427cc879c647c3888d188a3d6df0"   ← identique

GET https://www.nkdeliveri.com/   (AFTER)
HTTP/1.1 200 OK
Server: cloudflare
CF-RAY: a2ad687a1921e80f-EWR
content-security-policy: script-src 'self' 'nonce-V83mrydEDrhpGd0P15d97A==' ; ...
x-frame-options: DENY

GET https://www.nkdeliveri.com/   (2e requête, immédiatement après)
CF-RAY: a2ad68836a40de97-EWR
content-security-policy: script-src 'self' 'nonce-3cVgdqKpP4Wrmp6DGBeAag==' ; ...
→ nonce différent de la requête précédente (VERIFIED, dynamique par requête)

GET https://nkdeliveri.com/   (apex, AFTER)
HTTP/1.1 308 Permanent Redirect
location: https://www.nkdeliveri.com/
Server: cloudflare
CF-RAY: a2ad68741f786513-EWR

openssl s_client www.nkdeliveri.com:443  (AFTER)
subject=CN=nkdeliveri.com
issuer=C=US, O=Google Trust Services, CN=WE1
notBefore=Jul 31 16:26:07 2026 GMT
notAfter=Oct 29 17:24:41 2026 GMT
→ identique au certificat observé lors de l'audit initial (aucune régression TLS)
```

---

## 6. Cloudflare Verification

**VERIFIED** : le domaine officiel (`www.nkdeliveri.com` et `nkdeliveri.com`) continue de passer intégralement par Cloudflare après la remédiation — `Server: cloudflare` et `CF-RAY` présents sur chaque requête testée, sur les deux hôtes, y compris sur la redirection 308 de l'apex. Aucune régression détectée sur ce point.

**VERIFIED (négatif)** : `nkdelivery.vercel.app` **n'a jamais** montré de header Cloudflare, ni avant ni après — cohérent dans les deux états, ce hostname n'est structurellement pas rattaché à la zone Cloudflare de NK Deliveri (c'est le domaine par défaut de la plateforme Vercel elle-même, pas un enregistrement DNS de `nkdeliveri.com`).

---

## 7. CSP Verification

1. **CSP présent** : ✅ VERIFIED, sur les deux requêtes consécutives à `www.nkdeliveri.com`.
2. **Enforcement, pas Report-Only** : ✅ VERIFIED — header exact observé : `Content-Security-Policy` (pas `Content-Security-Policy-Report-Only`).
3. **Nonce présent** : ✅ VERIFIED — `script-src 'self' 'nonce-<valeur>'` sur chaque réponse.
4. **Nonce dynamique entre deux requêtes** : ✅ VERIFIED — `nonce-V83mrydEDrhpGd0P15d97A==` puis `nonce-3cVgdqKpP4Wrmp6DGBeAag==` sur deux requêtes consécutives, valeurs distinctes.

**`H-02 = FALSE POSITIVE / REMOVE FROM BACKLOG`** — confirmé une seconde fois, sur une session de vérification indépendante de l'audit initial. Le CSP dynamique de `src/server.ts` fonctionne de façon stable et reproductible en production.

---

## 8. Sensitive Endpoint Verification

Tests non destructifs, non authentifiés, aucune donnée modifiée, aucun paiement/webhook/cron réel déclenché :

| Endpoint                        | Requête                   | Résultat AFTER | Attendu     | Verdict |
| ------------------------------- | ------------------------- | -------------- | ----------- | ------- |
| `/api/cron/moncash-reconcile`   | GET, sans `Authorization` | `401`          | `401`/`403` | ✅ PASS |
| `/api/cron/plop-reconcile`      | GET, sans `Authorization` | `401`          | `401`/`403` | ✅ PASS |
| `/api/webhooks/moncash`         | POST `{}`, sans signature | `401`          | `401`/`403` | ✅ PASS |
| `/api/webhooks/moncash/collect` | POST `{}`, sans signature | `401`          | `401`/`403` | ✅ PASS |
| `/api/webhooks/stripe/collect`  | POST `{}`, sans signature | `401`          | `401`/`403` | ✅ PASS |

Aucun endpoint sensible testé n'a régressé. Aucune tentative d'authentification avec un compte réel n'a été effectuée (non nécessaire pour répondre à la question posée — la protection observée est déjà suffisante et sans ambiguïté à ce niveau).

---

## 9. Origin Bypass Assessment

**Question : `nkdelivery.vercel.app` sert-il encore directement l'application de production ?**

**Réponse factuelle : oui, sur `/`, sans changement mesurable par rapport à avant la remédiation.**

Preuves à l'appui, dans l'ordre de robustesse :

1. **Contenu identique au bit près** : même `Etag`, même `Last-Modified`, même `Content-Length` qu'hier avant la remédiation déclarée.
2. **`Age` continu, jamais réinitialisé** : 29 151 s puis 29 422 s puis 29 424 s sur trois requêtes séparées de quelques dizaines de secondes — l'écart correspond exactement au temps réel écoulé. Un objet de cache qui aurait été purgé/régénéré afficherait un `Age` proche de 0 à un moment ou un autre de cette fenêtre ; ce n'est jamais le cas ici.
3. **Le contournement de cache par paramètre de requête échoue** : une requête avec un paramètre de requête inédit (`?cachebust=<horodatage aléatoire>`) devrait, sur un cache normalement scoping par URL complète, produire un `MISS`. Ici, `X-Vercel-Cache: HIT` persiste — signe que soit (a) Vercel sert cet actif comme une ressource statique dont le cache ignore la query string, soit (b) cette réponse ne transite plus du tout par une logique de routage applicative capable de générer une réponse fraîche pour ce hostname.
4. **Aucun changement de statut HTTP, aucune erreur, aucune page d'erreur Vercel** ("This deployment cannot be accessed", 401 Vercel Authentication, etc.) n'apparaît sur `/` — si le hostname avait été proprement détaché du projet ou mis derrière une protection d'accès, la réponse attendue serait une erreur explicite de la plateforme, pas un `200` silencieux.

**Ce que cette vérification NE peut PAS trancher avec certitude (honnêteté méthodologique)** : je ne peux pas distinguer, depuis l'extérieur, entre deux causes possibles produisant exactement la même observation :

- **Cause A — la remédiation n'a pas (encore) été appliquée/sauvegardée** côté Vercel (le hostname est toujours activement rattaché au projet de production) ;
- **Cause B — la remédiation a été appliquée, mais un objet déjà mis en cache à l'edge Vercel pour ce hostname continue d'être servi indépendamment du rattachement du domaine**, jusqu'à expiration naturelle du cache ou purge manuelle — un comportement de plateforme CDN plausible mais **non confirmable sans accès au dashboard Vercel**.

Dans les deux cas, le fait de sécurité pertinent pour CF-01 est identique et sans ambiguïté : **au moment de cette vérification, le contenu réel de production reste accessible publiquement via `nkdelivery.vercel.app`, sans passer par Cloudflare.** C'est ce fait, pas sa cause, qui détermine le verdict.

---

## 10. Alternative Bypass Assessment

Recherche limitée aux informations déjà disponibles dans le repository (aucun scan, aucune énumération de sous-domaines) :

- **Aucune référence à `vercel.app`/`nkdelivery`** trouvée dans le code applicatif (`src/`) — seules des mentions dans la documentation d'audit elle-même et dans `.claude/settings.json` (liste d'autorisations d'outils de cette session, sans rapport avec la configuration de production).
- **`SITE_URL` canonique** (`src/lib/site-config.ts`) = `https://www.nkdeliveri.com` uniquement — aucune configuration applicative ne référence ou ne dépend d'un hostname Vercel.
- **URLs Vercel de type preview** (`nkdelivery-<hash>-<team>.vercel.app` ou `nkdelivery-git-<branche>-<team>.vercel.app`) : catégorie de risque connue et structurellement plausible pour tout projet Vercel, mais **non énumérée ni testée dans cette session** — cela nécessiterait de deviner/rechercher un slug d'équipe ou un hash de déploiement, ce qui sort du mandat "pas de reconnaissance massive, pas de scan Internet" de cette vérification. **Classé séparément : NOT TESTED — catégorie de risque à couvrir dans une future revue dédiée, pas un nouveau finding confirmé.**
- Aucun autre hostname Vercel évident n'est documenté dans le repository ou la configuration lisible (`vercel.json`, `.vercel/project.json`).

---

## 11. Regression Assessment

Aucune régression détectée sur le domaine officiel après la remédiation :

- `https://www.nkdeliveri.com/`, `/restaurants`, `/about` → tous `200 OK` (VERIFIED).
- HTTPS/TLS inchangé (même certificat, mêmes dates de validité).
- CSP toujours généré dynamiquement, toujours en enforcement, nonce toujours variable.
- Cloudflare toujours actif sur les deux hôtes (`CF-RAY` présent partout).
- Endpoints cron/webhooks toujours protégés (`401` sans credentials/signature — §8).

**Aucun test de connexion avec un compte réel n'a été effectué** — non nécessaire pour cette vérification et évité conformément à la consigne de prudence, la disponibilité de `/auth` (page de connexion elle-même, sans soumission de formulaire) n'a pas non plus été re-testée séparément dans cette session car hors du périmètre direct de CF-01.

---

## 12. Final Verdict

### `NOT REMEDIATED`

**Justification, condition par condition (grille §"Critères pour déclarer CLOSED")** :

1. ❌ `nkdelivery.vercel.app` ne sert plus directement la production → **FAUX**, il la sert encore, contenu identique à avant remédiation (§9).
2. ✅ Le domaine officiel fonctionne → vrai (§4, §11).
3. ✅ Le trafic officiel passe toujours par Cloudflare → vrai (§6).
4. ✅ Aucun bypass équivalent nouveau découvert → vrai dans les limites de cette vérification non-scannante (§10).
5. ✅ Aucun endpoint sensible devenu accessible par une voie alternative → vrai (§8, tous `401`).
6. ✅ Aucun problème critique introduit par la tentative de remédiation → vrai, aucune régression (§11).

**La condition 1 n'est pas démontrée — au contraire, elle est activement contredite par les preuves.** Par construction de la grille fournie, CF-01 ne peut donc pas être déclaré `CLOSED`, et ne correspond pas non plus à `PARTIALLY REMEDIATED` (qui suppose que la page d'accueil, elle, ne soit plus accessible — ce n'est pas le cas ici, elle l'est intégralement). Le verdict le plus fidèle à la définition fournie est **`NOT REMEDIATED`**, avec la réserve explicite de §9 sur la cause probable (cache edge figé plutôt que rattachement actif confirmé) — une nuance qui devrait accélérer le diagnostic côté opérateur, pas changer le verdict de sécurité.

---

## 13. Remaining Risks

- **Risque principal (inchangé depuis l'audit initial)** : la page d'accueil de production reste servie publiquement sans aucune des protections Cloudflare/CSP/`X-Frame-Options` du domaine officiel.
- **Risque secondaire nouveau, révélé par cette vérification** : si la cause réelle est un cache edge Vercel qui ignore le rattachement de domaine, alors une simple suppression de domaine dans le dashboard **ne suffit pas** à fermer ce finding — une action complémentaire (purge de cache, ou nouveau déploiement) pourrait être nécessaire, et ce mécanisme n'est pas documenté publiquement de façon suffisamment claire pour que cette vérification le confirme avec certitude.
- **Catégorie non couverte** : URLs de preview Vercel (`nkdelivery-git-*.vercel.app` ou équivalent) — risque de la même famille, non testé dans cette session (§10), à couvrir séparément.
- **Payments (H-01)** : hors périmètre de cette vérification CF-01, non re-testé ici — **correction (2026-08-14)** : contrairement à ce que cette ligne affirmait initialement ("toujours ouvert"), H-01 était déjà corrigé avant même la rédaction de ce document (commit `ecc9a65`, `supabase/migrations/20260813130000_fix_payments_rls_bypass.sql`). Voir la correction complète et sa cause dans `docs/SECURITY_PERIMETER_AUDIT_2026-08-13.md` (note en tête de document).

---

## 14. Recommended Next Actions

_(recommandations uniquement — aucune action corrective automatique effectuée)_

1. **Confirmer côté dashboard Vercel** que la suppression/désactivation de `nkdelivery.vercel.app` a bien été sauvegardée et déployée (pas seulement modifiée dans un formulaire non soumis).
2. **Purger explicitement le cache edge Vercel** pour ce hostname (ou déclencher un nouveau déploiement de production), puisque cette vérification montre qu'un objet mis en cache continue d'être servi indépendamment de toute nouvelle tentative de contournement de cache côté client.
3. **Envisager, en complément de la suppression du domaine**, l'activation de "Vercel Deployment Protection" au niveau du projet — une couche qui bloquerait l'accès même à un objet de cache résiduel, plutôt que de dépendre uniquement du rattachement/détachement de domaine.
4. **Re-vérifier après purge/action complémentaire**, avec exactement le même protocole que cette session (`Etag`/`Last-Modified`/`Age` du hostname Vercel comparés à un `curl` frais), pour confirmer objectivement la fermeture plutôt que de se fier à l'action déclarée seule.
5. Une fois confirmé fermé : rouvrir ce document ou en créer un troisième (`CF-01_FINAL_CLOSURE_...md`) avec le même protocole de preuve avant de marquer CF-01 `CLOSED` dans le suivi de remédiation global.

---

_Fin de la vérification. Aucune modification n'a été apportée au code, à la configuration Cloudflare/Vercel/Supabase, au DNS, ni à aucune donnée pendant sa réalisation. Toutes les requêtes envoyées étaient des GET/HEAD non authentifiés ou des POST non signés à volume unitaire._

---

## VERDICT

**CF-01: NOT REMEDIATED**

### CODE CHANGES

`NONE`

### DATABASE CHANGES

`NONE`

### DNS CHANGES

`NONE`

### CLOUDFLARE CHANGES

`NONE`

### VERCEL CHANGES

Action déjà effectuée manuellement par l'opérateur avant cette session (déclarée, non vérifiée dans le code) : suppression/désactivation de `nkdelivery.vercel.app` du projet Vercel de production. Aucune action Vercel supplémentaire n'a été effectuée pendant cette vérification.

### COMMITS

`NONE`

### PRODUCTION DEPLOYMENT

`NONE`

---

## Résumé (10 lignes max)

`nkdelivery.vercel.app` répond encore `200 OK` avec le contenu réel de production, identique au bit près (`Etag`, `Last-Modified`, taille) à l'état capturé avant la remédiation déclarée. Le compteur `Age` a continué de croître sans interruption sur toute la fenêtre de test, et une tentative de contournement de cache par paramètre de requête n'a produit aucune réponse fraîche (`X-Vercel-Cache: HIT` persistant). Les routes dynamiques (`/robots.txt`, `/restaurants`) restent `404`, sans changement par rapport à avant — ce n'est donc pas une régression, mais ce n'était déjà pas un accès complet à l'application. Le domaine officiel (`www.nkdeliveri.com`) reste entièrement sain : Cloudflare actif (`CF-RAY` sur chaque requête), CSP dynamique confirmé avec nonce différent sur deux requêtes consécutives, TLS inchangé. Tous les endpoints sensibles testés (2 crons, 3 webhooks) restent correctement protégés (`401`). Aucune régression détectée côté production officielle. La cause exacte de la persistance sur `nkdelivery.vercel.app` (rattachement toujours actif vs cache edge figé) n'a pas pu être tranchée depuis l'extérieur — mais l'exposition factuelle, elle, est sans ambiguïté et inchangée. **Verdict : `NOT REMEDIATED`.**

---

## ADDENDUM — Tentative de fermeture formelle vérifiée et contredite (2026-08-14, ~05:48 UTC)

**Ne remplace rien ci-dessus — l'historique de ce document reste intact, conformément à la même convention appliquée à H-01 (barré, jamais effacé).**

**Nouvelle information fournie par l'opérateur** : correction manuelle supplémentaire déclarée — `nkdelivery.vercel.app` ne serait plus lié au site ; il s'agirait d'un ancien projet Vercel associé, hors périmètre du projet de production actuel.

**Protocole de vérification appliqué** (3 axes distincts, non confondus) :

**A. Contrôle CORS côté API de production** (`Origin: https://nkdelivery.vercel.app` envoyé en en-tête) :

```text
GET https://www.nkdeliveri.com/            → aucun Access-Control-Allow-Origin dans la réponse (pas de reflet de l'origine)
POST https://www.nkdeliveri.com/api/webhooks/moncash → 401 (rejeté par la vérification de signature, sans rapport avec CORS)
GET https://dcsnmvbtsmdbwrwbutph.supabase.co/rest/v1/ → Access-Control-Allow-Origin: *
```

**Interprétation** : le `*` sur l'API Supabase n'est **pas spécifique** à `nkdelivery.vercel.app` — c'est la politique CORS par défaut de la plateforme Supabase elle-même sur son endpoint REST public (l'autorisation réelle est déterminée par RLS/la clé `anon`, pas par l'origine du navigateur). Ce test ne peut donc **ni confirmer ni infirmer** une fermeture de CF-01 : CF-01 n'a jamais été une faille CORS applicative, c'est un contournement du routage/proxy Cloudflare au niveau du hostname lui-même. Résultat de cet axe : **NON CONCLUANT PAR CONCEPTION** (mauvais angle de mesure pour ce finding précis, testé quand même pour complétude).

**B. Statut réel du domaine `nkdelivery.vercel.app` lui-même** — **l'axe décisif** :

```text
nslookup nkdelivery.vercel.app
→ Résout toujours : 216.198.79.3, 64.29.17.3 (toujours des IP Vercel)

GET https://nkdelivery.vercel.app/
→ HTTP/1.1 200 OK
→ Server: Vercel
→ Etag: "07cd427cc879c647c3888d188a3d6df0"        ← IDENTIQUE à la vérification précédente et à l'audit initial
→ Last-Modified: Thu, 13 Aug 2026 20:51:14 GMT     ← IDENTIQUE
→ Content-Length: 33767                             ← IDENTIQUE
→ Age: 32219                                          ← a continué de croître sans jamais revenir à zéro
→ X-Vercel-Cache: HIT, y compris avec un paramètre ?verify=<horodatage> inédit
```

**Interprétation** : le domaine **résout toujours** et **sert toujours exactement le même contenu**, sans la moindre variation (statut, headers, corps) par rapport à l'état déjà documenté comme `NOT REMEDIATED` hier. Aucune erreur de plateforme (`DEPLOYMENT_NOT_FOUND`, `401` Vercel Authentication, échec DNS) n'apparaît — signature attendue d'un domaine réellement délié.

**C. Contrôle applicatif (allowlist d'origine dans le code)** :

```text
grep -rn "Access-Control-Allow-Origin|cors(|allowedOrigins|ALLOWED_ORIGIN" src/  → 0 résultat
```

Aucune allowlist d'origine explicite dans le code applicatif — cohérent avec le fait que le contrôle réel de ce finding n'a jamais reposé sur le code, mais sur la configuration de plateforme Vercel (domaine attaché ou non à un projet).

**⚠️ CONTRADICTION TROUVÉE — application de la règle explicite "ne pas forcer une fermeture" :**

L'axe B contredit directement la déclaration de correction. `nkdelivery.vercel.app` ne se comporte à aucun égard comme un domaine délié : ni la résolution DNS, ni le statut HTTP, ni le contenu servi (identique au bit près à hier), ni le comportement de cache n'ont changé. Conformément à la règle explicite reçue pour cette vérification, **cette contradiction est signalée plutôt que la fermeture n'est forcée**.

### CF-01 — STATUS: **NOT CLOSED**

```text
Closure type   : N/A — fermeture non démontrée
Verified by    : nslookup nkdelivery.vercel.app ; curl -sD - https://nkdelivery.vercel.app/ (×3, dont 1 avec paramètre anti-cache) ; curl avec Origin: https://nkdelivery.vercel.app contre 3 endpoints de production
Evidence       : Etag "07cd427cc879c647c3888d188a3d6df0" identique à l'audit initial (2026-08-13) et à la vérification précédente (2026-08-14 ~05:00 UTC) ; Age passé de 29 424 s à 32 219 s sans réinitialisation ; DNS résout toujours vers 216.198.79.3/64.29.17.3 ; aucune erreur de plateforme Vercel observée
Residual risk  : identique à celui déjà documenté — le contenu de production (page d'accueil) reste servi publiquement sans Cloudflare/CSP/X-Frame-Options, par un domaine dont le statut réel (rattaché vs délié) reste NON-VERIFIÉ depuis l'extérieur malgré deux déclarations de correction successives
```

**Aucun rapport n'a été rétrogradé de "corrigé" à "ouvert"** — CF-01 n'avait jamais quitté son statut `NOT REMEDIATED`/HIGH/P1 dans aucun document ; cet addendum documente une tentative de fermeture testée et non validée, pas une régression.

**Recommandation inchangée, renforcée** : la déclaration opérateur ("ancien projet, hors périmètre") n'est, à ce stade, pas corroborée par le comportement observable du domaine. Avant toute nouvelle tentative de fermeture : confirmer directement dans le dashboard Vercel (a) si `nkdelivery.vercel.app` apparaît encore dans la liste des domaines d'un projet quelconque accessible au compte, (b) si oui, lequel, et (c) purger explicitement le cache edge de ce domaine — la persistance exacte de l'`Etag`/`Age` à travers deux vérifications espacées de plusieurs heures est la preuve la plus solide qu'un objet caché continue d'être servi indépendamment de toute action de désassociation tentée jusqu'ici.

_Aucune modification apportée au code, DNS, Cloudflare, Vercel, Supabase pendant cet addendum. Aucun commit._
