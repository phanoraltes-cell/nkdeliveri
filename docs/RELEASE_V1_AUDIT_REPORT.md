# NK Deliveri — Rapport d'Audit Complet — Préparation Release v1.0

**Date de l'audit** : 2026-08-01
**Portée** : code du working tree (`main`, incluant les chantiers non commités : Finance Dashboard, suite E2E) + base de données de production live (`dcsnmvbtsmdbwrwbutph`, us-east-2, Postgres 17.6) interrogée en lecture seule.
**Méthode** : vérification directe (grep, requêtes SQL en lecture seule sur la base live, `supabase --experimental backups list`, lecture de fichiers) — aucune donnée n'est estimée ou extrapolée sans le dire explicitement. Les 3 rapports d'audit précédents de cette session (`FINANCE_DASHBOARD_AUDIT_REPORT.md`, `MONCASH_ACTIVATION_PHASE2_AUDIT.md`, `E2E_TEST_REPORT.md`) sont réutilisés et cités, pas re-fabriqués.
**Statut de ce document** : audit + vérification uniquement. **Aucun commit, push, application de migration ou déploiement n'a été effectué.** Voir § 12 pour ce qui reste à valider avant le "Seulement lorsque tout est validé".

---

## Résumé exécutif

NK Deliveri est une application de livraison de repas fonctionnellement complète (client/restaurant/livreur/admin), construite sur TanStack Start + React 19 + Supabase, en production depuis début juillet 2026 (356 commits, ~1 mois de développement intensif, dernier commit 2026-07-31). L'architecture est cohérente et le niveau d'ingénierie est élevé : RLS partout, fonctions `SECURITY DEFINER` avec vérification de rôle interne systématique, migrations append-only, séparation `.server.ts` stricte, PWA complète, SEO propre, 0 `TODO`/`FIXME`/`console.log` trouvés dans tout le code.

**Aucun problème Critique n'a été trouvé.** Deux problèmes **Élevés** empêchent un "Production Ready" sans réserve : (1) **absence de sauvegarde automatique et de PITR** sur la base de données de production — confirmé en direct, `pitr_enabled: false`, `backups: []` ; (2) le **flag `payment_providers.moncash_api.is_active`**, présenté dans les phases précédentes comme le verrou d'activation MonCash, **ne contrôle en réalité rien côté client** — seule la présence des 5 variables d'environnement `MONCASH_*` active le flux (déjà documenté dans `MONCASH_ACTIVATION_PHASE2_AUDIT.md`, reconfirmé ici). Le reste des constats est Moyen/Faible — hygiène de privilèges Postgres, adoption partielle du moteur de notifications, un bug de contraste WCAG connu, deux incohérences mineures de garde de rôle. Aucun ne bloque une mise en production, mais tous méritent une décision explicite avant le Go-Live.

**Verdict global : PRÊT POUR LA PRODUCTION avec réserves** — sous condition de traiter au minimum les 2 points Élevés (§ 6, § 9) avant le Go-Live, et d'acter une décision consciente sur chaque point Moyen listé en § 12.

---

## 1. Frontend

**Source** : audit direct + agent "routes/pages/roles/PWA/SEO/responsive/a11y".

- 68 fichiers de route, tous `createFileRoute()`, aucun stub/placeholder/"coming soon".
- 4 familles de dashboard (customer/restaurant/driver/admin) + 3 pages semi-publiques (checkout/orders/profile) + 8 pages publiques indexables + 3 pages d'auth + 3 endpoints serveur (2 webhooks MonCash + 1 cron).
- Aucun lien de navigation mort, aucune route orpheline sauf une (voir § 12, non bloquant).
- **Score : 95/100.** (-5 pour les 2 incohérences de garde listées en § 12.)

## 2. Backend

**Source** : agent "backend Supabase health".

- 100% de la logique serveur passe par des fonctions serveur TanStack Start `.server.ts` (jamais importées statiquement dans une route) ou des RPC Postgres — **zéro Supabase Edge Function** dans le projet, cohérent et documenté.
- Convention respectée partout : mutation → RPC `SECURITY DEFINER` + vérification de rôle interne (`private.has_role()` / propriété) + `REVOKE`/`GRANT` explicites.
- **Score : 92/100.** (-8 pour le pattern systémique de grant `anon`, § 6.)

## 3. Supabase (infra, buckets, config)

