# Remédiation des écarts mineurs — PAYMENT_POST_INCIDENT_AUDIT

**Date** : 2026-08-05
**Portée** : uniquement les 5 écarts confirmés par `docs/PAYMENT_POST_INCIDENT_AUDIT.md`. Rien d'autre n'a été touché. **Aucune migration appliquée, aucun commit, aucun push.**

## Statut

**PRÊT POUR VALIDATION** — les 5 correctifs sont écrits et vérifiés ; les 2 migrations attendent votre validation avant application.

---

## Résumé

Les 5 écarts confirmés par l'audit ont chacun reçu le correctif le plus étroit possible :

| # | Écart | Correctif | Type |
|---|---|---|---|
| 1 | `maintenance_message` obsolète en base | Migration data-only (`UPDATE` guardé) | Migration (non appliquée) |
| 2 | Notifications SQL "MonCash Automatik" | Migration `CREATE OR REPLACE` (2 littéraux seulement) | Migration (non appliquée) |
| 3 | Toggle "Kache" sans effet | Bouton désactivé + libellés honnêtes | Code (admin uniquement) |
| 4 | Texte client "MonCash" codé en dur | Texte générique, sans nom de fournisseur | Code (customer-facing) |
| 5 | Pas de push admin sur échec de paiement | Nouveau `send-*-push.functions.ts`, câblé dans `checkout.tsx` | Code (nouveau fichier + 1 câblage) |

**Deux écarts entre la lettre de la mission et son exécution réelle, documentés ci-dessous** (§ Pourquoi ils étaient sûrs) : la Correction 4 n'utilise pas `payment-provider-display.ts` comme suggéré littéralement (cela aurait affiché "PLOP", un nom interne, au client) ; la Correction 5 notifie les **admins**, pas le "client" comme l'énoncé de la mission le disait — c'est exactement ce que l'audit avait réellement trouvé (`collect_payment_admin_error`, un événement nommé et ciblé admin dès l'origine).

Toutes les vérifications demandées sont vertes : `typecheck`, `lint` (0 erreur), `check:migrations` (0 hasard), 98/98 tests unitaires, build production.

---

## Correctifs appliqués

### Correction 1 — Rebranding de la donnée

**Fichier** : `supabase/migrations/20260805100000_fix_payment_global_maintenance_message.sql` (nouveau, non appliqué)

```sql
UPDATE public.payment_provider_settings
SET maintenance_message = 'Payment Global ap retounen byento.'
WHERE provider = 'moncash_auto'
  AND maintenance_message = 'MonCash Automatik ap retounen byento.';
```

- Uniquement une donnée — aucune table, colonne, fonction ou permission touchée.
- Composant React (`checkout.tsx`) : **non modifié** pour cette correction.
- Panneau admin (`dashboard.admin.payment-providers.tsx`) : **non modifié** pour cette correction (touché séparément pour la Correction 3, voir plus bas).
- Logique métier : **non modifiée**.
- Le `WHERE ... AND maintenance_message = '...'` garde l'opération idempotente et sûre : si vous avez déjà édité ce message à la main entre-temps, cette migration ne fait rien (0 ligne affectée) plutôt que d'écraser votre changement.

### Correction 2 — Notifications SQL

**Fichier** : `supabase/migrations/20260805110000_rename_collect_payment_notifications_to_payment_global.sql` (nouveau, non appliqué)

Deux littéraux changés, un dans chaque fonction, **rien d'autre** :

| Fonction | Avant | Après |
|---|---|---|
| `create_collect_payment_secure` | `'Yon tantativ peman MonCash Automatik ' \|\| ...` | `'Yon tantativ peman Payment Global ' \|\| ...` |
| `complete_collect_payment_secure` | `... atravè MonCash Automatik echwe: ...` | `... atravè Payment Global echwe: ...` |

- `CREATE OR REPLACE FUNCTION` (signature identique, donc pas de `DROP FUNCTION` nécessaire — confirmé par `npm run check:migrations`, qui ne signale un risque que pour un changement de signature).
- Chaque ligne du corps des deux fonctions est reproduite à l'identique de `20260804130000_plop_wallet_traceability.sql`, à l'exception des 2 littéraux ci-dessus — vérifié par relecture ligne à ligne.
- **Délibérément non touchés** (hors périmètre de cette mission, pas dans les 5 écarts confirmés) : les 2 messages d'exception client "MonCash Automatik disponib sèlman pou peman MonCash" et "MonCash Automatik pa disponib pou kounye a." — l'audit n'a flagué que les 2 corps de `notify_secure` (lignes 124/193 de l'ancienne migration), jamais ces exceptions.
- Permissions : `REVOKE`/`GRANT` reproduits à l'identique (`authenticated` pour `create_collect_payment_secure`, `service_role` pour `complete_collect_payment_secure`).
- Triggers : aucun sur ces 2 fonctions — rien à préserver de ce côté.

