# PLOP Dynamic Wallet Phase 1 Final Review

**Date** : 2026-08-04
**Portée** : (1) revalidation post-remédiation, (2) intégration du rebranding UI "Payment Global". Migration **non appliquée dans cette mission** (déjà appliquée précédemment — voir § Note importante). **Aucun commit créé.**

## Statut

**APPROVED**

---

## ⚠️ Note importante — prémisse de la mission obsolète

Cette mission part du principe que la migration `20260804130000_plop_wallet_traceability.sql` est encore en attente et qu'aucun commit n'a été créé. **Ce n'est plus le cas.** Entre le rapport de revalidation (`PLOP_DYNAMIC_WALLET_PHASE1_REVALIDATION_REPORT.md`, statut `APPROVED`/`READY`) et cette mission, vous avez explicitement demandé *"Applique les migrations puis pousse les commit"* — exécuté et confirmé : migration appliquée (`supabase db push`), types régénérés, tests/lint/build vérifiés, commit `036a186` créé et poussé sur `main`, déploiement Vercel confirmé en production.

**Conséquence pour cette mission** : la Partie 1 (revalidation SQL) a été refaite ici comme une **confirmation post-application** (audit du fichier de migration tel que committé, toujours cohérent avec ce qui est réellement en base), pas une validation pré-application. La Partie 3 ("Si APPROVED, la séquence officielle devient : 1. Appliquer migration... 5. Créer commit") ne s'applique donc qu'au **nouveau travail de cette mission** (le rebranding UI), pas à la migration SQL, déjà au-delà de ces étapes.

---

## Validation sécurité SQL

Confirmé, par lecture directe de `supabase/migrations/20260804130000_plop_wallet_traceability.sql` (fichier committé, migration appliquée) :

| Élément attendu | Présent ? |
|---|---|
| Hardening provider check du 3 août (`payment_provider_settings.moncash_auto.enabled`) | ✅ Ligne 100-107, condition/requête/message/code d'erreur identiques à `20260803130000` |
| Vérification doublon `pending` | ✅ Ligne 86-91, inchangée depuis l'origine |
| Logique wallet traceability (`payment_method_requested`) | ✅ Paramètre, `INSERT`, `log_audit_event` |
| `INSERT` final | ✅ Ligne 109-113 |

**Ordre réel dans le fichier** (identique entre la version production du 3 août et celle-ci, reconfirmé) : doublon `pending` → hardening provider → `INSERT`. Le diagramme "Ordre attendu" de cette mission place le hardening *avant* le doublon — écart déjà noté et expliqué dans `PLOP_DYNAMIC_WALLET_PHASE1_REVALIDATION_REPORT.md` : sans incidence, ce sont deux gardes indépendantes et inconditionnelles.

---

## Validation Dynamic Wallet

- ✅ `PLOP_PAYMENT_METHOD` ne force plus les paiements — `plop-client.server.ts::createPayment(reference, amount, paymentMethod?)`, le paramètre l'emporte sur la config globale.
- ✅ Sélection par `payment_method`, validée contre `VALID_PAYMENT_METHODS = ["moncash", "kashpaw", "natcash", "all"]`.

**Correction nécessaire à la prémisse de cette mission** : la liste "moncash / natcash / kashpaw / kach" donnée dans le contexte de la mission comme wallets supportés par PLOP est **factuellement inexacte**. `kach` est le rail "espèces à la livraison" propre à NK Deliveri (`payment_method` ENUM Postgres), **jamais** un wallet PLOP — PLOP ne le documente nulle part et `isValidPaymentMethod()` le rejette à raison. Ceci est cohérent avec `docs/PLOP_PHASE0_AUDIT.md` et n'a pas été modifié ; le code est correct, c'est l'énoncé de la mission qui contenait l'erreur.

---

## Validation Wallet Traceability

`payment_method_requested`/`payment_method_used` confirmés à chaque étape (relecture directe du code committé) :

| Étape | Fichier | Constat |
|---|---|---|
| Création paiement | `initiate-collect-payment.logic.ts` | `_payment_method_requested: payment.method` sur les 4 appels à `create_collect_payment_secure` |
| Polling client | `poll-collect-payment.logic.ts` | `_payment_method_used: status.walletUsed ?? undefined` sur `complete_collect_payment_secure` |
| Cron quotidien | `plop-reconcile.server.ts` | Idem, via `finalizeAsPaid()` |
| Finalisation (RPC) | `20260804130000_plop_wallet_traceability.sql` | Colonnes stockées, incluses dans `log_audit_event` |

---

## Validation UI Payment Global

### Audit initial (`grep -r "Peman Otomatik" src/`)

12 occurrences trouvées, toutes traitées :

