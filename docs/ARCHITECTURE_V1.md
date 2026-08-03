# NK Deliveri — Architecture Finale (v1.0)

## 1. Vue d'ensemble

```mermaid
flowchart TB
    subgraph Client["Navigateur / PWA"]
        UI["React 19 UI\n(TanStack Router)"]
        SW["Service Worker\n(src/sw.ts)"]
    end

    subgraph Vercel["Vercel (Hobby) — nk-delivery/nkdelivery"]
        SSR["TanStack Start SSR\n(Nitro, preset vercel)"]
        API["Server Functions\n*.server.ts"]
        Cron["1 Cron Job\n/api/cron/moncash-reconcile"]
        Webhooks["2 Webhooks\n/api/webhooks/moncash*"]
    end

    subgraph Supabase["Supabase (dcsnmvbtsmdbwrwbutph, us-east-2)"]
        DB[("Postgres 17.6\n113 migrations, 65 RLS policies\n94 fonctions SECURITY DEFINER")]
        Auth["Supabase Auth"]
        Storage["Storage\n8 buckets"]
        Realtime["Realtime\n(orders, deliveries,\nlocations, notifications)"]
    end

    subgraph External["Externe"]
        MonCash["MonCash / Digicel\nCollect + Business API"]
        Push["Web Push\n(VAPID)"]
    end

    UI -->|fetch/RPC| SSR
    UI -->|fetch/RPC direct| DB
    UI <-->|WebSocket| Realtime
    SSR --> DB
    API --> DB
    API --> Storage
    API -->|push| Push
    Cron --> API
    Webhooks --> API
    API <-->|Collect/Business API| MonCash
    Auth --> DB
    SW -->|precache + offline| UI
```

**Points clés confirmés par l'audit** :

- `VITE_SUPABASE_URL` est inliné au build dans le bundle client **et** serveur (Vite) — SSR et navigateur ciblent la même instance Supabase automatiquement.
- **Zéro Supabase Edge Function** — toute la logique serveur passe par des Server Functions TanStack Start (`.server.ts`, jamais importées statiquement dans une route) ou des RPC Postgres `SECURITY DEFINER`.
- Un seul job cron (`vercel.json`, quotidien — limite du plan Vercel Hobby), actuellement inerte (décaissement MonCash non activé).

## 2. Modèle de rôles

```mermaid
flowchart LR
    User(("Utilisateur\nauth.users"))
    User --> Customer["customer"]
    User --> RestOwner["restaurant_owner"]
    User --> RestStaff["restaurant_staff\n(cook/prep/cashier)"]
    User --> Driver["driver"]
    User --> Admin["admin"]
    User --> SuperAdmin["super_admin"]

    Customer -.->|multi-rôle possible| Driver
    Admin -.->|hiérarchie| SuperAdmin
```

Un même compte peut cumuler plusieurs rôles (`user_roles`, table n-n) — le sélecteur de dashboard multi-rôle (`activeRoleForPath()`) résout quel dashboard afficher depuis l'URL. `dashboard.customer.tsx` est la seule famille de layout sans `requireRole()` explicite (§ L-3 de l'audit) — RLS reste la barrière réelle dans tous les cas.

## 3. Flux — commande client de bout en bout

```mermaid
sequenceDiagram
    participant C as Client
    participant UI as React UI
    participant RPC as RPC Postgres
    participant DB as Postgres (RLS)
    participant R as Restaurant
    participant D as Livreur
    participant MC as MonCash

    C->>UI: Ajoute au panier, /checkout
    UI->>RPC: create_order + paiement (cash/MonCash/NatCash)
    alt Paiement MonCash
        RPC->>MC: create_collect_payment_secure
        MC-->>RPC: Webhook confirmation
        RPC->>DB: complete_collect_payment_secure
    end
    DB-->>R: Realtime — nouvelle commande (Kanban)
    R->>DB: update_order_status_secure (confirmed → preparing → ready)
    DB-->>D: Notification + disponible dans le pool livreur
    D->>DB: accepte la livraison
    DB-->>C: Realtime — statut + position GPS (opt-in)
    D->>DB: update_order_status_secure (delivered)
    DB-->>C: Notification — commande livrée, invite à noter
```

## 4. Sécurité — modèle en couches

```mermaid
flowchart TB
    A["1. RLS (65 policies)\nchaque table filtre par auth.uid()/rôle"]
    B["2. RPC SECURITY DEFINER (94 fonctions)\nvérification de rôle interne (private.has_role())"]
    C["3. GRANT/REVOKE au niveau fonction\n(85% encore anon-exécutable, mitigé par la couche 2 — voir audit § 6/M-1)"]
    D["4. Validation applicative (Zod, contraintes CHECK)"]
    A --> B --> C
    D -.->|défense en profondeur, pas la barrière principale| A

    style C fill:#7a3b1a,color:#fff
```

La couche 3 est le point faible identifié par l'audit (M-1) : le grant `anon` large sur 80/94 fonctions signifie que la sécurité repose presque entièrement sur la couche 2 (le corps de chaque fonction), sans deuxième filet au niveau privilège Postgres.

## 5. Storage — buckets et politique d'accès

| Bucket                   | Public | Contenu                           |
| ------------------------ | ------ | --------------------------------- |
| `avatars`                | oui    | Photos de profil                  |
| `restaurant-assets`      | oui    | Logo/cover restaurant             |
| `menu-photos`            | oui    | Photos plats                      |
| `driver-documents`       | non    | Permis/pièces d'identité livreur  |
| `dispute-attachments`    | non    | Preuves de litige                 |
| `payout-proofs`          | non    | Preuves de décaissement           |
| `payment-proofs`         | non    | Preuves de paiement (cash/manuel) |
| `order-chat-attachments` | non    | Pièces jointes du chat commande   |

## 6. PWA — cycle de vie du Service Worker

```mermaid
flowchart LR
    Install["Installation\nprecache __WB_MANIFEST"]
    Nav["Navigation\nNetworkFirst (5s timeout)"]
    Static["Assets statiques\nCacheFirst (30j)"]
    Offline["setCatchHandler\n→ offline.html"]
    PushEvt["Push reçu\n→ Notification OS"]
    Click["Clic notification\n→ focus/ouvre fenêtre"]

    Install --> Nav
    Install --> Static
    Nav -->|échec réseau| Offline
    PushEvt --> Click
```

## 7. Dette d'architecture identifiée (voir audit complet pour le détail)

- Grant `anon` systémique sur les fonctions `SECURITY DEFINER` (M-1).
- Moteur de notifications adopté à 12/44 sites d'appel seulement (M-2).
- Dashboards MonCash/Finance en pull, pas en push (M-3).
- Absence de sauvegarde automatique/PITR au niveau infrastructure (H-1 infra).
