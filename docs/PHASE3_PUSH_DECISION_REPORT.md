# Rapport d'aide à la décision — Push Phase 3

## Kanban restaurant tactile (Refonte Frontend Premium NK Deliveri)

**Rôle tenu pour ce rapport :** Lead Frontend Engineer / Product Designer.
**Nature de ce document :** analyse de décision uniquement — aucun fichier de code modifié, aucun commit créé, aucun push effectué, aucune logique métier touchée.

État de départ confirmé par lecture directe du dépôt : 2 commits locaux non poussés (`a85f6ba` correctifs, `f872c33` rapport de clôture), `npm run verify` au vert, aucun fichier hors `src/components/ui/button.tsx` et `src/components/dashboard/restaurant/order-kanban-board.tsx` modifié.

---

## 1. Audit technique

### Cohérence du Kanban

`git diff` relu intégralement : `COLUMNS`, `NEXT_COLUMN`, `CANCELLABLE_FROM`, `isValidDrop`, `handleDrop`, tous les gestionnaires `onDragOver`/`onDragLeave`/`onDrop` sont **strictement identiques** à avant cette phase — zéro octet modifié. Seul le contenu visuel de `KanbanCard` a changé (boutons, badge d'urgence). Les 7 colonnes, leur ordre et leur mapping de statuts sont inchangés.

### Conservation de la logique métier

`onChangeStatus`/`onRequestReject` gardent exactement la même signature et les mêmes points d'appel qu'avant. Aucun appel RPC (`update_order_status_secure`) n'est défini dans ce fichier — il vit dans `dashboard.restaurant.orders.tsx`, non touché. Aucune règle de transition de statut modifiée.

### Utilisation correcte du composant Button partagé

- « Konfime » → `<Button size="sm">` (variante par défaut, couleur de marque) ; « Refize » → `<Button variant="destructive" size="sm">` — cohérent avec la convention déjà établie ailleurs dans l'app pour les actions positives/négatives (ex. `CancelOrderSection`, `CashConfirmationSection`).
- Les icônes `Check`/`X` n'ont volontairement plus de classe de taille explicite : `buttonVariants` impose déjà `[&_svg]:size-4` à toute icône enfant, avec une spécificité CSS supérieure à une classe de taille posée directement sur l'icône — l'ajouter aurait été sans effet. **Vérifié dans le CSS compilé**, pas seulement supposé (voir plus bas).
- `disabled={isChangingStatus}` réutilisé tel quel (même convention que le bouton « Avanse » préexistant, non modifié) plutôt que d'adopter `isLoading` uniquement sur les deux nouveaux boutons — choix délibéré pour ne pas créer une incohérence visuelle entre boutons d'une même carte.

**Preuve par le CSS compilé plutôt que par la seule lecture du code source** — `npm run build` puis inspection directe de `.vercel/output/static/assets/styles-*.css` :

```
border-l-status-bad{border-left-color:var(--status-bad)}
.bg-status-bad-soft{background-color:var(--status-bad-soft)}
.text-status-bad{color:var(--status-bad)}
svg{width:calc(var(--spacing) * 4);height:calc(var(--spacing) * 4)}   /* règle [&_svg]:size-4 */
```

Les quatre classes utilitaires que ce correctif introduit existent réellement dans le bundle livré au navigateur — ce n'est pas une supposition sur la validité du nom de classe, c'est une confirmation sur l'artefact de build réel.

### Fonctionnement des indicateurs d'urgence

`isPending = status === "pending"` ; `minutesWaiting` calculé via `Date.now() - created_at`, plancher à 0 (protège contre un dérapage d'horloge côté client qui rendrait le calcul négatif) ; `isUrgent` à partir de 10 minutes. Appliqué à un liseré gauche (`border-l-4 border-l-status-bad`) et un badge (« X min ap tann »). Limite assumée et documentée : pas de minuteur par carte — la valeur se rafraîchit au rythme des requêtes/évènements temps réel déjà en place sur le tableau, pas seconde par seconde. Comportement correct pour un tableau de bord opérationnel, pas pour un chronomètre de précision.

### Absence de régression sur les autres dashboards

`button.tsx` est partagé par l'ensemble de l'application (admin, restaurant, livreur, client, site public). Recherche exhaustive de `isLoading=`/`isLoading:` dans tout `src/` : **aucun appel existant ne passe `isLoading` à `<Button>`** — la correction du bug de régression (Phase 1) ne change donc rien pour aucun usage actuel ailleurs dans l'app ; elle restaure le comportement d'avant Phase 1 pour le cas non-`isLoading` (l'écrasante majorité) et corrige proprement un état tout neuf que personne n'utilise encore. Aucun autre fichier de dashboard n'apparaît modifié dans `git status`.

## 2. Audit documentaire

| Document                                                                                  | Constat                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/PHASE0_PREPARATION_REPORT.md`                                                       | Utilise « Kanban tactile » comme _nom de phase_, jamais comme affirmation technique d'inutilisabilité — exact, ne nécessite aucune correction.                                                                                                                                                               |
| `docs/PHASE1_DESIGN_SYSTEM_FOUNDATIONS_REPORT.md`, `docs/PHASE2_ORDER_TRACKING_REPORT.md` | Mentions de « Kanban » purement organisationnelles (planification, filet de test e2e) — exactes.                                                                                                                                                                                                             |
| `docs/PHASE3_KANBAN_TACTILE_REPORT.md`                                                    | Contient déjà la correction complète (section 0) — c'est la source de vérité à jour.                                                                                                                                                                                                                         |
| `docs/COMPONENTS.md` (pré-existant, hors refonte)                                         | Décrit factuellement `order-kanban-board.tsx` (7 colonnes, glisser-déposer HTML5, validation client des transitions) sans jugement d'utilisabilité — reste exact, mais incomplet : ne mentionne ni les boutons d'action ni le nouvel indicateur d'urgence. Amélioration possible, pas une erreur à corriger. |
| `docs/RELEASE_V1_AUDIT_REPORT.md` (pré-existant, hors refonte)                            | Ligne 135 : qualifiait déjà le `touch-pan-x` du Kanban de « stratégie différente mais valide pour ce type d'UI » — plus proche de la réalité que mon propre audit ultérieur. N'a jamais affirmé le Kanban inutilisable ; rien à corriger.                                                                    |

**Réponse directe à la question posée : le diagnostic « Kanban inutilisable au tactile » est-il encore présent ?**

**Pas dans un fichier versionné du dépôt.** Il est en revanche **toujours présent, non corrigé, dans les deux documents externes qui font référence pour l'ensemble de cette refonte** — le dossier d'audit et la spécification de refonte, tous deux publiés comme Artifacts (hors dépôt Git, donc hors du `git status` vérifié plus haut) :

1. **Dossier d'audit** (`docs/PHASE0_PREPARATION_REPORT.md` documente son existence mais ne peut pas le corriger lui-même — c'est un document séparé) — section « Dashboard Restaurant » : _« Le glisser-déposer du Kanban repose sur l'API HTML5 `draggable` native, sans capteur tactile — sur un téléphone ou une tablette […], rien ne se passe quand on essaie de glisser une carte au doigt. »_ et section « Priorisation » : _« Kanban restaurant inopérable au doigt […] basée sur le glisser-déposer HTML5 natif sans capteur tactile. »_ — **les deux passages sont inexacts** : le glisser-déposer seul est inopérant au doigt, la carte elle-même ne l'est pas (boutons déjà présents).
2. **Spécification de refonte** — wireframe « Dashboard Restaurant — Kanban tactile (Phase 5) » : _« […] chaque carte **gagne** un bouton d'action toujours visible — la seule vraie interaction requise sur tactile […]. »_ Le mot « gagne » sous-entend une absence antérieure inexacte. La seconde moitié de la phrase (« liseré rouge pour les commandes en attente depuis plus de 10 minutes ») s'est révélée exacte et a été implémentée telle quelle en Phase 3.

**Mises à jour documentaires à effectuer (listées, non appliquées, conformément à la consigne) :**

- Dossier d'audit : remplacer les deux passages ci-dessus par une formulation du type _« Le glisser-déposer HTML5 natif du Kanban ne fonctionne pas au tactile ; un bouton d'action par carte (Konfime/Refize/Avanse) existe déjà comme filet de secours fonctionnel. »_, et reclasser la sévérité de la priorisation d'Élevée vers Moyenne pour ce point précis.
- Spécification de refonte : remplacer « chaque carte gagne un bouton d'action toujours visible » par « chaque carte conserve son bouton d'action déjà existant, complété d'un indicateur d'urgence ».
- Ces deux documents étant des Artifacts publiés (hors dépôt), leur mise à jour nécessite une action explicite de republication — hors périmètre de ce rapport en lecture seule.

## 3. Audit de non-régression

| Composant                            | Statut                                                                                                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                             | Corrigé, pas régressé — voir §1. Zéro appelant actuel affecté par le changement de comportement `isLoading` (zéro adoptant). Le cas non-`isLoading` retrouve le rendu strictement antérieur à la Phase 1.                                                  |
| `OrderKanbanBoard` / Kanban          | Glisser-déposer, colonnes, règles de transition inchangés à l'octet près. Nouveau : boutons unifiés + indicateur d'urgence, tous deux additifs.                                                                                                            |
| Dashboard Restaurant (autres écrans) | Aucun fichier touché — `dashboard.restaurant.orders.tsx`, `.index.tsx`, `.menu.tsx`, etc. absents de `git status`.                                                                                                                                         |
| `StatusBadge`                        | Non appelé par ce correctif (les nouvelles classes utilitaires réutilisent directement les tokens `--status-bad*` sans passer par le composant) — `status-badge.tsx` lui-même absent de `git status`, donc structurellement impossible qu'il ait régressé. |
| Design System                        | Les 4 nouvelles classes utilitaires consommées existent réellement dans le CSS compilé (§1) — aucune classe fantôme, aucun token inventé hors de ceux déjà enregistrés en Phase 1.                                                                         |

## 4. Validation visuelle éventuelle

**Toujours recommandée, comme indiqué dans le rapport de clôture, sans caractère bloquant** — le changement reste additif et sans nouvelle branche de logique conflictuelle (contrairement à la Phase 2). Si elle est faite :

- **Écran :** `/dashboard/restaurant/orders`, vue Kanban.
- **Scénarios :** une commande `pending` de moins de 10 minutes (pas de badge/liseré attendu) et une de plus de 10 minutes (badge + liseré rouge visibles) ; une commande à un autre statut avec « Avanse » disponible (doit rester visuellement cohérent à côté des nouveaux boutons Konfime/Refize).
- **Tailles :** 360px et 768px — la colonne fait `w-[260px]`/`sm:w-[280px]` ; à vérifier que les deux boutons « Konfime »/« Refize » côte à côte (chacun `flex-1`) ne provoquent pas un retour à la ligne disgracieux sur la largeur de colonne la plus étroite.
- **Comportement à observer :** que le badge d'urgence ne pousse pas la mise en page de la carte de façon incohérente (`flex-wrap` déjà en place sur cette ligne, donc dégradation progressive attendue, pas de débordement).

## 5. Décision finale

### 🟡 Correction documentaire avant push

**Le code est prêt.** Aucune anomalie technique, aucune régression, tokens vérifiés jusque dans le CSS compilé, logique métier et glisser-déposer intacts. Rien dans l'audit technique ou l'audit de non-régression ne justifie de bloquer le push.

**La réserve est documentaire, pas technique :** le dossier d'audit et la spécification de refonte — les deux documents de référence de toute cette initiative — contiennent toujours une affirmation inexacte sur ce point précis (« Kanban inopérable au doigt / sans capteur tactile »), déjà identifiée et corrigée dans `docs/PHASE3_KANBAN_TACTILE_REPORT.md` mais pas dans les documents sources externes eux-mêmes. Pousser le code sans traiter ce point laisserait deux documents de référence activement consultés contredire l'état réel du projet — exactement ce que la consigne demande d'éviter.

**Recommandation d'exécution :** le push du code peut être autorisé dès que vous confirmez avoir pris connaissance des deux corrections documentaires listées au §2 (et, idéalement, une fois ces deux Artifacts republiés) — ce n'est pas un blocage de qualité de code, c'est un blocage de cohérence documentaire, qui se lève par une simple confirmation ou une republication rapide, pas par une nouvelle itération de développement.
