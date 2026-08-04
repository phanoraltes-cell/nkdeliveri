# NK Deliveri — PLOP — Rapport de remédiation architecturale

**Date** : 2026-08-04
**Portée** : correction de conception uniquement, avant Phase 2. **Aucun code, aucune migration, aucune modification React/RPC/Supabase écrits ou exécutés.** Complète `docs/PLOP_PHASE1_ARCHITECTURE.md` (mis à jour en parallèle — s'y référer pour le détail technique complet de chaque décision).

---

## 1. Résumé par objectif

| # | Objectif | Verdict | Détail |
|---|---|---|---|
| 1 | Renommer le provider | **Retenu, adapté** | Nouveau fichier `plop-provider.server.ts` ; `moncash-provider.server.ts` reste legacy Digicel intact. Répertoire `src/lib/payment-providers/` **non déplacé** — option "déplacement complet vers `src/lib/payments/providers/`" documentée et écartée (§ 2). |
| 2 | Optimiser le poll client | **Refait** | 4 paliers dégressifs (5s→10s→30s→60s) sur 15 min, jitter ±20 %, pause sur onglet caché, arrêt sur signal Realtime. ≤ 31 requêtes/session contre 56 dans la proposition initiale, pour une fenêtre 50 % plus longue (§ 3). |
| 3 | Clarifier le rôle du cron | **Fait** | Encadré explicite ajouté à `docs/PLOP_PHASE1_ARCHITECTURE.md` § 3 + diagramme de séquence distinguant visuellement "mécanisme principal" (poll client) et "filet de sécurité" (cron). |
| 4 | Affichage du fournisseur | **Fait, portée clarifiée** | Nouveau module de présentation `payment-provider-display.ts` (`moncash_api → "PLOP"`). Aucune surface admin actuelle n'affiche `provider_code` côté Collect — vérifié par grep exhaustif, donc rien à corriger dans l'existant ; le module attend la première vraie surface Collect (Phase 6). `payout-pay-modal.tsx`/`dashboard.admin.moncash.tsx` (décaissement) **non touchés**. |
| 5 | Uniformiser les logs | **Fait** | Matrice de correspondance complète `moncash_api_logs` ↔ `plop_api_logs` — un seul écart trouvé (colonne `method` manquante dans la proposition initiale), corrigé. Index, RLS, triggers append-only identiques. |
| 6 | Documentation | **Fait** | `docs/PLOP_PHASE1_ARCHITECTURE.md` mis à jour (justifications, avantages, impacts, dette évitée par objectif) + diagramme Mermaid de bout en bout (§ 11 de ce document). |

---

## 2. Objectif 1 — détail de l'arbitrage (renommage)

La mission proposait, à titre d'exemple, un déplacement complet vers `src/lib/payments/providers/`. Analyse du coût réel avant décision :

**Fichiers qui référencent `src/lib/payment-providers/` aujourd'hui** (grep exhaustif, imports statiques et dynamiques confondus) :

| Fichier | Import concerné | Domaine |
|---|---|---|
| `src/lib/initiate-collect-payment.logic.ts` | `moncash-provider.server` (dynamique) | **Collect — à modifier de toute façon (Phase 3)** |
| `src/lib/payment-providers/index.server.ts` | registre interne | **Collect — à modifier de toute façon** |
| `src/lib/initiate-provider-payout.functions.ts` | `index.server` (statique) | Décaissement — **hors périmètre, ne doit pas changer** |
| `src/routes/api.webhooks.moncash.ts` | `moncash-webhook-handler.server` (dynamique) | Décaissement — **hors périmètre** |
| `src/routes/api.webhooks.moncash.collect.ts` | `moncash-collect-webhook-handler.server` (dynamique) | Collect (dormant) — **hors périmètre** |
| `src/routes/api.cron.moncash-reconcile.ts` | `moncash-reconcile.server` (dynamique) | Décaissement — **hors périmètre** |
| `src/lib/get-moncash-status.functions.ts` | `moncash-config.server` (dynamique) | Config générale — **hors périmètre** |
| `src/lib/__tests__/initiate-collect-payment.test.ts` | `payment-providers/types`, mock `moncash-provider.server` | Tests — **à ajuster de toute façon (Phase 5)** |

**Constat** : un déplacement complet toucherait 4 fichiers explicitement hors périmètre de cette mission, dont deux (`api.webhooks.moncash.ts`, `api.cron.moncash-reconcile.ts`) appartiennent au **décaissement**, protégé par la contrainte "aucune modification des décaissements". Le bénéfice (cosmétique — un chemin de répertoire plus "propre") ne justifie pas ce risque pour un chantier dont l'objectif réel, tel que nommé dans la mission, est uniquement "le code PLOP ne doit jamais vivre dans un fichier nommé MonCash" — objectif atteint à 100 % par un simple fichier neuf.

**Décision** : Option A (fichier neuf `plop-provider.server.ts`, répertoire inchangé) — 2 lignes de diff au lieu de ~10 fichiers. Aucune couche de compatibilité nécessaire (aucun import cassé). La stratégie de compatibilité pour une éventuelle Option B future (si un jour souhaitée, hors de ce chantier) est documentée dans `docs/PLOP_PHASE1_ARCHITECTURE.md` § 8 pour référence.

---

## 3. Objectif 2 — détail du calcul de charge

| | Proposition initiale | Proposition retenue |
|---|---|---|
| Paliers | 2 (5s, 15s) | 4 (5s, 10s, 30s, 60s) |
| Fenêtre couverte | 10 min | 15 min |
| Appels max/session | 56 | 31 |
| Protection anti-rafale | Aucune | Jitter ±20 %, pause onglet caché, arrêt sur Realtime |

Réduction ≈ 45 % du volume d'appels pour une couverture temporelle supérieure de 50 %. Le détail palier par palier et sa justification (comportement attendu de l'utilisateur à chaque fenêtre) est dans `docs/PLOP_PHASE1_ARCHITECTURE.md` § 3bis.

