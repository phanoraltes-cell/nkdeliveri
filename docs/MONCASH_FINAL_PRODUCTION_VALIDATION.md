# Validation finale avant mise en production — Module MonCash

Rapport d'audit final (Phases 1-12). Chaque affirmation ci-dessous a été
vérifiée directement le 2026-07-31 (commandes réelles contre Git,
Supabase, Vercel — pas une réutilisation de conclusions antérieures).
Là où une vérification était impossible, c'est indiqué explicitement,
jamais deviné. Sert aussi de rapports #2-12 : chaque section, quand elle
recoupe un document déjà écrit (audit précédent, sécurité webhook,
résilience, performance), pointe vers ce document plutôt que de le
recopier — le contenu neuf de cette passe (état de déploiement réel,
comptage live des notifications, workflow Cash) est détaillé en entier.

## Résumé — statut par catégorie

| Catégorie                                      | Statut                                                                                           | Détail                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Migrations                                     | ❌ KO (attendu)                                                                                  | 4 migrations non appliquées, ordre confirmé — § Phase 1                                   |
| Edge Functions / fonctions serveur             | ⚠️ KO — **rien de nouveau déployé**                                                              | Tout le code de durcissement (Phases 3-10 précédentes) n'a jamais été commité — § Phase 2 |
| Cron                                           | ❌ KO — **n'existe pas en production**                                                           | `404` confirmé en direct sur l'URL live — § Phase 3                                       |
| Variables d'environnement                      | ✅ OK (pour ce qui existe) / ⚠️ 1 variable demandée n'existe pas dans ce projet                  | § Phase 4                                                                                 |
| Webhooks                                       | ✅ OK (déployé, fonctionnel) mais version **sans** les durcissements de la session précédente    | § Phase 5                                                                                 |
| Sécurité                                       | ⚠️ 1 constat déjà connu (R1, correctif écrit mais non appliqué)                                  | § Phase 6                                                                                 |
| Dashboard                                      | ⚠️ Version basique déployée (200 OK) ; version étendue (KPI/alertes) non déployée                | § Phase 7                                                                                 |
| Workflows (MonCash auto/manuel, NatCash, Cash) | ✅ Manuel/NatCash/Cash inchangés et actifs ; MonCash Automatik toujours inerte par construction  | § Phase 8                                                                                 |
| Notifications                                  | ⚠️ Le moteur `notify_secure` n'est **pas** utilisé partout — constat précis, pas une supposition | § Phase 9                                                                                 |
| Performance                                    | ✅ Conception vérifiée, aucune régression possible à mesurer (0 trafic réel)                     | § Phase 10                                                                                |
| Résilience                                     | ✅ 32/32 tests automatisés repassés avec succès à l'instant                                      | § Phase 11                                                                                |

