# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/). Ce projet n'a pas encore de tags de version Git — `[1.0.0]` regroupe l'historique de développement de juillet 2026 (356 commits) jusqu'à la préparation de cette release.

## [1.0.0] — 2026-08-01 (préparation)

### Added

- Parcours complet client/restaurant/livreur/admin (recherche, commande, checkout, suivi, évaluation).
- Paiement MonCash Collect (client → plateforme), production, avec webhook signé et idempotent.
- Architecture `PaymentProvider` générique préparant le décaissement MonCash/NatCash (payouts).
- Dashboard MonCash admin — canal unifié, historique, statut, erreurs, événements webhook.
- Partage de position GPS opt-in côté client, position livreur en temps réel (Phase 1 delivery).
- Chat par commande entre client, livreur et admin, avec pièces jointes et partage de position (Phase 2 delivery).
- Annulation de commande côté client avant le début de la préparation (Phase 3 delivery).
- Confirmation double pour le paiement en espèces.
- Moteur de notifications centralisé (`private.notify_secure`) avec préférences par catégorie et pushs ciblés (Phase 10).
- Sélecteur de dashboard multi-rôle pour les comptes cumulant plusieurs rôles (Phase 7).
- Placements publicitaires sponsorisés — bannière accueil, recherche, page restaurant, dashboard (Phase 6).
- Onglets mini-CRM pour les profils restaurant/livreur/client côté admin (Phase 2 admin).
- Gestion des livreurs côté admin (Phase 1 admin).
- Centralisation de la messagerie sous "Mwen > Chat" pour client/livreur/admin.
- Flux de permission push explicatif, gestion des appareils, son/vibration.
- Verrouillage d'inactivité admin, ré-authentification renforcée avant décaissement, gestion des sessions actives.
- Nettoyage d'historique personnel pour client/restaurant/livreur.
- Centre de décaissement admin étendu — filtres, aperçu de preuve, navigateur de commissions.
- Journal d'audit financier complet pour le connecteur MonCash.
- (Construit, non intégré à cette release) Dashboard financier admin — vue globale, historique filtrable, export CSV/PDF, timeline par commande.
- (Construit, non intégré à cette release) Suite de tests end-to-end Playwright, ~35 flux couverts, mock réseau complet.

### Changed

- Extraction de la logique de récupération de données hors des 3 plus grosses routes admin.
- Pagination de l'historique de commandes client, correction du LCP de la page d'accueil, liste des livreurs déplacée vers Supabase Realtime plutôt que du polling.
- Extraction d'un helper partagé `enforceRateLimit()` pour les envois push.
- Cron de réconciliation MonCash passé sur un rythme quotidien (limite du plan Vercel Hobby).

### Fixed

- Commission : résolution d'une ambiguïté de colonne `restaurant_id` qui faisait planter le moteur de commission.
- Commission : correction du lien entre décaissements et commissions.
- Chat : conservation du message tapé dans le composeur en cas d'échec d'envoi.
- Chat : correction du grant `EXECUTE` manquant sur `order_chat_author_role` pour `authenticated`.
- Push : suppression du popup de notification OS pour une page déjà active côté destinataire.
- Notifications : exclusion des notifications masquées du compteur de non-lus.
- Auth : arrêt de la reconnexion forcée sur une session encore valide.
- Auth : un échec d'upload de logo/document ne masque plus un inscription par ailleurs réussie.
- Audit pré-déploiement : corrections sur 4 migrations non encore appliquées (v7).

### Security

- Durcissement des uploads HEIC, de l'inscription à la newsletter, et des en-têtes HTTP (suivi d'audit).
- Statuts de litige structurés, catégories, notes internes, pièces jointes (refonte disputes).

---

## Non livré dans cette version (voir `docs/RELEASE_NOTES_v1.0.md`)

- Décaissement automatique MonCash (code prêt, non activé).
- Sauvegarde automatique / PITR de la base de données (non configurée — voir `docs/BACKUP_CHECKLIST.md`).
- Dashboard financier admin (implémenté, non commité, migration non appliquée en production).
- Suite E2E Playwright (implémentée, non commitée).