### Correction 3 — Bouton Admin "Kache"

**Fichier modifié** : `src/routes/_authenticated/dashboard.admin.payment-providers.tsx`

**Option retenue : A (désactiver le contrôle)** — la moins risquée, comme demandé :
- Le bouton "Kache"/"Fè l vizib" est maintenant **toujours désactivé** (`disabled` inconditionnel, avant c'était seulement pendant la mutation), avec un `title` expliquant pourquoi et un suffixe visible "(pa aktive)".
- Le badge "Kache" affiché quand `visible=false` devient "Kache (san efè kounye a)" avec un `title` explicite.
- La mutation `toggleVisible` elle-même **n'a pas été supprimée** — elle reste câblée (RPC, RLS inchangés) pour ne pas fermer la porte à une future implémentation réelle (Option B), seul le contrôle UI qui la déclenche est neutralisé.
- **Non touché** : `checkout.tsx` (aucune logique de rendu client modifiée pour cette correction), aucune RPC, aucune permission.

### Correction 4 — `orders.$id.tsx`

**Fichier modifié** : `src/routes/orders.$id.tsx`

Avant : `"N ap tann konfimasyon MonCash — paj sa a ap mete ajou otomatikman."`
Après : `"N ap tann konfimasyon peman an — paj sa a ap mete ajou otomatikman."`

Aucun nom de fournisseur ou de wallet n'apparaît plus dans ce texte — reste correct quel que soit le wallet PLOP utilisé (`moncash`, et demain `natcash`/`kashpaw` sans nouvelle modification de ce fichier).

### Correction 5 — Notification Push

**Nouveau fichier** : `src/lib/send-collect-payment-admin-error-push.functions.ts`
**Fichier modifié** : `src/routes/checkout.tsx` (import + `useServerFn` + 1 appel fire-and-forget dans la branche `outcome === "failed"`)

- Suit exactement le patron des 9 fichiers `send-*-push.functions.ts` déjà existants : `createServerFn` + `requireSupabaseAuth` + vérification de propriété + `enforceRateLimit` + `pushToUsers` (le même moteur que tous les autres, `push-dispatch.server.ts` — **aucun second système créé**).
- Résout les destinataires exactement comme le fait déjà `create_collect_payment_secure` en SQL : `user_roles.role IN ('admin', 'super_admin')` — même audience que la notification in-app existante.
- Appelé en fire-and-forget (`.catch(console.warn)`) juste après que `initiateCollect(...)` retourne `outcome: "failed"` — une panne de ce push ne bloque et ne modifie jamais le comportement client existant (`toast.error` + navigation restent inchangés).

---

## Pourquoi ils étaient sûrs

- **Correction 1** : une seule instruction `UPDATE`, guardée par l'ancienne valeur exacte — ne peut ni créer, ni supprimer, ni renommer quoi que ce soit ; ne peut affecter aucune autre ligne que celle de `moncash_auto`.
- **Correction 2** : `CREATE OR REPLACE` à signature strictement identique — Postgres remplace la fonction en place (même OID), les permissions déjà accordées restent en vigueur automatiquement ; de plus elles sont réémises explicitement, à l'identique, par cohérence avec le style du reste du projet. `check:migrations` confirme 0 risque de surcharge silencieuse.
- **Correction 3** : ne touche qu'un composant admin déjà isolé du flux de paiement réel (`checkout.tsx`, les RPC, PLOP — tout cela reste intact). Rendre un bouton `disabled` est le changement le plus réversible possible.
- **Correction 4** : retire un nom en dur au lieu d'en calculer un dynamiquement — élimine la classe de bug entière (aucun risque qu'un futur wallet rende ce texte encore faux) sans ajouter de dépendance ni de logique nouvelle.
- **Correction 5** : fire-and-forget, comme tous les appels `send-*-push` existants dans ce même fichier — une panne de la nouvelle notification ne peut, par construction, jamais empêcher `clear()`/`toast.error(...)`/`nav(...)` de s'exécuter.

### Deux écarts documentés entre la lettre de la mission et l'exécution réelle

