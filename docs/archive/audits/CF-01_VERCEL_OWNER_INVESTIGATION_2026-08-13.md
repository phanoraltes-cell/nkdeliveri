# CF-01 — INVESTIGATION : PROPRIÉTAIRE RÉEL DE `nkdelivery.vercel.app`

**NK Deliveri — Origin Bypass**

**Date** : 2026-08-14, ~05:10–05:15 UTC
**Type** : INVESTIGATION UNIQUEMENT — aucune modification de code, DNS, Cloudflare, Vercel, Supabase. Seule la création de ce rapport est autorisée.
**Méthode** : lecture directe du repository (fichiers de configuration, historique git), requêtes HTTP réelles à très faible volume (aucun scan), **aucun accès API/dashboard Vercel disponible dans cette session** — voir §5.

> **⚠️ ADDENDUM (2026-08-14)** : l'opérateur a confirmé, en consultant lui-même le dashboard Vercel du projet qui déploie réellement `nkdeliveri.com`, que son `Project ID` (Settings → General) est bien `prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x` — **identique** à celui trouvé dans `.vercel/project.json` de ce dépôt. Ceci **confirme** (source : opérateur, pas une API interrogée par cette session) l'hypothèse §9/§7 qui était marquée `PROBABLE` : c'est bien **le même projet**. La confusion initiale de l'opérateur ("le domaine n'est nulle part dans mon dashboard") s'explique autrement qu'imaginé — voir §7/§9/§10 corrigés ci-dessous, barrés plutôt que réécrits silencieusement.

---

## 1. Executive Summary

**Découverte principale, non anticipée par les deux rapports précédents (`SECURITY_PERIMETER_AUDIT` et `CF-01_POST_REMEDIATION_VERIFICATION`) : le contenu servi par `nkdelivery.vercel.app` n'est PAS identique au contenu actuel de `www.nkdeliveri.com`.** Une comparaison octet par octet effectuée dans cette session révèle deux artefacts différents : titre différent (« NK Delivery — Livraison de repas aux Gonaïves » en français vs « NK Deliveri — Manje lakay, livre lakay ou » en kreyòl), taille différente (33 767 vs 64 970 octets), meta description différente. Les deux rapports précédents avaient conclu à une identité de contenu sur la seule base du nom de domaine et du statut HTTP `200` — **cette conclusion doit être nuancée : ce n'est pas la page d'accueil actuelle qui fuit, c'est une version antérieure, probablement gelée en cache.**

