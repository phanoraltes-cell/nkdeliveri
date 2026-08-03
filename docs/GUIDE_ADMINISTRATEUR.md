# NK Deliveri — Guide Administrateur (v1.0)

Pour les utilisateurs `admin`/`super_admin` de la plateforme. Différence entre les deux : `super_admin` peut gérer les rôles d'autres utilisateurs (`Admins manage roles` sur `user_roles`) et supprimer un restaurant ; `admin` a accès à tout le reste.

## Dashboard principal (`/dashboard/admin`)

Vue d'ensemble en temps réel (Supabase Realtime — se met à jour sans recharger) : carte live des livraisons en cours, restaurants/livreurs en attente d'approbation, KPIs du jour.

## Gestion des utilisateurs

| Page                           | Rôle nécessaire | Action                                  |
| ------------------------------ | --------------- | --------------------------------------- |
| `/dashboard/admin/users`       | admin           | Vue globale de tous les utilisateurs    |
| `/dashboard/admin/customers`   | admin           | Gestion spécifique clients              |
| `/dashboard/admin/restaurants` | admin           | Approuver/rejeter/gérer les restaurants |
| `/dashboard/admin/drivers`     | admin           | Approuver/rejeter/gérer les livreurs    |

Un compte peut cumuler plusieurs rôles (ex. un livreur qui est aussi client) — le sélecteur multi-rôle du dashboard gère cela automatiquement.

## Finance

| Page                                | Contenu                                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dashboard/admin/finance`          | Vue globale, historique complet filtrable, export CSV/PDF, timeline détaillée par commande                                                                     |
| `/dashboard/admin/payments`         | Ledger des paiements clients                                                                                                                                   |
| `/dashboard/admin/commissions`      | Configuration et ledger des commissions                                                                                                                        |
| `/dashboard/admin/payouts`          | Traitement des décaissements restaurant/livreur (ré-authentification requise)                                                                                  |
| `/dashboard/admin/payout-settings`  | Configuration des méthodes de décaissement                                                                                                                     |
| `/dashboard/admin/refunds`          | Traitement des remboursements                                                                                                                                  |
| `/dashboard/admin/moncash`          | Statut du canal MonCash, historique, erreurs, événements webhook                                                                                               |
| `/dashboard/admin/payout-migration` | Outil ponctuel de migration de données de décaissement — accessible uniquement depuis un bouton sur la page Payouts, pas dans le menu principal (intentionnel) |

**⚠️ Note d'audit** : le flag visible dans la configuration (`moncash_api.is_active`) ne contrôle pas réellement l'activation du paiement client — voir `docs/MONCASH_ACTIVATION_PHASE2_AUDIT.md`. Ne pas se fier à son état seul pour juger si MonCash est actif.

## Litiges et support

| Page                        | Contenu                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `/dashboard/admin/disputes` | Résolution des litiges (statuts structurés, catégories, notes internes, pièces jointes) |
| `/dashboard/admin/chat`     | Chat support avec les utilisateurs                                                      |

## Marketing

| Page                   | Contenu                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| `/dashboard/admin/ads` | Bannières publicitaires (accueil, recherche, page restaurant, dashboard) |

## Notifications

Chaque utilisateur peut configurer ses préférences de notification (opt-out par catégorie) dans son profil. **Note** : certains flux de notification (annulation client, cycle de vie décaissement MonCash) ne respectent pas encore ces préférences — ils passent par une insertion directe plutôt que par le moteur centralisé (voir audit § Notifications, M-2). Un admin verra donc parfois une notification qu'un utilisateur a désactivée pour ce type d'événement précis.

## Sécurité de session admin

- Verrouillage automatique après inactivité (idle lock).
- Ré-authentification (mot de passe) requise avant tout décaissement.
- Gestion des sessions actives et appareils depuis le profil (`/profile`).

## Ce qu'un admin ne devrait jamais faire

- Modifier directement une ligne de `payments`/`payouts`/`orders` en base — toujours passer par l'action correspondante dans l'interface, qui journalise et notifie correctement.
- Attribuer le rôle `super_admin` à la légère — c'est le seul rôle pouvant supprimer un restaurant et gérer les rôles d'autrui.
