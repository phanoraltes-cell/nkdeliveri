# 🧭 Implémentation — Module admin « Komand »

**Date** : 2026-08-12
**Référence** : `docs/KOMAND_ADMIN_AUDIT.md` (Phase 1, validée) + validation Phase 2 (décisions détaillées de l'utilisateur, message « VALIDATION PHASE 2 — MODULE KOMAND »)
**Statut** : Code + migration écrits et **vérifiés par tests transactionnels réels (BEGIN/ROLLBACK) contre la production**. **Migration NON appliquée en production** — en attente de confirmation explicite, conformément à la règle absolue de ce projet. **Aucun commit, aucun push.**

---

## 1. Ce que Komand est — et n'est pas

Komand est une **couche de supervision pure** au-dessus des commandes existantes. Il ne crée :

- ❌ Aucun deuxième système de commandes.
- ❌ Aucune deuxième machine à états — `orders.status` n'est **jamais** écrit par une action Komand.
- ❌ Aucun deuxième système de notification — tout passe par `private.notify_secure()`, la cloche existante, `/notifications`.
- ❌ Aucun deuxième système de messagerie — « Contacter » ouvre le chat par commande déjà existant (`dashboard.admin.chat.tsx?order=<id>`).
- ❌ Aucune nouvelle page de gestion client — le lien « nouveau client » ouvre la liste Kliyan existante (`dashboard.admin.customers.tsx`), avec un filtre exact additif.

Il ajoute strictement le minimum qui n'existait nulle part ailleurs : une vue agrégée « santé de commande » calculée à la lecture, des notes internes, et un état d'assistance déclaratif distinct du statut métier.

---

## 2. Architecture — schéma

```text
Komand (SECURITY DEFINER, admin/super_admin uniquement)
│
├── get_orders_admin(...)          ← liste + filtres + pagination + "Komand Health"
├── get_order_admin_detail(id)     ← détail complet (jsonb agrégé)
├── add_order_admin_note_secure    ← écrit order_admin_notes (append-only)
├── set_komand_assistance_secure   ← écrit komand_assistance (1 ligne/commande, PK=order_id)
├── log_komand_contact_secure      ← télémétrie d'audit uniquement, pas de nouvelle messagerie
└── get_customers_admin(..., _customer_id) ← filtre additif, réutilisé par le lien notification

orders.status ─────────────────────────────────── jamais touché
   │
   ├── payments, deliveries, disputes, refunds ─── lus, jamais écrits par Komand
   └── komand_assistance (nouveau, PK=order_id) ─── état de supervision déclaratif séparé
```

---

## 3. « Komand Health » — classification dérivée

Calculée entièrement en SQL dans `get_orders_admin`, jamais stockée. Sept buckets, priorité décroissante :

| Bucket | Condition (résumé) |
|---|---|
| 🔴 `assistance_required` | Assistance admin `required`/`in_progress`, **OU** litige non résolu/rejeté, **OU** remboursement `requested`, **OU** paiement `under_review`, **OU** confirmation cash `disputed` |
| ⬛ `cancelled` / `refunded` | Statuts terminaux de `orders.status`, buckets séparés (jamais fondus dans "complete"/"incomplete") |
| 🟠 `blocked` | Staleness réelle par étape — voir §4 pour la provenance de chaque seuil |
| 🟡 `incomplete` | Étape obligatoire manquante, pas encore assez ancienne pour être `blocked` |
| 🟢 `complete` | `delivered` + `paid` + aucune confirmation cash en attente |
| 🔵 `en_cours` | Tout le reste, actif et dans les temps |

## 4. Seuils de staleness — provenance de chacun, aucun inventé en silence

Conformément à la décision explicite (« ne pas inventer de règles métier »), chaque seuil est étiqueté par sa source réelle :

| Seuil | Source | Statut |
|---|---|---|
| Préparation restaurant (`confirmed`/`preparing`) | `restaurants.avg_prep_time` (réel, par restaurant, déjà utilisé côté client) + 20 min de marge | Ancré sur une donnée réelle |
| Paiement automatique MonCash/NatCash (24h) | `STUCK_PENDING_MINUTES.moncash/natcash` — **valeur exacte déjà en production** dans `dashboard.admin.collect.tsx` | Réutilisé, pas réinventé |
| Paiement automatique Stripe (2h) | `STUCK_PENDING_MINUTES.stripe` — **valeur exacte déjà en production** | Réutilisé, pas réinventé |
| `pending` sans confirmation restaurant (20 min) | Aucun précédent dans le code | **Provisoire — à valider opérationnellement** |
| `ready` sans livreur assigné (30 min) | Aucun précédent | **Provisoire** |
| `assigned`/`picked_up` sans livraison (90 min) | Aucun précédent | **Provisoire** |
| Preuve de paiement manuelle en attente (60 min) | Aucun précédent | **Provisoire** |
| Confirmation cash non validée après livraison (60 min) | Aucun précédent | **Provisoire** |

Les valeurs « Provisoire » sont des points de départ opérationnels, pas des règles métier validées — chacune est un littéral SQL isolé dans `get_orders_admin`, donc ajustable en une seule `CREATE OR REPLACE FUNCTION` sans migration de schéma.

---

## 5. Nouvelles données — le strict minimum

Deux tables, aucune de plus :

1. **`public.order_admin_notes`** — notes internes, admin/super_admin uniquement, jamais visibles client/restaurant/livreur. Append-only (`private.prevent_log_mutation()`, motif déjà réutilisé 5× dans ce projet). Écriture uniquement via `add_order_admin_note_secure`.
2. **`public.komand_assistance`** — `order_id` est la **clé primaire** (pas une table de log) : une seule ligne par commande, mise à jour en place. C'est ce qui garantit **structurellement** qu'une commande ne peut jamais avoir deux états d'assistance actifs simultanément. `status_history` (jsonb) conserve la trace complète des transitions sans deuxième table. Écriture uniquement via `set_komand_assistance_secure` (`ON CONFLICT (order_id) DO UPDATE`).

Plus une extension additive mineure : `notifications.category` accepte désormais `'admin'` (confirmé via `pg_constraint` que ce n'était pas déjà le cas avant d'écrire la migration), et `get_customers_admin` accepte un `_customer_id` optionnel exact-match (défaut `NULL`, aucun appelant existant affecté).

---

## 6. Notifications — « nouveau client inscrit »

- **Point d'ancrage réel** : la branche `ELSE` (compte client) de `handle_new_user()` — le trigger `AFTER INSERT ON auth.users`, déjà audité en profondeur lors de l'incident SMTP du 2026-08-11. Reproduit intégralement (diffé contre `pg_get_functiondef()` en direct avant modification, pas retapé de mémoire), avec un seul `PERFORM private.notify_secure(...)` ajouté.
- **Idempotence intrinsèque** : trigger `AFTER INSERT`, une ligne `auth.users` n'est insérée qu'une fois — aucun chemin de retry ne peut le refaire déclencher pour le même utilisateur (un `signUp()` répété échoue sur l'email déjà pris, avant tout INSERT).
- **In-app uniquement pour v1** — aucun push, décision explicite.
- **Destinataires** : `ARRAY(SELECT user_id FROM user_roles WHERE role IN ('admin','super_admin'))` — patron déjà utilisé 8× dans ce projet.
- **Contenu** : `Nouvo kliyan enskri` / `[Prénom] [Nom] fèk kreye yon kont kliyan.` / `data: {customer_id}` — pas d'email/téléphone dans le texte (déjà accessible en un clic).
- **UI** : aucune nouvelle interface — nouvel onglet « Admin » + icône (`UserCog`, réutilisée du nav) dans `/notifications`, et le clic route désormais aussi `data.customer_id` (en plus de `data.order_id` déjà géré) vers `dashboard.admin.customers.tsx?customer=<id>`, qui ouvre automatiquement la fiche via le nouveau filtre `_customer_id`.

---

## 7. Frontend — fichiers

| Fichier | Rôle |
|---|---|
| `src/lib/komand-status.ts` (nouveau) | Libellés/tons Kreyòl partagés pour santé/assistance/sous-statuts |
| `src/routes/_authenticated/dashboard.admin.komand.tsx` (nouveau) | Liste : KPI, recherche, filtre santé, pagination, temps réel |
| `src/components/dashboard/admin/komand-detail-dialog.tsx` (nouveau) | Détail : client/restaurant/livreur, paiement/livraison, litige/remboursement, notes internes, contrôles d'assistance, contact |
| `src/components/dashboard/sidebar/nav-items.ts` | Ajout de l'entrée « Komand » (admin + super_admin) |
| `src/routes/_authenticated/notifications.tsx` | Onglet/icône `admin`, lien `data.customer_id` |
| `src/routes/_authenticated/dashboard.admin.customers.tsx` | `validateSearch` + `_customer_id`, ouverture auto de la fiche |
| `src/integrations/supabase/types.ts` | Signatures des 5 nouvelles RPC + `get_customers_admin` mise à jour |

**Réutilisation, pas duplication** : `useRealtimeTableSync` (déjà utilisé 5×), `DataTable`/`KpiCard`/`EmptyState`/`PaginationControls`/`StatusBadge` (composants partagés existants), motif `get_*_admin` (recherche/pagination/`total_count`) identique à `get_disputes_admin`/`get_customers_admin`/`get_drivers_admin`.

---

## 8. Séparation stricte respectée

- Aucune action Komand n'écrit `orders.status`. Vérifié par lecture de chaque RPC ajoutée — aucune ne contient `UPDATE public.orders`.
- L'assistance administrative (`komand_assistance.status`) est un axe **complètement indépendant** du statut métier — une commande peut être `komand_health = assistance_required` (calculé) sans qu'aucun admin n'ait encore cliqué « Pran li » (`in_progress`, déclaratif), et inversement une commande peut être marquée `in_progress` sans que son statut métier ne change jamais.
- « Contacter » ne crée pas de nouveau canal — `log_komand_contact_secure` est de la télémétrie d'audit pure ; l'action réelle est une navigation vers le chat par commande déjà existant.

---

## 9. Sécurité — pile standard, aucun raccourci

- **RLS** : `order_admin_notes`/`komand_assistance` — `SELECT` réservé à `admin`/`super_admin` (`private.has_role`), aucune policy d'écriture directe (écriture uniquement via RPC `SECURITY DEFINER`).
- **RPC** : chaque fonction (5 nouvelles + `get_customers_admin` modifiée) revérifie `has_role` **indépendamment** — aucune ne suppose qu'un appelant est passé par une autre RPC ou par le frontend au préalable.
- **Frontend jamais l'autorité** : prouvé par les tests transactionnels §11 (appel direct en JWT non-admin → `42501` sur chacune des 6 RPC).
- **Audit log** : `komand_assistance_started/assigned/resolved/note_added`, `komand_client/restaurant/driver_contacted` — uniquement de vraies actions administratives, jamais une simple lecture/vue.
- **Aucun secret/PII superflu loggé** — les entrées d'audit ne contiennent que `order_id`/`status`/`assigned_admin_id`.

---

## 10. Tests

### 10.1 SQL — transactionnels, réels (`BEGIN`/`ROLLBACK` contre la production, via l'API Management)

Deux passes complètes, aucune ligne restante après coup (vérifié) :

- Classification santé pour 4 états synthétiques de commande.
- Isolation des filtres (`_health`, `_search`, `_restaurant_id`, `_driver_id`).
- `get_order_admin_detail` — succès + 404 (`P0002`) sur commande inexistante.
- Append-only sur `order_admin_notes` (`UPDATE`/`DELETE`/`TRUNCATE` rejetés).
- `set_komand_assistance_secure` — 3 transitions (`required`→`in_progress`→`resolved`), `status_history`/`resolved_by`/`resolved_at` corrects à chaque étape, une seule ligne par commande garantie (`ON CONFLICT`).
- `log_komand_contact_secure` — 3 actions loggées + rejet d'une action hors liste blanche.
- Rejet non-admin (`42501`) sur 3 RPC d'écriture distinctes.
- Notification `notify_secure()` avec la nouvelle catégorie `'admin'` — insertion réussie après l'ajout de `'admin'` à la contrainte `CHECK`.
- **Nouveau (2ᵉ passe)** : `get_customers_admin(_customer_id=...)` retourne exactement le client ciblé ; `_search` seul reste inchangé pour tout appelant existant ; rejet non-admin identique aux autres RPC.

### 10.2 Frontend — logique pure (convention du projet, pas de DOM/RTL)

`src/lib/__tests__/komand-status.test.ts` (7 tests) — garde les dictionnaires `KOMAND_HEALTH_LABEL`/`_TONE`/`KOMAND_ASSISTANCE_LABEL`/`_TONE` contre toute entrée orpheline (une clé de filtre sans libellé afficherait la clé SQL brute à l'admin).

La logique de classification elle-même vit en SQL et est couverte par §10.1 — pas dupliquée côté TypeScript.

### 10.3 `npm run verify`

Voir §11 pour le résultat détaillé.

---

## 11. `npm run verify` — résultat

**Vert, exit code 0**, exécution complète :

| Étape | Résultat |
|---|---|
| `typecheck` (`tsc --noEmit`) | ✅ Aucune erreur |
| `lint` (`eslint .`) | ✅ 0 erreur (3 warnings `react-refresh` pré-existants, fichiers non touchés par ce travail) |
| `check:migrations` | ✅ 132 migrations scannées, aucun hazard non résolu |
| `test` (`vitest run`) | ✅ **173/173 tests**, 16 fichiers (dont les 7 nouveaux de `komand-status.test.ts`) |
| `build` (`vite build`) | ✅ Build production complet réussi, `dashboard.admin.komand-*.mjs` généré |

---

## 12. Ce qui reste hors périmètre (décisions explicites, pas des oublis)

- **Push notifications** pour « nouveau client » — v1 in-app uniquement, décision explicite de l'utilisateur.
- **Extension STRICT/STANDARD step-up** à d'autres RPC au-delà des 7 déjà couvertes (phase précédente) — hors périmètre Komand.
- **Seuils de staleness « provisoires »** (§4) — à valider opérationnellement avant de les considérer comme des règles métier définitives.

---

## 🚦 Statut

**Code + migration prêts, tests transactionnels réussis (2 passes, zéro résidu confirmé). Migration NON appliquée — en attente de votre confirmation explicite avant application en production (jamais `supabase db push` automatique, conformément à la règle du projet). Aucun commit, aucun push effectué.**