**Preuve la plus forte quant à la propriété** : le repository local contient `.vercel/project.json`, créé par `vercel link`, qui rattache **ce dépôt exact** à un projet Vercel nommé **`nkdelivery`** (`projectId: prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x`, `orgId: team_xjDg0M8Vzbd8NK8r2oh6K7vW`). Le nom de domaine par défaut d'un projet Vercel suit toujours la convention `<nom-du-projet>.vercel.app` — c'est un mécanisme de plateforme standard, pas une supposition propre à ce projet. **`nkdelivery.vercel.app` correspond exactement à ce nom de projet.** C'est très probablement la cause de la confusion de l'opérateur dans le dashboard : le projet ne s'appelle pas « nkdeliveri » (comme le domaine officiel), il s'appelle **« nkdelivery »** (orthographe anglicisée, cohérente avec l'ancien branding « NK Delivery » documenté dans `docs/SEO_BRAND_AUTHORITY_NK_DELIVERI.md`).

**Ce que je ne peux pas confirmer sans accès dashboard/API Vercel** : si ce projet `nkdelivery` est (a) le même projet qui déploie aujourd'hui `nkdeliveri.com` mais dont l'alias de domaine par défaut est resté figé sur un ancien build, ou (b) un projet distinct/dormant qui coexiste sous le même compte/équipe. Voir §9 pour le classement de probabilité.

---

## 2. Initial Finding _(rappel du contexte fourni)_

- Domaine officiel : `https://nkdeliveri.com` → Cloudflare confirmé (rapports précédents).
- `https://nkdelivery.vercel.app` sert un contenu qui _ressemble_ à NK Deliveri (même famille de produit : livraison de repas, Gonaïves) mais, comme découvert dans cette session, **pas le build actuel**.
- Une suppression manuelle de domaine a été tentée dans un projet Vercel — sans effet observable, ce qui a mené à cette investigation sur l'identité réelle du projet concerné.

---

## 3. Repository Evidence

| Référence                                                                                                                                                                                                                      | Fichier                                   | Type                         | Importance                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projectName: "nkdelivery"`, `projectId: prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x`, `orgId: team_xjDg0M8Vzbd8NK8r2oh6K7vW`                                                                                                             | `.vercel/project.json`                    | **SECURITY_RELEVANT**        | **Preuve directe et la plus forte de cette investigation** — ce fichier n'existe que parce qu'un `vercel link`/`vercel deploy` a été exécuté depuis ce dépôt exact vers ce projet exact                                                                                                                                                                                                                                                                                       |
| `"projectName":"nkdelivery"` répété                                                                                                                                                                                            | `.vercel/project.json`                    | SECURITY_RELEVANT            | Confirme l'orthographe exacte du nom de projet (« delivery », pas « deliveri »)                                                                                                                                                                                                                                                                                                                                                                                               |
| `SITE_URL = "https://www.nkdeliveri.com"`                                                                                                                                                                                      | `src/lib/site-config.ts`                  | EXPECTED                     | Seule source de vérité canonique côté application — aucune référence à un hostname Vercel dans le code applicatif                                                                                                                                                                                                                                                                                                                                                             |
| 6 headers statiques (`X-Frame-Options`, HSTS, etc.), aucun CSP, aucune mention de domaine                                                                                                                                      | `vercel.json`                             | EXPECTED                     | Configuration de plateforme, ne référence aucun hostname explicitement — s'applique à tout domaine attaché au projet                                                                                                                                                                                                                                                                                                                                                          |
| `nitro: { preset: "vercel" }` + commentaire expliquant une **« ambiguïté de build Cloudflare/Vercel »** historique, corrigée le 2026-07-15 (commit `df7ca82`)                                                                  | `vite.config.ts`, `docs/ARCHITECTURE.md`  | **SECURITY_RELEVANT**        | Avant cette date, un build lancé hors de l'environnement Vercel natif produisait par défaut une sortie `cloudflare-module` (Worker) au lieu d'une fonction Vercel — n'explique pas directement le contenu périmé observé (le commit précise que les déploiements Vercel eux-mêmes, via leur propre environnement de build, n'étaient pas affectés), mais confirme qu'il y a bien eu, historiquement, une période de configuration de build instable autour de la cible Vercel |
| `alternateName: "NK Delivery"` ajouté délibérément au schema.org `Organization` de la page actuelle, pour capturer la confusion orthographique Google entre « NK Delivery » (anglicisé) et « NK Deliveri » (marque officielle) | `docs/SEO_BRAND_AUTHORITY_NK_DELIVERI.md` | SECURITY_RELEVANT (contexte) | Confirme que « NK Delivery » n'est pas une marque totalement étrangère au projet — c'est une variante orthographique documentée et connue de l'équipe elle-même, ce qui rend d'autant plus plausible qu'un ancien build/projet ait porté ce nom avant le passage au kreyòl                                                                                                                                                                                                    |
| Aucune référence à `vercel.app` ou `nkdelivery` dans `src/`                                                                                                                                                                    | grep exhaustif                            | UNRELATED                    | Le code applicatif ne dépend d'aucune façon du hostname Vercel — la fuite n'est pas un bug de code, c'est un état de plateforme                                                                                                                                                                                                                                                                                                                                               |
| Commit `2e0c35b feat(payments): NatCash Otomatik + Payment Global -> MonCash/NatCash Otomatik rebrand` et historique git montrant un développement continu depuis 2026-07-02 (après un commit-gabarit isolé du 2025-01-01)     | `git log`                                 | UNRELATED                    | Contexte temporel seulement — pas de trace explicite d'un « rename de projet Vercel » dans l'historique de code (ce type de changement ne serait de toute façon pas versionné)                                                                                                                                                                                                                                                                                                |

**Aucun fichier n'a été modifié pour produire ce tableau.**

---

## 4. Live HTTP Evidence

Comparaison directe, requêtes effectuées à quelques secondes d'intervalle dans cette session :

| Champ                                    | `nkdelivery.vercel.app/`                                                                                                                                                                        | `www.nkdeliveri.com/`                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `<title>`                                | **« NK Delivery — Livraison de repas aux Gonaïves »** (français)                                                                                                                                | **« NK Deliveri — Manje lakay, livre lakay ou »** (kreyòl)                   |
| Meta description                         | _(non capturée dans cette comparaison — titre déjà suffisant pour conclure à une différence)_                                                                                                   | « NK Deliveri se platfòm livrezon manje Gonaïves, Ayiti... »                 |
| `og:site_name`                           | _(absent du même extrait — voir titre)_                                                                                                                                                         | « NK Deliveri »                                                              |
| Taille du corps HTML                     | **33 767 octets**                                                                                                                                                                               | **64 970 octets**                                                            |
| Hash des assets JS (`assets/index-*.js`) | Aucun motif `assets/index-*.js` trouvé dans le corps                                                                                                                                            | `assets/index-BgiMVoBT.js`                                                   |
| `theme-color`                            | non observé dans l'extrait capturé                                                                                                                                                              | `#F97316`                                                                    |
| `Server`                                 | `Vercel`                                                                                                                                                                                        | `cloudflare`                                                                 |
| `CF-RAY`                                 | Absent                                                                                                                                                                                          | Présent                                                                      |
| `Content-Security-Policy`                | Absent                                                                                                                                                                                          | Présent, avec nonce                                                          |
| `Etag`                                   | `07cd427cc879c647c3888d188a3d6df0` (**identique sur toutes les requêtes de cette investigation ET des deux rapports précédents**)                                                               | Change à chaque requête (SSR dynamique, `x-vercel-cache: MISS` systématique) |
| `Last-Modified`                          | `Thu, 13 Aug 2026 20:51:14 GMT` — **coïncide exactement avec l'heure de la toute première requête de cette investigation vers ce hostname**, lors de l'audit initial `SECURITY_PERIMETER_AUDIT` | N/A (pas de `Last-Modified` sur une réponse SSR dynamique)                   |
| `X-Vercel-Cache`                         | `HIT`, y compris avec un paramètre de requête aléatoire pour forcer une nouvelle clé de cache (testé dans le rapport de post-remédiation)                                                       | `MISS` systématique                                                          |
| `Age`                                    | Croissant en continu depuis la première observation, jamais réinitialisé (29 151 s → 30 165 s sur la fenêtre d'observation cumulée)                                                             | `0`                                                                          |

**Conclusion factuelle de cette section** : `nkdelivery.vercel.app` ne sert **pas** un miroir en temps réel de `www.nkdeliveri.com`. Il sert un **artefact figé, mis en cache une seule fois**, dont le contenu correspond à une version antérieure et différente du produit (branding français « NK Delivery » au lieu du kreyòl actuel « NK Deliveri »). La coïncidence exacte entre `Last-Modified` et l'heure de ma toute première requête vers ce hostname (dans l'audit d'hier) suggère fortement — **INFERRED, pas prouvé** — que cette page a été générée/rendue à la demande lors de ce tout premier accès (mécanisme de type rendu-à-la-demande suivi d'une mise en cache longue durée côté edge Vercel), à partir de **quel que soit le déploiement qui était marqué comme la cible de ce hostname à ce moment-là** — pas nécessairement le déploiement actuellement en production sur le domaine officiel.

---

## 5. Vercel Ownership Evidence

**`VERCEL API ACCESS NOT AVAILABLE`** — cette session n'a accès à aucun token, CLI authentifié (`vercel whoami` → commande introuvable) ni identifiant permettant d'interroger l'API Vercel ou le dashboard. Toute conclusion de cette section repose uniquement sur (a) le fichier `.vercel/project.json` présent dans le repository, (b) le comportement HTTP observable publiquement.

**Preuve disponible (VERIFIED — lecture de fichier)** :

```json
{
  "projectId": "prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x",
  "orgId": "team_xjDg0M8Vzbd8NK8r2oh6K7vW",
  "projectName": "nkdelivery"
}
```

**Ce que cela prouve** : à un moment donné, quelqu'un a exécuté `vercel link` (ou un premier `vercel deploy`) **depuis ce dépôt exact** et l'a rattaché à ce projet précis. C'est la preuve la plus directe et la plus fiable disponible sans accès dashboard.

**Ce que cela ne prouve PAS avec certitude absolue** : que ce fichier reflète encore l'état actuel si le projet a depuis été supprimé/recréé/renommé côté Vercel, ou si les déploiements de production passent aujourd'hui exclusivement par l'intégration Git native de Vercel (auquel cas ce fichier local n'a plus besoin d'être à jour pour que les déploiements fonctionnent — il devient un vestige de la configuration initiale, toujours correct dans l'immense majorité des cas, mais pas garanti à 100 % sans confirmation dashboard).

