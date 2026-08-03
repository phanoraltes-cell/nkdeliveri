# MonCash — Phase 2 : Audit d'activation officielle

Audit complet, rien modifié. Toutes les vérifications ci-dessous ont
été refaites **en direct** aujourd'hui (pas de réutilisation aveugle
des ~19 rapports MonCash déjà présents dans `docs/`, tous non
committés — voir § Annexe) — plusieurs faits qu'ils affirmaient sont
**périmés** depuis que MonCash Collect (paiement client automatique)
a été construit et déployé plus tôt dans cette même session, après la
rédaction de la plupart d'entre eux.

## 🔴 Constat prioritaire — à lire avant tout le reste

**Quelqu'un a ajouté 4 des 5 secrets `MONCASH_*` sur Vercel Production
il y a moins d'une heure**, pendant que j'écrivais ce rapport
(`MONCASH_API_URL`, `MONCASH_WEBHOOK_SECRET`, `MONCASH_CLIENT_SECRET`,
`MONCASH_MERCHANT_ID` — créés/modifiés il y a 44 à 49 minutes). Ce
n'est pas moi qui les ai ajoutés. `MONCASH_CLIENT_ID` est absent, donc
`isMonCashConfigured()` retourne encore `false` **aujourd'hui** — le
système reste inerte pour l'instant, confirmé par zéro nouvelle
activité (`moncash_api_logs`/`payment_transactions` : 0 ligne depuis 2h).

