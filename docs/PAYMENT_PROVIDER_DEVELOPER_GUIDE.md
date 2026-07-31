# Guide développeur — Ajouter un nouveau fournisseur de paiement

Comment brancher un nouveau `PaymentProvider` (ex. une vraie
implémentation NatCash, ou un fournisseur totalement différent) sans
retoucher `initiate_payout_secure`, `payout-pay-modal.tsx`, ni aucune
logique métier existante — c'est exactement le problème que
l'abstraction `PaymentProvider` (`src/lib/payment-providers/`) a été
conçue pour résoudre. Le connecteur MonCash de ce module est la
référence à suivre.

## L'interface à implémenter

`src/lib/payment-providers/types.ts` définit `PaymentProvider` :

```ts
export interface PaymentProvider {
  code: PaymentProviderCode; // ajouter le nouveau code à ce type union
  isConfigured(): boolean;
  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  checkStatus(providerReference: string): Promise<PaymentStatusResult>;
  cancelPayment(providerReference: string): Promise<CancelPaymentResult>;
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<WebhookVerifyResult>;
}
```

## Étapes

1. **Un module `.server.ts` par fournisseur, jamais `.ts`** —
   `mon-fournisseur-provider.server.ts`. Le suffixe `.server.ts` n'est
   pas une convention de style : TanStack Start fait échouer le build si
   un fichier de route ou un composant l'importe directement, ce qui
   garantit — au niveau du compilateur, pas d'une revue de code — que le
   secret du fournisseur ne peut jamais atteindre le bundle client. Voir
   `moncash-provider.server.ts` pour le patron exact.

2. **Config centralisée** — `mon-fournisseur-config.server.ts`, calqué
   sur `moncash-config.server.ts` : une fonction `isXConfigured()`
   (jamais de throw, juste un booléen) et une `getXConfig()` (throw avec
   un message listant les variables manquantes, jamais leurs valeurs).
   Aucun autre fichier ne doit lire `process.env.X_*` directement.

3. **Client HTTP séparé si l'appel réseau existe** —
   `mon-fournisseur-client.server.ts`. Si l'API a un contrat confirmé,
   reproduire le patron de `moncash-client.server.ts` :
   - Timeout (`AbortController`) + retry (backoff exponentiel, jamais
     sur un 4xx).
   - Journalisation de chaque tentative dans une table dédiée (ou
     réutiliser `moncash_api_logs` si le fournisseur est suffisamment
     proche — évaluer au cas par cas), avec **sanitization construite à
     la main par endpoit** (liste blanche des champs sûrs à logguer,
     jamais un dump brut de la requête/réponse).
   - `parseJsonOrThrow()`-équivalent — ne jamais laisser un
     `response.json()` non protégé produire une exception brute après
     un `response.ok` (gap réel trouvé et corrigé sur MonCash pendant ce
     chantier — voir MONCASH_RESILIENCE_REPORT.md).

4. **N'implémenter que ce que le fournisseur supporte réellement** — si
   son API ne supporte pas l'annulation, retourner
   `{ status: "not_cancellable" }`, jamais un succès inventé (voir
   `manual-provider.server.ts`/`moncash-provider.server.ts` pour
   l'exemple). Si un webhook n'est pas documenté publiquement,
   `verifyWebhook()` doit retourner `{ valid: false, error: "..." }`
   avec un message honnête plutôt que d'inventer un schéma de signature
   non confirmé et prétendre qu'il fonctionne. **Ne jamais faire
   accepter par `initiatePayment()` une direction (`collect`/`disburse`)
   que le fournisseur ne supporte pas réellement** — c'est exactement la
   garantie que `moncashProvider` fait pour `direction:"disburse"`,
   l'invariant le plus important de tout ce module.

5. **Enregistrer dans le registre** —
   `payment-providers/index.server.ts`, `PROVIDERS` : une ligne. C'est
   le **seul** endroit où `initiate-provider-payout.functions.ts`
   (et tout futur appelant) accède à une implémentation — jamais un
   import direct d'un fichier `*-provider.server.ts` ailleurs dans
   l'app.

6. **Ligne `payment_providers`** — migration additive,
   `INSERT INTO payment_providers (code, label, is_active) VALUES
   ('mon_fournisseur_api', 'Mon Fournisseur', false)` — toujours
   `is_active = false` à la création, jamais activé avant que
   l'implémentation soit réellement testée.

7. **Le sélecteur admin se met à jour tout seul** —
   `payout-pay-modal.tsx`'s `PAYOUT_CHANNELS` est la seule liste à
   étendre pour qu'un nouveau canal apparaisse dans "Kanal peman" ; il
   respecte déjà dynamiquement `payment_providers.is_active`
   (grisé "byento" tant que non activé), pas de logique
   supplémentaire à écrire.

## Tests attendus avant toute activation

Suivre le patron de `moncash-client.test.ts`/`moncash-provider.test.ts` :

- Succès, rejet 4xx (jamais réessayé), timeout, erreur réseau, retry
  5xx→succès, réponse invalide (JSON malformé).
- L'invariant central : toute direction/opération que le fournisseur ne
  supporte pas réellement échoue **toujours**, quelle que soit la
  configuration.
- Un test dédié confirmant qu'aucun secret n'apparaît dans ce qui est
  journalisé (calque de "createPayment: never logs the Authorization
  header, client secret, or raw tokens").
- Si webhook : signature valide acceptée, signature invalide rejetée,
  corps altéré rejeté, idempotence (`event_id` unique).

## Conventions générales de ce projet à respecter

- **Jamais de commit sans confirmation explicite pour un changement de
  cette ampleur** (financier) — voir CLAUDE.md.
- **Migrations append-only** — jamais modifier un fichier déjà mergé ;
  voir [MIGRATIONS.md](./MIGRATIONS.md).
- **`DROP FUNCTION IF EXISTS` avant tout `CREATE OR REPLACE` qui change
  une signature** — sinon Postgres crée une surcharge silencieuse (voir
  MIGRATIONS.md § Le risque déjà rencontré).
- **`SECURITY DEFINER` partout où une RPC touche wallets/payouts**,
  jamais une policy RLS `UPDATE` brute sur ces tables.
- **Toute RPC appelée uniquement par un mécanisme serveur-à-serveur
  (webhook, cron)** doit être `GRANT`-ée à `service_role` **exclusivement**
  (`REVOKE ALL ... FROM PUBLIC, authenticated, anon` explicitement nommés,
  pas seulement `PUBLIC`) — voir le correctif R1
  (MONCASH_PRODUCTION_READINESS_AUDIT.md) pour l'erreur à ne pas
  reproduire : `REVOKE ALL FROM PUBLIC` seul ne retire pas un privilège
  déjà accordé nommément à `anon` par les privilèges par défaut du
  projet.
