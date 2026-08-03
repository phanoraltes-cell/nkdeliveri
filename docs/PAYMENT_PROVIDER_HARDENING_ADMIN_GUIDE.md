# Guide Administrateur — Fournisseurs de Paiement

**Page** : `/dashboard/admin/payment-providers` (nav : Finans → Fournisseurs)
**Rôle requis** : `admin` ou `super_admin`

---

## Ce que cette page contrôle

Les 4 méthodes de paiement affichées au checkout client : Kach nan livrezon, MonCash Manyèl, NatCash, MonCash Automatik. **C'est le seul et unique endroit qui décide réellement si une méthode est utilisable** — le backend applique cette décision indépendamment de ce que montre l'interface client, y compris contre une tentative de contournement (voir `docs/PAYMENT_PROVIDER_HARDENING_SECURITY_REPORT.md`).

Cette page ne touche **pas** au menu de décaissement admin (`payout-pay-modal.tsx`, `/dashboard/admin/payout-settings`) — ce sont deux systèmes distincts (voir `docs/PAYMENT_PROVIDER_HARDENING_PHASE0_AUDIT.md` § 1).

## Actions disponibles, par carte

- **Kache / Fè l vizib** — affiche ou masque la méthode dans le checkout (non exploité aujourd'hui, les 4 méthodes restent visibles ; prévu pour un futur "retrait complet" sans devoir la désactiver seulement).
- **Aktive / Dezaktive** — le contrôle réel. Une méthode désactivée devient un bouton non cliquable au checkout, avec le message de maintenance affiché.
- **Fè l default** — change quelle méthode est présélectionnée à l'arrivée sur `/checkout`. Désactivé sur la méthode déjà par défaut (un seul défaut possible à la fois, imposé par la base de données).
- **Mesaj antretyen** — texte affiché aux clients quand la méthode est désactivée. Modifiable indépendamment de l'état activé/désactivé (utile pour préparer un message avant de désactiver).

## Chaque changement est journalisé

Toute modification (via cette page ou via un appel direct à la RPC) écrit une ligne dans `audit_log` (`action = 'payment_provider_setting.updated'`), avec l'identifiant admin, l'horodatage, et l'état complet après changement — automatique, aucune action supplémentaire requise.

## Procédure : réactiver MonCash Automatik

1. Confirmer que les variables d'environnement nécessaires sont configurées sur Vercel (5 variables `MONCASH_*` pour l'intégration Digicel actuelle — voir `docs/MONCASH_CONFIGURATION.md` ; ou les identifiants du nouveau fournisseur une fois son implémentation terminée, voir `docs/PAYMENT_PROVIDER_HARDENING_BOUSPAM_READINESS.md`).
2. Vérifier la connexion API (hors périmètre de cette page — test manuel ou script séparé).
3. Sur cette page, cliquer "Aktive" sur la carte MonCash Automatik.
4. Effet immédiat côté client (moins d'une minute, `staleTime: 60s` de la requête checkout) — **aucun redéploiement nécessaire**.

## Procédure : désactiver en urgence (incident)

1. Cliquer "Dezaktive" sur la méthode concernée.
2. Optionnel : mettre à jour le message de maintenance pour expliquer la situation aux clients.
3. Vérifier `payment_transactions`/le dashboard MonCash (`/dashboard/admin/moncash`) pour toute transaction déjà en cours au moment de la désactivation — elle ne sera pas annulée rétroactivement, seules les *nouvelles* tentatives sont bloquées.