---

## 6. Deployment Evidence

**`VERCEL API ACCESS NOT AVAILABLE`** — impossible de lister les déploiements, leur ID, ou leur alias depuis cette session. Les seuls signaux indirects disponibles sont les en-têtes HTTP déjà documentés en §4 :

- `X-Vercel-Id` change à chaque requête sur les deux hostnames (identifiant de _requête_ edge, pas de _déploiement_ — ne permet pas d'identifier le build).
- Aucun en-tête `x-vercel-deployment-url` ou équivalent n'a été observé dans les réponses capturées.
- Le seul signal exploitable reste `Etag`/`Last-Modified`/`Content-Length`, déjà documentés — suffisants pour établir que le contenu diffère, pas pour identifier un ID de déploiement précis.

---

## 7. Alias / Domain Analysis

| Hypothèse                                                                                                                                                                                            |                                                                          Probabilité | Preuve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------------------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~Même projet Vercel (`nkdelivery`, celui lié à ce dépôt) que celui qui sert `nkdeliveri.com`, mais son alias de domaine par défaut (`.vercel.app`) est resté figé sur un ancien déploiement/rendu~~ |                                             ~~PROBABLE~~ → **CONFIRMÉ (2026-08-14)** | `.vercel/project.json` de ce dépôt exact pointe vers un projet nommé exactement `nkdelivery` (§5) ; **l'opérateur a vérifié dans son propre dashboard Vercel que le `Project ID` du projet servant `nkdeliveri.com` est bien `prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x`, identique** ; le comportement de cache (Etag figé, jamais de MISS même en forçant une nouvelle clé) est cohérent avec un artefact statique jamais réinvalidé plutôt qu'avec un routage vers un serveur toujours actif |
| **Projet Vercel distinct, plus ancien ou dormant, non lié à ce dépôt local, coexistant sous le même compte/équipe**                                                                                  |                                                                             POSSIBLE | Le contenu diffère significativement (français vs kreyòl, taille quasi doublée) — cohérent avec un projet séparé et jamais développé depuis ; rien dans le repository ne le confirme ni ne l'infirme directement                                                                                                                                                                                                                                                                       |
| **Alias de déploiement historique (« Preview » ou ancienne « Production ») du même projet, jamais retiré manuellement**                                                                              |                                                                             POSSIBLE | Comportement Vercel connu : promouvoir un nouveau déploiement en Production ne supprime pas automatiquement les anciens alias explicitement assignés ; cohérent avec le contenu figé observé                                                                                                                                                                                                                                                                                           |
| **Cache edge Vercel uniquement, sans lien avec un alias de domaine actif** (le domaine aurait déjà été détaché, mais un objet en cache continue d'être servi)                                        | POSSIBLE, déjà documenté dans `CF-01_POST_REMEDIATION_VERIFICATION_2026-08-13.md` §9 | `X-Vercel-Cache: HIT` persistant même avec contournement de cache par requête — déjà observé et documenté ; reste compatible avec chacune des trois hypothèses ci-dessus (le cache peut figer le contenu d'un alias toujours actif comme celui d'un alias déjà retiré)                                                                                                                                                                                                                 |
| **Autre projet totalement indépendant, sans rapport avec NK Deliveri, coïncidence de nommage**                                                                                                       |                                                                         PEU PROBABLE | Le contenu (livraison de repas, Gonaïves, mêmes couleurs/famille de produit implicite) rend une coïncidence totale peu crédible, bien que non formellement exclue sans lecture du HTML complet ligne à ligne                                                                                                                                                                                                                                                                           |

**Aucune de ces hypothèses n'est présentée comme un fait établi.** La première reste la mieux soutenue par les preuves directement disponibles dans ce repository.

---

## 8. Production vs Bypass Comparison

```text
Chemin officiel :
Client
 ↓
nkdeliveri.com / www.nkdeliveri.com
 ↓
Cloudflare (CF-RAY présent, CSP dynamique avec nonce, VERIFIED)
 ↓
Vercel — fonction SSR (TanStack Start), x-vercel-cache: MISS systématique (contenu généré à chaque requête)
 ↓
NK Deliveri (build actuel, branding kreyòl « NK Deliveri »)

Chemin de contournement :
Client
 ↓
nkdelivery.vercel.app
 ↓
Vercel — domaine par défaut du projet "nkdelivery" (.vercel/project.json de CE dépôt, VERIFIED)
 ↓
Objet mis en cache à l'edge Vercel, jamais réinvalidé depuis sa première génération
   (Etag/Last-Modified figés, X-Vercel-Cache: HIT permanent, y compris en forçant
    une nouvelle clé de requête — VERIFIED)
 ↓
Contenu NK Delivery/NK Deliveri — MAIS UNE VERSION ANTÉRIEURE ET DIFFÉRENTE
   du build actuellement servi sur le domaine officiel (branding français « NK Delivery »,
   taille quasi deux fois plus petite — VERIFIED §4)
```

Le `???` de la consigne initiale se résout donc en : **« un objet statique gelé à l'edge Vercel, associé au projet dont ce dépôt possède l'identifiant local, servant un ancien contenu — pas une fonction serveur active équivalente à celle qui sert le domaine officiel aujourd'hui »**.

---

## 9. Root Cause Assessment

### ~~`PROBABLE`~~ → **`CONFIRMED` (2026-08-14, source : opérateur)**

**Hypothèse retenue** : `nkdelivery.vercel.app` est le domaine par défaut du **même projet Vercel** que celui lié à ce dépôt (`nkdelivery`, `prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x`), mais ce domaine par défaut sert un **artefact figé en cache depuis un ancien état du produit** (branding pré-kreyòl), jamais réinvalidé par les déploiements de production suivants ni par la tentative de suppression de domaine déjà effectuée par l'opérateur.

**Pourquoi c'était `PROBABLE` et pas `CONFIRMED` au moment de la rédaction initiale** : aucun accès API/dashboard Vercel dans cette session ne permettait de vérifier directement l'ID du projet réellement rattaché à `nkdeliveri.com`. La preuve reposait uniquement sur la cohérence entre plusieurs signaux indirects (nom de projet local, branding historique documenté, comportement de cache).

**Pourquoi c'est désormais `CONFIRMED`** : l'opérateur a consulté lui-même le dashboard Vercel du projet qui sert effectivement `nkdeliveri.com` aujourd'hui (Settings → General) et rapporté un `Project ID` **identique** à celui du fichier local (`prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x`). C'est une confirmation de première main, pas une déduction — même si elle vient du rapport de l'opérateur plutôt que d'une requête API exécutée par cette session (nuance conservée pour l'honnêteté méthodologique : `VERIFIED (rapporté)`, pas `VERIFIED (API directe)`).

**Ce que ça résout** : la confusion initiale de l'opérateur ("le domaine n'apparaît nulle part dans mon dashboard") ne venait donc **pas** d'un mauvais projet/compte — c'était le bon projet depuis le début. La vraie explication (voir §10 corrigé) : le domaine par défaut `<projet>.vercel.app` **n'apparaît jamais comme une entrée dans l'onglet "Domains"** d'un projet Vercel — ce n'est pas un domaine personnalisé ajouté manuellement qu'on peut sélectionner et retirer de cette liste, il est généré automatiquement et implicitement à partir du nom du projet. Chercher à le "supprimer" depuis cet onglet explique pourquoi la première tentative de correction (déjà testée dans `CF-01_POST_REMEDIATION_VERIFICATION_2026-08-13.md`, restée `NOT REMEDIATED`) n'a produit aucun changement observable : il n'y avait probablement rien à supprimer à cet endroit précis, donc rien n'a été réellement modifié côté Vercel malgré l'intention.

---

## 10. Recommended Manual Remediation

_(recommandation uniquement — aucune action effectuée)_

> ~~Ouvrir le dashboard Vercel → chercher le projet par son identifiant exact `prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x` [...] → onglet Deployments → identifier quel déploiement est actuellement assigné comme Production et lequel est assigné au domaine `nkdelivery.vercel.app` spécifiquement → si un ancien déploiement y est encore explicitement aliasé, retirer cet alias (Vercel : Deployments → ⋯ sur le déploiement concerné → Remove/unalias)~~

**Recommandation corrigée (2026-08-14)** — le projet est désormais confirmé (§9), donc l'étape "chercher le bon projet" est terminée ; ce qui restait imprécis était **où agir à l'intérieur du projet**. Le domaine par défaut `<projet>.vercel.app` n'étant listé nulle part sous "Domains" (ni comme alias de déploiement retirable sous "Deployments" dans les versions actuelles du dashboard Vercel), la seule action de plateforme qui bloque effectivement l'accès public à ce hostname est :

> **Dans le projet `prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x` (équipe `team_xjDg0M8Vzbd8NK8r2oh6K7vW`) → Settings → Deployment Protection → activer une protection couvrant explicitement la Production (pas seulement "Preview Deployments" — c'est le piège le plus courant : la protection par défaut ne couvre souvent que les previews). Selon la version du dashboard, l'option s'appelle "Standard Protection", "Vercel Authentication" ou équivalent — chercher le réglage qui exige une authentification/un bypass token pour atteindre n'importe quelle URL de déploiement, y compris le domaine `.vercel.app` par défaut, pas seulement les domaines personnalisés.**

Si cette option n'existe pas ou reste sans effet sur le domaine par défaut spécifiquement (comportement qui varierait selon le plan Vercel de l'équipe — **NOT VERIFIED** dans cette session, aucun accès dashboard), l'alternative de dernier recours est un **ticket Vercel Support**, en fournissant précisément l'`Etag`/`Age`/`Content-Length` documentés dans `CF-01_POST_REMEDIATION_VERIFICATION_2026-08-13.md` comme preuve d'un objet de cache qui ne répond à aucune action self-service testée jusqu'ici.

> **⏸️ MIS DE CÔTÉ (2026-08-14)** : l'opérateur confirme que **Deployment Protection n'est pas accessible sur le plan Vercel actuel de l'équipe** — cette recommandation est donc bloquée, pas rejetée. Décision explicite de l'opérateur : mettre CF-01 en pause plutôt que de poursuivre l'investigation/remédiation dans cette session. Statut réel inchangé : **CF-01 reste `NOT REMEDIATED`**, `nkdelivery.vercel.app` continue de servir publiquement le contenu figé documenté (§4). Ce n'est pas un risque oublié — c'est un risque connu, accepté temporairement par l'opérateur pour une raison de plan/coût hors du contrôle du code ou de cette investigation. Voies non explorées, pour une reprise future : (a) upgrade du plan Vercel pour débloquer Deployment Protection, (b) ticket Vercel Support directement (ne dépend pas du plan), (c) renommer le projet Vercel (libérerait `nkdelivery.vercel.app`, mais changerait aussi l'URL de déploiement par défaut — impact plus large, non évalué ici).

---

## 11. Post-Remediation Verification Plan

Une fois l'action ci-dessus effectuée :

1. Répéter exactement le protocole déjà utilisé dans `CF-01_POST_REMEDIATION_VERIFICATION_2026-08-13.md` (`GET`/`HEAD` sur `/`, comparaison `Etag`/`Last-Modified`/`Age`, tentative de contournement de cache par paramètre de requête).
2. Vérifier spécifiquement que la réponse n'est plus `200` (attendu : erreur Vercel explicite type `DEPLOYMENT_NOT_FOUND` ou `401` si Deployment Protection est activée) plutôt qu'un simple changement de contenu — un `200` avec un contenu différent mais toujours réel serait un signe que le cache a été renouvelé sur un déploiement encore actif, pas que le bypass est fermé.
3. Confirmer en parallèle qu'aucune régression n'apparaît sur `www.nkdeliveri.com` (déjà couvert par le protocole existant).

---

## 12. Security Impact

Inchangé par rapport aux rapports précédents sur le principe (contournement de la couche Cloudflare pour un actif public), mais **révisé à la baisse en gravité concrète** par la découverte de cette session : le contenu exposé via `nkdelivery.vercel.app` n'est **pas** la page d'accueil active et à jour — c'est une version antérieure, plus courte, avec un branding différent. Cela ne change rien à la nécessité de fermer CF-01 (l'absence de Cloudflare/CSP sur ce chemin reste un vrai gap de périmètre), mais réduit la probabilité que ce chemin expose un jour, sans action supplémentaire, du contenu dynamique ou des données réelles — puisqu'il ne semble même pas suivre les déploiements actuels du produit.

---

## 13. Final Conclusion

**Pourquoi `nkdelivery.vercel.app` sert-il encore du contenu NK Deliveri après la suppression déclarée d'un domaine ?** Parce que ce hostname n'est pas un alias configuré manuellement qu'on aurait pu simplement « oublier » de supprimer — c'est le **domaine par défaut de la plateforme Vercel elle-même** pour le projet nommé `nkdelivery`, un domaine qui existe automatiquement tant que le projet existe et n'est pas explicitement protégé, et qui sert ici un **objet gelé en cache depuis une génération antérieure**, insensible à une simple suppression de domaine personnalisé effectuée ailleurs dans les réglages.

**Dans quel projet Vercel faut-il intervenir ?** Le projet dont l'identifiant exact est `prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x` (nom `nkdelivery`, équipe `team_xjDg0M8Vzbd8NK8r2oh6K7vW`) — **confirmé le 2026-08-14** par l'opérateur lui-même (Project ID vérifié identique dans son propre dashboard, §9). ~~c'est la seule preuve directe et fiable disponible depuis ce repository (§5)~~.

**Addendum (2026-08-14) — pourquoi l'opérateur ne "voyait" pas le domaine malgré le bon projet** : ~~la confusion précédente de l'opérateur s'explique très probablement par une différence de nom : « nkdelivery » ≠ « nkdeliveri »~~ — cette explication est **écartée**, le bon projet a été localisé par ID. La vraie explication : le domaine par défaut `.vercel.app` **n'apparaît tout simplement pas comme une entrée gérable** dans l'onglet "Domains" du dashboard Vercel — il n'y a rien à y trouver ni à y supprimer, ce qui rend une recherche dans cet onglet structurellement infructueuse quel que soit le projet ouvert. L'action qui agit réellement sur ce chemin est **Deployment Protection** (§10 corrigé), pas la gestion des domaines.

---

## INVESTIGATION

**COMPLETE** _(dans les limites de l'accès disponible — voir réserves explicites de §5/§6/§9 sur l'absence d'accès API/dashboard Vercel)_

### CODE CHANGES

`NONE`

### DATABASE CHANGES

`NONE`

### DNS CHANGES

`NONE`

### CLOUDFLARE CHANGES

`NONE`

### VERCEL CHANGES

`NONE`

### DEPLOYMENTS

`NONE`

### COMMITS

`NONE`

### PUSH

`NONE`

### CF-01

**OWNER IDENTIFIED** _(niveau de confiance : ~~PROBABLE~~ → **CONFIRMED le 2026-08-14**, source : Project ID vérifié par l'opérateur dans son propre dashboard — voir §9)_

---

## Recommandation manuelle prioritaire (unique)

~~Dans le dashboard Vercel, ouvrir le projet dont l'ID est exactement `prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x` [...], aller dans Deployments, identifier et retirer l'alias qui assigne encore un déploiement au domaine `nkdelivery.vercel.app`~~ — **corrigé (2026-08-14)** : le projet est confirmé, mais il n'y a pas d'alias à retirer dans Deployments/Domains pour un domaine `.vercel.app` par défaut.

**Dans le projet `prj_p14gRktfIMXQ3UdL8zYgsdN8LU2x` (équipe `team_xjDg0M8Vzbd8NK8r2oh6K7vW`) → Settings → Deployment Protection → activer la protection en s'assurant explicitement qu'elle couvre la Production (pas seulement les Preview Deployments) → si aucun réglage de ce type ne bloque effectivement `nkdelivery.vercel.app` une fois activé, ouvrir un ticket Vercel Support avec l'`Etag`/`Age` déjà documentés comme preuve d'un objet de cache persistant.**