- **8 buckets de storage**, tous confirmés en direct avec `allowed_mime_types` et `file_size_limit` cohérents avec leur usage (ex. `payment-proofs` : 8 Mo, images + PDF, privé ; `avatars` : 3 Mo, images seules, public) :

| Bucket                   | Public | Limite | Types                   |
| ------------------------ | ------ | ------ | ----------------------- |
| `avatars`                | oui    | 3 Mo   | jpeg/png/webp/heic/heif |
| `restaurant-assets`      | oui    | 5 Mo   | jpeg/png/webp/heic/heif |
| `menu-photos`            | oui    | 5 Mo   | jpeg/png/webp/heic/heif |
| `driver-documents`       | non    | 8 Mo   | + pdf                   |
| `dispute-attachments`    | non    | 8 Mo   | + pdf                   |
| `payout-proofs`          | non    | 8 Mo   | + pdf                   |
| `payment-proofs`         | non    | 8 Mo   | + pdf                   |
| `order-chat-attachments` | non    | 8 Mo   | jpeg/png/webp/heic/heif |

- **113 migrations** appliquées en séquence append-only, dont 12 migrations correctives (fix/patch) — deux incidents notables dans l'historique déjà corrigés (grant EXECUTE manquant sur `order_chat_author_role`, ambiguïté `restaurant_id` dans le moteur de commission), tous deux avec un commit `fix(...)` dédié, pas de réécriture d'historique.
- **1 migration en attente, non appliquée à la production** : `20260731140000_admin_finance_dashboard_rpcs.sql` (Finance Dashboard, chantier de cette session, jamais commité — voir § 12).
- **Aucune Edge Function** — confirmé par `Glob supabase/functions/**` vide.
- **Score : 90/100.** (-10 pour l'absence de sauvegarde/PITR, § 9 — c'est une lacune d'infrastructure, pas de code.)

## 4. SQL / RPC

- **94 fonctions `SECURITY DEFINER`** dans le schéma `public`, comptées en direct (`pg_proc` × `prosecdef`).
- Sur ces 94 : **80 (85%) sont exécutables par le rôle `anon`**, **85 (90%) par `authenticated`** — confirmé par requête directe (`has_function_privilege`). Analyse complète en § 6.
- Seules 14 fonctions sont correctement verrouillées (`REVOKE EXECUTE FROM anon` explicite) : essentiellement les RPC de paiement/décaissement les plus sensibles (`create_collect_payment_secure`, `complete_pending_payout_secure`, `fail_pending_payout_secure`, etc.), les triggers internes (`handle_new_user`, `protect_*_commission`), et les RPC de session (`get_my_active_sessions_secure`, `revoke_my_session_secure`).
- Bug réel trouvé et corrigé pendant cette session (Finance Dashboard, non encore appliqué en prod) : `ORDER BY event_time ASC` sur un `UNION ALL` brut échoue silencieusement en Postgres — corrigé en `ORDER BY 2 ASC` (référence positionnelle), validé par script transactionnel `BEGIN...ROLLBACK` contre des données réelles.
- **Score : 88/100.** (-12 pour le grant `anon` systémique — mitigé mais pas éliminé, voir § 6.)

## 5. RLS (Row-Level Security)

- **65 policies** au total (comptage confirmé par l'agent backend), spot-check direct de 6 policies sur les 3 tables les plus sensibles (`restaurants`, `profiles`, `user_roles`) :

| Table         | Policy                               | Cmd    | Rôle déclaré      | Verdict                                                                                                                                 |
| ------------- | ------------------------------------ | ------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`    | Users insert own profile             | INSERT | `{public}`        | Fonctionnellement sûr — `with_check: auth.uid() = id`, `auth.uid()` est `NULL` pour `anon`, donc toujours faux pour un visiteur anonyme |
| `profiles`    | Users update own profile             | UPDATE | `{public}`        | Idem — `auth.uid() = id`                                                                                                                |
| `profiles`    | Users view own profile               | SELECT | `{authenticated}` | Correct, pas de flag                                                                                                                    |
| `restaurants` | Admin deletes restaurant             | DELETE | `{public}`        | Fonctionnellement sûr — `has_role()` retourne explicitement `false` si `auth.uid() IS NULL` (code source vérifié, § ci-dessous)         |
| `restaurants` | Approved restaurants viewable by all | SELECT | `{public}`        | Intentionnel — lecture publique des restaurants approuvés                                                                               |
| `user_roles`  | Admins manage roles                  | ALL    | `{public}`        | Fonctionnellement sûr, même raison                                                                                                      |
| `user_roles`  | Users can view own roles             | SELECT | `{public}`        | Fonctionnellement sûr, même raison                                                                                                      |

Fonction `has_role()` vérifiée en lisant sa définition live :

```sql
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) ...
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  ...
END;
```

**Conclusion : les 4 policies portant `TO public` au lieu de `TO authenticated` ne sont PAS des vulnérabilités exploitables** — elles sont protégées par une garde `NULL`-safe. C'est une question d'hygiène/best-practice Postgres (le linter Supabase le signale généralement), pas un trou de sécurité réel. Recommandation Faible : passer ces 4 policies à `TO authenticated` pour ne plus dépendre implicitement de la sémantique `NULL`, en défense en profondeur contre une future modification de `has_role()` qui casserait cette garantie silencieusement.

- **Score : 94/100.**

## 6. Sécurité

**Score global : 87/100.** Détail des constats classés par sévérité — voir aussi § 4/5 ci-dessus pour le détail technique.

### 🟠 Élevé

**H-1 — Le flag `payment_providers.moncash_api.is_active` ne protège pas ce qu'on croit.**
Déjà découvert et documenté en détail dans `docs/MONCASH_ACTIVATION_PHASE2_AUDIT.md` (§ "Constat prioritaire"), reconfirmé ici : le flux MonCash Collect côté client n'est gardé que par `moncashProvider.isConfigured()` (présence des 5 variables d'environnement `MONCASH_*`), pas par le flag nommé que l'utilisateur avait explicitement demandé de protéger ("Ne jamais activer... sans validation explicite"). Ajouter la 5ème variable + redéployer suffit à activer le paiement réel pour de vrais clients, indépendamment du flag. **Action requise avant Go-Live** : soit faire du flag le verrou réel (le faire vérifier par `isConfigured()`), soit documenter noir sur blanc que le vrai verrou est la présence des secrets Vercel — actuellement personne ne peut se fier au nom du flag pour juger si MonCash est "vivant".

### 🟡 Moyen

**M-1 — Grant `EXECUTE` à `anon` sur 80/94 fonctions `SECURITY DEFINER` (85%).**
Cause racine : `ALTER DEFAULT PRIVILEGES` sur ce projet Supabase accorde `EXECUTE` à `anon`/`authenticated` par défaut à la création de toute fonction, et `REVOKE ALL ... FROM PUBLIC` ne retire **pas** un grant fait nommément à un rôle — seul un `REVOKE EXECUTE ... FROM anon` explicite le fait. En pratique, chaque fonction concernée fait sa propre vérification interne (`private.has_role()`, comparaison de propriété), donc **aucune n'est exploitable en l'état** (spot-check du code de plusieurs fonctions à haut risque confirmé lors des audits précédents). Mais la posture actuelle repose à 100% sur la justesse du corps de chaque fonction, sans deuxième barrière au niveau privilège DB — un seul bug de logique dans une fonction anon-exécutable future serait immédiatement exploitable sans qu'aucune couche RLS/GRANT ne l'arrête. Remédiation proposée (migration à écrire, **pas appliquée**) : `REVOKE EXECUTE ON FUNCTION ... FROM anon` sur les fonctions qui n'ont légitimement aucune raison d'être appelées par un visiteur non authentifié (tout sauf les RPC publiques volontaires comme `get_active_placements_secure`, `check_auth_rate_limit_secure`).

**M-2 — Adoption partielle du moteur de notifications (`private.notify_secure`).**
12 sites d'appel dans 5 fichiers utilisent le moteur (préférences opt-out, catégorisation) ; **32 `INSERT INTO notifications` bruts subsistent dans 16 fichiers**, dont deux migrations _postérieures_ au lancement du moteur (`customer_order_cancellation.sql`, `moncash_webhook_payout_lifecycle.sql`) — pas seulement de la dette historique, de l'adoption incohérente en continu. Impact : les utilisateurs concernés par ces 32 sites ne bénéficient pas des préférences de notification (opt-out) qu'ils ont pourtant la possibilité de configurer dans leur profil — une incohérence fonctionnelle silencieuse, pas une brèche de sécurité.

**M-3 — Dashboards MonCash et Finance sans alerting temps réel.**
Seul le dashboard admin principal utilise un vrai canal Supabase Realtime. Les dashboards MonCash (`dashboard.admin.moncash.tsx`) et Finance (`dashboard.admin.finance.tsx`) sont en `refetch-on-mount/focus` uniquement (`staleTime: 60_000`, pas de `refetchInterval`) — un incident MonCash (paiements bloqués, webhook manquant) ne remonte visuellement que si un admin ouvre la page, pas en push. Les 4 conditions d'alerte existent bien dans le code (erreurs consécutives, webhook manquant, paiement bloqué, taux d'échec anormal) mais ne sont visibles qu'à la demande.

### 🟢 Faible

**L-1** — 4 policies RLS portant `TO public` au lieu de `TO authenticated` (§ 5) — fonctionnellement sûres, hygiène seulement.
**L-2** — Bug de contraste WCAG AA confirmé dans `SiteFooter` (§ 7).
**L-3** — `dashboard.customer.tsx` est la seule famille de dashboard sans `requireRole()` explicite — bas risque (RLS reste la vraie barrière), incohérence de style avec les 3 autres familles.
**L-4** — Garde d'authentification incohérente entre `/orders/$id` (redirection serveur stricte) et `/checkout`, `/orders`, `/profile` (garde côté client, affichage conditionnel) — fonctionnellement correct (RLS protège les données dans tous les cas) mais mérite une note expliquant pourquoi une seule route a un traitement différent.

Aucun secret en clair trouvé dans le code, aucune clé committée (`.env.local`/`.env.e2e` correctement gitignorés), aucune injection SQL (paramétrage systématique via RPC), aucune faille XSS évidente (React échappe par défaut, pas de `dangerouslySetInnerHTML` détecté hors composants contrôlés).

## 7. Accessibilité (WCAG 2A/AA)

- Densité de code : 117 `aria-label`, 144 attributs `aria-*` au total, 5 `role=` manuels (les composants Radix/shadcn portent déjà les rôles ARIA corrects, donc un faible compte de `role=` manuel n'est pas un signal négatif).
- **100% des balises `<img>` du projet (22 occurrences, 17 fichiers) ont un `alt` explicite** — descriptif ou `alt=""` correctement utilisé pour le décoratif.
- **1 bug réel confirmé** (trouvé pendant la construction de la suite E2E, `axe-core`, jamais corrigé — volontairement laissé rouge et documenté) : `src/components/site-footer.tsx` lignes 69/83/98/112, classe `text-white/70` sur fond `bg-brand` (#F97316) pour les libellés de section ("Lyen itil", "Sipò", etc.) — ratio de contraste mesuré entre **2.06:1 et 3.79:1**, WCAG AA exige **4.5:1**. Confirmé sur `/restaurants` et `/checkout`, pied de page partagé donc présent sur la majorité des pages publiques.
- **Score : 88/100.** (-12 pour L-2, qui touche une portion significative des pages du fait du partage du composant.)

## 8. Responsive

- Mécanisme systématique confirmé, pas cosmétique : `DataTable` (`src/components/dashboard/tables/data-table.tsx`) rend un vrai `<table>` en `md:block` et une liste de cartes empilées en `md:hidden`, à partir des mêmes données — utilisé par la majorité des pages de liste admin/restaurant/livreur.
- Grilles KPI en vrai reflow par breakpoint (`sm:grid-cols-2 lg:grid-cols-5`), pas de classes copiées-collées sans effet.
- Kanban restaurant : scroll horizontal tactile (`touch-pan-x`) plutôt qu'un switch caché/visible — stratégie différente mais valide pour ce type d'UI.
- Aucun hook `useMediaQuery`/`useIsMobile` — tout est en CSS pur, cohérent et vérifié comme réellement utilisé (pas décoratif).
- **Score : 96/100.**

## 9. PWA

- Manifest complet (`public/manifest.webmanifest`) : nom, icônes (192/512/512-maskable), `display: standalone`, `lang: "ht"`, 2 raccourcis.
- Service worker `src/sw.ts` hand-rolled (`injectManifest`) : precache + `NetworkFirst` (navigation, 5s timeout) + `CacheFirst` (assets statiques) + fallback `offline.html` + gestion push complète (clic → focus/ouverture fenêtre, suppression de doublon si l'onglet est déjà sur la page cible).
- Prompt d'installation cross-plateforme (`install-prompt.tsx`) : Android/desktop natif (`beforeinstallprompt`), iOS/iPadOS instructions manuelles, cooldown 14 jours, permission push différée après installation réelle.
- **Aucune lacune trouvée côté application PWA elle-même.**
- **🟠 Mais côté infrastructure de sauvegarde, confirmé en direct** (`supabase --experimental backups list --project-ref dcsnmvbtsmdbwrwbutph`) :
  ```json
  { "pitr_enabled": false, "backups": [] }
  ```
  **Aucun PITR, aucune sauvegarde automatique gérée par Supabase n'existe actuellement sur le projet de production.** Un script manuel (`scripts/backup-database.sh`, `npm run db:backup`) existe et fonctionne (`supabase db dump`), mais rien ne l'exécute automatiquement — c'est une action humaine à déclencher, jamais planifiée. C'est le point Élevé le plus urgent de cet audit (voir § 19 et `BACKUP_CHECKLIST.md`).
- **Score PWA applicatif : 97/100** — noté séparément de la lacune de sauvegarde qui est infrastructure, pas code PWA (déjà comptée en § 3).

## 10. SEO

- 8 pages publiques avec `pageMeta()` (title/description/OG/Twitter/canonical/`robots: index,follow`), 9+ pages privées avec `noIndexMeta()`, héritage correct de `noIndexMeta` depuis `_authenticated/route.tsx` pour tout `/dashboard/*`.
- `robots.txt` et `sitemap.xml` cohérents (sitemap dynamique interroge `restaurants` en direct, dégrade proprement sur erreur DB plutôt que de planter).
- Scores Lighthouse réels mesurés (E2E, `docs/E2E_TEST_REPORT.md`) : Accueil SEO 100/100, Liste restaurants SEO 100/100.
- **Aucune lacune de classification indexable/privée trouvée** (audit exhaustif des 68 routes).
- **Score : 96/100.**

## 11. Performance

- Scores Lighthouse réels (environnement de test local, non représentatif de l'hébergement Vercel réel — voir note ci-dessous) : Best Practices 92 (accueil), 92 (restaurants), 100 (dashboard client).
- `performance` volontairement non mesuré comme un score bloquant par la suite E2E : Lighthouse simule un réseau mobile throttlé contre un serveur Node nu local (pas de CDN, pas de HTTP/2, pas de cache edge) — non représentatif de la production Vercel réelle. Un audit Lighthouse **contre l'URL de production** (`www.nkdeliveri.com`) n'a pas été fait dans le cadre de cette session et est recommandé comme action de suivi.
- Optimisations déjà en place, confirmées par l'historique de commits : pagination de l'historique client, correction du LCP homepage, liste des livreurs déplacée vers Realtime plutôt que polling (`baf5067`), extraction de la logique de fetch hors des 3 plus grosses routes admin (`1cd97bb`).
- `staleTime: 30_000` par défaut sur le QueryClient global, Realtime réservé aux données réellement volatiles (commandes, livraisons, position, notifications) — choix documenté dans le code, pas un oubli.
- **Score : 90/100** (réserve sur l'absence de mesure Lighthouse en conditions de production réelles).

## 12. Monitoring

- 3 dashboards de monitoring existent (admin principal, MonCash, Finance) — voir § 6/M-3 pour la nuance push vs. polling.
- Aucun outil de monitoring externe (Sentry, Datadog, etc.) configuré au-delà des dépendances `@sentry/node`/`@sentry/react` présentes dans `package.json` — **à vérifier si un DSN Sentry est réellement configuré en production** (non confirmé dans cet audit ; si absent, les erreurs runtime en production ne sont observables que via les logs Vercel).
- **Score : 78/100** — dépendances de monitoring présentes mais configuration/activation non confirmée, alerting non temps réel sur 2 des 3 dashboards.

## 13. Cron

- **1 seul job cron existe** : `api/cron/moncash-reconcile`, `vercel.json` → `0 3 * * *` (quotidien, limite du plan Vercel Hobby).
- Sécurisé par `CRON_SECRET` en bearer auth, 401 si absent/incorrect, 500 si `CRON_SECRET` n'est pas configuré.
- **Actuellement inerte par conception** : le code lui-même documente qu'aucun payout `provider_code='moncash_api'` ne peut être `pending` tant que le décaissement MonCash n'est pas activé (distinct de Collect, déjà en production).
- **Score : 96/100.**

## 14. MonCash

Couvert en détail dans `docs/MONCASH_ACTIVATION_PHASE2_AUDIT.md` et `docs/MONCASH_COLLECT_GO_LIVE_REPORT.md` — synthèse ici, pas de duplication :

- **Collect (client → plateforme)** : en production, migration appliquée, 47/47 tests passés au go-live, secrets Vercel Production configurés (4 sur 5 ajoutés par un tiers avant cette session, confirmé).
- **Décaissement (plateforme → restaurant/livreur)** : code prêt (`create_pending_payout_secure`, `complete_pending_payout_secure`, `fail_pending_payout_secure`, cron de réconciliation), mais **non activé** — cohérent avec le cron actuellement inerte (§ 13).
- Voir H-1 (§ 6) pour la réserve sur le véritable verrou d'activation.
- **Score : 90/100** (réserve H-1).

## 15. Notifications

- Moteur central (`private.notify_secure`) existant et fonctionnel, `notification_preferences` par utilisateur, `notifications.category` avec 7 catégories (`order`/`delivery`/`payment`/`commission`/`promotion`/`dispute`/`system`).
- 8 fichiers `send-*-push.functions.ts` (order, order-status, promotion, employee, dispute, payout, refund, order-chat) — convention "chaque fonctionnalité utilisant `notify_secure` a son propre envoi push" respectée à 100%.
- Voir M-2 (§ 6) pour la réserve d'adoption partielle du moteur.
- **Score : 85/100** (réserve M-2).

## 16. GPS

- **Complet et en production.** `customer_delivery_locations` (RLS, `REPLICA IDENTITY FULL`, publication Realtime), `push_customer_location_secure`/`stop_customer_location_sharing_secure` pour le client (RPC obligatoire car RLS seule ne peut pas restreindre l'écriture à `lat/lng/accuracy` sur une table partagée), écriture directe via RLS pour le livreur (suffisant, RLS protège déjà ses propres lignes).
- Nettoyage confirmé sur triggers de statut de livraison **et** sur annulation client (`DELETE FROM customer_delivery_locations` explicite dans `update_order_status_secure`) — un gap identifié lors d'un audit pré-déploiement antérieur, déjà corrigé.
- **Score : 98/100.**

## 17. Chat

- **Complet et en production**, y compris pièces jointes image (bucket `order-chat-attachments`) et partage de position (lien Google Maps généré depuis `navigator.geolocation`).
- Indicateur de saisie en temps réel (broadcast Supabase), masquage de conversation côté utilisateur — au-delà du périmètre initialement demandé.
- Correctif de grant déjà appliqué en historique (`5c245fd fix(chat): grant EXECUTE on order_chat_author_role to authenticated`).
- **Score : 97/100.**

---

## Tableau récapitulatif des scores

| Dimension     | Score        |
| ------------- | ------------ |
| Frontend      | 95/100       |
| Backend       | 92/100       |
| Supabase      | 90/100       |
| SQL / RPC     | 88/100       |
| RLS           | 94/100       |
| Sécurité      | 87/100       |
| Accessibilité | 88/100       |
| Responsive    | 96/100       |
| PWA           | 97/100       |
| SEO           | 96/100       |
| Performance   | 90/100       |
| Monitoring    | 78/100       |
| Cron          | 96/100       |
| MonCash       | 90/100       |
| Notifications | 85/100       |
| GPS           | 98/100       |
| Chat          | 97/100       |
| **Moyenne**   | **91.4/100** |

**Problèmes restants : 0 Critique, 1 Élevé bloquant réel (H-1 déjà mitigé par posture actuelle "pas de décaissement live"), 1 Élevé infrastructure (sauvegarde/PITR), 3 Moyens, 4 Faibles.** Voir § 19 pour la liste consolidée des décisions à prendre avant Go-Live.

---

## 18. Vérification exhaustive demandée

| Élément                   | Résultat                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Tous les `TODO`           | **0 trouvé** dans `src/`, `supabase/`                                                                  |
| Tous les `FIXME`          | **0 trouvé**                                                                                           |
| Tous les `console.log`    | **0 trouvé** (convention `console.warn`/`console.error` uniquement respectée partout)                  |
| Toutes les routes         | **68/68** inventoriées, aucun stub (§ 1)                                                               |
| Toutes les pages          | Couvertes par l'inventaire de routes ci-dessus                                                         |
| Tous les rôles            | 4 rôles dashboard + garde de rôle vérifiée route par route (§ 1, § 12 pour les 2 incohérences)         |
| Tous les dashboards       | 4 familles + 3 sous-dashboards admin spécialisés (finance/moncash/principal) tous audités              |
| Toutes les migrations     | **113 appliquées**, **1 en attente** (`20260731140000_admin_finance_dashboard_rpcs.sql`, non commitée) |
| Toutes les policies       | **65 policies RLS**, spot-check des 3 tables les plus sensibles fait en direct (§ 5)                   |
| Tous les buckets          | **8/8** inventoriés avec config MIME/taille (§ 3)                                                      |
| Toutes les fonctions Edge | **0** — confirmé, zéro Edge Function dans ce projet (architecture 100% RPC + `.server.ts`)             |

---

## Constats reportés depuis les audits précédents de cette session (non dupliqués, référencés)

- **Finance Dashboard** (`docs/FINANCE_DASHBOARD_AUDIT_REPORT.md`) : implémenté, testé en transactionnel, **jamais commité, migration jamais appliquée en prod** — reste un chantier ouvert, voir § 19.
- **Activation MonCash Phase 2** (`docs/MONCASH_ACTIVATION_PHASE2_AUDIT.md`) : voir H-1 ci-dessus, reste la découverte la plus importante de tout l'audit release v1.0.
- **Suite E2E** (`docs/E2E_TEST_REPORT.md`) : 3 bugs WCAG réels trouvés (L-2 ci-dessus), suite jamais commitée.

---

## 19. Décisions requises avant validation ("Seulement lorsque tout est validé")

Ce mandat impose explicitement de ne rien commit/push/déployer avant validation. Voici, dans l'ordre de priorité, chaque décision qui doit être prise par l'utilisateur avant de déclencher cette étape — aucune n'a été tranchée unilatéralement pendant cet audit.

1. **[Élevé] Sauvegarde/PITR absents en production.** Décision : activer le PITR Supabase (changement de plan payant probable) et/ou planifier `scripts/backup-database.sh` via un cron externe (le cron applicatif est déjà saturé à 1 job/jour sur le plan Vercel Hobby, donc probablement un cron GitHub Actions ou un service tiers). Voir `BACKUP_CHECKLIST.md`.
2. **[Élevé] Sémantique du flag `moncash_api.is_active` (H-1).** Décision : le faire correspondre à la réalité (le faire lire par `isConfigured()`) ou documenter formellement que le vrai verrou est la présence des secrets Vercel. Impacte directement la sécurité opérationnelle de l'activation du décaissement MonCash.
3. **[Moyen] Migration Finance Dashboard non appliquée.** Décision : l'appliquer maintenant (migration déjà écrite et validée en transactionnel, `20260731140000_admin_finance_dashboard_rpcs.sql`) ou la laisser hors du périmètre de la v1.0.
4. **[Moyen] Grant `anon` systémique sur 80 fonctions (M-1).** Décision : accepter le risque résiduel documenté (mitigé par les vérifications internes) pour la v1.0, ou traiter une migration de remédiation (`REVOKE EXECUTE ... FROM anon` sur les fonctions concernées) avant Go-Live — nécessite de qualifier fonction par fonction lesquelles doivent rester publiques.
5. **[Moyen] Adoption partielle du moteur de notifications (M-2).** Décision : migrer les 32 sites d'insertion brute restants vers `notify_secure` maintenant, ou accepter l'incohérence fonctionnelle (préférences opt-out non respectées sur ces flux) pour la v1.0.
6. **[Faible] Bug de contraste WCAG `SiteFooter` (L-2).** Décision : corriger avant ou après le Go-Live (pas bloquant fonctionnellement, mais c'est un vrai defect WCAG AA confirmé).
7. **[Faible] 4 policies RLS `TO public` (L-1), garde de rôle `dashboard.customer.tsx` (L-3), incohérence de garde `/orders/$id` (L-4).** Décision : traiter en nettoyage post-v1.0 ou avant — aucun n'est exploitable en l'état.
8. **Consolidation documentaire** : 52 fichiers dans `docs/`, dont 30 relatifs à MonCash seul — une passe de consolidation (regrouper les rapports d'étape en un historique, garder les documents de référence à jour) est recommandée mais n'a pas été faite dans cet audit (hors périmètre : audit, pas réorganisation).

Une fois ces points explicitement tranchés par l'utilisateur, l'étape suivante ("Préparer, Commit, Push, Déploiement, Documentation finale") peut être engagée.
