# NK DELIVERI — AUDIT PÉRIMÉTRIQUE : CLOUDFLARE, DDoS, WAF & RÉSILIENCE AUX ATTAQUES

**Date** : 2026-08-13
**Type** : Audit READ-ONLY (aucun fichier, migration, variable d'environnement, DNS, config Cloudflare/Vercel/Supabase modifié)
**Portée** : périmètre réseau/HTTP (DNS, Cloudflare, Vercel, TLS, headers, origin bypass, DDoS/WAF/rate limiting, abus d'API, injection, contrôle d'accès, paiements) — complète, sans le dupliquer, `docs/GLOBAL_AUDIT_360_2026-08-13.md` (RLS/RBAC/business logic en profondeur) et `docs/FULL_PLATFORM_AUDIT_2026-08-13.md` (inventaire des 62 routes), tous deux réutilisés ici comme **VERIFIED déjà établi** plutôt que re-audités ligne à ligne.
**Méthode** : reconnaissance DNS réelle (`nslookup`, plusieurs types d'enregistrements), requêtes HTTP réelles à très faible volume contre `nkdeliveri.com`/`www.nkdeliveri.com`/le domaine Vercel par défaut/le projet Supabase (GET/HEAD/quelques POST non signés — **aucune charge, aucun flood, aucune exploitation destructive**), inspection TLS via `openssl s_client`, lecture directe du code (`vercel.json`, routes `api.*`, migrations de sécurité storage), grep exhaustif du dépôt pour toute trace Cloudflare/Wrangler/Turnstile.
**Confiance** : chaque affirmation est **VERIFIED** (observée directement — réponse HTTP réelle, DNS réel, code réel), **PARTIALLY VERIFIED**, ou **NOT VERIFIED** (hors de portée sans accès au dashboard/API Cloudflare ou Vercel — que cette session n'a pas). Aucune protection n'est supposée exister par défaut.

> **⚠️ CORRECTIF (2026-08-14)** : ce rapport affirmait initialement que **H-01 était toujours ouvert**, sur la base d'une vérification incomplète du `git log` (seul le commit `498f36c` avait été inspecté). Le commit `ecc9a65` — déjà présent à la pointe de `main` au moment même où cet audit a été rédigé — avait en réalité **déjà fermé H-01/F-03** (`supabase/migrations/20260813130000_fix_payments_rls_bypass.sql`, `DROP POLICY "payments admin update"`, appliquée et testée en production selon le message de ce commit et `docs/PHASE_1_REMEDIATION_REPORT.md`). Toutes les mentions de H-01 ci-dessous ont été corrigées en conséquence (§14, §19, §20, §22, §25, §26) plutôt que réécrites silencieusement — cette note documente l'erreur d'audit elle-même, pas seulement sa correction.
>
> **⚠️ TENTATIVE DE FERMETURE CF-01 VÉRIFIÉE ET CONTREDITE (2026-08-14, ~05:48 UTC)** : l'opérateur a signalé une correction manuelle supplémentaire — `nkdelivery.vercel.app` aurait été délié du projet de production ("ancien projet associé, hors périmètre"). Une re-vérification empirique immédiate (`nslookup` + `curl` frais, avec contournement de cache) **contredit cette affirmation** : le hostname résout toujours (`216.198.79.3`/`64.29.17.3`), répond toujours `200 OK`, `Server: Vercel`, avec un `Etag`/`Content-Length`/`Last-Modified` **strictement identiques** à ceux de l'audit initial et de la vérification post-remédiation précédente, et un `Age` qui a continué de croître sans interruption (29 424 s → 32 219 s, cohérent avec le temps réel écoulé). **CF-01 reste `NOT REMEDIATED`** — voir le détail complet dans `docs/CF-01_POST_REMEDIATION_VERIFICATION_2026-08-13.md` (addendum du 2026-08-14). Aucune section de ce rapport n'a été rouverte/rétrogradée à "ouvert" puisqu'aucune ne l'avait jamais été refermée — CF-01 y est resté listé HIGH/P1 sans interruption ; cette note documente uniquement la tentative de fermeture testée et son résultat.

---

## 1. Executive Summary

NK Deliveri utilise **réellement Cloudflare** — confirmé factuellement, pas supposé (nameservers, IPs anycast, en-têtes `CF-RAY`/`Server: cloudflare`, certificat edge, `robots.txt` porteur du bloc "Cloudflare Managed content"). Le trafic HTTPS public passe bien par Cloudflare avant d'atteindre Vercel : HSTS, un CSP strict avec nonce par requête, `X-Frame-Options: DENY`, `Permissions-Policy` restrictive et `Cross-Origin-Opener-Policy` sont tous présents et actifs en production sur `www.nkdeliveri.com` — un résultat **meilleur** que ce que l'audit statique du 2026-08-13 (`GLOBAL_AUDIT_360`, finding H-02) avait pu établir en lisant uniquement `vercel.json` : le CSP réel est généré dynamiquement par `src/server.ts` (nonce par requête), invisible à une lecture statique de `vercel.json`. **H-02 est donc obsolète et doit être retiré du backlog** — voir §16.

Mais cet audit a trouvé une **rupture réelle et vérifiée** dans le périmètre : le domaine par défaut de Vercel, **`nkdelivery.vercel.app`**, sert la page d'accueil réelle de production (contenu identique, 33 767 octets, `<title>NK Deliveri`) **directement, sans passer par Cloudflare** — aucun `CF-RAY`, aucun CSP, aucun `X-Frame-Options`, aucun `Permissions-Policy`. Toute protection configurée au niveau de la zone Cloudflare (WAF, bot management, règles de rate limiting, scrubbing DDoS L7) **ne s'applique pas** à ce chemin. C'est un contournement d'origine confirmé — voir Finding **CF-01**, priorité P1.

Deux limites honnêtes de cet audit : (1) **impossible de confirmer si le WAF, le Bot Fight Mode ou des règles de rate limiting Cloudflare sont réellement activés** au niveau de la zone — cette session n'a accès ni au dashboard ni à l'API Cloudflare, seulement au comportement observable depuis Internet, qui ne distingue pas "protection désactivée" de "protection activée mais jamais déclenchée par un trafic normal à faible volume" ; (2) **aucun test de charge ni brute-force réel n'a été exécuté** contre les endpoints de production (login, OTP) — le projet n'a pas d'identifiants de test dédiés (voir mémoire projet) et générer un volume réel contre un système de production sans autorisation explicite préalable pour ce test précis dépasserait le mandat "audit à très faible volume" de ce document. La protection anti-brute-force est donc vérifiée **au niveau du code** (RPC `check_auth_rate_limit_secure` réellement appelée dans `auth.index.tsx`/`auth.forgot-password.tsx`), pas déclenchée en conditions réelles.

---

## 2. Architecture actuelle (vérifiée)

```text
INTERNET
   ↓
CLOUDFLARE (nameservers chelsea.ns.cloudflare.com / titan.ns.cloudflare.com — VERIFIED)
   • DNS + proxy HTTP actif (orange cloud) sur nkdeliveri.com, www.nkdeliveri.com,
     et le sous-domaine générique *.nkdeliveri.com (wildcard — VERIFIED, voir §4)
   • Certificat TLS edge (Google Trust Services WE1, SAN nkdeliveri.com + *.nkdeliveri.com)
   • Aucun Worker/Wrangler/Pages trouvé dans le dépôt — Cloudflare est utilisé
     uniquement comme DNS + reverse proxy devant Vercel, pas comme plateforme de calcul
     (confirmé aussi par le commentaire explicite dans docs/ARCHITECTURE.md sur le choix
     du preset Nitro "pas cloudflare-module")
   ↓
VERCEL (Server: cloudflare visible côté client, x-vercel-id visible → Cloudflare proxifie vers Vercel)
   • Déploiement SSR (TanStack Start, `.vercel/output/functions/__server.func`)
   • Domaine par défaut nkdelivery.vercel.app ATTEINT DIRECTEMENT DEPUIS INTERNET,
     EN PARALLÈLE, SANS PASSER PAR CLOUDFLARE — voir Finding CF-01 (§8, §16)
   • CSP/HSTS/X-Frame-Options générés dynamiquement par src/server.ts (nonce par requête),
     PAS par vercel.json (qui ne définit que 6 headers statiques : X-Frame-Options,
     X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS, COOP)
   • Cron Vercel (moncash-reconcile, plop-reconcile) protégés par CRON_SECRET — VERIFIED live (401 sans le secret)
   ↓
NK DELIVERI APPLICATION (React 19 / TanStack Start, SSR)
   ↓
SUPABASE (projet dcsnmvbtsmdbwrwbutph.supabase.co — périmètre séparé, hors du contrôle
           direct de la zone Cloudflare de NK Deliveri, voir §6)
   ├── Auth (JWT, rate limiting applicatif — VERIFIED code)
   ├── PostgreSQL (RLS 100% des tables publiques — déjà VERIFIED dans GLOBAL_AUDIT_360)
   ├── Storage (buckets publics/privés correctement séparés — VERIFIED migrations, §7)
   └── Realtime (websocket, `wss://*.supabase.co` — autorisé explicitement dans le CSP connect-src)

SERVICES EXTERNES (visibles dans le CSP connect-src/img-src — VERIFIED) :
   • *.supabase.co (API + Storage + Realtime)
   • *.tile.openstreetmap.org (tuiles carte, img-src)
   • nominatim.openstreetmap.org (géocodage)
   • router.project-osrm.org (routing GPS — serveur de démo public, voir H-03 déjà
     documenté dans GLOBAL_AUDIT_360, non re-audité ici)
   • *.ingest.sentry.io (monitoring d'erreurs)
   • mx1/mx2.hostinger.com (MX — email sortant/entrant, hors Cloudflare, hors Vercel)
```

**MX/SPF** : `nkdeliveri.com` pointe vers `mx1.hostinger.com`/`mx2.hostinger.com` avec un enregistrement `SPF` (`v=spf1 include:_spf.mail.hostinger.com ~all`) — un service de messagerie tiers (Hostinger), indépendant de Cloudflare/Vercel/Supabase. **Pas de DMARC trouvé** au moment de cet audit (requête `TXT _dmarc.nkdeliveri.com` non incluse dans le périmètre testé — à vérifier séparément, NOT VERIFIED ici). **DNSSEC** : non vérifié positivement dans cette session (nécessiterait une requête `DNSKEY`/`DS` dédiée — NOT VERIFIED).

---

## 3. Cloudflare status — réponse factuelle

**Cloudflare est utilisé, activement, en mode proxy (pas seulement DNS).** Preuves :

| Preuve                                                                                                                                        | Résultat                                                                                                                    | Verdict                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nameservers du domaine                                                                                                                        | `chelsea.ns.cloudflare.com`, `titan.ns.cloudflare.com`                                                                      | Zone gérée par Cloudflare                                                                                                                                                                             |
| Résolution A/AAAA de `nkdeliveri.com` et `www`                                                                                                | `104.21.10.156`, `172.67.131.138`, `2606:4700:3030::…`, `2606:4700:3032::…` (plages anycast Cloudflare)                     | Proxy actif (pas de résolution vers une IP d'hébergeur classique)                                                                                                                                     |
| Header `Server` sur toute réponse HTTPS du domaine custom                                                                                     | `cloudflare`                                                                                                                | Confirmé sur chaque requête                                                                                                                                                                           |
| Header `CF-RAY`                                                                                                                               | présent sur chaque requête (ex. `a2aaa3b4af477386-MIA`)                                                                     | Confirmé — trafic passé par un edge Cloudflare (Miami)                                                                                                                                                |
| `cf-cache-status`                                                                                                                             | `DYNAMIC` sur les pages SSR                                                                                                 | Confirmé — Cloudflare voit et catégorise chaque requête, pas un simple DNS passthrough                                                                                                                |
| Certificat TLS                                                                                                                                | émis par Google Trust Services (`WE1`), SAN `nkdeliveri.com` + `*.nkdeliveri.com`                                           | Signature typique d'un certificat "Universal SSL" Cloudflare (émission edge), pas un certificat Vercel classique                                                                                      |
| `robots.txt`                                                                                                                                  | contient un bloc explicite `# BEGIN Cloudflare Managed content` / `# END Cloudflare Managed Content` (règles anti-crawl IA) | Confirmé — une fonctionnalité Cloudflare (Content Signals / AI Crawl Control) modifie activement le contenu servi                                                                                     |
| `www.nkdeliveri.com` (redirigé)                                                                                                               | même comportement, mêmes headers Cloudflare                                                                                 | Cohérent sur les deux hôtes                                                                                                                                                                           |
| `*.nkdeliveri.com` (sous-domaines arbitraires testés : `api`, `staging`, `dev`, `admin`, `test`, `mail`, `webmail`, `cpanel`, `autodiscover`) | tous résolvent vers les mêmes IPs Cloudflare, tous retournent `404` avec `Server: cloudflare` + `CF-RAY` propre             | Wildcard DNS proxifié par Cloudflare — aucun sous-domaine ne "fuit" une IP d'origine ; Cloudflare répond lui-même 404 (pas de backend configuré derrière), donc pas de fuite d'origine par ce vecteur |

**Cloudflare protège-t-il réellement le domaine, ou seulement le DNS ?** Réponse : **le proxy HTTP est actif** (mode "orange cloud"), donc au minimum les protections de base incluses par défaut sur toute zone proxifiée s'appliquent (chiffrement edge, masquage de l'IP d'origine réelle côté DNS public, DDoS réseau L3/L4 basique — ce niveau est automatique chez Cloudflare et ne dépend d'aucune configuration). **Ce qui N'EST PAS vérifiable depuis cette session** : si des règles WAF managées, du Bot Fight Mode, ou des règles de rate limiting personnalisées sont **explicitement activées** au niveau de la zone — voir §9-10 et Finding **CF-02**.

---

## 4. DNS Analysis

| Type                             | Valeur                                                                                     | Commentaire                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| NS                               | `chelsea.ns.cloudflare.com`, `titan.ns.cloudflare.com`                                     | Zone déléguée à Cloudflare                                                 |
| A/AAAA (`nkdeliveri.com`, `www`) | `104.21.10.156`, `172.67.131.138`, `2606:4700:3030::ac43:838a`, `2606:4700:3032::6815:a9c` | Anycast Cloudflare, aucune IP d'origine Vercel exposée par le DNS lui-même |
| MX                               | `mx1.hostinger.com` (10), `mx2.hostinger.com` (5)                                          | Email tiers, hors périmètre Cloudflare/Vercel                              |
| TXT                              | `v=spf1 include:_spf.mail.hostinger.com ~all`                                              | SPF présent et cohérent avec le MX ; DMARC non vérifié dans cette session  |
| SOA                              | `chelsea.ns.cloudflare.com`, contact `dns.cloudflare.com`                                  | Cohérent avec la délégation Cloudflare                                     |
| Wildcard `*.nkdeliveri.com`      | proxifié, répond 404 propre côté Cloudflare                                                | Pas de fuite d'origine par sous-domaine non attendu                        |
| DNSSEC                           | **NOT VERIFIED** dans cette session                                                        | Requête `DNSKEY`/`DS` non exécutée — à vérifier séparément                 |

---

## 5. Vercel Analysis

- Projet Vercel : `nkdelivery` (`.vercel/project.json`, `projectId: prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x`).
- `vercel.json` définit **6 headers statiques** appliqués à `/(.*)` : `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`. **Aucun CSP dans ce fichier** — le CSP réellement observé en production vient d'ailleurs (voir §11).
- 2 crons Vercel (`moncash-reconcile` 3h00, `plop-reconcile` 3h15) — **protection par `CRON_SECRET` VERIFIED en direct** : requête GET non authentifiée → `401` sur les deux endpoints.
- **`nkdelivery.vercel.app` (domaine par défaut du projet) répond publiquement, sans authentification, et sert le contenu réel de production sur `/`** — voir Finding **CF-01** ci-dessous. C'est un comportement par défaut de Vercel (le domaine `<projet>.vercel.app` est actif et public par défaut sauf activation explicite de la "Vercel Deployment Protection"), pas une fuite de configuration exotique — mais son existence n'est visiblement pas neutralisée pour ce projet.

---

## 6. Supabase Analysis (périmètre réseau, pas RLS — voir GLOBAL_AUDIT_360 pour le détail RLS déjà VERIFIED)

- Projet : `dcsnmvbtsmdbwrwbutph.supabase.co`. **VERIFIED live** : `GET /rest/v1/` sans clé → `401 UNAUTHORIZED_MISSING_API_KEY` (comportement correct — la clé publique `anon` est obligatoire même pour les endpoints "publics", elle n'accorde des droits qu'à travers RLS).
- **Fait architectural important** : le projet Supabase est lui-même derrière Cloudflare (`Server: cloudflare`, `CF-RAY` présents sur `dcsnmvbtsmdbwrwbutph.supabase.co`, cookie `__cf_bm` — Cloudflare Bot Management — observé sur cette requête). **Mais c'est le périmètre Cloudflare de Supabase Inc., pas celui de NK Deliveri** — l'équipe du projet ne peut pas configurer de règles WAF/rate limiting Cloudflare sur ce domaine ; seuls les réglages exposés dans le dashboard Supabase lui-même (rate limiting Auth, CAPTCHA hooks, RLS, policies Storage) sont sous son contrôle. C'est un deuxième périmètre de confiance, séparé, qui n'apparaît dans aucun des deux audits précédents sous cet angle.
- **Storage — public vs privé, VERIFIED par lecture directe des migrations de création de bucket** :

| Bucket                   | Public ?  | Contenu                             | Verdict                                 |
| ------------------------ | --------- | ----------------------------------- | --------------------------------------- |
| `menu-photos`            | ✅ public | Photos de plats                     | Correct — contenu destiné à être public |
| `restaurant-assets`      | ✅ public | Logos/bannières restaurant          | Correct                                 |
| `avatars`                | ✅ public | Photos de profil                    | Correct                                 |
| `driver-documents`       | ❌ privé  | **Pièces d'identité / KYC livreur** | Correct — sensible, bien isolé          |
| `payment-proofs`         | ❌ privé  | Preuves de paiement manuel          | Correct                                 |
| `payout-proofs`          | ❌ privé  | Preuves de payout                   | Correct                                 |
| `dispute-attachments`    | ❌ privé  | Pièces jointes de litige            | Correct                                 |
| `order-chat-attachments` | ❌ privé  | Pièces jointes de chat commande     | Correct                                 |

Tous les buckets sensibles ont `file_size_limit` + `allowed_mime_types` posés au niveau du moteur de stockage lui-même (migration `20260713120000_secure_storage_buckets.sql`), pas seulement en validation applicative — **bon réflexe défense-en-profondeur, VERIFIED**.

---

## 7. Attack Surface

| Surface                   | URL/Route                                                                                |                                 Public ? |                                                      Auth ? |                                                                 Rate Limit ? |                                                     Devant Cloudflare ? |                                                                Risque |
| ------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------: | ----------------------------------------------------------: | ---------------------------------------------------------------------------: | ----------------------------------------------------------------------: | --------------------------------------------------------------------: |
| Site public               | `/`, `/restaurants`, `/restaurants/:slug`, `/about`…                                     |                                      Oui |                                                         Non |                                          Non (pas nécessaire, lecture seule) |             Oui (custom domain) ; **aussi via `nkdelivery.vercel.app`** |                                                         🟠 Voir CF-01 |
| Auth                      | `/auth`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`               |                                      Oui |                                 N/A (endpoint de connexion) |                          Oui, `check_auth_rate_limit_secure` — VERIFIED code |                                                                     Oui |                               🟡 Non testé en charge réelle (voir §1) |
| Checkout/paiement         | `/checkout` → `create_order_secure` + 4 providers                                        |                    Non (session requise) |                                                         Oui |       Rate limiting applicatif sur actions coûteuses (VERIFIED précédemment) |                                                                     Oui |                                                 🟢 H-01 corrigé (§14) |
| Webhooks paiement         | `/api/webhooks/moncash`, `/api/webhooks/moncash/collect`, `/api/webhooks/stripe/collect` | Oui (tiers non authentifiés par session) | Signature provider — VERIFIED live : POST non signé → `401` | Pas de rate limit IP dédié observé (repose sur la vérification de signature) |                                                                     Oui | 🟢 Signature vérifiée ; 🔵 GET renvoie 200 au lieu de 404/405 (CF-05) |
| Cron                      | `/api/cron/moncash-reconcile`, `/api/cron/plop-reconcile`                                |                                Oui (URL) |           `CRON_SECRET` — VERIFIED live : `401` sans secret |                                                                          N/A |                                                                     Oui |                                                            🟢 Correct |
| CSP report                | `/api/csp-report`                                                                        |      Oui, volontairement non authentifié |                                                Non (design) |                            **Aucun**, seulement une limite de taille (20 Ko) |                                                                     Oui |                                                         🟡 Voir CF-04 |
| Chat commande             | `/chat/:orderId`                                                                         |                                      Non |                                  Oui, RLS scope participant |                                  Écriture via RPC uniquement (déjà VERIFIED) |                                                                     Oui |                                                                    🟢 |
| Storage                   | buckets `*.supabase.co/storage/v1/...`                                                   |                          Mixte (voir §6) |                                       RLS + policies bucket |                                                                          N/A | Passe par le périmètre Cloudflare de Supabase, pas celui de NK Deliveri |                                                                    🟢 |
| Domaine Vercel par défaut | `nkdelivery.vercel.app/`                                                                 |                                      Oui |                                                         Non |                                                                          Non |                                                                 **NON** |                                                              🔴 CF-01 |

---

## 8. DDoS Analysis

- **Couche réseau (L3/L4)** : Cloudflare proxifie le trafic vers `nkdeliveri.com`/`www` — la protection DDoS réseau de base de Cloudflare s'applique automatiquement à tout trafic proxifié, sans configuration additionnelle requise ; c'est un fait structurel de l'architecture confirmée en §3, pas une supposition.
- **Couche applicative (L7)** : Cloudflare voit le trafic comme `DYNAMIC` (pas de cache agressif sur les pages SSR authentifiées, ce qui est correct pour la confidentialité mais signifie que chaque requête HTTP atteint réellement Vercel — un flood HTTP L7 bien formé n'est pas absorbé par un cache, il doit être arrêté par du rate limiting/WAF avant d'atteindre l'origine). **Impossible de confirmer si des règles de rate limiting Cloudflare L7 sont configurées** (voir CF-02).
- **Contournement confirmé** : `nkdelivery.vercel.app` reçoit le même contenu que le domaine principal **sans passer par la couche DDoS/L7 de Cloudflare** — un attaquant visant spécifiquement la page d'accueil peut choisir ce chemin pour toute protection Cloudflare-dépendante. Vercel a ses propres protections de plateforme (non spécifiques à ce projet, non auditables depuis cette session — **NOT VERIFIED**), donc ce n'est pas un accès "nu" à un serveur non protégé, mais ce n'est plus **le** périmètre que l'équipe a choisi et configuré.
- **Endpoints coûteux identifiés** : `create_order_secure` (checkout), les 4 clients de paiement, `initiate_payout_secure`, l'upload de documents (`register-documents.functions.ts`, jusqu'à 8 Mo) — tous déjà `check_rate_limit_secure`-gated côté applicatif (VERIFIED code, cohérent avec `GLOBAL_AUDIT_360`). `/api/csp-report` est le seul endpoint public trouvé dans cet audit **sans aucune limite de fréquence**, voir CF-04.
- Aucun test de charge réel n'a été exécuté (hors mandat "très faible volume" de cet audit).

---

## 9. WAF Analysis

**NOT VERIFIED — limite méthodologique explicite, pas une conclusion.** Un WAF actif (managed rules, règles custom) n'est observable depuis Internet que s'il bloque activement une requête qui le déclenche (signature d'attaque connue dans l'URL/body/headers) — cet audit s'est interdit d'envoyer de telles charges (règle "aucune exploitation", "tests à très faible volume"). Aucune requête envoyée dans cette session n'a été bloquée par un mur Cloudflare distinct de l'application elle-même (tous les `401`/`404` observés viennent du code applicatif — `CRON_SECRET`, signature webhook, routing — pas d'une page d'erreur Cloudflare 1020/403). Cela ne prouve ni la présence ni l'absence d'un WAF Cloudflare — seulement qu'aucune règle WAF n'a été déclenchée par le trafic légitime envoyé. **Recommandation : vérifier directement dans le dashboard Cloudflare (Security → WAF) quelles règles managées sont actives, plutôt que de déduire leur présence.**

---

## 10. Rate Limiting

| Niveau                                                                    | Preuve                                                                                                                                                                                                                                          | Statut                                                                                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applicatif/DB (`check_rate_limit_secure`, `check_auth_rate_limit_secure`) | Appelé dans `auth.index.tsx`, `auth.forgot-password.tsx`, `poll-collect-payment.logic.ts`, `push-dispatch.server.ts`, `register-documents.functions.ts`, `send-newsletter.functions.ts`, `send-push.functions.ts` — **VERIFIED grep + lecture** | ✅ Présent sur login, reset password, upload documents, envoi de push/newsletter, polling paiement                                                                                  |
| Edge/Cloudflare                                                           | **NOT VERIFIED** (§9)                                                                                                                                                                                                                           | ❓                                                                                                                                                                                  |
| `/api/csp-report`                                                         | Aucune limite de fréquence trouvée, seulement un plafond de taille de 20 Ko par requête ; chaque violation parsée déclenche un appel `captureExceptionServer` (Sentry) — **VERIFIED lecture du code**                                           | 🟡 CF-04                                                                                                                                                                            |
| Webhooks paiement                                                         | Pas de rate limit IP dédié trouvé ; protection repose entièrement sur la vérification de signature provider (déjà `401` si absente/invalide — VERIFIED live)                                                                                    | 🟡 Acceptable si la vérification de signature est bien à coût constant et systématique (déjà documentée dans `docs/MONCASH_WEBHOOK_SECURITY.md`, non re-vérifiée ligne à ligne ici) |

---

## 11. Authentication

- Supabase Auth (JWT), OAuth possible (non ré-audité en détail ici, déjà couvert par `GLOBAL_AUDIT_360` §8).
- Rate limiting applicatif confirmé sur login/reset password (§10).
- Step-up MFA STRICT pour les actions admin sensibles — déjà VERIFIED en profondeur dans les audits précédents (C-01 fermé), non re-testé ici (hors périmètre "attaques réseau/périmètre").
- **CAPTCHA/Turnstile** : **aucune trace trouvée** dans le code (`grep -i turnstile` → 0 résultat applicatif) ni dans la configuration Cloudflare observable. Le formulaire de connexion/inscription ne semble pas protégé par un challenge bot au-delà du rate limiting applicatif — à confirmer si le Bot Fight Mode Cloudflare compense au niveau edge (NOT VERIFIED, §9).

---

## 12. Authorization

Repris de `GLOBAL_AUDIT_360_2026-08-13.md` (§9, matrice RLS déjà VERIFIED en direct contre `pg_policies`) et non re-audité ligne à ligne dans cette session à vocation périmétrique : **100% des 52 tables publiques ont RLS activé**, pattern dominant = 1 policy SELECT + écritures 100% via RPC `SECURITY DEFINER`. Les deux exceptions historiquement connues sont désormais **toutes les deux corrigées** : `user_roles` (**C-01, corrigé** — commit `dd2da77`) et `payments` (**H-01, corrigé** — commit `ecc9a65`, voir §14, correction apportée le 2026-08-14 par rapport à la version initiale de cet audit).

---

## 13. API Security

Convention `_secure` uniforme (85 RPC sur 117), `SECURITY DEFINER` + `search_path` fixé + revérification de rôle indépendante de RLS — déjà VERIFIED dans les audits précédents. Nouveauté de cette session : deux constats mineurs de comportement HTTP :

- **CF-04** : `/api/csp-report` sans limite de fréquence.
- **CF-05** : les routes qui ne définissent qu'un handler `POST` (`api.webhooks.moncash(.collect)`, `api.webhooks.stripe.collect`) répondent `200` avec le shell HTML complet de l'application sur une requête `GET`, au lieu d'un `404`/`405` propre — un vrai chemin inexistant (`/totally-fake-path-xyz`) renvoie bien `404` (**VERIFIED, comparaison directe**), donc ce n'est pas un fallback SPA générique cassé, mais spécifiquement l'absence d'un handler `GET` explicite sur ces routes précises. Impact : révèle qu'un chemin existe (déjà documenté publiquement côté intégration MonCash/Stripe de toute façon) — pas une fuite de données.

---

## 14. Payment Security

Repris des audits précédents (webhooks signés, réconciliation cron protégée par `CRON_SECRET`, idempotence par construction sur `payments.status='pending'` déjà VERIFIED) + confirmations live de cette session :

- `POST /api/webhooks/moncash` sans signature → `401` (**VERIFIED live**)
- `POST /api/webhooks/moncash/collect` sans signature → `401` (**VERIFIED live**)
- `POST /api/webhooks/stripe/collect` sans signature → `401` (**VERIFIED live**)
- `GET /api/cron/moncash-reconcile` et `/api/cron/plop-reconcile` sans `CRON_SECRET` → `401` (**VERIFIED live**)

**Question critique : un attaquant peut-il faire croire au système qu'un paiement a été effectué alors qu'il ne l'a pas été ?**

- Par forgerie de webhook : **non**, signature vérifiée, `401` sur payload non signé (VERIFIED).
- Par manipulation du montant/méthode côté client : **non pour le flux normal** — `orders`/`payments` sont RPC-only pour l'écriture, aucune policy RLS d'écriture directe côté client (VERIFIED dans `GLOBAL_AUDIT_360`).
- Par un admin authentique dont la session est compromise : **non, H-01 est corrigé — correction apportée à cet audit le 2026-08-14.** La policy RLS `"payments admin update"` permettait un `UPDATE payments SET status='paid'` direct par un compte admin, sans passer par `review_manual_payment_secure` ni déclencher de validation de transition. **Ce rapport affirmait initialement le contraire** (« toujours ouvert »), sur la base d'une vérification `git log` incomplète qui n'avait inspecté que le commit `498f36c` (correction de la classification manuel/automatique du paiement, sans rapport avec H-01) — sans remarquer que le commit `ecc9a65`, déjà présent à la pointe de `main` à ce moment-là, avait fermé H-01 séparément.
  **Preuve de la correction** (`supabase/migrations/20260813130000_fix_payments_rls_bypass.sql`, commit `ecc9a65`, `docs/PHASE_1_REMEDIATION_REPORT.md`) : la policy `"payments admin update"` a été **supprimée** (`DROP POLICY`), pas remplacée par un trigger — choix délibéré et documenté (4 RPC déjà gardées — `review_manual_payment_secure`, `complete_collect_payment_secure`, `confirm_cash_payment_secure`, `complete_refund_secure` — couvrent déjà chaque transition légitime ; `payments` rejoint ainsi le modèle 100% RPC-only déjà utilisé par `orders`/`user_roles`/`payout_settings`). Testé en `BEGIN…ROLLBACK` contre la production réelle avant application (mutation arbitraire refusée, y compris depuis un état terminal ; les 4 RPC légitimes toujours fonctionnelles ; non-admin toujours refusé) et le commit déclare explicitement "Migrations applied to production and tested in this session".
  **Limite de cette correction elle-même** : cette session n'a pas de credentials admin de test (voir mémoire projet) pour re-vérifier indépendamment par une requête SQL live que la policy a bien disparu en production — la conclusion ci-dessus repose sur la preuve de commit/migration/rapport (VERIFIED du point de vue du code et de la documentation), pas sur une re-exécution SQL par cette session (NOT VERIFIED indépendamment aujourd'hui). Priorité : **résolu, P1 → clos**.

---

## 15. Origin Bypass — section critique

**Question posée : même si Cloudflare est parfaitement configuré, est-il possible de le contourner ?**

**Réponse : oui, partiellement, et c'est vérifié en direct.**

```text
curl https://nkdelivery.vercel.app/
→ HTTP/1.1 200 OK
→ Server: Vercel  (PAS cloudflare)
→ Aucun CF-RAY
→ Aucun Content-Security-Policy
→ Aucun X-Frame-Options / X-Content-Type-Options / Permissions-Policy / COOP
→ Access-Control-Allow-Origin: *
→ Corps : 33 767 octets, <title>NK Delivery — Livraison de repas aux Gonaïves</title>
   → contenu RÉEL de production, identique à www.nkdeliveri.com
```

**Nuance importante, vérifiée pour ne pas exagérer l'impact** : seule la page d'accueil (`/`) répond `200` sur ce domaine. `/restaurants`, `/about`, `/auth`, `/api/webhooks/moncash`, et un chemin aléatoire renvoient tous `404` sur `nkdelivery.vercel.app` (**VERIFIED, 4 routes testées**) — le routage SSR dynamique et les endpoints API/paiement **ne sont pas** atteignables par ce chemin actuellement. Ce n'est donc pas un contournement total de l'application, mais un contournement confirmé d'au moins un actif réel de production, avec un comportement (quel sous-ensemble de routes est exposé) qui n'est piloté par aucune décision explicite de l'équipe et pourrait changer silencieusement à un futur déploiement.

**Pourquoi c'est un problème même limité à la page d'accueil :**

1. Toute règle WAF/rate limiting/bot management configurée côté Cloudflare pour protéger le site ne s'applique pas à ce chemin — un attaquant qui viserait spécifiquement cet actif contourne entièrement cette couche.
2. La page servie par ce chemin n'a **aucun** des headers de durcissement (CSP, `X-Frame-Options`) présents sur le domaine officiel — elle est en théorie embarquable dans un `<iframe>` tiers (clickjacking) alors que le domaine principal l'interdit explicitement (`frame-ancestors 'none'`, `X-Frame-Options: DENY`).
3. `Access-Control-Allow-Origin: *` sur ce chemin n'a pas d'impact direct ici (page HTML publique sans données sensibles), mais révèle que les réponses de ce chemin ne passent pas par le même pipeline de headers applicatifs que le domaine principal — un signal que d'autres différences de comportement pourraient exister sans supervision.
4. C'est un domaine public, prévisible (nom du projet Vercel dérivé du nom de l'entreprise), non documenté nulle part comme faisant partie de la surface exposée assumée du produit.

**Recommandation (non appliquée, audit uniquement)** : désactiver l'exposition publique du domaine `<projet>.vercel.app` via les réglages "Deployment Protection" du projet Vercel, ou au minimum le rediriger vers le domaine canonique — sans jamais servir de contenu directement dessus.

---

## 16. Security Headers

| Header                                | Présent sur `www.nkdeliveri.com` ?                                                    | Valeur observée                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Qualité                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`             | ✅ **Oui — contredit `GLOBAL_AUDIT_360` H-02, voir note ci-dessous**                  | `script-src 'self' 'nonce-<random>'; default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src 'none'; form-action 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org https://router.project-osrm.org https://*.ingest.sentry.io; worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests; report-uri /api/csp-report; report-to csp-endpoint` | 🟢 Solide : nonce par requête (pas de `'unsafe-inline'` sur `script-src`), `object-src 'none'`, `frame-ancestors 'none'`, allowlist `connect-src`/`img-src` précise et alignée sur les services réellement utilisés. `style-src 'unsafe-inline'` reste un compromis (probablement lié à une lib de styling runtime) — non investigué plus loin, hors périmètre de cet audit réseau |
| `Strict-Transport-Security`           | ✅ `www`                                                                              | `max-age=63072000; includeSubDomains; preload`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 🟢                                                                                                                                                                                                                                                                                                                                                                                 |
| `Strict-Transport-Security`           | ⚠️ apex (redirect)                                                                    | `max-age=63072000` seul, sans `includeSubDomains`/`preload`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 🔵 CF-03, mineur — voir §18                                                                                                                                                                                                                                                                                                                                                        |
| `X-Frame-Options`                     | ✅                                                                                    | `DENY`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 🟢                                                                                                                                                                                                                                                                                                                                                                                 |
| `X-Content-Type-Options`              | ✅                                                                                    | `nosniff`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 🟢                                                                                                                                                                                                                                                                                                                                                                                 |
| `Referrer-Policy`                     | ✅                                                                                    | `strict-origin-when-cross-origin`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 🟢                                                                                                                                                                                                                                                                                                                                                                                 |
| `Permissions-Policy`                  | ✅                                                                                    | `camera=(), microphone=(), geolocation=(self), payment=(), usb=(), interest-cohort=()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 🟢                                                                                                                                                                                                                                                                                                                                                                                 |
| `Cross-Origin-Opener-Policy`          | ✅                                                                                    | `same-origin-allow-popups`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 🟢 (le `allow-popups` est nécessaire pour les redirections OAuth/paiement en popup — cohérent avec le produit)                                                                                                                                                                                                                                                                     |
| `Cross-Origin-Embedder-Policy` (COEP) | ❌ Absent, **délibérément**                                                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 🟢 Correct de ne pas le recommander automatiquement : COEP casserait le chargement des tuiles Leaflet/OpenStreetmap (`cross-origin` sans CORP compatible) — conforme à l'instruction explicite de cet audit                                                                                                                                                                        |
| `Cross-Origin-Resource-Policy` (CORP) | Non observé sur les réponses HTML                                                     | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 🔵 Non bloquant pour ce type de contenu ; à envisager sur les futures API JSON si besoin d'isolement                                                                                                                                                                                                                                                                               |
| Cache sur pages privées               | `Cache-Control: public, max-age=0, must-revalidate` sur `/` (page publique — correct) | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 🟢 Aucune donnée privée observée en cache dans les réponses testées (dashboard/checkout non testés en profondeur ici, déjà couverts par les audits précédents comme routes protégées par session)                                                                                                                                                                                  |

**Note sur H-02 (`GLOBAL_AUDIT_360`)** : ce finding affirmait "aucun Content-Security-Policy n'est configuré nulle part". C'était **correct pour une lecture statique de `vercel.json`**, mais **incorrect pour le comportement réel en production**, où `src/server.ts` génère un CSP strict par requête. **Recommandation : marquer H-02 comme résolu/obsolète dans le suivi de remédiation**, avec cette preuve live comme référence.

---

## 17. Secrets Exposure

Aucun secret trouvé exposé côté client dans cette session (cohérent avec `GLOBAL_AUDIT_360` §8 — toutes les clés serveur sont `process.env`, jamais `VITE_*`, sauf la clé publique Supabase qui est explicitement publique par design). Aucune clé, token ou identifiant réel n'a été observé dans les réponses HTTP testées, le HTML servi, ou les fichiers de configuration lus (`.env.example` ne contient que des placeholders `your-project.supabase.co`/`your-anon-or-publishable-key`). Si un secret avait été trouvé, il aurait été masqué (`sk_live_************`) — non applicable ici.

---

## 18. Attack Scenarios

### Scénario 1 — Attaquant anonyme → plateforme publique

Attaque → requête HTTP arbitraire sur `www.nkdeliveri.com`.
Protection actuelle → Cloudflare (edge, DDoS L3/L4, TLS), CSP/headers stricts, RLS côté données.
Protection manquante → confirmation WAF/rate limiting edge (NOT VERIFIED).
Exploitabilité → faible pour une attaque simple ; **modérée** si l'attaquant vise `nkdelivery.vercel.app` à la place (CF-01).
Impact → faible sur ce chemin seul (page publique).
Risque → 🟡 MEDIUM (à cause de CF-01).

### Scénario 2 — Attaquant → brute force login

Attaque → tentatives répétées sur `/auth`.
Protection actuelle → `check_auth_rate_limit_secure` (RPC, VERIFIED code, non déclenché en conditions réelles dans cet audit).
Protection manquante → CAPTCHA/Turnstile (aucun trouvé) ; confirmation d'un rate limiting edge Cloudflare en complément (NOT VERIFIED).
Exploitabilité → limitée si le rate limiting applicatif fonctionne comme documenté ; **non re-testée en direct** dans cet audit (voir §1).
Impact → compromission de compte si succès.
Risque → 🟡 MEDIUM (protection présente mais mono-couche, non re-vérifiée en live).

### Scénario 3 — Utilisateur authentifié → modification d'un autre utilisateur

Protection actuelle → RLS scoping strict par `auth.uid()`, déjà VERIFIED (`GLOBAL_AUDIT_360` §9).
Risque → 🟢 LOW, hors nouvelle preuve dans cette session.

### Scénario 4 — Utilisateur → modification d'une commande qui ne lui appartient pas

Protection actuelle → `orders` 100% RPC-only, aucune policy d'écriture directe (déjà VERIFIED).
Risque → 🟢 LOW.

### Scénario 5 — Utilisateur → manipulation d'un paiement

Protection actuelle → webhooks signés (VERIFIED live cette session), RPC-only côté client, **et H-01 corrigé** (`DROP POLICY "payments admin update"`, commit `ecc9a65` — plus aucune écriture RLS directe sur `payments`, admin inclus).
Protection manquante → aucune identifiée dans le périmètre de ce scénario.
Risque → 🟢 LOW _(révisé le 2026-08-14 — était 🟠 HIGH par erreur, voir correctif en tête de document)_.

### Scénario 6 — Attaquant → API abuse

Protection actuelle → convention `_secure` + `check_rate_limit_secure` sur les actions coûteuses connues.
Protection manquante → `/api/csp-report` sans limite (CF-04) ; confirmation edge (NOT VERIFIED).
Risque → 🟡 MEDIUM (coût/bruit, pas de fuite de données).

### Scénario 7 — Attaquant → upload malveillant

Protection actuelle → `file_size_limit`/`allowed_mime_types` posés au niveau du moteur Storage lui-même (VERIFIED migrations), pas seulement en validation applicative.
Risque → 🟢 LOW.

### Scénario 8 — Attaquant → récupération de données privées

Protection actuelle → RLS 100%, buckets sensibles privés (VERIFIED §6), `nkdelivery.vercel.app` ne sert que du contenu déjà public (page d'accueil).
Risque → 🟢 LOW, sous réserve que CF-01 ne s'étende pas un jour à des routes dynamiques (voir §15).

### Scénario 9 — Attaquant → bypass Cloudflare

Attaque → cibler `nkdelivery.vercel.app` au lieu du domaine officiel.
Protection actuelle → aucune (ce chemin n'est simplement pas couvert par la zone Cloudflare de NK Deliveri).
Protection manquante → désactivation du domaine par défaut Vercel ou redirection forcée.
Exploitabilité → **confirmée, faible complexité** (URL publique, prévisible, aucune authentification requise).
Impact → limité aujourd'hui (page d'accueil seule), structurel (aucune garantie que ça le reste).
Risque → 🟠 **HIGH — Finding CF-01**.

### Scénario 10 — Attaquant → exploitation d'un endpoint sans rate limit

Attaque → flood de `/api/csp-report`.
Protection actuelle → plafond de taille (20 Ko), pas de limite de fréquence.
Impact → bruit Sentry/logs, coût d'observabilité, pas de fuite de données ni d'écriture DB (le endpoint n'écrit rien en base — VERIFIED lecture du code).
Risque → 🟡 MEDIUM — Finding CF-04.

---

## 19. Vulnerability Matrix

| ID                        | Titre                                                                                                                                | Sévérité  | Composant                                    | Priorité                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CF-01                     | Origin bypass — `nkdelivery.vercel.app` sert la page d'accueil réelle sans passer par Cloudflare                                     | 🟠 HIGH   | Vercel / Cloudflare                          | P1                                                                                                                                                                                                                                 |
| CF-02                     | Impossible de confirmer si WAF/Bot Fight Mode/rate limiting Cloudflare sont réellement activés (limite d'audit, pas juste un manque) | 🟡 MEDIUM | Cloudflare (config non observable)           | P2                                                                                                                                                                                                                                 |
| CF-03                     | HSTS sur l'apex (redirect) sans `includeSubDomains`/`preload`, contrairement à `www`                                                 | 🔵 LOW    | Vercel headers                               | P3                                                                                                                                                                                                                                 |
| CF-04                     | `/api/csp-report` sans rate limiting — abusable pour générer du bruit Sentry/logs à coût attaquant nul                               | 🟡 MEDIUM | Application (`src/routes/api.csp-report.ts`) | P2                                                                                                                                                                                                                                 |
| CF-05                     | Routes webhook `POST`-only répondent `200` (shell SPA) au lieu de `404`/`405` sur `GET`                                              | 🔵 LOW    | Application (routing)                        | P3                                                                                                                                                                                                                                 |
| CF-06                     | Aucun `/.well-known/security.txt`                                                                                                    | 🟢 INFO   | —                                            | P3                                                                                                                                                                                                                                 |
| H-01 _(repris — CLOS)_    | `payments` modifiable directement par un admin sans trigger de validation                                                            | —         | Supabase RLS                                 | **RÉSOLU** — `DROP POLICY`, commit `ecc9a65`, `docs/PHASE_1_REMEDIATION_REPORT.md`. Cet audit affirmait initialement "toujours ouvert" par erreur de vérification `git log` — corrigé le 2026-08-14, voir note en tête de document |
| H-02 _(repris — à clore)_ | "Aucun CSP configuré" — **infirmé par cet audit**, CSP réel et strict en production                                                  | —         | —                                            | **À retirer du backlog**                                                                                                                                                                                                           |

---

## 20. Security Score /100

| Domaine           |             Score /10 | Justification courte                                                                                                                        |
| ----------------- | --------------------: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| DDoS              |                     6 | Cloudflare proxy actif = protection réseau de base ; contournement confirmé pour au moins un actif (CF-01) réduit la couverture réelle      |
| WAF               |                     4 | Non vérifiable positivement (CF-02) — score prudent, pas optimiste                                                                          |
| Rate limiting     |                     6 | Solide au niveau applicatif sur les actions sensibles connues ; un gap confirmé (CF-04) ; couverture edge non vérifiable                    |
| Authentication    |                     8 | JWT + step-up MFA STRICT déjà VERIFIED (audits précédents) + rate limiting login VERIFIED code                                              |
| Authorization     | 8 _(révisé, était 7)_ | RLS 100% + pattern 100% RPC-only désormais confirmé sur toutes les tables financières sensibles — H-01 corrigé (commit `ecc9a65`)           |
| API security      |                     7 | Convention `_secure` cohérente ; deux gaps mineurs (CF-04, CF-05)                                                                           |
| Payment security  | 8 _(révisé, était 7)_ | Webhooks signés VERIFIED live, cron protégé VERIFIED live, H-01 corrigé (plus aucune écriture RLS directe sur `payments`)                   |
| Supabase/RLS      |                     8 | RLS 100%, storage buckets sensibles tous privés (VERIFIED cette session)                                                                    |
| Headers/TLS       |                     8 | CSP strict + nonce, HSTS/X-Frame-Options/Permissions-Policy tous corrects sur le domaine principal ; incohérence mineure sur l'apex (CF-03) |
| Origin protection |                     3 | Contournement confirmé et reproductible (CF-01)                                                                                             |

### **GLOBAL SECURITY SCORE : 66/100 → Moyen (60–69)** _(révisé de 64/100 le 2026-08-14, suite à la correction H-01 — voir note en tête de document)_

Ce score porte spécifiquement sur le **périmètre réseau/edge** — il ne remplace ni n'améliore le score de 75.5/100 de `FULL_PLATFORM_AUDIT_2026-08-13.md` (qui porte sur RLS/business logic/routes), il l'un complète l'autre. Le facteur qui tire ce score-ci vers le bas est désormais presque entièrement **CF-01** (origin bypass confirmé, toujours `NOT REMEDIATED` au 2026-08-14 — voir `docs/CF-01_POST_REMEDIATION_VERIFICATION_2026-08-13.md`) et l'incapacité méthodologique à confirmer la configuration Cloudflare réelle (CF-02) — deux problèmes rapides à corriger/vérifier (réglages de plateforme, pas de refonte).

---

## 21. Critical Findings

**Aucun finding CRITICAL nouveau trouvé dans cette session.** Le plus proche (CF-01) est classé HIGH et non CRITICAL car les routes dynamiques/API/paiement restent inatteignables via le chemin de contournement identifié (vérifié activement, pas supposé) — voir la nuance détaillée en §15.

---

## 22. High Findings

### CF-01 — Origin bypass confirmé via `nkdelivery.vercel.app`

Voir détail complet §15. **Priorité P1 — toujours ouvert au 2026-08-14** (voir `docs/CF-01_POST_REMEDIATION_VERIFICATION_2026-08-13.md` : `NOT REMEDIATED`, et `docs/CF-01_VERCEL_OWNER_INVESTIGATION_2026-08-13.md` pour l'identification du projet Vercel réel à corriger).

### ~~H-01 — `payments.status` modifiable directement par un admin sans trigger de validation~~ — RÉSOLU

Voir détail §14. **Corrigé** (commit `ecc9a65`, `supabase/migrations/20260813130000_fix_payments_rls_bypass.sql`). Ce rapport listait initialement ce finding comme "toujours ouvert" par erreur — corrigé le 2026-08-14, voir note en tête de document. Conservé ici, barré, pour la traçabilité de la correction plutôt que supprimé silencieusement.

---

## 23. Medium Findings

### CF-02 — Configuration WAF/Bot/rate limiting Cloudflare non vérifiable depuis cette session

**Recommandation** : export ou capture d'écran du dashboard Cloudflare (Security → WAF, Security → Bots, Security → Rate limiting rules) à joindre à une prochaine revue pour fermer ce point par une preuve directe plutôt qu'une déduction comportementale. **Priorité P2.**

### CF-04 — `/api/csp-report` sans rate limiting

**Recommandation** : appliquer `check_rate_limit_secure` (ou un simple compteur en mémoire/edge) par IP sur ce endpoint, cohérent avec le reste du projet. **Priorité P2.**

---

## 24. Low Findings

- **CF-03** — HSTS incomplet sur la réponse de redirection de l'apex (`nkdeliveri.com` sans `www`) : `max-age` seul, sans `includeSubDomains`/`preload`, alors que `www.nkdeliveri.com` a les trois. Impact réel limité (le HSTS de `www` couvre déjà le cas nominal après le premier chargement), mais incohérent. **Priorité P3.**
- **CF-05** — `GET` sur les routes webhook `POST`-only renvoie `200` (shell SPA) au lieu de `404`/`405`. Révèle l'existence de la route sans fuite de données (chemins déjà publics dans la doc d'intégration provider). **Priorité P3.**
- **CF-06** — Pas de `/.well-known/security.txt` (RFC 9116) pour faciliter un signalement responsable de vulnérabilité. **Priorité P3.**

---

## 25. Prioritized Remediation Roadmap

**Phase 0 (P1 — rapide, fort impact, pas de refonte)**

1. **CF-01** : toujours ouvert au 2026-08-14 (`NOT REMEDIATED` confirmé). Projet Vercel confirmé (`prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x`), recommandation (Deployment Protection) identifiée — **mais explicitement mise en pause par l'opérateur le 2026-08-14** : la fonctionnalité n'est pas disponible sur le plan Vercel actuel de l'équipe. Risque connu et accepté temporairement, pas oublié — voir `docs/CF-01_VERCEL_OWNER_INVESTIGATION_2026-08-13.md` §10 pour les voies alternatives non explorées (ticket support, upgrade de plan, renommage de projet).
2. ~~**H-01**~~ _(repris)_ : **RÉSOLU** — `DROP POLICY "payments admin update"`, commit `ecc9a65`, plus besoin d'action.

**Phase 1 (P2 — confirmation/config, pas de code)** 3. **CF-02** : auditer directement le dashboard Cloudflare (WAF managed rules, Bot Fight Mode, règles de rate limiting) et documenter l'état réel — transforme un NOT VERIFIED en VERIFIED dans un sens ou l'autre. 4. **CF-04** : ajouter un rate limit (IP ou fenêtre glissante) sur `/api/csp-report`. 5. Vérifier/poser un enregistrement DMARC (`_dmarc.nkdeliveri.com`), non couvert par cet audit.

**Phase 2 (P3 — cosmétique/best practice)** 6. **CF-03** : aligner le HSTS de la réponse de redirection apex sur celui de `www` (`includeSubDomains; preload`). 7. **CF-05** : ajouter des handlers `GET` explicites (405) sur les routes webhook `POST`-only. 8. **CF-06** : publier `/.well-known/security.txt`.

**Nettoyage de backlog** 9. **H-02** (`GLOBAL_AUDIT_360`) : marquer comme résolu/obsolète — le CSP existe réellement et est solide en production, cet audit en apporte la preuve live.

---

## 26. Réponses aux 14 questions de réussite

1. **NK Deliveri utilise-t-il Cloudflare actuellement ?** Oui — VERIFIED (nameservers, IPs anycast, `CF-RAY`, certificat edge, `robots.txt` Cloudflare-managed).
2. **Quelle partie du trafic passe réellement par Cloudflare ?** Le domaine officiel (`nkdeliveri.com`/`www`) et tout le wildcard `*.nkdeliveri.com` — **mais pas** le trafic dirigé vers `nkdelivery.vercel.app`, qui atteint Vercel directement (CF-01).
3. **Cloudflare protège-t-il réellement le domaine ou seulement le DNS ?** Le proxy HTTP est actif (pas DNS-only) — protection edge de base confirmée ; l'étendue exacte des protections additionnelles (WAF/bot/rate limiting) n'est pas vérifiable depuis cette session (CF-02).
4. **Le WAF est-il actif ?** NOT VERIFIED — aucune requête envoyée n'a déclenché de blocage Cloudflare distinct de l'application.
5. **Le rate limiting existe-t-il ?** Oui, au niveau applicatif sur les actions sensibles connues (VERIFIED code) ; au niveau edge Cloudflare, NOT VERIFIED ; un gap confirmé sur `/api/csp-report` (CF-04).
6. **Le DDoS est-il correctement couvert ?** Partiellement — protection réseau de base via Cloudflare pour le domaine officiel, mais contournable pour au moins un actif via CF-01.
7. **L'origine peut-elle être contournée ?** **Oui, confirmé** (CF-01), limité aujourd'hui à la page d'accueil, structurellement risqué.
8. **Quels endpoints sont les plus exposés ?** La page d'accueil via `nkdelivery.vercel.app` (CF-01), `/api/csp-report` (CF-04) — le reste de la surface publique est correctement gardé (signature webhook, `CRON_SECRET`, RLS).
9. **Un attaquant peut-il abuser des APIs ?** Marginalement, sur `/api/csp-report` uniquement (bruit, pas de fuite) — le reste suit la convention `_secure` avec revérification de rôle.
10. **Les paiements sont-ils correctement protégés ?** Oui — contre la forgerie externe (signature vérifiée, VERIFIED live) **et** contre un admin compromis (H-01 corrigé le 2026-08-13, commit `ecc9a65` — cette réponse était incorrecte dans la version initiale de cet audit, voir note en tête de document).
11. **Les données privées sont-elles correctement isolées ?** Oui — RLS 100%, buckets sensibles tous privés (VERIFIED cette session).
12. **Quelle est la probabilité qu'une attaque réussisse ?** Faible pour une compromission de données ; **modérée à confirmée** pour un contournement partiel de la couche Cloudflare (CF-01, déjà démontré, pas hypothétique).
13. **Quel serait son impact ?** Aujourd'hui limité (contenu déjà public) ; le vrai risque est l'absence de garantie que cette exposition reste bornée à la page d'accueil dans le temps.
14. **Quelles sont les corrections encore urgentes ?** _(H-01 retiré de cette liste le 2026-08-14 — déjà résolu)_
    1. CF-01 — toujours ouvert, voir `docs/CF-01_VERCEL_OWNER_INVESTIGATION_2026-08-13.md` pour l'action précise (P1).
    2. CF-02 — confirmer la configuration WAF/Bot/rate limiting réelle dans le dashboard Cloudflare (P2).
    3. CF-04 — rate limit sur `/api/csp-report` (P2).
    4. Clore H-02 dans le suivi (CSP déjà résolu, preuve live disponible) pour ne pas polluer la prochaine roadmap avec un faux problème.
    5. CF-03/CF-05/CF-06 — cosmétique, P3 (§24).

---

_Fin de l'audit. Aucune modification n'a été apportée au code, à la configuration Cloudflare/Vercel/Supabase, au DNS, ni à aucune donnée pendant sa réalisation. Toutes les requêtes envoyées étaient des GET/HEAD non authentifiés ou des POST non signés à volume unitaire — aucun flood, aucun brute-force réel, aucune exploitation destructive. Toute correction listée ci-dessus attend une autorisation explicite avant implémentation, conformément à la consigne "aucune remédiation pendant cet audit"._
