# Rapport d'aide à la décision — Push Phase 2
## Suivi de commande (Refonte Frontend Premium NK Deliveri)

**Rôle tenu pour ce rapport :** Lead Frontend Engineer / Product Designer.
**Nature de ce document :** analyse de décision uniquement — aucun fichier de code modifié, aucun commit créé, aucune migration lancée, aucun push effectué.

État de départ confirmé par lecture directe du dépôt : 2 commits locaux non poussés (`f15bce4` implémentation, `ee18475` rapport de clôture), `npm run verify` au vert, aucun fichier backend touché.

---

## 1. Audit de la qualité de l'implémentation

| Critère | Constat |
|---|---|
| Cohérence avec la spécification de refonte | Conforme au wireframe P2 : timeline unique, bannière contextuelle, accordéon secondaire. Un écart mineur assumé et documenté (le numéro de commande n'est pas répété dans la timeline, pour ne pas doubler le `<h1>` de la page). |
| Cohérence avec le rapport d'audit initial | Traite directement le point faible n°1 (« la page de suivi empile 9 cartes sans hiérarchie »). Voir §3 pour une réserve importante : la correction réintroduit une version plus étroite du même problème sur deux états précis. |
| Respect du Design System | Conforme — tokens `--status-*` de P1 réutilisés (aucune couleur Tailwind brute introduite), `text-xs` utilisé au lieu d'une nouvelle taille arbitraire, rayons/ombres identiques au reste de l'app. |
| Absence de régression structurelle | Aucune régression de rendu (tous les branchements compilent, tous les statuts ont une branche explicite). Une régression de **visibilité d'information** existe — voir §3, pas une régression de rendu cassé. |
| Conservation des fonctionnalités existantes | Toutes les actions existantes restent atteignables (rien supprimé, rien de définitivement inaccessible) — le problème trouvé est un problème de **découvrabilité proactive**, pas de perte de fonctionnalité. |

## 2. Audit des risques

| Domaine | Niveau | Justification |
|---|---|---|
| UX | **Élevé** | Voir §3 : deux états réels (preuve de paiement manuelle « en cours de vérification », litige actif sur commande non terminale) ne déclenchent aucun signal visible sur la page principale — l'utilisateur doit deviner qu'il faut ouvrir un accordéon générique pour les trouver. Le premier de ces deux états est atteint par **tout** client en paiement manuel immédiatement après avoir accompli l'action principale que cette phase met justement en avant. |
| UI | Faible | Composants et tokens cohérents avec le reste de l'app ; aucune classe arbitraire nouvelle. |
| Responsive | Faible | Aucune largeur fixe introduite ; la timeline utilise `flex-1`/`text-center` par étape (dégradation progressive, pas de débordement prévisible) ; les bannières utilisent des conteneurs bloc qui enveloppent le texte naturellement. Non vérifié visuellement — voir §4. |
| Accessibilité | Moyen | L'étape active/complétée de la timeline est distinguée par couleur + anneau + coche (`aria-hidden`), sans équivalent textuel porté par chaque étape elle-même — seul le badge au-dessus de la timeline énonce l'étape courante en texte lisible, ce qui atténue mais ne supprime pas le problème. Cohérent avec la dette déjà identifiée et réservée à P7 dans le plan de migration — pas une régression nouvelle par rapport à l'ancienne grille à deux cartes (qui avait le même type de lacune). |
| Performance | Faible | Aucune dépendance ajoutée, `<details>` natif (zéro JS), un seul nouveau composant, pas de requête réseau supplémentaire. |
| Maintenabilité | Faible | `PaymentProofSection` est désormais appelée à deux endroits (primaire / dans l'accordéon) avec des conditions miroir (`needsProof` / `!needsProof`) — légère duplication de call-site, sans duplication de logique métier (le composant lui-même n'est pas dupliqué). |

## 3. Vérification des scénarios

| État | Timeline cohérente | Action principale visible | Ambiguïté UX |
|---|---|---|---|
| En attente (kach, rien à faire) | ✅ Oui | ✅ Oui (aucune action requise, à raison) | Non |
| En attente + paiement manuel à prouver | ✅ Oui | ✅ Oui (formulaire directement sous la timeline) | Non |
| En attente + paiement automatique en cours | ✅ Oui | ✅ Oui (bannière dédiée) | Non |
| Confirmée | ✅ Oui | ✅ Oui (rien requis, chat disponible) | Non |
| En préparation | ✅ Oui | ✅ Oui | Non *(mais voir ligne « Litige »)* |
| Prête | ✅ Oui | ✅ Oui | Non *(mais voir ligne « Litige »)* |
| En livraison | ✅ Oui (assigned/picked_up correctement fusionnés en « An livrezon ») | ✅ Oui (carte + chat visibles) | Non |
| Livrée | ✅ Oui (badge vert distinct) | ✅ Oui — accordéon **ouvert automatiquement**, avis/remboursement/confirmation cash tous visibles sans clic | Non |
| Annulée | ✅ Oui (état plat rouge distinct, pas de barre figée) | ✅ Oui si remboursement pertinent (accordéon ouvert automatiquement) | Mineure — la légende « Peman konfime » juste au-dessus d'un badge « Anile » peut lire comme contradictoire une fraction de seconde avant de voir le formulaire de remboursement juste en dessous |
| Paiement manuel — en attente/preuve requise/échoué | ✅ Oui | ✅ Oui | Non |
| **Paiement manuel — en cours de vérification (`under_review`)** | ✅ Oui | ❌ **Non** — aucune bannière, aucune légende ; le message « Prèv peman resevwa, y ap verifye li » existe mais est **caché dans un accordéon fermé par défaut** (la commande reste `pending`, donc non terminale) | **Oui, confirmée** |
| Paiement validé | ✅ Oui | ✅ Oui (légende de confiance immédiate) | Non |
| Paiement refusé (manuel ou automatique) | ✅ Oui | ✅ Oui (formulaire ou bannière selon le rail) | Non |
| **Litige actif sur commande non terminale** (ex. signalé pendant « Prè » ou « An livrezon ») | ✅ Oui (la timeline ne s'en préoccupe pas, à raison) | ❌ **Non** — le fil de discussion du litige existe et peut contenir des messages du support, mais rien sur la page principale ne l'indique ; il faut ouvrir l'accordéon fermé par défaut pour le découvrir | **Oui, confirmée — la plus sérieuse des deux** |
| Litige sur commande terminale (livrée/annulée) | ✅ Oui | ✅ Oui (accordéon ouvert automatiquement) | Non |

**Constat central :** la règle « une seule action à la fois, rien d'important cousu dans un coin » — exactement ce que cette phase devait corriger — est bien respectée pour tous les statuts de **commande**, mais **pas** pour deux statuts secondaires (preuve en cours de vérification, litige en cours) quand ils surviennent sur une commande encore active. C'est précisément la classe de problème que l'audit initial reprochait à l'ancienne page.

## 4. Vérification visuelle

**Une validation visuelle reste recommandée, mais elle n'est pas le facteur décisif de ce rapport.** Les deux lacunes du §3 sont des lacunes de **logique d'affichage** (une condition manquante), pas des inconnues de rendu — les revoir à l'œil ne les révèlerait que si le testeur pense spécifiquement à créer une commande en paiement manuel « en vérification » ou à ouvrir un litige sur une commande encore active, deux scénarios faciles à ne pas tester par hasard.

Si une vérification visuelle est faite (recommandé une fois les corrections du §5 appliquées) :
- **Écrans :** `/orders/$id` pour une commande de chaque statut du tableau ci-dessus, y compris les deux cas rares (preuve en vérification, litige actif non terminal).
- **Tailles :** 360px (mobile étroit), 414px (mobile standard), 768px (tablette) — la timeline à 6 étapes est l'élément le plus à risque de tassement visuel sur les petites largeurs.
- **Scénario prioritaire :** une commande livrée avec paiement kach non encore confirmé, pour vérifier que l'accordéon auto-ouvert n'affiche pas un empilement redondant avec la légende de confiance.

## 5. Décision finale

### ❌ OPTION C — Push interdit

**Problèmes précis identifiés :**

1. **Paiement manuel « en cours de vérification » sans aucun signal visible** — état atteint par tout client en paiement manuel immédiatement après avoir soumis sa preuve, c'est-à-dire juste après l'action que cette phase met justement en avant. `orders.$id.tsx`, bloc des bannières contextuelles (autour de `isCollect && collectTransaction?.status === "pending"` / `"failed"`).
2. **Litige actif sur commande non terminale sans aucun signal visible** — un fil de discussion support en cours peut rester invisible tant que le client ne pense pas à ouvrir l'accordéon.

**Corrections nécessaires avant de pousser :**

- Ajouter une bannière (même famille visuelle que les bannières `isCollect` existantes, tokens `--status-info-soft`/`--status-info`) pour `isManual && payment?.status === "under_review"`, à côté des bannières `isCollect` déjà présentes.
- Faire en sorte qu'un litige actif et non résolu soit signalé même quand la commande n'est pas terminale — au minimum en ouvrant l'accordéon par défaut dans ce cas précis (nécessite de savoir si un litige actif existe au niveau de la page, ce qui n'est aujourd'hui connu qu'à l'intérieur de `DisputeSection`), ou plus simplement une bannière légère de type « Yon pwoblèm siyale sou kòmand sa a — gade pi ba » si récupérer le statut du litige au niveau de la page s'avère trop coûteux pour une correction rapide.
- Une fois ces deux corrections en place : relancer `npm run verify`, refaire le tableau du §3 pour ces deux lignes spécifiquement, puis repasser par ce même gabarit de décision avant de pousser.

**Ce qui n'est PAS remis en cause :** l'architecture générale (timeline + bannière + accordéon), le choix des tokens, la non-modification des 8 composants de section, et le traitement de tous les autres statuts listés au §3, qui sont corrects et prêts.