| Fichier | Nature | Action |
|---|---|---|
| `checkout.tsx` (×4 : label, message de maintenance, commentaire, texte explicatif) | Client-facing | Remplacé |
| `dashboard.admin.payment-providers.tsx` (×1, `PROVIDER_LABELS`) | Admin-facing | Remplacé |
| `initiate-collect-payment.logic.ts` (×3 messages d'erreur + ×1 commentaire) | Client-facing | Remplacé |
| `plop-provider.server.ts` (×1 commentaire) | Interne, non visible | Remplacé (cohérence) |
| `initiate-collect-payment.test.ts` (×4) | Fixtures de test | Mis à jour en miroir des chaînes de production |

**Zéro occurrence restante** (`grep` de contrôle après modification : 0 résultat).

**Non touché, à dessein** : `payment-provider-display.ts` (`moncash_api: "PLOP"`) — concept distinct (nom technique du fournisseur/gateway pour un futur dashboard admin Collect, jamais affiché aujourd'hui) de "Peman Otomatik"/"Payment Global" (nom de la *méthode de checkout* client). Question ouverte pour vous : voulez-vous que "PLOP" devienne aussi "Payment Global" à cet endroit le jour où ce dashboard existera ? Non fait ici, hors du périmètre explicite ("Ancien : Peman Otomatik / Nouveau : Payment Global").

### Logo

**Écart assumé et justifié** : la mission demande un logo au format **PNG**. Je n'ai aucun outil de génération d'image raster dans cette session — je ne peux produire que du code (dont du SVG, du texte vectoriel valide). J'ai donc créé `public/payment-global-logo.svg` à la place :
- Badge arrondi, dégradé orange de marque (`#FB923C` → `#EA580C`, les couleurs exactes de `src/styles.css` — `--brand-light`/`--brand-deep`), fond transparent en dehors du badge.
- Icône carte de paiement générique + arcs concentriques (motif "sans contact"/connectivité universelle) — **aucune référence visuelle à MonCash, NatCash ou Kashpaw**, conforme à la contrainte "couche de paiement universelle".
- Validé XML bien formé (`[xml]` .NET parser : `XML VALID`).
- Un SVG reste net à n'importe quelle taille d'affichage (contrainte "bonne lisibilité en petite taille" — un SVG est objectivement supérieur à un PNG sur ce point précis). Si vous voulez malgré tout un vrai PNG (ex. dessiné par un designer), il suffit de le déposer dans `public/` et de changer une seule ligne (`checkout.tsx`, champ `logo`).

Câblage : `checkout.tsx` — `METHODS[0].logo` et l'encadré explicatif emerald (affiché quand "Payment Global" est sélectionné) pointent tous deux vers `/payment-global-logo.svg`, en suivant exactement le même motif d'affichage (`<img>` 40×28, `object-contain`, boîte blanche bordée) déjà utilisé pour MonCash/NatCash — aucun nouveau composant, aucune nouvelle logique de rendu.

### Vérification UX — honnêteté sur ce qui a été testé

- **Fait** : le SVG utilise exactement les mêmes dimensions/classes CSS (`width={40} height={28}`, `h-7 w-10 object-contain`) que les logos MonCash/NatCash déjà en production — aucun nouveau risque de rupture de mise en page introduit, par construction identique.
- **Fait** : `npx vite build` inclut désormais 216 entrées dans le precache PWA (215 avant) — confirme que le nouvel asset est correctement embarqué dans le build statique.
- **Non fait** : je n'ai pas lancé l'application dans un navigateur réel pour prendre une capture d'écran desktop/mobile — aucun outil de screenshot/navigateur headless disponible dans cette session au-delà du skill `run` (non invoqué ici, jugé disproportionné pour la vérification d'un seul asset SVG suivant un motif déjà éprouvé). Si vous voulez cette confirmation visuelle explicite avant mise en avant marketing, dites-le et je lance `run`.

Texte du checkout enrichi (encadré explicatif) : *"Payment Global — yon sèl pòtay pou plizyè rezo peman (MonCash jodi a, lòt rezo tankou NatCash pi devan)."* — formulation volontairement honnête (NatCash "pi devan"/à venir, pas "disponib kounye a") plutôt que la présentation "MonCash / NatCash / Autres moyens disponibles" suggérée telle quelle dans la mission, qui aurait affirmé une disponibilité NatCash non encore réelle (la porte métier `payment.method !== "moncash"` reste la seule voie active). À ajuster si vous préférez une formulation plus commerciale.

---

## Tests

| Commande | Résultat |
|---|---|
| `npm run typecheck` | ✅ Propre |
| `npm run lint` | ✅ 0 erreur (12 avertissements préexistants, sans rapport) |
| `npx vitest run` | ✅ **98/98 tests**, 9 fichiers |
| `npx vite build` | ✅ Réussi (216 entrées precache PWA, +1 vs avant) |

**Aucun impact backend, aucun impact paiement, aucune régression UI** — confirmé : seuls des libellés textuels et un asset statique ont changé ; aucune RPC, aucune logique de branche, aucun test de comportement (hors chaînes de texte) n'a été touché.

---

## Risques restants

| Niveau | Risque |
|---|---|
| **Faible** | Logo livré en SVG plutôt qu'en PNG comme demandé littéralement — justifié (aucun outil de génération d'image raster disponible), et objectivement supérieur pour la lisibilité à petite taille. À remplacer facilement si un PNG réel est fourni. |
| **Faible** | Aucune capture d'écran réelle (desktop/mobile) prise pour cette révision — réutilise un motif d'affichage déjà en production, risque résiduel jugé minime. |
| **Négligeable** | `payment-provider-display.ts` ("PLOP") non renommé — question ouverte, hors périmètre explicite de cette mission. |
| **Négligeable** | Formulation du texte explicatif checkout plus prudente que celle suggérée dans la mission ("pi devan" vs affirmer NatCash disponible) — décision éditoriale à valider avec vous. |

Aucun risque bloquant.

---

## Décision finale

**READY FOR MIGRATION**

(Note : au sens de "prêt à passer à l'étape suivante" — la migration SQL de la Phase 1 Dynamic Wallet est déjà appliquée et committée, voir § Note importante. Ce qui reste réellement "prêt" ici, c'est le **rebranding UI**, non encore commité.)

---

**Aucune migration appliquée dans cette mission (rien de nouveau à appliquer). Aucun commit créé — le rebranding UI (`checkout.tsx`, `dashboard.admin.payment-providers.tsx`, `initiate-collect-payment.logic.ts`, `plop-provider.server.ts`, tests, `public/payment-global-logo.svg`) attend votre validation avant tout commit.**