**Mais ceci change la nature du risque que votre consigne visait à
prévenir.** Vous avez demandé : _"Ne jamais activer
`payment_providers.moncash_api.is_active` sans validation explicite."_
J'ai vérifié le code précisément : **ce flag ne protège que le
décaissement** (`payout-pay-modal.tsx` le vérifie avant d'proposer
"MonCash Automatik" comme canal de paiement). **Il ne protège pas du
tout le flux client MonCash Collect**, déjà en production depuis cette
session — `initiate-collect-payment.logic.ts` ne vérifie que
`moncashProvider.isConfigured()` (les 5 variables d'environnement),
jamais `payment_providers.is_active`. Et `checkout.tsx` a
**"MonCash Automatik" comme méthode de paiement sélectionnée par
défaut** pour chaque client.

**Conséquence concrète** : le jour où quelqu'un ajoute
`MONCASH_CLIENT_ID` et redéploie, le paiement client automatique
MonCash devient réellement actif pour de vrais clients, **sans que
`payment_providers.moncash_api.is_active` n'entre en jeu**. Le verrou
que vous avez nommé ne couvre pas le chemin qui s'activerait le plus
facilement. Je n'ai rien modifié — mais je recommande fortement de
traiter "qui a ajouté ces 4 variables, et avec quelles valeurs
(sandbox ou production ?)" comme la première question à répondre avant
toute autre étape, et de valider explicitement si le flux Collect doit
lui aussi être protégé par un verrou équivalent à `is_active` avant
que `MONCASH_CLIENT_ID` ne soit ajouté.

---

## Audit

### 1. Contrat Digicel

**Non vérifiable par le code — fait externe.** Chaque audit précédent
de ce chantier (le plus récent : `MONCASH_GO_LIVE_FINAL_REPORT.md`)
conclut qu'aucun contrat B2C (décaissement) n'a jamais été confirmé
avec Digicel. Rien dans le dépôt (code, migrations, docs) ne permet de
confirmer un changement depuis. **À confirmer explicitement par vous**
— c'est le seul blocage externe pour activer le **décaissement**
automatique. Pour le **Collect** (encaissement client), l'API publique
utilisée est déjà celle documentée par Digicel pour un marchand
"collecte" standard — aucun document de ce dépôt n'indique qu'un
contrat séparé soit nécessaire pour ce flux-là, mais cette distinction
n'a jamais été confirmée explicitement avec Digicel non plus.

### 2. Credentials

5 variables requises (`moncash-config.server.ts`, aucune autre lecture
directe de `process.env.MONCASH_*` ailleurs dans le code — vérifié) :

| Variable                 | Statut Vercel Production (vérifié à l'instant) |
| ------------------------ | ---------------------------------------------- |
| `MONCASH_CLIENT_ID`      | ❌ **Absente**                                 |
| `MONCASH_CLIENT_SECRET`  | ✅ Présente (créée il y a 47 min)              |
| `MONCASH_MERCHANT_ID`    | ✅ Présente (créée il y a 49 min)              |
| `MONCASH_API_URL`        | ✅ Présente (créée il y a 44 min)              |
| `MONCASH_WEBHOOK_SECRET` | ✅ Présente (créée il y a 47 min)              |

Je n'ai lu/imprimé aucune valeur (impossible de toute façon — Vercel
ne permet jamais de relire une variable chiffrée). **Impossible pour
moi de savoir si `MONCASH_API_URL` pointe vers le sandbox ou la
production réelle** — à confirmer par la personne qui les a ajoutées.

### 3. Secrets

- Aucun secret dans le code ou les migrations (recherche `MONCASH_`
  dans tout le dépôt hors `.server.ts`/docs : rien).
- Chaque module MonCash (`moncash-config.server.ts`,
  `moncash-client.server.ts`, `moncash-provider.server.ts`) est
  suffixé `.server.ts` — le build échoue si un composant/route les
  importe directement, donc aucun secret ne peut atteindre le bundle
  client par construction.
- `moncash_api_logs`/`moncash_webhook_events` : redaction vérifiée
  (jamais l'en-tête `Authorization`, jamais `access_token`, tokens
  tronqués 4+4 caractères) — test dédié qui tourne à chaque `npm test`.
- **Item ouvert non résolu** : un rapport antérieur
  (`MONCASH_GO_LIVE_REPORT.md`) signale qu'un `supabase db dump
--dry-run` a affiché le **mot de passe réel de la base de données**
  en clair dans une sortie de commande, et recommandait sa rotation.
  **Rien dans les rapports suivants ne confirme que cette rotation a
  été faite.** Je ne peux pas vérifier moi-même si un mot de passe a
  été tourné. **À confirmer explicitement.**

### 4. Webhooks

Deux routes distinctes, jamais partagées :

| Route                                | Flux                                                     | Statut                                                               |
| ------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------- |
| `POST /api/webhooks/moncash`         | Décaissement (jamais atteignable — refus au niveau code) | Déployée, répond `401` sans signature valide (revérifié à l'instant) |
| `POST /api/webhooks/moncash/collect` | Encaissement client (MonCash Collect, déjà en prod)      | Déployée, répond `401` sans signature valide                         |

Idempotence à 2 niveaux indépendants sur le décaissement
(`UNIQUE(event_id)` + garde RPC `status <> 'pending'`), à 1 niveau sur
le Collect (garde RPC uniquement — voir
`docs/MONCASH_COLLECT_PHASE2_VALIDATION_REPORT.md`, déjà validé cette
session). **Découverte pendant cet audit** : 4 webhooks reçus sur la
route de décaissement entre le 31/07 15h08 et aujourd'hui 02h41 (UTC),
tous rejetés dès la première vérification (`isConfigured()` avant même
la signature) avec `"MonCash API pa konfigire toujou"`. Comme ce
rejet intervient **avant** toute vérification de signature, **n'importe
quelle requête POST** (bot de scan internet, ou l'un de mes propres
tests `curl` de la session précédente) produit exactement ce même
enregistrement — **rien n'indique une origine MonCash réelle**, et rien
dans `moncash_webhook_events` ne capture l'IP/User-Agent pour trancher.
Recommandation mineure : ajouter la capture IP/User-Agent à cette
table avant l'activation réelle, pour pouvoir distinguer du bruit
d'une vraie tentative Digicel plus tard.

### 5. Signature

HMAC-SHA256 sur le corps brut, en-tête `x-moncash-signature`,
hexadécimal, comparaison `timingSafeEqual` (protection contre les
attaques temporelles) — **identique pour les deux routes** (Collect
réutilise `moncashProvider.verifyWebhook` tel quel). **Ce schéma n'est
pas confirmé publiquement par Digicel** — c'est la convention la plus
courante chez les fournisseurs de paiement, écrite pour être
vérifiable dès que Digicel confirme le schéma réel, pas une garantie
contractuelle. À vérifier/ajuster une fois un accès sandbox ou une
documentation officielle Digicel obtenue.

### 6. Sandbox

Bascule sandbox/production entièrement pilotée par **une seule
variable**, `MONCASH_API_URL` (aucun branchement sur `NODE_ENV`/
`VERCEL_ENV` dans le code — vérifié) :

| Environnement | URL attendue                                         |
| ------------- | ---------------------------------------------------- |
| Sandbox       | `https://sandbox.moncashbutton.digicelgroup.com/Api` |
| Production    | `https://moncashbutton.digicelgroup.com/Api`         |

Les 4 autres variables changent ensemble avec elle (jeu de
credentials sandbox vs. jeu de credentials production — jamais
mélangés). **Aucun test contre un vrai sandbox MonCash n'a jamais été
exécuté** dans ce projet — toute la suite de tests (32/32 aujourd'hui,
confirmé) mocke `fetch`, jamais un vrai appel réseau. Voir § Tests
Sandbox ci-dessous pour le plan.

### 7. Production

`payment_providers.moncash_api.is_active = false` (revérifié à
l'instant). Décaissement automatique **refusé au niveau code**
indépendamment de ce flag (`direction:"disburse"` toujours refusé —
API MonCash publique = passerelle de collecte, pas de décaissement
B2C confirmé). Activité réelle en production : **zéro** sur toutes les
tables MonCash (`moncash_api_logs`: 0, `payouts` avec
`provider_code='moncash_api'`: 0, `payment_transactions`: 0). Seul le
flux manuel (Cash/MonCash Manyèl/NatCash Manyèl) et, depuis cette
session, MonCash Collect (jamais encore utilisé par un vrai client)
existent réellement.

### 8. Cron

```
npx vercel crons ls
→ /api/cron/moncash-reconcile   0 3 * * *   (une fois par jour, limite du plan Vercel Hobby)
```

Confirmé identique à la dernière vérification (session précédente).
`CRON_SECRET` configuré (10h), testé avec succès (401/401/200) lors
d'une session antérieure. **Découverte critique pendant cet audit** :
`moncash-reconcile.server.ts` ne reconcilie **que** les `payouts`
(`provider_code='moncash_api', status='pending'`) — **il ne connaît
pas du tout `payment_transactions`** (la table Collect). **Si un
paiement client Collect reste bloqué `pending`** (client qui ferme la
page MonCash sans finir, webhook perdu), **rien ne le rattrapera
jamais automatiquement** — aucune tâche cron équivalente n'existe pour
ce flux. C'est un vrai trou opérationnel, pas juste "hors périmètre" —
à combler avant d'activer réellement Collect pour de vrais clients
(voir recommandation § Plan de reprise).

### 9. Monitoring

`/dashboard/admin/moncash` répond `200`, 4 conditions d'alerte codées
(erreurs consécutives, webhook manquant >15min, paiement bloqué

> 30min, taux d'échec ≥50% sur les 20 derniers appels) — **toutes
> scopées décaissement uniquement**, aucune ne surveille Collect. Le
> nouveau Dashboard Financier (`/dashboard/admin/finance`, livré plus
> tôt cette session) inclut un volume MonCash agrégé (`Volume MonCash`)
> mais aucune alerte dédiée Collect non plus. Recommandation : avant
> d'activer Collect pour de vrais clients, ajouter au minimum une alerte
> "paiement Collect bloqué pending depuis > X minutes" — le même trou
> que le cron ci-dessus, côté visibilité cette fois.

---

## Checklist Go-Live

Cases distinctes pour Décaissement (bloqué par le contrat Digicel,
inchangé) et Collect (déjà en prod, mais avec le trou de
réconciliation ci-dessus).

### Décaissement automatique — NE PAS COCHER avant contrat confirmé

- [ ] Contrat B2C confirmé avec Digicel
- [ ] Credentials production obtenus de Digicel (les 5 variables)
- [ ] `MONCASH_API_URL` pointe vers la production (pas sandbox)
- [ ] Test sandbox complet réussi (§ Tests Sandbox)
- [ ] `payment_providers.moncash_api.is_active = true` — **votre
      validation explicite requise, uniquement après tout ce qui précède**
- [ ] Vérification post-activation : premier vrai payout suivi manuellement de bout en bout

### Collect (déjà en prod — checklist avant "usage réel non supervisé")

- [ ] Confirmer qui a ajouté les 4 variables `MONCASH_*` déjà présentes et pourquoi
- [ ] Confirmer si `MONCASH_API_URL` actuel est sandbox ou production
- [ ] Décider explicitement : ajouter `MONCASH_CLIENT_ID` maintenant, ou attendre ?
- [ ] Combler le trou de réconciliation cron pour `payment_transactions` (aucun code à écrire sans votre validation — juste signalé ici)
- [ ] Ajouter une alerte dashboard pour un paiement Collect bloqué
- [ ] Tester un paiement Collect complet en sandbox de bout en bout (checkout → redirection → webhook → confirmation commande)
- [ ] Rotation confirmée du mot de passe DB (item ouvert § Secrets)
- [ ] PITR ou backup automatisé fonctionnel en place (§ Plan de reprise)

---

## Runbook

**Méthodologie reprise de `MONCASH_DEPLOYMENT_RUNBOOK.md`** (déjà
éprouvée cette session pour la migration Collect) :

1. Backup frais (`npm run db:backup` — nécessite Docker, indisponible
   sur ce poste ; sinon utiliser le dernier backup valide et le noter
   explicitement comme non-frais dans le rapport de l'étape).
2. `supabase migration list --linked` pour confirmer l'état exact
   avant toute action.
3. Pour toute nouvelle migration : isoler, `--dry-run`, appliquer,
   vérifier fonctionnellement (pas seulement l'existence), jamais en
   lot.
4. `npm run verify` après tout changement de code.
5. Pour l'activation `is_active=true` (décaissement uniquement, le
   jour où le contrat est confirmé) : `UPDATE payment_providers SET
is_active = true WHERE code = 'moncash_api';` — une seule ligne,
   aucun redéploiement requis (c'est une lecture DB à chaque montage
   de `payout-pay-modal.tsx`, pas une variable d'environnement).
6. **Rappel critique découvert cette session** : toute modification de
   variable d'environnement Vercel (les 5 `MONCASH_*`, `CRON_SECRET`)
   **nécessite un redéploiement** pour prendre effet sur les instances
   serverless déjà chaudes — la rotation seule ne suffit jamais.
7. Vérification post-déploiement standard : route webhook → `401` sans
   signature, cron → `401` sans secret puis `200` avec, dashboard MonCash
   → `200`, aucune régression sur le canal manuel.

## Rollback

**Décaissement** — un seul geste, jamais de redéploiement :

```sql
UPDATE public.payment_providers SET is_active = false WHERE code = 'moncash_api';
```

Le canal manuel (MonCash/NatCash Manyèl, Cash) n'est jamais affecté —
chemins de code entièrement séparés.

**Collect** — pas de flag `is_active` équivalent aujourd'hui (voir
constat prioritaire). Rollback d'urgence possible mais plus lourd :
retirer une des 5 variables `MONCASH_*` de Vercel (`isConfigured()`
redevient `false`) **puis redéployer** (le rappel du point 6
ci-dessus s'applique ici aussi) — `initiateCollectPayment` échouera
alors proprement (`"MonCash Automatik pa konfigire toujou"`), le
checkout retombe sur les 3 autres méthodes déjà éprouvées.

**Rollback de migration** (si jamais nécessaire) : voir
`MONCASH_ROLLBACK_PLAN.md` pour les 4 migrations de décaissement —
**aucune section n'existe encore pour `20260731130000_moncash_collect_payments.sql`**,
à écrire si un rollback de schéma Collect devient un jour nécessaire
(actuellement, aucune raison de rollback schéma identifiée — seule la
désactivation applicative ci-dessus serait pertinente en urgence).

## Rotation des secrets

Procédure (identique pour les 5 `MONCASH_*`, établie dans
`PAYMENT_PROVIDERS.md`, reconfirmée fonctionnelle cette session pour
`CRON_SECRET`) :

1. Générer/obtenir la nouvelle valeur (jamais l'afficher dans un
   terminal partagé ou un log).
2. `vercel env add <NOM> production` avec la nouvelle valeur (écrase
   l'ancienne).
3. **Redéployer immédiatement** (`vercel --prod`) — sans cette étape,
   les instances déjà chaudes gardent l'ancienne valeur en mémoire et
   les rotations échouent silencieusement (confirmé par test réel
   cette session sur `CRON_SECRET`).
4. Vérifier avec un test réel après déploiement (ex. webhook →
   toujours `401` sans signature, `200` avec la bonne).
5. Ne révoquer l'ancienne valeur côté Digicel qu'**après** confirmation
   que la nouvelle fonctionne en production — jamais l'inverse, pour
   éviter une fenêtre d'indisponibilité.

**Item ouvert à traiter en priorité** : le mot de passe Postgres de
production a potentiellement fuité en clair dans une sortie de
commande lors d'une session antérieure (`supabase db dump --dry-run`)
— rotation recommandée à l'époque, **jamais confirmée faite**. À
rotationner via le tableau de bord Supabase (Project Settings →
Database → Reset password), puis mettre à jour toute connexion directe
qui l'utiliserait (aucune trouvée dans le code applicatif — Supabase
est toujours utilisé via les clients publishable/service-role, jamais
une connexion Postgres directe avec mot de passe en dur).

## Plan de reprise (disaster recovery)

**Constat vérifié à l'instant, inchangé depuis le dernier audit** :

```
walg_enabled: true, pitr_enabled: false, backups: []
```

**Aucune sauvegarde physique automatisée, aucun PITR actif.** Seule
sauvegarde logique locale valide : `backups/full_20260731T161758Z.sql`
(354 Ko, plusieurs heures), toutes les tentatives plus récentes ont
échoué silencieusement (Docker indisponible sur ce poste — le CLI
Supabase a besoin d'un conteneur pour `pg_dump`).

**Recommandations, par ordre de priorité** :

1. Activer le PITR dans le tableau de bord Supabase (Project Settings
   → Database → Backups) — vérifier d'abord si le plan tarifaire
   actuel l'inclut ou si c'est un coût additionnel, décision business
   à valider avec vous.
2. À défaut, mettre en place un `pg_dump` planifié depuis un
   environnement où Docker est disponible (ce poste ne l'a pas) —
   même un cron externe simple suffirait tant qu'il tourne réellement
   et que les fichiers produits sont non-vides.
3. **Scénario de reprise spécifique Collect** : un paiement client
   bloqué `pending` sans réconciliation automatique (§ Cron) devient,
   en l'absence de plan, un cas traité uniquement manuellement — table
   `payment_transactions` filtrée sur `status='pending'` et
   `created_at` ancien, croisée avec `moncashProvider.checkStatus()`
   appelé manuellement par un admin. Recommandé : formaliser cette
   procédure manuelle par écrit avant toute activation réelle non
   supervisée de Collect, ou combler le trou cron d'abord.
4. **Scénario de reprise décaissement** : sans objet tant que
   `is_active=false` — aucun payout `provider_code='moncash_api'` ne
   peut exister.

## Tests Sandbox

**N'a jamais été exécuté dans ce projet** — à faire avant toute
activation réelle, décaissement ou Collect :

1. Obtenir des credentials sandbox Digicel (`MONCASH_API_URL` =
   `https://sandbox.moncashbutton.digicelgroup.com/Api` + les 4 autres
   variables sandbox), les placer en scope **Preview** sur Vercel
   uniquement (jamais Production — règle déjà établie dans
   `MONCASH_ENVIRONMENTS.md`, cohérente avec la pratique Supabase).
2. Rejouer les scénarios déjà couverts par des mocks
   (`MONCASH_RESILIENCE_REPORT.md`/`MONCASH_TEST_REPORT.md`) contre le
   vrai sandbox : authentification OAuth2 réelle, `CreatePayment` réel,
   webhook réel reçu et vérifié (signature réelle, pas simulée),
   `RetrieveOrderPayment` réel, timeout réel (couper le réseau ou
   utiliser un endpoint sandbox lent si Digicel en propose un).
3. Test de bout en bout Collect en sandbox : checkout → redirection
   réelle vers la page MonCash sandbox → paiement test → retour →
   webhook réel → `payments.status='paid'` → notification client réelle.
4. Test de bout en bout décaissement en sandbox (une fois un endpoint
   B2C sandbox confirmé exister, ce qui n'est pas encore le cas —
   sinon ce test reste bloqué comme le reste du décaissement).
5. Consigner chaque résultat dans un rapport daté, comme pour tous les
   tests précédents de ce chantier — ne jamais activer la production
   sur la base d'un test sandbox non documenté.

## Tests Production

À exécuter **après** activation, jamais pour la valider a priori :

1. **Décaissement** (une fois `is_active=true` validé) : un premier
   vrai payout de petit montant, suivi manuellement à chaque étape
   (création → webhook → confirmation bénéficiaire), avant tout volume.
2. **Collect** (déjà activable dès que `MONCASH_CLIENT_ID` existe) :
   une première vraie commande test, montant minimal, suivie
   manuellement (checkout → redirection → paiement réel → webhook →
   `orders.$id.tsx` reflète le statut en temps réel — déjà validé
   fonctionnellement en Phase 2 du chantier Collect, mais jamais avec
   un vrai paiement MonCash).
3. Vérification immédiate post-premier-paiement réel : `moncash_api_logs`
   ne contient aucune donnée sensible (contrôle déjà automatisé en
   test, à revérifier visuellement une fois une vraie ligne existe),
   notification reçue par le client, aucune régression sur les 3
   autres méthodes de paiement.
4. Surveillance rapprochée du dashboard MonCash pendant au moins 48h
   après le premier vrai paiement, avant de considérer le flux
   "normal."

---

## Recommandation finale

🔴 **`payment_providers.moncash_api.is_active` reste à `false`** —
aucune validation explicite reçue pour l'activer, conformément à votre
consigne. Rien n'a été modifié.

🟡 **Le vrai risque immédiat n'est pas `is_active`, c'est Collect** —
4 des 5 secrets nécessaires à l'activation réelle du paiement client
automatique existent déjà en production, ajoutés par quelqu'un
d'autre que moi il y a moins d'une heure, sans qu'aucun flag
équivalent à `is_active` ne protège ce chemin. Je recommande de traiter
ceci comme la priorité immédiate : confirmer qui les a ajoutées, avec
quelles valeurs (sandbox/production), et décider explicitement de la
suite avant que `MONCASH_CLIENT_ID` ne soit ajouté par quiconque.

🟢 **L'infrastructure elle-même reste saine** — webhooks, signature,
idempotence, logs, cron (décaissement) : tout fonctionne comme conçu
et testé. Les trous réels sont opérationnels, pas structurels : aucune
réconciliation automatique pour Collect, aucun PITR/backup fiable, un
item de rotation de secret jamais confirmé.

## Annexe — ~19 rapports MonCash déjà existants

`docs/MONCASH_*.md` (hors les 6 rapports du chantier Collect, déjà à
jour) contiennent une quantité considérable de travail déjà fait mais
jamais committé, presque tous rédigés **avant** que Collect n'existe —
plusieurs affirment explicitement "aucun flux d'encaissement client
n'existe", ce qui est aujourd'hui faux. Je n'ai touché à aucun d'eux.
Recommandé, une fois les décisions ci-dessus prises : soit les
committer tels quels comme archive historique, soit les consolider
dans ce rapport-ci et les supprimer pour éviter la confusion future
entre affirmations périmées et actuelles — décision à valider avec
vous, pas prise unilatéralement ici.
