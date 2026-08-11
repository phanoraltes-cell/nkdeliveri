# F-01 — Google Maps Browser Key: Before/After Verification Report

**Date** : 2026-08-11
**Scope** : `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY`, `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID` uniquement.
**Statut final** : 🟢 F-01 RESOLVED (voir § 13)

## 1. Executive Summary

Baseline complet capturé, puis re-vérifié à l'identique sur plusieurs passes de cette session (aucune régression, aucun fichier de cartographie touché). Le volet Vercel était déjà résolu avant le début de cette série de vérifications (variables absentes, constaté sans action de ma part). Le volet Google Cloud, initialement bloquant (aucun accès Google Cloud Console depuis cet environnement), a été traité **manuellement par l'opérateur du projet** — clé réinitialisée/révoquée directement dans Google Cloud Console, rapporté le 2026-08-11. Cette action n'a **pas** pu être vérifiée indépendamment par un outil depuis cet environnement (toujours aucun accès `gcloud`/navigateur) ; elle repose sur la confirmation directe de l'opérateur, qui est la seule source d'évidence disponible pour une action réalisée entièrement hors de cet environnement.

## 2. Baseline BEFORE

```text
========== F-01 BASELINE (2026-08-11) ==========

Git HEAD:                        8f9d5dc454838e27ea4cf37f01fd39df188a1fd2
Branch:                          main
Git status:                      3 fichiers modifiés préexistants + 13 fichiers non suivis
                                  préexistants (aucun lié à F-01 sauf le rapport F-01
                                  lui-même, créé lors d'une tâche précédente)

Vercel Browser Key:              ABSENT
Vercel Tracking ID:               ABSENT

Runtime Google Maps references:  0 (code/config) — 4+4 matches trouvés, mais
                                  intégralement à l'intérieur de ce rapport
                                  lui-même (auto-documentation du finding,
                                  pas une référence runtime)

Leaflet:                          PASS (présent, package.json + LeafletMap.tsx)
OpenStreetMap:                    PASS (tuiles {s}.tile.openstreetmap.org +
                                  Nominatim, allowlisté dans la CSP de src/server.ts)
OSRM:                             PASS (src/services/routing.ts)
Google Maps runtime:              ABSENT (confirmé)

Typecheck:                        PASS (0 erreur)
Lint:                             PASS (0 erreur, 3 warnings préexistants documentés,
                                  sans rapport avec F-01)
Build:                             PASS (succès, sortie sans référence googleapis)

Production:
  Homepage:                       HTTP 200
  Checkout:                       HTTP 200
  Restaurants (page avec carte):  HTTP 200
  googleapis.com dans le HTML livré: 0 occurrence
====================================
```

## 3. Actions réalisées dans cette session

**Aucune.** Recherche exhaustive confirmant que le volet Vercel (suppression des deux variables) avait déjà été effectué **avant** le début de cette tâche — je l'ai constaté (via `vercel env ls production`, lecture seule), je ne l'ai pas exécuté cette session. Aucune commande de suppression, aucune modification de fichier, aucune action Google Cloud n'a été tentée ni effectuée ici.

Google Cloud reste inaccessible (pas de navigateur, pas de CLI `gcloud` dans cet environnement) — **révocation non tentée, non vérifiée**.

## 4. Verification AFTER

Contrôles D1–D3 et D6 ré-exécutés intégralement. D4 (cartographie) et D5 (build) **non ré-exécutés en double** : `git status`/`git rev-parse HEAD` en D1 sont strictement identiques à la baseline A1 (preuve directe qu'aucun fichier n'a changé entre les deux mesures), rendant un deuxième build/typecheck/lint redondant — les résultats A5/A4 restent valides par construction, pas par supposition.

```text
Git HEAD AFTER:                   8f9d5dc454838e27ea4cf37f01fd39df188a1fd2 (identique)
Git status AFTER:                 identique caractère pour caractère à BEFORE
Vercel Browser Key AFTER:         ABSENT (re-confirmé)
Vercel Tracking ID AFTER:         ABSENT (re-confirmé)
Runtime references AFTER:         0 code/config (identique)
Production Homepage AFTER:        HTTP 200
Production Checkout AFTER:        HTTP 200
```

## 5. Before/After Matrix

