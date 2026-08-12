# 🔎 Audit — Module Admin « Komand » (supervision des commandes)

**Date** : 2026-08-12
**Type** : **Phase 1 — Audit + Design uniquement. Aucun code modifié, aucune migration créée/appliquée.**
**Méthode** : lecture complète du code (frontend, migrations SQL) + introspection live du schéma réel en production (Management API, read-only — `information_schema`, `pg_enum`, `pg_indexes`, `pg_policies`).

---

## 1. Cartographie réelle du modèle de commande

```text
auth.users (customer_id)
    ↓
public.orders  ←──────────────┐
    │  restaurant_id           │ status_history (jsonb, déjà append-only par convention)
    │  address_id → addresses  │
    │  delivery_address (texte snapshot, pas juste une FK)
    ↓
public.order_items (product_name/unit_price snapshot — pas de FK obligatoire vers products)
    ↓
public.deliveries (1:1 via order_id UNIQUE — PAS de driver_id sur orders lui-même)
    │  driver_id → public.drivers
    ↓
public.payments (1:N réel, mais 1 actif typique — method, status, cash_confirmation_status)
    │  + public.payment_transactions (logs des appels API MonCash/Stripe automatiques — déjà audité, docs/REGISTRATION_AUTH_REMEDIATION_REPORT.md n'est pas lié mais docs/ADMIN_ACCESS_SECURITY_AUDIT.md l'a traversé)
    ↓
public.refunds (0:1 par commande typiquement)
public.disputes (0:1 par commande typiquement)
public.order_chat_messages (0:N, chat déjà existant par commande)
```

**Point clé confirmé par lecture directe du schéma** : il n'existe **pas** de colonne `orders.driver_id`. L'assignation livreur passe exclusivement par `public.deliveries` (relation 1:1, `deliveries.order_id` a une contrainte `UNIQUE`). Toute requête Komand qui a besoin du livreur doit joindre `deliveries`, jamais supposer un champ direct sur `orders`.

---

## 2. Tous les statuts réellement présents (introspection live, pas une supposition)

