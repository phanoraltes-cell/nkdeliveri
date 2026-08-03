# NK Deliveri — Release Notes v1.0

**Date de préparation** : 2026-08-01
**Statut** : Prêt pour production avec réserves — voir `docs/RELEASE_V1_AUDIT_REPORT.md` § 19 pour les décisions à trancher avant le Go-Live.

## En bref

NK Deliveri v1.0 est la première version consolidée de la plateforme de livraison de repas pour la région de Gonaïves/Artibonite, Haïti. Elle couvre les quatre parcours complets — client, restaurant, livreur, administrateur — avec paiement mobile MonCash, partage de position GPS, chat par commande, et un moteur de notifications centralisé.

## Fonctionnalités principales de cette version

**Commande et paiement**

- Parcours d'achat complet : recherche restaurant, panier, checkout, paiement cash ou MonCash Collect (automatique, en production).
- Confirmation double pour le paiement en espèces.
- Annulation client avant le début de la préparation.
- Historique de commandes avec évaluation post-livraison.

**Livraison**

- Pool de livraisons disponibles, acceptation, suivi de statut.
- Partage de position GPS opt-in côté client, position livreur en temps réel.
- Chat par commande entre client, livreur et (si besoin) l'équipe support, avec pièces jointes image et partage de position.

**Restaurant**

- Gestion de menu, Kanban de commandes, gestion des employés (cook/prep/cashier), promotions, revenus, commissions, décaissements.

**Administration**

- Dashboard live (carte, KPIs, commandes en cours), approbation restaurants/livreurs, litiges, publicités, dashboard financier complet (vue globale, historique filtrable avec export CSV/PDF, timeline détaillée par commande), dashboard MonCash dédié.
- Sécurité de session renforcée : verrouillage d'inactivité, ré-authentification avant décaissement, gestion des sessions actives.

**Notifications**

- Moteur centralisé avec préférences par catégorie (opt-out), notifications push web (PWA), 7 catégories.

**Infrastructure**

- PWA installable (Android/desktop natif, instructions iOS), mode hors-ligne avec coquille applicative précachée, SEO complet, accessibilité de base solide (0 balise `<img>` sans `alt` sur tout le projet).

## Ce qui n'est PAS encore activé

- **Décaissement automatique MonCash** (paiement plateforme → restaurant/livreur) — le code est prêt mais l'activation n'a pas été déclenchée ; le Collect (client → plateforme) est en revanche pleinement en production.
- **Sauvegarde automatique / PITR** de la base de données — non configurée à ce jour (voir `docs/BACKUP_CHECKLIST.md`), sauvegarde manuelle disponible en attendant.

## Réserves connues (non bloquantes, à trancher avant Go-Live)

Voir le détail complet dans `docs/RELEASE_V1_AUDIT_REPORT.md` :

- Sémantique du flag d'activation MonCash à clarifier (le flag visible ne correspond pas au vrai verrou technique).
- Posture de privilèges Postgres à durcir (grant `anon` large sur les fonctions, mitigé mais pas éliminé).
- Adoption du moteur de notifications encore partielle sur certains flux plus anciens.
- Un bug de contraste WCAG AA confirmé dans le pied de page partagé.

## Chantiers construits pendant cette phase mais pas encore livrés

- Dashboard financier admin (Finance Dashboard) — implémenté et validé, en attente de décision de mise en production.
- Suite de tests end-to-end Playwright (~35 flux couverts) — construite et validée localement, en attente de décision d'intégration au dépôt.

## Score d'audit global

91.4/100 en moyenne sur 17 dimensions auditées, 0 problème Critique. Détail complet : `docs/RELEASE_V1_AUDIT_REPORT.md`.