| Contrôle | BEFORE | AFTER | Résultat |
|---|---|---|---|
| Git HEAD | `8f9d5dc` | `8f9d5dc` | PASS (inchangé) |
| Git status | 16 entrées préexistantes | identique | PASS (aucune dérive) |
| Browser key Vercel | ABSENT | ABSENT | PASS (déjà résolu avant cette session) |
| Tracking ID Vercel | ABSENT | ABSENT | PASS (déjà résolu avant cette session) |
| Références browser key (code/config) | 0 | 0 | PASS |
| Références tracking ID (code/config) | 0 | 0 | PASS |
| Google Maps runtime | ABSENT | ABSENT | PASS |
| Leaflet | PASS | PASS | PASS |
| OpenStreetMap | PASS | PASS | PASS |
| OSRM | PASS | PASS | PASS |
| Typecheck | PASS | PASS (non re-testé, git diff prouve stabilité) | PASS |
| Lint | PASS | PASS (idem) | PASS |
| Build | PASS | PASS (idem) | PASS |
| Homepage | HTTP 200 | HTTP 200 | PASS |
| Checkout | HTTP 200 | HTTP 200 | PASS |
| Google Cloud key | UNKNOWN (accès indisponible) | Réinitialisée/révoquée (rapporté par l'opérateur, 2026-08-11) | PASS (évidence opérateur, non outillée) |

## 6. Google Cloud status

```text
Google Cloud revocation: REPORTED DONE BY OPERATOR (2026-08-11) — NOT INDEPENDENTLY VERIFIED
```

Aucun accès outillé n'a jamais été disponible dans cet environnement (pas de navigateur, `gcloud` CLI absent du PATH — confirmé à plusieurs reprises). L'opérateur du projet a réinitialisé/révoqué la clé directement dans Google Cloud Console et l'a confirmé explicitement. Je n'ai aucun moyen technique, depuis cet environnement, de vérifier indépendamment cette action (pas de requête API Google Cloud possible) — elle est donc enregistrée comme **rapportée par l'opérateur**, catégorie d'évidence distincte d'une vérification outillée, mais suffisante pour clore ce point puisqu'il s'agit d'une action que seul l'opérateur pouvait effectuer et confirmer.

## 7. Vercel status

Les deux variables sont **absentes** de Vercel Production, confirmé à deux reprises dans cette session (avant et après, résultat identique) et une troisième fois par rapport à la vérification de la tâche précédente. **Origine du retrait non attribuable à cette session** — aucune commande de suppression n'a été exécutée ici ; il s'agit d'un état déjà en place au moment où cette vérification a commencé.

## 8. Cartography regression check

Aucune régression. Leaflet, OpenStreetMap (tuiles + Nominatim) et OSRM confirmés présents et inchangés avant/après ; aucun fichier de `src/components/maps/`, `src/services/routing.ts`, ni aucune dépendance cartographique n'a été touché — confirmé par `git status` identique entre les deux mesures.

## 9. Git scope verification

`git status --short` identique caractère pour caractère entre BEFORE et AFTER — **aucune modification, aucun fichier d'un autre chantier touché**. Seul fichier lié à F-01 dans l'arbre de travail : ce rapport (`docs/F01_GOOGLE_MAPS_KEY_REMEDIATION_REPORT.md`), non commité.

## 10. Residual risk

- **Vercel : risque résiduel nul.**
- **Google Cloud : risque résiduel faible.** Clé de type "browser" (jamais un secret serveur) ; action de réinitialisation/révocation rapportée par l'opérateur le 2026-08-11. Non re-vérifiable de façon outillée depuis cet environnement (aucun accès Google Cloud à aucun moment de cet engagement), mais il s'agit d'une action que seul l'opérateur pouvait poser — traité comme clos sur la base de sa confirmation directe.
- **Historique Git** : la valeur historique reste techniquement récupérable (historique non réécrit, conformément à la consigne — aucune purge n'a été demandée ni effectuée). Sans intérêt pratique désormais que la clé a été réinitialisée côté Google Cloud — une ancienne valeur ne donne plus accès à rien.

## 11. Manual actions remaining

**Aucune.** L'action Google Cloud (seule étape manuelle restante) a été effectuée par l'opérateur. Optionnel, faible urgence, non requis : purge de l'historique Git (`git filter-repo`/BFG) pour retirer les 2 commits contenant l'ancienne valeur — hors périmètre de cette mission, à envisager séparément si souhaité.

## 12. Final verdict

```text
🟢 F-01 RESOLVED
```

Tous les critères de succès sont satisfaits :
- Ancienne clé non utilisée par le code actuel (vérifié, plusieurs passes, 0 référence).
- Clé Google Cloud réinitialisée/révoquée — rapporté explicitement par l'opérateur le 2026-08-11 (seule source d'évidence possible pour une action réalisée entièrement hors de cet environnement, aucun outil ne pouvant la vérifier indépendamment ici).
- Les deux variables Vercel Production sont absentes (vérifié, plusieurs passes).
- Aucune référence runtime, aucune régression cartographique, aucun fichier hors périmètre modifié.
- Aucun secret affiché dans ce rapport ni dans aucune réponse de cette série de tâches.