1. **Correction 4** — la mission demandait d'"utiliser le module officiel d'affichage des providers" (`payment-provider-display.ts`). Ce module mappe `moncash_api` → **"PLOP"**, un nom de passerelle interne, explicitement réservé (dans son propre commentaire d'en-tête) à une future vue admin — jamais à un écran client. L'utiliser ici aurait affiché "PLOP" à un client sur `/orders/:id`, une régression de confidentialité de marque plus grave que le bug d'origine (tout le travail de rebranding précédent visait justement à ne jamais exposer "PLOP", seulement "Payment Global"). **Correctif retenu** : aucun nom de fournisseur du tout — la formulation la plus sûre et la plus généraliste, sans toucher `payment-provider-display.ts` ni créer un nouveau module (qui aurait été une modification d'architecture, interdite par cette mission).
2. **Correction 5** — l'énoncé de cette mission dit *"Le **client** ne reçoit aucune notification push"*. L'audit lui-même, cité en préambule de cette mission comme la seule source de vérité, décrit le problème différemment : *"L'admin reçoit bien une notification in-app... mais aucun push mobile"* — et l'événement concerné s'appelle littéralement `collect_payment_admin_error`, ciblé `admin`/`super_admin` dès sa création dans `create_collect_payment_secure`. Le client, lui, voit déjà un `toast.error` immédiat et un message dédié sur `/orders/:id` au moment même de l'échec — il n'a jamais été signalé comme manquant de notification. **Correctif retenu** : notifier les admins (ce que l'audit a réellement trouvé), pas les clients — suivre la description erronée aurait été une action hors périmètre, non couverte par les 5 écarts réellement confirmés.

---

## Vérifications

| Commande | Résultat |
|---|---|
| `npm run typecheck` | ✅ Propre |
| `npm run lint` | ✅ 0 erreur (12 avertissements préexistants, sans rapport) |
| `npm run check:migrations` | ✅ "119 migrations scanned, 2 historical overload(s) all later cleaned up, no unresolved hazards" (117 → 119, les 2 nouvelles migrations) |
| `npx vitest run` | ✅ 98/98 tests, 9 fichiers |
| `npx vite build` | ✅ Réussi, 252 entrées precache PWA (inchangé) |

---

## Vérifications métier

Confirmé inchangé par lecture directe du code et de `git status` (aucun de ces fichiers n'apparaît dans les modifications de cette mission) :

| Domaine | Statut |
|---|---|
| Cash | 🟢 Intact |
| NatCash Manuel / MonCash Manuel | 🟢 Intacts |
| Payment Global / PLOP (logique de paiement) | 🟢 Intact — `plop-provider.server.ts`, `plop-client.server.ts` non touchés dans cette mission |
| Polling (`useCollectPaymentPoll.ts`) | 🟢 Non touché |
| Cron (`plop-reconcile.server.ts`) | 🟢 Non touché |
| Realtime | 🟢 Non touché |
| Wallet / Décaissements | 🟢 Aucun fichier de ces domaines touché |
| Notifications existantes (les 9 autres `send-*-push.functions.ts`) | 🟢 Non touchées |
| Dashboard | 🟢 Seule la page fournisseurs de paiement a changé (Correction 3), aucune autre page admin |

---

## Régression

**Aucune régression attendue.** Périmètre des fichiers touchés strictement limité aux 5 corrections :

```
git status --short -- src/ supabase/
 M src/routes/_authenticated/dashboard.admin.payment-providers.tsx   (Correction 3)
 M src/routes/checkout.tsx                                           (Correction 5, câblage)
 M src/routes/orders.$id.tsx                                         (Correction 4)
?? src/lib/send-collect-payment-admin-error-push.functions.ts        (Correction 5, nouveau)
?? supabase/migrations/20260805100000_..._maintenance_message.sql    (Correction 1, nouveau)
?? supabase/migrations/20260805110000_..._payment_global.sql         (Correction 2, nouveau)
```

**Note de transparence** : `dashboard.admin.payment-providers.tsx` et `checkout.tsx` portaient déjà des modifications non commitées **avant le début de cette mission** (le rebranding "Peman Otomatik" → "Payment Global", en attente de votre validation depuis un tour précédent — voir `docs/PLOP_DYNAMIC_WALLET_PHASE1_FINAL_REVIEW_REPORT.md`). Le `git diff` complet de ces 2 fichiers contient donc ce travail antérieur en plus des corrections de cette mission — la section suivante isole précisément ce qui vient de cette mission.

`initiate-collect-payment.logic.ts`, `plop-provider.server.ts` et `initiate-collect-payment.test.ts` apparaissent aussi comme modifiés dans `git status`, mais **aucun d'eux n'a été touché durant cette mission** — ce sont, de la même façon, des modifications non commitées d'un tour précédent (dynamic wallet + rebranding), non ré-ouvertes ici.

---

## Tests

98/98 tests unitaires toujours verts après les 5 corrections. Aucun test unitaire n'exerçait les chaînes exactement modifiées (les corps de fonction SQL ne sont pas testés au niveau unitaire — mockés — et l'ancien texte "N ap tann konfimasyon MonCash" n'était référencé par aucun test), donc aucune mise à jour de fixture n'a été nécessaire. Suite Playwright non ré-exécutée dans cette mission (portée strictement limitée aux 5 écarts ; le rapport d'audit avait déjà confirmé 6/7 tests de paiement fonctionnels avec le bon build `build:e2e`, sans lien avec les 5 corrections ci-dessus).

---

## Capture git diff

### `orders.$id.tsx` (Correction 4 — seul changement de cette mission dans ce fichier)

```diff
             {isCollect && collectTransaction?.status === "pending" && (
+              // Wallet-agnostic on purpose (post-incident audit remediation, ...)
               <p className="mt-2 text-xs text-ink-soft">
-                N ap tann konfimasyon MonCash — paj sa a ap mete ajou otomatikman.
+                N ap tann konfimasyon peman an — paj sa a ap mete ajou otomatikman.
               </p>
             )}
```

### `dashboard.admin.payment-providers.tsx` (Correction 3 — seul changement de cette mission ; la ligne `moncash_auto: "Payment Global"` visible dans le diff complet est antérieure à cette mission)

```diff
+  // `visible` itself is still wired end-to-end ... (comment)
   const toggleVisible = useMutation({ ... });
   ...
-                  {!row.visible && <Badge variant="outline">Kache</Badge>}
+                  {!row.visible && (
+                    <Badge variant="outline" title="San efè sou paj checkout la pou kounye a">
+                      Kache (san efè kounye a)
+                    </Badge>
+                  )}
   ...
                   <button
                     onClick={() => toggleVisible.mutate(row)}
-                    disabled={toggleVisible.isPending}
-                    className="rounded-lg border-2 border-brand-soft px-3 py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40"
+                    disabled
+                    title="Poko gen efè sou paj checkout la — sèl 'Aktive/Dezaktive' kontwole sa kliyan yo ka itilize jodi a"
+                    className="cursor-not-allowed rounded-lg border-2 border-brand-soft/60 px-3 py-1 text-xs font-bold text-ink-soft opacity-60"
                   >
-                    {row.visible ? "Kache" : "Fè l vizib"}
+                    {row.visible ? "Kache" : "Fè l vizib"} (pa aktive)
                   </button>
```

### `checkout.tsx` (Correction 5 — seul changement de cette mission ; le reste du diff complet, ex. les labels "Payment Global", est antérieur)

```diff
+import { sendCollectPaymentAdminErrorPush } from "@/lib/send-collect-payment-admin-error-push.functions";
   ...
+  const sendCollectPaymentAdminErrorPushFn = useServerFn(sendCollectPaymentAdminErrorPush);
   ...
         if (result.outcome === "failed") {
+          sendCollectPaymentAdminErrorPushFn({ data: { paymentId: paymentRow.id } }).catch((e) =>
+            console.warn("[push] collect-payment-admin-error notify failed", e),
+          );
           clear();
           toast.error(...);
```

### Fichiers entièrement nouveaux

- `src/lib/send-collect-payment-admin-error-push.functions.ts` (74 lignes)
- `supabase/migrations/20260805100000_fix_payment_global_maintenance_message.sql` (21 lignes)
- `supabase/migrations/20260805110000_rename_collect_payment_notifications_to_payment_global.sql` (178 lignes, corps de fonction reproduits pour respecter `CREATE OR REPLACE`)

---

## Verdict

**🟢 PRÊT — 5/5 corrections appliquées au code, dans le périmètre strict demandé, aucune régression détectée, toutes les vérifications vertes.**

**Rien n'a été commité, poussé, ou appliqué en base.** Avant toute mise en production :
1. Relire les 2 nouvelles migrations (`20260805100000`, `20260805110000`).
2. Si elles vous conviennent, les appliquer (`supabase db push`) — elles sont indépendantes l'une de l'autre et de tout autre changement en attente.
3. Valider les 3 fichiers de code modifiés + le nouveau fichier de push.
4. Me dire si vous voulez que je commite (avec la même discipline d'exclusion des fichiers non liés déjà en place depuis le début de ce chantier).

**En attente de votre validation avant toute application de migration, tout commit, tout push ou toute mise en production.**
