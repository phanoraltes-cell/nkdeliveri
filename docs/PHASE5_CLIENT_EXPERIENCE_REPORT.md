# Phase 5 — Rapport de clôture

## Expérience client — polish sur 6 écrans (Refonte Frontend Premium NK Deliveri)

**Statut :** ✅ Exécutée, vérifiée, commitée localement (`ae10100`). **En attente de votre validation avant push.**

**6 fichiers modifiés**, chacun indépendamment livrable comme le prévoyait le plan : `hero-section.tsx`, `restaurants.$slug.tsx`, `restaurants.index.tsx`, `checkout.tsx`, `orders.index.tsx`, `register-shared.tsx`.

---

## 1. Ce qui a changé, écran par écran

| Écran                                        | Changement                                                                                                                                                                                                          | Source                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Accueil                                      | Le libellé « Peman disponib » force sa propre ligne sur mobile (`w-full`, revient à `sm:w-auto`) au lieu d'un retour à la ligne imprévisible dans le `flex-wrap` existant.                                          | Faiblesse notée dans l'audit (dossier Accueil) |
| Restaurant (détail)                          | Descriptions de plat tronquées à 2 lignes (`line-clamp-2`) — hauteur de carte régulière dans une même rangée. Nombre d'avis ajouté à côté de la note dans « Avi kliyan yo ».                                        | Wireframe P5                                   |
| Restaurants (liste)                          | Tri via `Chip` : « Pi popilè » (défaut, note) / « Pi rapid » (délai de préparation), dans l'état d'URL au même titre que `q`/`page`.                                                                                | Wireframe P5                                   |
| Checkout                                     | Le bloc adresse/téléphone/notes et le bloc moyen de paiement reçoivent chacun un titre (« Livrezon » / « Peman ») et une séparation visuelle — toujours une seule page, même ordre de champs, même nombre de clics. | Wireframe P5                                   |
| Historique de commandes                      | Le statut passe d'un texte coloré brut à un `StatusBadge`, avec les mêmes tons (good/warn/bad/info) que la timeline de suivi de commande.                                                                           | Cohérence perçue (objectif explicite de P5)    |
| Inscription restaurant/livreur (`FileField`) | Aperçu miniature immédiat après sélection d'un fichier image.                                                                                                                                                       | Recommandation explicite de l'audit initial    |

## 2. Écarts assumés par rapport au plan initial, et pourquoi

- **Stats du hero non reformulées.** Le plan les conditionnait explicitement à « dès que le volume de données le permet » — sans accès à des métriques réelles (note moyenne agrégée, délai réel mesuré) dans cet environnement, les changer maintenant reviendrait à inventer des chiffres. Reporté tel quel.
- **Nombre d'avis non ajouté aux cartes de liste (accueil, page restaurants).** L'audit le recommandait pour les « cartes restaurant » au sens large, mais la table `restaurants` n'a pas de colonne de comptage d'avis — l'afficher sur une liste de 24 cartes exigerait soit une nouvelle colonne (migration, hors périmètre absolu de toute cette refonte), soit une requête par carte (N+1, mauvaise pratique). Fait uniquement sur la page détail, où la requête d'avis existante pouvait être étendue avec `count: "exact"` sans appel réseau supplémentaire.
- **Toggle mode sombre du Profil non ajouté.** C'est explicitement le sujet de P8 (« Activation du mode sombre »), pas de P5 — ajouter un bouton sans mécanisme de bascule fonctionnel derrière aurait été trompeur. Le seul item de Profil réellement actionnable maintenant (aperçu immédiat sur upload) a été traité — mais sur `FileField` (formulaires d'inscription restaurant/livreur), pas sur l'avatar du Profil lui-même, qui avait **déjà** son aperçu immédiat avant cette phase (vérifié par lecture : `avatarPreview` via `URL.createObjectURL` déjà en place).
- **« Pertinence » non offerte comme option de tri distincte.** L'app n'a pas de score de pertinence textuelle (la recherche est un simple filtre `ilike`) — un tri « pertinence » séparé aurait produit exactement le même résultat que « note », le tri par défaut. Un seul tri alternatif réel a été ajouté (délai), pas trois options dont deux identiques.

## 3. Vérification

```
typecheck        : 0 erreur (1 erreur corrigée en cours de route : le type de updateSearch()
                    dans restaurants.index.tsx ne connaissait pas encore `sort`)
lint              : 0 erreur, 12 avertissements (identiques, pré-existants) — 3 erreurs de
                    formatage prettier corrigées par eslint --fix avant cette exécution finale
check:migrations  : 122 migrations scannées, aucun hazard non résolu
tests unitaires   : 105/105 passés
build             : réussi — présence de la nouvelle classe .line-clamp-2 confirmée directement
                    dans le CSS compilé livré
```

## 4. Recommandation

Six changements localisés, chacun à faible risque individuellement (aucune nouvelle table, aucune migration, une seule extension mineure de requête déjà existante avec `count: "exact"`). Comme pour les phases précédentes, aucune vérification visuelle réelle n'est disponible dans cet environnement.

**Recommandation :** un coup d'œil visuel sur les 6 écrans — en particulier le tri de la liste restaurants et le rendu du badge de statut dans l'historique — reste utile mais n'est pas un blocage de principe.

**En attente de votre validation avant push.**