| Enum                             | Valeurs réelles                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `order_status`                   | `pending, confirmed, preparing, ready, assigned, picked_up, delivered, cancelled, refunded`                                                                                                                                                                                                      |
| `delivery_status`                | `assigned, en_route_pickup, picked_up, en_route_dropoff, delivered, cancelled`                                                                                                                                                                                                                   |
| `payment_status`                 | `pending, awaiting_proof, under_review, paid, failed, refunded`                                                                                                                                                                                                                                  |
| `cash_confirmation_status`       | `pending, customer_confirmed, driver_confirmed, validated, disputed` (spécifique au paiement cash à la livraison — double confirmation client+livreur)                                                                                                                                           |
| `refund_status`                  | `requested, approved, rejected, completed`                                                                                                                                                                                                                                                       |
| `dispute_status` (enum existant) | `open, resolved` — **mais la colonne réelle `disputes.status` est typée `text` en pratique**, pas directement cet enum (vérifié par `information_schema.columns` — à confirmer/documenter avant de s'y fier dans du code, écart entre enum déclaré et colonne réelle non expliqué par cet audit) |

**Aucun nouveau statut créé pour cet audit** — conforme à la règle absolue.

---

## 3. Pages/RPC admin déjà existantes — non-duplication (Règle §26)

| Existant                                                                 | Portée                                                       | Chevauchement avec Komand                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `dashboard.admin.disputes.tsx` + `get_disputes_admin`                    | Litiges uniquement                                           | Komand **affiche** l'état dispute d'une commande (lecture), ne remplace pas la page de résolution dédiée |
| `dashboard.admin.payments.tsx` + `review_manual_payment_secure`          | Revue des preuves de paiement manuel                         | Komand **affiche** l'état paiement, le bouton d'action pointe vers ce flux existant, ne le duplique pas  |
| `dashboard.admin.finance.tsx`                                            | Vue financière agrégée (chiffre d'affaires, etc.)            | Aucun chevauchement — Komand est opérationnel, pas financier                                             |
| `dashboard.admin.customers.tsx`                                          | Liste des clients                                            | Komand **lie vers** le profil client, ne réimplémente pas la liste                                       |
| `dashboard.admin.drivers.tsx` / `.restaurants.tsx`                       | Gestion des comptes                                          | Idem — liens, pas duplication                                                                            |
| `dashboard.admin.refunds.tsx`                                            | Approbation/complétion des remboursements                    | Idem                                                                                                     |
| `dashboard.restaurant.orders.tsx`, `chat.$orderId.tsx`, `orders.$id.tsx` | Vues **non-admin** (restaurant/client/livreur) des commandes | Patterns UI/RPC à réutiliser comme référence, jamais une seconde logique de statut                       |

**Aucune page admin listant toutes les commandes n'existe aujourd'hui.** Komand comble un vide réel, confirmé par l'absence de fichier `dashboard.admin.orders.tsx` ou équivalent — ce n'est pas une duplication.

---

## 4. RLS — orders/deliveries/payments (déjà correctes, à ne pas toucher)

Confirmé par lecture de la dernière policy en vigueur (`20260709093000_fix_orders_deliveries_rls_recursion.sql`) :

```sql
CREATE POLICY "orders read" ON public.orders FOR SELECT TO authenticated
  USING (auth.uid() = customer_id
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (... owner du restaurant ...)
    OR EXISTS (... employé du restaurant ...)
    OR private.order_visible_to_driver(orders.id, orders.status));
```

**L'admin a déjà un accès SELECT complet** à `orders`/`deliveries`/`payments` via RLS. Komand n'a besoin d'**aucune nouvelle policy** pour la lecture — seul un nouveau RPC `SECURITY DEFINER` est nécessaire pour les jointures/pagination/agrégation performantes (voir §7), suivant exactement le patron déjà établi (`get_drivers_admin`, `get_restaurants_admin`, `get_customers_admin`, `get_disputes_admin` — tous `SECURITY DEFINER`, gate `has_role(admin) OR has_role(super_admin)`, `_limit`/`_offset`/`_search`, retournent `total_count`).

⚠️ Point de vigilance déjà documenté dans ce projet : le commentaire de `20260709093000...sql` explique qu'un JOIN RLS-vers-RLS entre `orders`↔`deliveries` a déjà causé une récursion infinie une fois (`ERROR 42P17`), corrigée via une fonction `SECURITY DEFINER` (`private.order_visible_to_driver`). Le nouveau RPC `get_orders_admin` proposé ci-dessous **contourne ce risque par construction** — étant lui-même `SECURITY DEFINER`, il ne passe jamais par le chemin RLS pour ses propres jointures internes.

---

## 5. Définition de « Komand Health » — dérivée, jamais stockée sur `orders.status`

Conforme à la Règle §3 : aucune colonne `orders.status` modifiée. La classification est **calculée à la lecture**, en SQL, dans le nouveau RPC — jamais persistée comme un statut métier concurrent.

```text
KOMAND HEALTH = f(order.status, payment.status, payment.cash_confirmation_status,
                   delivery.status, delivery.driver_id, dispute.status, refund.status,
                   âge de la commande dans son statut actuel)
```

### 🔴 `assistance_required` (priorité la plus haute)

- Un litige existe avec `disputes.status = 'open'` pour cette commande, **OU**
- Un remboursement est en attente : `refunds.status = 'requested'`, **OU**
- Un paiement manuel attend une revue humaine : `payments.status = 'under_review'`, **OU**
- Une confirmation cash est contestée : `payments.cash_confirmation_status = 'disputed'`

Ces 4 conditions ont un point commun réel et vérifiable dans le code existant : **chacune a déjà une RPC d'admin dédiée pour la résoudre** (`resolve_dispute_secure`/`update_dispute_status_secure`, `review_refund_secure`/`complete_refund_secure`, `review_manual_payment_secure`) — Komand ne fait qu'agréger ce qui existe déjà et pointer vers l'action correcte, jamais une nouvelle logique de résolution.

### 🟠 `blocked`

- La commande n'a **pas progressé** depuis un temps anormal dans un statut non-terminal. Seuils proposés (à valider, même style que `STUCK_PENDING_MINUTES` déjà utilisé dans `dashboard.admin.collect.tsx`) :
  - `pending` depuis > 15 min (le restaurant n'a pas confirmé)
  - `ready` depuis > 30 min sans livreur assigné (`deliveries.driver_id IS NULL`)
  - `assigned`/`picked_up` depuis > 90 min sans passage à `delivered`
- `payments.status = 'failed'` et la commande n'est ni `cancelled` ni `refunded` (paiement mort, rien ne la fait progresser automatiquement)

### 🟡 `incomplete`

- La commande est dans un statut actif (`pending`…`picked_up`) et une donnée/étape obligatoire manque, **sans** être encore assez ancienne pour être `blocked` :
  - `payments.status IN ('pending','awaiting_proof')` alors que la commande a dépassé `pending`
  - `order.status = 'ready'` sans `deliveries` créée du tout (jamais assignée)
  - `orders.address_id IS NULL` (adresse non liée à une adresse enregistrée — rare, mais réel puisque la colonne est nullable)

### 🟢 `complete`

- `orders.status = 'delivered'` **ET** `payments.status = 'paid'` **ET** aucun litige `open` **ET** (si `cash_confirmation_status` n'est pas NULL) `= 'validated'`.

### Buckets terminaux séparés (pas "complete", pas "incomplete")

- `cancelled` : `orders.status = 'cancelled'`
- `refunded` : `orders.status = 'refunded'` (distinct d'un remboursement encore `requested`, qui lui est `assistance_required`)

Ceci correspond exactement aux filtres demandés en §8 du prompt (`Toutes / Complètes / Incomplètes / Bloquées / Assistance requise / En cours / Terminées / Annulées`) — chacun est soit un des 4 buckets Komand Health ci-dessus, soit dérivable directement de `orders.status` sans rien inventer.

---

## 6. Vue principale — colonnes et requête

| Colonne demandée  | Source                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| Commande          | `orders.order_number`                                                                   |
| Client            | `profiles.first_name/last_name` via `customer_id`                                       |
| Restaurant        | `restaurants.name`                                                                      |
| Livreur           | `drivers.first_name/last_name` via `deliveries.driver_id` (peut être NULL)              |
| Statut            | `orders.status` (libellé Kreyòl, même convention que `dashboard.restaurant.orders.tsx`) |
| Santé             | Calculée (§5)                                                                           |
| Paiement          | `payments.status` + `method`                                                            |
| Dernière activité | `GREATEST(orders.updated_at, deliveries.updated_at, payments.updated_at)`               |
| Action            | Lien vers le détail (§10), pas d'action inline dans le tableau                          |

Proposition : nouveau RPC `public.get_orders_admin(_search, _health_filter, _order_status_filter, _payment_status_filter, _restaurant_id, _driver_id, _date_from, _date_to, _limit, _offset)`, `SECURITY DEFINER`, retourne `TABLE(..., total_count bigint)` — **exactement le patron** de `get_disputes_admin`/`get_drivers_admin`. Pagination serveur réelle (Règle §23 — jamais `SELECT *` puis filtrage navigateur).

---

## 7. Bloc « Pourquoi incomplète ? » — dérivable, pas une nouvelle table de raisons

La raison exacte peut être dérivée directement des mêmes conditions que §5 (pas de nouvelle colonne "raison" à stocker) — le RPC retourne déjà les champs sources (`payment_status`, `driver_id IS NULL`, etc.), et le frontend traduit ça en message humain, exactement comme `dashboard.admin.collect.tsx` calcule déjà ses propres `alerts[]` à partir des données chargées (aucune donnée dupliquée, calcul pur en frontend à partir de la réponse RPC).

---

## 8. Assistance admin — actions réellement disponibles (Règle §12-13)

**Aucune nouvelle capacité de modification créée.** Komand ne fait qu'orchestrer l'accès aux RPC déjà auditées et déjà step-up-protégées (docs/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md) :

| Action demandée dans le prompt           | RPC/mécanisme réel existant                                                                                                                                                                                                                           | Nouveau ?                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vérifier un paiement                     | `review_manual_payment_secure` (déjà protégé step-up standard, voir remédiation précédente — à vérifier si couvert)                                                                                                                                   | Non                                                                                                                                                                                     |
| Résoudre un problème (litige)            | `resolve_dispute_secure`, `update_dispute_status_secure`                                                                                                                                                                                              | Non                                                                                                                                                                                     |
| Approuver/compléter un remboursement     | `review_refund_secure`, `complete_refund_secure` (déjà STRICT/STANDARD step-up)                                                                                                                                                                       | Non                                                                                                                                                                                     |
| Contacter client/restaurant/livreur      | **Aucun mécanisme de messagerie admin→acteur n'existe** pour l'instant en dehors du chat _par commande_ déjà existant (`order_chat_messages`, admin peut déjà y participer — `add_dispute_message_secure` équivalent pour le chat général à vérifier) | À confirmer en Phase 2 — probablement réutiliser `order_chat_messages` (l'admin y poste déjà comme dans une conversation à 3, mécanisme confirmé actif dans `dashboard.admin.chat.tsx`) |
| Ajouter une note interne                 | **N'existe pas encore**                                                                                                                                                                                                                               | **Oui — nouvelle table minimale requise**, voir §9                                                                                                                                      |
| Marquer "assistance en cours" / "résolu" | **N'existe pas** comme état de supervision séparé du statut métier                                                                                                                                                                                    | **Oui — nouvelle colonne/table de supervision requise**, voir §9                                                                                                                        |

---

## 9. Nouvelles données réellement nécessaires (minimales, justifiées)

Après audit, **deux** ajouts de schéma sont nécessaires — pas plus :

1. **`public.order_admin_notes`** — note interne liée à une commande, jamais visible client/restaurant/livreur.

   ```text
   id, order_id, author_id, note, created_at
   ```

   RLS : lecture/écriture admin/super_admin uniquement (`has_role`), jamais de policy pour les autres rôles. Append-only (mêmes triggers `private.prevent_log_mutation()` déjà réutilisés 5 fois dans ce projet) — une note d'assistance a la même exigence d'intégrité qu'un log d'audit.

2. **État de supervision séparé** (Règle §15 : _"ne pas modifier le statut métier de la commande"_) — table `public.order_supervision_state` plutôt qu'une colonne sur `orders` (évite de toucher une table déjà RLS-sensible et déjà impliquée dans la récursion documentée §4) :
   ```text
   order_id (PK, FK orders), state ('normal'|'assistance_required'|'assistance_in_progress'|'resolved'),
   set_by, set_at, note
   ```
   Une ligne n'existe que si un admin a explicitement marqué la commande — absence de ligne = `normal`. `assistance_required` calculé (§5) reste **indépendant** de cet état déclaratif : une commande peut être Komand-Health=`assistance_required` (calculé) sans qu'aucun admin n'ait encore cliqué "je m'en occupe" (`assistance_in_progress`, déclaratif).

Ces deux tables sont les **seules** nouvelles structures proposées — tout le reste de Komand est lecture pure des tables existantes.

---

## 10. Notifications — nouveau Client inscrit

### Point de déclenchement réel (Règle §17 : pas au submit du formulaire)

Confirmé par lecture directe de `handle_new_user()` (trigger `AFTER INSERT ON auth.users`, déjà audité en profondeur lors de l'incident SMTP du 2026-08-11) : la branche `ELSE` (ni restaurant ni driver) est exécutée **uniquement après** que Supabase Auth ait réellement inséré la ligne `auth.users` — c'est-à-dire après un `signUp()` réussi, dans la même transaction que la création du `profile` + rôle `customer`. C'est le point exact de "provisioning réussi", pas la soumission du formulaire (qui peut échouer avant, comme l'incident SMTP l'a prouvé).

**Point d'ancrage proposé** : ajouter `PERFORM private.notify_secure(...)` dans cette branche `ELSE` existante. Un seul trigger, une seule fois par vraie ligne `auth.users`, **intrinsèquement idempotent** (Règle §21) — Postgres ne peut pas ré-exécuter un trigger `AFTER INSERT` pour une ligne qui n'est insérée qu'une fois ; un retry de `signUp()` côté client échouerait sur l'email déjà pris, pas sur un second INSERT.

### Destinataires (Règle §18)

Patron déjà utilisé **8 fois** dans ce projet (dispute, annulation, paiements automatiques…) :

```sql
ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin'))
```

Aucun risque de notifier client/restaurant/livreur — c'est le même mécanisme déjà éprouvé.

### Moteur réutilisé, pas dupliqué (Règle §18, §30)

`private.notify_secure(_user_ids, _type, _category, _title, _body, _data)` — déjà l'unique moteur de notification in-app du projet. Nouveau `type = 'new_customer_signup'`, nouvelle `category = 'admin'` (catégorie non encore utilisée — `notification_preferences_for()` retombe sur `true` par défaut pour toute catégorie non explicitement désactivée, donc aucune action requise côté préférences).

### Contenu — sans sur-exposer de PII (Règle §19)

```text
Titre : Nouvo kliyan enskri
Corps : [Prénom] [Nom] fèk kreye yon kont kliyan.
data: { customer_id: <uuid> }
```

Pas d'email/téléphone dans le corps affiché (déjà accessible en un clic via le profil, pas besoin de le dupliquer dans le texte de notification).

### UI notification — déjà entièrement construite, aucune nouvelle interface nécessaire

**Découverte majeure de cet audit** : `src/routes/_authenticated/notifications.tsx` + la cloche dans `dashboard-header.tsx` forment **déjà** un système complet — non lues/lues, horodatage, onglets par catégorie, lien vers le contexte, marquer comme lu, mise à jour Realtime (`postgres_changes` sur `notifications`, déjà utilisé pour le badge). Tout ce que demande la Règle §20 existe déjà.

Seuls ajustements nécessaires, tous additifs :

- Ajouter `{ key: "admin", label: "Admin" }` à `CATEGORY_TABS` et une icône à `CATEGORY_ICON` dans `notifications.tsx`.
- Le lien-vers-contexte actuel ne sait router que `data.order_id` → `/orders/$id` ou `/chat/$orderId`. Il faudra un cas `data.customer_id` → lien vers la fiche client admin (`dashboard.admin.customers.tsx` n'a pas de route de détail dédiée aujourd'hui à confirmer en Phase 2 — potentiellement un paramètre de recherche préremplie plutôt qu'une nouvelle route).

### Push — limite technique réelle trouvée

Le patron établi (`send-*-push.functions.ts`) est **toujours déclenché par le client dont l'action vient de réussir**, via `requireSupabaseAuth` (JWT valide obligatoire). Pour un nouveau client, au moment exact du `signUp()`, **il n'y a souvent pas encore de session valide** (`mailer_autoconfirm: false`, confirmé lors de l'incident SMTP — `hasSession` peut être `false`). Deux options réelles, à trancher en Phase 2 :

- **(a)** Notification in-app uniquement pour ce déclencheur précis (le badge + `/notifications` suffisent, l'admin les voit à sa prochaine visite ou en direct via Realtime s'il a le dashboard ouvert) — **recommandé pour la Phase 3**, le plus simple et le plus sûr.
- **(b)** Un nouveau `send-new-customer-admin-push.functions.ts` appelé côté client juste après `signUp()`, en réutilisant le **même patron "pas de session garantie"** déjà validé et en production dans `register-documents.functions.ts` (garde-fous par âge de ligne + rate limit, sans dépendre d'un Bearer token obligatoire).

---

## 11. Temps réel (Règle §24)

**Réutiliser `useRealtimeTableSync` existant** (générique, déjà utilisé 5 fois : `useLiveOrders`, `useAdminDashboardData`, `useChatConversations`, la cloche de notifications, les pages commission/payout). Komand invaliderait ses requêtes sur `postgres_changes` de `orders`/`deliveries`/`payments`/`disputes` sans filtre (vue admin globale) — **aucun nouveau mécanisme temps réel à introduire**, juste un appel de plus à ce hook déjà éprouvé.

---

## 12. Audit log (Règle §16)

Réutilise directement `private.log_audit_event(_user_id, _role, _action, _metadata)` déjà en place, déjà utilisé par 10+ RPC. Les actions proposées (`komand_viewed`, `komand_assistance_note_added`, etc.) sont de simples nouvelles valeurs de `_action` — aucune nouvelle table, aucun nouveau mécanisme.

⚠️ `komand_viewed` mérite réflexion : logger _chaque consultation_ d'une commande par un admin pourrait générer un volume élevé pour un bénéfice limité — à trancher en Phase 2 (probablement limiter aux actions qui _changent_ quelque chose : note ajoutée, statut de supervision modifié — pas la simple lecture).

---

## 13. Performance (Règle §23)

- `idx_orders_customer`, `idx_orders_restaurant`, `idx_orders_status` existent déjà.
- **Aucun index sur `orders.created_at`** — la vue Komand triera très probablement par activité récente. À faible volume actuel (0 commande réelle en production au moment de cet audit — confirmé lors de travaux précédents), non urgent, mais à inclure dans la migration proposée en Phase 3 si le tri par date devient un vrai chemin de requête.
- `deliveries`/`payments` ont déjà des index sur leurs clés de jointure (`order_id`).
- Le RPC `get_orders_admin` proposé (§6) fait toute la jointure/filtrage/pagination côté serveur — jamais de `SELECT *` suivi d'un filtrage navigateur.

---

## 14. Permissions (Règle §22)

Aucune nouvelle notion de rôle — `admin`/`super_admin` déjà bien définis et déjà protégés à 3 niveaux (frontend `requireRole`, RLS, et depuis peu step-up MFA pour les actions critiques — docs/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md). Komand est une page **de lecture** en majorité — le tier de step-up pour ses actions d'écriture (note interne, changement d'état de supervision) reste à trancher : probablement **STANDARD** (15 min, pas STRICT) puisqu'aucune de ces actions ne modifie un privilège, ne déplace de l'argent, ni n'est irréversible — cohérent avec la matrice déjà établie.

---

## 15. Sécurité — scénarios à tester en Phase 4 (déjà anticipés, pas encore exécutés)

- Client/Restaurant/Livreur → `get_orders_admin` directement (RPC) → doit échouer (`has_role` check).
- Admin non authentifié / session expirée → idem.
- Manipulation de `_order_id` dans un appel direct pour lire une commande hors périmètre → sans objet ici puisque `get_orders_admin` ne filtre par aucun ID appartenant à un tiers (c'est une vue admin globale par construction) — mais toute future RPC "détail d'une commande" doit revalider `has_role` en interne, pas seulement compter sur le RPC de liste.
- Note interne : vérifier qu'un `restaurant_owner`/`driver`/`customer` ne peut ni lire ni écrire `order_admin_notes` même en devinant un `order_id` valide.

---

## 16. Décisions à valider avant la Phase 2/3

1. **Les deux nouvelles tables proposées** (§9 : `order_admin_notes`, `order_supervision_state`) — confirmer le périmètre minimal avant d'écrire la migration.
2. **Notification "nouveau client" — option (a) in-app seulement, ou (b) ajouter un push malgré la contrainte "pas de session garantie"** (§10).
3. **Seuils de staleness pour `blocked`** (§5 : 15/30/90 min proposés) — à ajuster selon la réalité opérationnelle voulue.
4. **`komand_viewed` dans l'audit log** — le logger ou non (§12).
5. **Lien de la notification "nouveau client"** — nouvelle route de détail client admin, ou paramètre de recherche sur la page liste existante (§10).

---

## 🚦 Statut

**Phase 1 terminée — aucun code modifié, aucune migration créée.** En attente de votre validation sur les 5 points ci-dessus avant la Phase 2 (design détaillé + confirmation finale de l'architecture) puis la Phase 3 (implémentation).