---

## 4. Vérifications finales

| Vérification | Statut |
|---|---|
| Aucun changement fonctionnel | ✅ — uniquement de la conception/documentation dans cette passe |
| Aucune migration | ✅ — `plop_api_logs` reste un plan (§ 10 de l'architecture), pas un fichier `.sql` |
| Aucun RPC modifié | ✅ — `create_collect_payment_secure`/`complete_collect_payment_secure` non touchées, ni dans le code ni dans le plan |
| Aucune régression | ✅ — aucun fichier réel modifié dans cette passe |
| Aucune modification de `PaymentProvider` | ✅ — `types.ts` inchangé, aucune évolution d'interface proposée |
| Aucune modification de Cash | ✅ — non mentionné, non touché |
| Aucune modification de NatCash | ✅ — `natcash-provider.server.ts` explicitement listé comme non touché |
| Aucune modification de MonCash Manuel | ✅ — flux `moncash` manuel dans `checkout.tsx` non concerné |
| Aucune modification des décaissements | ✅ — `payout-pay-modal.tsx`, `dashboard.admin.moncash.tsx`, `moncash-webhook-handler.server.ts`, `api.webhooks.moncash.ts`, `moncash-reconcile.server.ts`, `initiate-provider-payout.functions.ts` explicitement identifiés et exclus de tout changement (§ 2, § 9 de l'architecture) |

---

## 5. Liste consolidée des fichiers qui seront modifiés/créés en Phase 2

### Créés
- `src/lib/payment-providers/plop-config.server.ts`
- `src/lib/payment-providers/plop-client.server.ts`
- `src/lib/payment-providers/plop-provider.server.ts`
- `src/lib/payment-providers/plop-reconcile.server.ts`
- `src/routes/api.cron.plop-reconcile.ts`
- `src/lib/payment-provider-display.ts`
- `src/lib/payment-providers/__tests__/plop-client.test.ts`
- `src/lib/payment-providers/__tests__/plop-provider.test.ts`
- `src/lib/payment-providers/__tests__/plop-reconcile.test.ts`
- `supabase/migrations/<timestamp>_plop_api_logs.sql` (écrite, non appliquée)

### Modifiés (Phase 2 elle-même ne touche encore que la config/l'outillage — le branchement réel à l'app est Phase 3)
- `.env.example` (ajout des 3 variables `PLOP_*`)
- `vercel.json` (nouvelle entrée `crons`)

### Modifiés en Phase 3 (branchement — rappel, pas cette phase)
- `src/lib/payment-providers/index.server.ts` (1 ligne : `moncash_api: plopProvider`)
- `src/lib/initiate-collect-payment.logic.ts` (1 ligne : import `plop-provider.server`)
- `src/routes/orders.$id.tsx` (ajout du poll adaptatif § 3bis)

### Explicitement non modifiés, à aucun moment de ce chantier
`moncash-provider.server.ts`, `moncash-client.server.ts`, `moncash-config.server.ts`, `moncash-webhook-handler.server.ts`, `moncash-collect-webhook-handler.server.ts`, `moncash-reconcile.server.ts`, `manual-provider.server.ts`, `natcash-provider.server.ts`, `types.ts`, `payout-pay-modal.tsx`, `dashboard.admin.moncash.tsx`, `api.webhooks.moncash.ts`, `api.webhooks.moncash.collect.ts`, `api.cron.moncash-reconcile.ts`, `initiate-provider-payout.functions.ts`, `get-moncash-status.functions.ts`, toute migration SQL existante, `payment_providers`, `create_collect_payment_secure`, `complete_collect_payment_secure`, `checkout.tsx`.

---

**Aucun code n'a été écrit. Aucune migration n'a été créée. Seuls `docs/PLOP_PHASE1_ARCHITECTURE.md` et ce rapport ont été modifiés. En attente de votre validation avant la Phase 2.**
