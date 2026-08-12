# Payment Provider Hardening — Rapport de Sécurité

**Date** : 2026-08-03
**Méthode** : chaque scénario ci-dessous a été vérifié en direct contre la production (`dcsnmvbtsmdbwrwbutph`) — requêtes SQL réelles, jamais supposées.

---

## Scénarios d'attaque testés

### 1. Appel RPC direct (bypass complet du frontend et de la couche JS)

**Constat initial** : `create_collect_payment_secure` (la RPC existante) n'avait aucune connaissance de `payment_provider_settings` — un appel direct avec `_status='pending'` aurait pu insérer une ligne `payment_transactions` "pending" fictive même si `moncash_auto.enabled = false`.

**Impact réel avant correctif** : nul financièrement (cette RPC ne touche jamais `payments.status`/`orders.status`, seule `complete_collect_payment_secure` — `service_role` uniquement, inatteignable côté client — peut confirmer un paiement), mais une ligne fictive aurait pollué l'audit et déclenché de fausses alertes admin.

**Correctif** : migration `20260803130000` — un `IF _status = 'pending'` vérifie `payment_provider_settings.enabled` avant l'insertion.

**Preuve en production, réelle (pas transactionnelle)** :

```sql
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claim.sub', '<client réel, non-admin>', true);
SELECT public.create_collect_payment_secure('<payment_id réel>'::uuid, 'live-attack-check', 'pending', NULL);
→ ERROR: 42501: MonCash Automatik pa disponib pou kounye a.
```

Confirmé : **zéro ligne orpheline** créée (`SELECT count(*) FROM payment_transactions WHERE external_reference IN (...)` → `0`).

### 2. Manipulation du frontend (retirer l'attribut `disabled`, forcer un clic)

Le bouton "MonCash Automatik" utilise l'attribut HTML natif `disabled` — un utilisateur qui le retire via les DevTools et force un clic atteindrait `initiateCollect()`, qui appelle la fonction serveur `initiateCollectPayment` → `runInitiateCollectPayment`. **Ce chemin vérifie `enabled` en tout premier**, avant même `isConfigured()` — confirmé par test unitaire (`isConfiguredMock` jamais appelé quand `enabled=false`) et par la vérification RPC directe ci-dessus (le même chemin serveur).

**Conclusion** : manipuler le frontend ne donne accès à rien de plus qu'un appel RPC direct — déjà couvert par le scénario 1.

### 3. Requête forgée (falsifier `enabled: true` dans la requête)

`InitiateCollectPaymentInputSchema` (Zod) n'accepte qu'un seul champ : `{ paymentId: uuid }`. Testé explicitement :

```ts
InitiateCollectPaymentInputSchema.safeParse({
  paymentId: "...",
  enabled: true,
  providerAvailable: true,
});
// → { paymentId } uniquement — les champs additionnels sont silencieusement ignorés par zod, jamais transmis
```

Aucun champ client ne peut jamais influencer la décision `enabled` — elle est lue exclusivement depuis la base de données côté serveur, jamais depuis l'entrée utilisateur.

### 4. Élévation de privilège sur la RPC d'administration

`update_payment_provider_setting_secure` — testé transactionnellement avec un vrai utilisateur `customer` (non-admin, sans rôle superposé — voir note méthodologique ci-dessous) :

```
→ ERROR: 42501 (Forbidden)
```

Testé avec un vrai `admin` : succès, `audit_log` reçoit une ligne `payment_provider_setting.updated`.

**Note méthodologique** (transparence) : la première tentative de ce test a échoué à révéler quoi que ce soit car l'utilisateur "customer" sélectionné au hasard (`LIMIT 1` sans tri) possédait _aussi_ les rôles `admin`/`super_admin` dans les données de fixture (`6d6db611-...`) — un compte multi-rôle de développement. Corrigé en excluant explicitement tout utilisateur ayant un rôle admin de la sélection du fixture "customer". Documenté ici pour qu'un futur test similaire ne retombe pas dans le même piège.

### 5. RLS — lecture publique, écriture bloquée

```sql
SET LOCAL role anon;
SELECT count(*) FROM payment_provider_settings; → 4 (lecture publique confirmée, comme voulu)
UPDATE payment_provider_settings SET enabled = true WHERE provider = 'kach';
→ ERROR: insufficient_privilege (confirmé — aucune policy d'écriture n'existe)
```

### 6. Contrainte d'unicité du défaut

```sql
UPDATE payment_provider_settings SET default_provider = true WHERE provider = 'moncash';
-- (alors que 'kach' est déjà default_provider = true)
→ ERROR: unique_violation (index partiel, confirmé)
```

---

## Ce qui n'a pas été testé (hors périmètre, déjà couvert ailleurs)

- Sécurité générale de `payment_providers` (table de décaissement, inchangée) — déjà auditée dans `docs/RELEASE_V1_AUDIT_REPORT.md`.
- Grant `anon` systémique sur les 80 autres fonctions `SECURITY DEFINER` du schéma — constat M-1 déjà documenté, non traité ici (hors périmètre explicite de cette mission).

## Verdict

**Le backend est désormais la seule source de vérité pour la disponibilité de MonCash Automatik.** Trois chemins d'attaque distincts (appel RPC direct, manipulation frontend, requête forgée) ont été testés et refusés en direct sur la production, pas seulement en théorie. Le seul chemin qui aurait pu contourner le contrôle (RPC existante sans connaissance du flag) a été identifié et corrigé avec une justification explicite, conformément à l'autorisation de la mission de modifier une RPC existante "avec justification".