**Verdict global : le code est prêt (testé, documenté, sans régression
détectée) mais rien de la session de durcissement précédente n'est
encore déployé.** C'est la seule vraie action bloquante avant mise en
production — voir la Checklist (livrable #13) pour la marche à suivre.

---

## Phase 1 — Migrations

### Comparaison demandée

| Source                                                                       | État vérifié                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Migrations locales (`supabase/migrations/`)                                  | 111 fichiers, le plus récent : `20260731100000_revoke_anon_create_pending_payout.sql` |
| Migrations appliquées sur Supabase (`supabase_migrations.schema_migrations`) | La plus récente en date MonCash : `20260730100000` uniquement                         |
| Branche Git locale (`main`)                                                  | `HEAD = dc780ea`                                                                      |
| Branche distante (`origin/main`)                                             | `dc780ea` — **identique**, aucune divergence                                          |

### Migrations manquantes (non appliquées), ordre et impact

Identique au constat de l'audit précédent, reconfirmé par requête directe
à l'instant :

1. `20260730110000_log_payment_provider_error.sql`
2. `20260730120000_moncash_provider_notifications.sql` (dépend de #1 — `DROP FUNCTION` sur une signature à 6 arguments qui n'existe que si #1 a tourné)
3. `20260730130000_moncash_financial_audit_log.sql`
4. `20260731100000_revoke_anon_create_pending_payout.sql` (nouvelle depuis la dernière session — correctif R1, additive, aucune dépendance)

Détail complet (impact/validation/rollback par migration) déjà produit
et inchangé : [MONCASH_PRODUCTION_READINESS_AUDIT.md § 4](./MONCASH_PRODUCTION_READINESS_AUDIT.md).

**Confirmation : aucune migration ne manque à l'appel** — les 4 fichiers
ci-dessus sont les seuls écarts entre `main` et la base live ;
`check-migration-hazards.mjs` (111 migrations scannées) ne rapporte
aucun hasard non résolu.

---

## Phase 2 — Edge Functions / fonctions serveur

**Terminologie** : ce projet n'a aucune Supabase Edge Function
(`supabase/functions/` n'existe pas — reconfirmé). Tout le serveur passe
par des fonctions TanStack Start déployées comme fonctions Vercel — ce
que cette phase vérifie en pratique.

### Constat central de cette phase

**Aucun fichier de la session de durcissement précédente n'a été commité
ni poussé.** `git log --oneline -1` = `dc780ea`, le commit de la
campagne de tests — pas le durcissement. Vérifié en direct par appel
HTTP réel sur le domaine de production :

| Endpoint                                                    | Résultat réel | Interprétation                                                                                                                                                                                          |
| ----------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST https://www.nkdeliveri.com/api/webhooks/moncash`      | `401`         | Existe et fonctionne (rejette une requête non signée, comportement correct) — **version déployée avant la session de durcissement**, donc sans le trigger d'immutabilité ni les dernières notifications |
| `GET https://www.nkdeliveri.com/api/cron/moncash-reconcile` | `404`         | **N'existe pas en production** — le code n'a jamais été déployé                                                                                                                                         |
| `GET https://www.nkdeliveri.com/dashboard/admin/moncash`    | `200`         | Existe — **version de base** (statut/historique/erreurs), sans les KPI/alertes ajoutés la session précédente                                                                                            |

Permissions/secrets pour ce qui est réellement déployé : voir Phase 4/6
ci-dessous, inchangés. Logs : `moncash_api_logs` n'existe pas en
production (migration non appliquée) — impossible de vérifier des logs
qui n'ont nulle part où s'écrire aujourd'hui, indiqué clairement plutôt
que supposé.

---

## Phase 3 — Cron

| Point demandé                                | Résultat                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fréquence configurée (code local)            | `*/5 * * * *` dans `vercel.json`                                                                                                                                                          |
| Endpoint                                     | `/api/cron/moncash-reconcile`                                                                                                                                                             |
| Authentification                             | `Authorization: Bearer <CRON_SECRET>`, vérifié dans le handler                                                                                                                            |
| Timeout                                      | Hérite du timeout de fonction Vercel par défaut — aucune limite explicite fixée dans le code ; à confirmer contre le plan Vercel réel (non vérifiable sans y accéder)                     |
| **Sera-t-il exécuté toutes les 5 minutes ?** | **Non — impossible aujourd'hui.** `vercel.json` n'est pas sur `origin/main` (rien commité), donc Vercel n'a aucune définition de cron à enregistrer. Confirmé par le `404` de la Phase 2. |

### Scénario demandé : Webhook jamais reçu → Cron → Réconciliation → Paiement mis à jour

**Vérifié au niveau unitaire uniquement — impossible en conditions
réelles.** Deux raisons indépendantes, toutes deux confirmées :

1. Le cron n'est pas déployé (ci-dessus).
2. Même s'il l'était, aucun paiement `provider_code='moncash_api' AND
status='pending'` ne peut exister en production (0 ligne `payouts`
   au total, `create_pending_payout_secure` sans appelant vivant tant
   que le décaissement MonCash reste refusé).

Le scénario est prouvé au niveau du code par
`moncash-reconcile.test.ts` (7 tests, repassés avec succès à l'instant,
voir Phase 11) : un paiement `pending` synthétique, non vérifié par
webhook, est effectivement repris par `reconcilePendingMonCashPayouts()`
et finalisé via `complete_pending_payout_secure`/
`fail_pending_payout_secure` selon la réponse simulée de MonCash. C'est
la limite honnête de ce qui est vérifiable sans déploiement réel ni
identifiants MonCash.

---

## Phase 4 — Variables d'environnement

Vérifié en direct (`vercel env ls production`), aucune valeur affichée
ci-dessous — seulement présence/absence :

| Variable                    | Présente en production          | Remarque                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONCASH_CLIENT_ID`         | ❌ Non                          | Attendu — voir MONCASH_SECRETS_AUDIT.md                                                                                                                                                                                                                                                                                 |
| `MONCASH_CLIENT_SECRET`     | ❌ Non                          | idem                                                                                                                                                                                                                                                                                                                    |
| `MONCASH_MERCHANT_ID`       | ❌ Non                          | idem                                                                                                                                                                                                                                                                                                                    |
| `MONCASH_API_URL`           | ❌ Non                          | idem                                                                                                                                                                                                                                                                                                                    |
| `MONCASH_WEBHOOK_SECRET`    | ❌ Non                          | idem                                                                                                                                                                                                                                                                                                                    |
| `APP_URL`                   | **N'existe pas dans ce projet** | `grep -rn "APP_URL" src/` (hors `VITE_*`) → 0 résultat. L'équivalent réel est `SITE_URL`, une **constante codée en dur** (`src/lib/site-config.ts:11`, `"https://www.nkdeliveri.com"`), pas une variable d'environnement. Rien à vérifier ici — ce n'est pas un oubli, cette variable n'a jamais existé dans ce projet. |
| `SUPABASE_URL`              | ✅ Oui                          |                                                                                                                                                                                                                                                                                                                         |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Oui                          |                                                                                                                                                                                                                                                                                                                         |
| `CRON_SECRET`               | ❌ Non                          | Introduit la session précédente, jamais poussé sur Vercel — cohérent avec le cron non déployé (Phase 3)                                                                                                                                                                                                                 |

**Aucune valeur vide, aucune valeur de test détectée** parmi les
variables réellement présentes — `vercel env ls` ne montre que
`Encrypted`, jamais un contenu, donc une valeur vide serait invisible
par cette commande seule ; ce que je peux confirmer avec certitude est
la présence/absence du nom de variable, pas la validité de son contenu
sans le lire (ce que je ne fais jamais, par principe de sécurité —
indiqué clairement comme limite plutôt que supposé correct).

---

## Phase 5 — Webhooks

| Contrôle         | Résultat                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| URL              | `/api/webhooks/moncash`, confirmée répondre en production (`401` sur requête non signée)                                                                           |
| Méthode          | `POST`                                                                                                                                                             |
| Authentification | Aucune session — signature HMAC uniquement (attendu pour un webhook)                                                                                               |
| Signature        | Vérifiée par `moncashProvider.verifyWebhook()` — schéma générique non confirmé par MonCash publiquement (rappel, pas un nouveau constat)                           |
| Validation       | Idempotence via `UNIQUE(event_id)` sur `moncash_webhook_events` (table live, confirmée)                                                                            |
| Retry            | Effectué côté MonCash (hors de notre contrôle) ; côté app, `moncash-reconcile.server.ts` compense un webhook qui ne reviendrait jamais — **non déployé** (Phase 3) |

### Tests demandés

| Scénario           | Résultat                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webhook valide     | ✅ `moncash-webhook-handler.test.ts` — dispatch correct vers `complete_pending_payout_secure`                                                      |
| Signature invalide | ✅ `401`, aucune RPC appelée                                                                                                                       |
| Webhook en double  | ✅ `23505` → `200`, aucun retraitement — **aussi vérifié contre le vrai schéma live** dans la session précédente (MONCASH_TEST_REPORT.md groupe E) |
| Webhook retardé    | ✅ Couvert par la réconciliation (non déployée — voir Phase 3)                                                                                     |
| Webhook absent     | ✅ Idem, `needs_manual_review` après épuisement de l'échéancier                                                                                    |

Détail sécurité complet (score, constats classés) déjà produit :
[MONCASH_WEBHOOK_SECURITY.md](./MONCASH_WEBHOOK_SECURITY.md) — rien de
changé depuis, reconfirmé par la présence du endpoint en production.

---

## Phase 6 — Sécurité

Vérifié en direct, pas une réutilisation :

| Élément                                                       | Constat                                                                                                                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_pending_payout_secure`                                | `anon:EXECUTE` toujours présent en production (R1, correctif écrit dans `20260731100000`, **non appliqué**)                                                                                                           |
| `complete_pending_payout_secure`/`fail_pending_payout_secure` | `service_role`/`postgres` uniquement — correct, confirmé inchangé                                                                                                                                                     |
| `moncash_webhook_events` (RLS + grants)                       | `authenticated: SELECT` seul (filtré ensuite par la policy admin-only), aucun `anon` — confirmé                                                                                                                       |
| Buckets de stockage                                           | `payout-proofs`, `payment-proofs`, `driver-documents`, `dispute-attachments`, `order-chat-attachments` : tous `public=false` — confirmé. Seuls `menu-photos`/`restaurant-assets` sont publics (attendu, non sensible) |
| Secrets (Git/Vercel/local/logs/notifications)                 | Aucun trouvé — voir [MONCASH_SECRETS_AUDIT.md](./MONCASH_SECRETS_AUDIT.md), reconfirmé par les mêmes commandes à l'instant (Phase 4 ci-dessus)                                                                        |
| Logs (`moncash_api_logs`)                                     | N'existe pas encore en production — rien à auditer avant application de `20260730130000`                                                                                                                              |

Aucune permission excessive nouvelle, aucune fuite de données trouvée.
Le seul écart de sécurité connu (R1) a déjà un correctif écrit et prêt,
seulement pas appliqué — cohérent avec "ne pas appliquer les
migrations".

---

## Phase 7 — Dashboard Admin

| Contrôle                                                                    | Résultat                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page déployée                                                               | `200 OK` en production — **version de base** (statut, historique, erreurs)                                                                                                                                                                                                                                                                                       |
| Version étendue (KPI, alertes, journal d'appels API)                        | Écrite, testée localement (build + typecheck), **non déployée**                                                                                                                                                                                                                                                                                                  |
| Correspondance avec les données réelles                                     | Requêtes de la page exécutées en direct contre la base live : `moncash_payouts=0`, `provider_errors=0`, `moncash_active=false` — cohérent avec un canal inerte, aucune divergence trouvée                                                                                                                                                                        |
| KPI dépendant de `moncash_api_logs` (temps de réponse moyen, disponibilité) | **Ne peuvent pas être vérifiés contre la production** — la table n'existe pas encore ; si la version étendue du dashboard était déployée AVANT d'appliquer `20260730130000`, cette section précise planterait (requête sur une table inexistante) — **point d'ordre de déploiement à respecter**, déjà couvert par le Runbook mais à souligner explicitement ici |

---

## Phase 8 — Workflows

| Flux                                                                                                     | Statut                                                                                                                                                                                                                                                          | Vérification                                                                                     |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| MonCash Automatique (création → confirmation → webhook → notification → wallet → commission → audit log) | Code complet et testé unitairement (32 tests) ; **inatteignable en production** (décaissement B2C refusé par construction, 0 identifiant configuré) — le flux complet ne peut être observé qu'en environnement simulé, jamais en conditions réelles aujourd'hui | Tests unitaires + tests transactionnels rollback (session précédente)                            |
| MonCash Manuel                                                                                           | Inchangé, actif, chemin de production réel depuis le début du module financier                                                                                                                                                                                  | `initiate_payout_secure` — aucune migration de cette session ne le touche (confirmé par lecture) |
| NatCash Manuel                                                                                           | Idem                                                                                                                                                                                                                                                            | Idem                                                                                             |
| **Cash**                                                                                                 | Existe — pas documenté avant cette phase de validation                                                                                                                                                                                                          | Voir ci-dessous                                                                                  |

### Découverte : le workflow Cash existe déjà, avec double confirmation exacte

`supabase/migrations/20260722200000_cash_double_confirmation.sql`
(pré-existant, **aucun rapport de ce du chantier MonCash ne l'avait
mentionné jusqu'ici** — trouvé en vérifiant directement plutôt qu'en
supposant le périmètre limité à MonCash/NatCash). RPC
`confirm_cash_payment_secure(_order_id)` :

- Le **client** et le **livreur** appellent chacun cette même RPC
  indépendamment (`v_is_driver` déterminé par
  `auth.uid()` — jamais un paramètre côté client).
- `customer_confirmed_at`/`driver_confirmed_at` posés séparément.
- **Validation finale automatique** dès que les deux sont non-nuls :
  `status='paid'`, `cash_confirmation_status='validated'` — exactement
  le schéma "Client → Livreur → Validation finale" demandé, sans étape
  admin manuelle dans le cas nominal (un désaccord devient un litige via
  le système de disputes existant, `open_dispute_secure` dans le même
  fichier).

Ce flux est **totalement indépendant** de tout le chantier MonCash —
aucune migration de cette session n'y touche, aucune régression
possible par construction.

---

## Phase 9 — Notifications

### La demande précise à vérifier

> "Vérifier que toutes utilisent désormais le moteur
> `private.notify_secure()`. Aucun `INSERT` direct dans `notifications`
> ne doit subsister."

**Résultat de la vérification directe (requête sur `pg_proc.prosrc`,
pas un grep de fichiers de migration qui inclurait des versions
historiques remplacées) : cette affirmation est fausse si prise au sens
littéral, et c'est un état délibéré, documenté depuis avant le début du
chantier MonCash — pas un oubli.**

18 fonctions actuellement en production contiennent encore un `INSERT
INTO ... notifications` direct (`notify_secure` elle-même exclue de ce
compte, puisque c'est son unique implémentation interne, correcte et
attendue) :

```
complete_refund_secure          notify_payment_status_change
confirm_payout_secure           open_dispute_secure
create_promotion_secure         request_refund_secure
dispute_payout_secure           resolve_dispute_secure
initiate_payout_secure          resolve_payout_dispute_secure
                                 reverse_commission_on_refund
                                 review_refund_secure
                                 send_promotional_notification_secure
                                 update_driver_status_secure
                                 update_order_status_secure
                                 update_restaurant_employee_role_secure
```

Plus, spécifiquement lié à MonCash :
**`complete_pending_payout_secure`/`fail_pending_payout_secure`** — leur
version actuellement live (`20260730100000`) utilise encore un `INSERT`
direct ; la version qui les fait basculer sur `notify_secure`
(`20260730120000`) existe dans le code mais **n'est pas appliquée**
(Phase 1).

### Ce qui est réellement vrai

- **Le code MonCash lui-même**, une fois `20260730120000` appliquée,
  sera à 100 % sur `notify_secure` — zéro `INSERT` direct restant dans
  `create/complete/fail_pending_payout_secure`. Vérifiable dès
  maintenant en lisant ce fichier (déjà fait, confirmé la session
  précédente).
- **Le reste de l'application** (remboursements, litiges, promotions,
  statuts de commande/livreur, rôles employés) reste sur des `INSERT`
  directs — décision **délibérée et documentée** dès la création du
  moteur (`20260723090000_notifications_engine_and_gps_sharing.sql`,
  commentaire d'origine : _"The ~15 existing call sites are left as-is
  deliberately — retrofitting an already-audited financial/dispute
  pipeline is out of scope"_). Ce chantier MonCash n'a jamais eu le
  mandat de migrer ces 18 fonctions — le faire serait une modification
  de logique métier hors périmètre, explicitement interdite par les
  contraintes de cette mission ("Ne modifier aucun code sans
  justification").

**Conclusion de cette phase : le moteur est utilisé par 100 % du
nouveau code MonCash (une fois les migrations restantes appliquées),
0 % par le code préexistant non-MonCash — exactement la portée
initialement annoncée, jamais celle, plus large, que la formulation "no
INSERT INTO notifications doit subsister" laisserait supposer sans
vérification.** Aucune action recommandée ici — élargir la portée est
un choix produit à discuter séparément, pas un défaut de préparation.

### Push / In-App / Bruit / Badge / Historique

- **Push** : `moncash-webhook-handler.server.ts` pousse au bénéficiaire
  et à l'admin sur confirmation/échec (code présent, non déployé — Phase
  2/3).
- **In-App/Badge/Historique** : mécanisme générique déjà en place
  (`dashboard-header.tsx`, centre de notifications) — non modifié par ce
  chantier, donc non re-testé ici (aucune raison de régression).
- **Bruit** : `notify_secure` respecte déjà `notification_preferences`
  par catégorie (`commission` pour tout ce qui est MonCash) — mécanisme
  préexistant, réutilisé tel quel, pas de nouveau réglage à vérifier.

---

## Phase 10 — Performance

Aucun trafic réel (0 paiement MonCash en production) — rien de nouveau à
mesurer depuis [MONCASH_PERFORMANCE_REPORT.md](./MONCASH_PERFORMANCE_REPORT.md),
reconfirmé : requêtes bornées (`.limit()` systématique), index en place
sur les 3 tables concernées, cache du jeton OAuth2 déjà testé. Aucun
goulot d'étranglement identifiable sans trafic réel — indiqué
explicitement plutôt que deviné.

---

## Phase 11 — Résilience

**32/32 tests automatisés repassés avec succès à l'instant**
(`npm test`, 5,51s) — timeout, perte réseau, API indisponible, réponse
JSON invalide, webhook dupliqué, rollback (vérifié contre le vrai schéma
la session précédente), réconciliation. Détail complet, scénario par
scénario : [MONCASH_RESILIENCE_REPORT.md](./MONCASH_RESILIENCE_REPORT.md)
— aucun changement depuis, aucune nouvelle anomalie trouvée en
relançant.

**Erreur SQL** (scénario demandé, non couvert explicitement
auparavant) : chaque RPC `SECURITY DEFINER` de ce module utilise `RAISE
EXCEPTION` pour toute violation de contrainte/état invalide (référence
inconnue testée en Phase précédente — voir MONCASH_TEST_REPORT.md
groupe C) ; Postgres annule alors automatiquement toute la transaction
de cette RPC (garantie ACID native, pas un mécanisme applicatif à
tester séparément) — aucune écriture partielle possible par
construction.

---

## Recommandations

| #   | Constat                                                                          | Sévérité                                                               | Action                                                                                                     |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Rien de la session de durcissement précédente n'est commité/déployé              | **Critique** (bloque toute mise en production du volet MonCash)        | Revoir, committer, pousser — décision qui vous appartient, jamais faite automatiquement dans cette session |
| 2   | 4 migrations non appliquées (ordre : 110000→120000→130000→R1)                    | **Critique**                                                           | Suivre [MONCASH_DEPLOYMENT_RUNBOOK.md](./MONCASH_DEPLOYMENT_RUNBOOK.md)                                    |
| 3   | R1 — `anon:EXECUTE` sur `create_pending_payout_secure`                           | **Moyenne** (non exploitable, défense en profondeur déjà correcte)     | Appliquer `20260731100000`                                                                                 |
| 4   | Dashboard étendu dépend de `moncash_api_logs` — ordre de déploiement à respecter | **Moyenne**                                                            | Toujours appliquer `20260730130000` avant de déployer le code du dashboard étendu                          |
| 5   | `CRON_SECRET` absent de Vercel                                                   | **Moyenne** (bloque le cron même une fois déployé)                     | Générer et ajouter avant le déploiement du cron                                                            |
| 6   | Le cron nécessite un plan Vercel supportant un intervalle <1/jour                | **Faible/à confirmer** — non vérifiable sans accès au plan Vercel réel | Confirmer le plan avant de compter sur `*/5 * * * *`                                                       |
| 7   | 18 fonctions préexistantes hors MonCash n'utilisent pas `notify_secure`          | **Faible** (délibéré, documenté, hors périmètre)                       | Aucune action requise pour ce chantier ; envisager comme chantier séparé si souhaité                       |

Aucune anomalie critique nouvelle trouvée dans le code lui-même — tout
ce qui précède concerne l'état de déploiement, pas la qualité ou la
sécurité du code écrit.
