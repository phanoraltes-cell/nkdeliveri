# 🔧 Remédiation — Inscription Restaurant + Documents Livreur + Storage Owner

**Date** : 2026-08-09
**Référence** : `docs/DRIVER_RESTAURANT_REGISTRATION_AUDIT.md`
**Statut** : code + tests + migrations écrits et vérifiés, **migrations testées uniquement via BEGIN/ROLLBACK — rien n'a été appliqué en production, aucun commit, aucun push**.

---

## 1. Bugs corrigés

| ID  | Bug                                                                                | Statut     |
| --- | ---------------------------------------------------------------------------------- | ---------- |
| R1  | `restaurants.opening_hours` toujours `{}` à l'inscription                          | ✅ Corrigé |
| R2  | Un livreur pouvait être approuvé sans pièce d'identité persistée                   | ✅ Corrigé |
| R3  | Aucun mécanisme de rattrapage pour un livreur déjà approuvé sans document          | ✅ Corrigé |
| R4  | `stampOwner()` laissait `storage.objects.owner` à `NULL` après upload service-role | ✅ Corrigé |

---

## 2. Cause racine (rappel, détail complet dans l'audit)

- **R1** : le formulaire d'inscription restaurant collectait "Orè ouvèti" mais ne l'envoyait jamais dans les metadata de `signUp()` — le trigger `handle_new_user()` retombait systématiquement sur `COALESCE(NULL, '{}')`.
- **R2/R3** : `update_driver_status_secure` n'avait aucune vérification de document avant d'autoriser `'approved'`, et `finalizeRegistrationDocuments` verrouille définitivement dès que le compte quitte `pending` — confirmé sur le seul livreur réel en production (`id_doc_url: null`, statut `online`).
- **R4** : `.schema("storage").from("objects").update(...)` n'avait aucun effet en production — confirmé sur les 2 seuls objets réels (`restaurant-assets`), tous deux `owner: NULL`.

---

## 3. Fichiers modifiés

| Fichier                                                      | Nature                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/components/hours-picker.tsx`                            | **Nouveau** — composant partagé extrait de `dashboard.restaurant.profile.tsx`                      |
| `src/routes/_authenticated/dashboard.restaurant.profile.tsx` | Modifié — utilise `HoursPicker` (comportement identique, code relocalisé)                          |
| `src/components/auth/restaurant-form.tsx`                    | Modifié — remplace le champ texte libre par `HoursPicker`, transmet `restaurant_hours`             |
| `src/lib/register-documents.functions.ts`                    | Modifié — `stampOwner()` appelle la nouvelle RPC au lieu de `.schema("storage")`                   |
| `src/components/dashboard/admin/driver-detail-dialog.tsx`    | Modifié — bouton "Apwouve" désactivé si `id_doc_url` absent (miroir UI, pas l'autorité)            |
| `src/routes/_authenticated/dashboard.driver.profile.tsx`     | Modifié — nouvelle section de rattrapage pour uploader la pièce d'identité manquante               |
| `src/integrations/supabase/types.ts`                         | Modifié — 2 nouvelles fonctions ajoutées manuellement (à régénérer pour de vrai après application) |
| `src/components/auth/__tests__/restaurant-form.test.ts`      | **Nouveau** — 3 tests                                                                              |
| `src/lib/__tests__/register-documents.test.ts`               | **Nouveau** — 3 tests                                                                              |

---

## 4. Migrations créées (non appliquées)

| Fichier                                                                   | Contenu                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260809120000_restaurant_hours_signup_shape.sql`    | `public.is_valid_opening_hours_shape(jsonb)` (nouvelle fonction pure) + `CREATE OR REPLACE FUNCTION public.handle_new_user()` (décodage sécurisé de `restaurant_hours`) |
| `supabase/migrations/20260809130000_require_driver_identity_document.sql` | `CREATE OR REPLACE FUNCTION public.update_driver_status_secure(...)` — vérifie `id_doc_url` + existence réelle de l'objet Storage avant `'approved'`                    |
| `supabase/migrations/20260809140000_fix_storage_document_owner.sql`       | Nouvelle RPC `public.stamp_storage_object_owner_secure(text, text, uuid)`, `service_role` uniquement                                                                    |

Toutes trois `CREATE OR REPLACE` sur des signatures **inchangées** (sauf la nouvelle RPC, qui est une création pure) — aucun `DROP`, aucune perte de grants existants. `npm run check:migrations` : **128 migrations, 0 danger**.

---

## 5. Restaurant `opening_hours` — Avant / Après

**Avant** : formulaire → champ texte libre jamais transmis → `handle_new_user()` → `COALESCE(NULL, '{}')` → `opening_hours = {}` pour 100% des inscriptions.

**Après** : formulaire → `HoursPicker` (même composant que `dashboard.restaurant.profile.tsx`, extrait pour réutilisation) → si l'owner touche au moins un jour, `restaurant_hours` est envoyé en JSON-encodé (`JSON.stringify`) dans les metadata → `handle_new_user()` décode via `->>` + `::jsonb` (avec récupération sur erreur de parsing) → valide la forme via `is_valid_opening_hours_shape()` → stocke la vraie structure `Record<jour,{open,close,closed}>`, ou `{}` si l'owner n'a rien touché (comportement Cas B préservé, testé).

---

## 6. Documents livreur — Avant / Après

**Avant** : aucune vérification à l'approbation (ni UI ni RPC) ; une fois le compte hors `pending` ou après 2h, aucun moyen de rattraper un document manquant.

**Après** :

- `update_driver_status_secure` refuse `'approved'` si `id_doc_url` est `NULL`/vide **ou** si aucun objet correspondant n'existe réellement dans `storage.objects` (bucket `driver-documents`) — pas seulement une vérification de présence textuelle, une vérification d'existence réelle (répond à la question ouverte de la Phase 4 de la mission).
- Le bouton "Apwouve" est désactivé côté UI avec une infobulle explicative — mais la vraie autorité reste le RPC (testé : un appel RPC direct sans passer par le dialogue est bloqué de façon identique).
- Nouvelle section "Pyès idantite manke" dans `dashboard.driver.profile.tsx`, visible uniquement quand `id_doc_url` est absent — le livreur peut uploader directement avec sa **propre session** (pas de service role ici, donc `storage.objects.owner` est correctement défini par Storage lui-même, sans avoir besoin de `stampOwner()`), puis la référence est persistée dans `drivers.id_doc_url` via la même politique RLS `drivers_self_update` déjà existante et déjà utilisée par le reste de cette page.

---

## 7. Protection de l'approbation (backend, détail)

```sql
IF _status = 'approved' THEN
  SELECT id_doc_url INTO v_id_doc_url FROM public.drivers WHERE id = _driver_id;
  IF v_id_doc_url IS NULL OR btrim(v_id_doc_url) = '' THEN
    RAISE EXCEPTION 'Pa ka apwouve: pyès idantite obligatwa a poko mete nan dosye a.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'driver-documents' AND name = v_id_doc_url) THEN
    RAISE EXCEPTION 'Pa ka apwouve: fichye pyès idantite a pa jwenn nan depo a. ...' USING ERRCODE = '22023';
  END IF;
END IF;
```

Le `SECURITY DEFINER` de la fonction lui donne un accès direct à `storage.objects`, indépendamment de ce que PostgREST expose ou non côté REST — la vérification fonctionne pour **tout** appelant, y compris un appel RPC direct contournant complètement le dialogue Admin. Confirmé par test transactionnel (§ 9, tests A/B/C).

---

## 8. Storage owner — Avant / Après

**Avant** : `supabaseAdmin.schema("storage").from("objects").update({owner: userId}).match(...)` — confirmé sans effet en production.

**Après** : `supabaseAdmin.rpc("stamp_storage_object_owner_secure", {_bucket, _path, _owner})` — une fonction `SECURITY DEFINER` qui touche `storage.objects` directement en SQL, contournant la question de l'exposition du schéma `storage` à PostgREST (cause probable, non confirmable à distance faute d'accès aux logs Vercel du moment exact de l'échec original — voir commentaire dans la migration). Confirmé fonctionner par test transactionnel (§ 9, test E) : `owner` **et** `owner_id` correctement définis après l'appel.

Aucune policy RLS modifiée, aucun bucket rendu public, aucune exposition de document — uniquement l'attribution du propriétaire, exactement le périmètre demandé.

---

## 9. Tests

### Automatisés (`npx vitest run`)

| Test                                                                         | Résultat                                |
| ---------------------------------------------------------------------------- | --------------------------------------- |
| `buildRestaurantHoursMetadata` — Cas A (horaires renseignés)                 | ✅                                      |
| `buildRestaurantHoursMetadata` — Cas B (non renseignés → `{}` préservé)      | ✅                                      |
| `buildRestaurantHoursMetadata` — seuls les jours touchés sont inclus         | ✅                                      |
| `stampOwner` — appelle la RPC avec les bons paramètres                       | ✅                                      |
| `stampOwner` — n'échoue jamais si la RPC retourne une erreur (log seulement) | ✅                                      |
| `stampOwner` — aucun log si succès                                           | ✅                                      |
| **Suite complète du projet**                                                 | ✅ **143/143** (137 avant + 6 nouveaux) |

### Transactionnels (BEGIN/ROLLBACK contre la production réelle, migrations appliquées puis annulées dans la même transaction — méthode déjà établie sur ce projet)

| Test                                                                             | Résultat |
| -------------------------------------------------------------------------------- | -------- |
| `is_valid_opening_hours_shape` — forme valide acceptée                           | ✅       |
| `is_valid_opening_hours_shape` — objet vide accepté                              | ✅       |
| `is_valid_opening_hours_shape` — clé de jour invalide rejetée                    | ✅       |
| `is_valid_opening_hours_shape` — format d'heure invalide rejeté                  | ✅       |
| `is_valid_opening_hours_shape` — non-objet (array) rejeté                        | ✅       |
| `handle_new_user()` référence bien le validateur (compilation confirmée)         | ✅       |
| Approbation bloquée si `id_doc_url` absent                                       | ✅       |
| Approbation bloquée si le fichier référencé n'existe pas réellement dans Storage | ✅       |
| Approbation réussit une fois document + objet Storage présents                   | ✅       |
| Transition `'rejected'` toujours possible sans document (non-régression)         | ✅       |
| `stamp_storage_object_owner_secure` définit `owner` **et** `owner_id`            | ✅       |
| Résidu post-ROLLBACK : driver réel et objets fictifs — **aucun résidu**          | ✅       |

### Tableau récapitulatif demandé par la mission

| Test                      | Résultat                                                                       |
| ------------------------- | ------------------------------------------------------------------------------ |
| Restaurant signup         | ✅ (build + typecheck confirmés, non modifié structurellement)                 |
| opening_hours             | ✅                                                                             |
| Driver signup             | ✅ (non modifié structurellement, build confirmé)                              |
| Identity upload           | ✅ (nouveau chemin de rattrapage testé par lecture de code + RLS déjà auditée) |
| Approval without document | ✅ (bloqué)                                                                    |
| Approval with document    | ✅ (autorisé)                                                                  |
| Admin document access     | ✅ (inchangé, déjà confirmé fonctionnel par l'audit)                           |
| Storage owner             | ✅                                                                             |
| RLS                       | ✅ (aucune policy modifiée, revérifiées live pendant les tests)                |
| Build                     | ✅                                                                             |

---

## 10. Régressions

Aucune régression détectée. `npm run typecheck`/`lint`/`check:migrations`/tests/`build` tous verts. Le seul point pré-existant hors-scope : une erreur TypeScript transitoire dans `order-kanban-board.tsx` a été observée une fois puis a disparu au re-run — ce fichier appartient à un chantier non lié, déjà présent modifié-mais-non-committé dans l'arbre de travail avant cette mission, non touché ici.

---

## 11. Risques résiduels

- **R2 (garde d'approbation)** : si un cas métier légitime existait pour approuver sans document, il serait désormais bloqué — à valider avec vous avant application (aucun tel cas connu à ce jour).
- **R4 (stampOwner)** : la cause exacte de l'échec original (probable non-exposition du schéma `storage` à PostgREST) reste non confirmée formellement — le correctif la contourne plutôt que de la diagnostiquer avec certitude absolue, mais son efficacité est prouvée par test direct (§ 9, test E).
- **Nouvelle RPC `stamp_storage_object_owner_secure`** : nouvelle surface d'écriture sur `storage.objects`, strictement limitée à `owner`/`owner_id`, `service_role` uniquement — pas de risque d'exposition identifié, mais toute nouvelle fonction touchant `storage` mérite un regard attentif avant go-live.

---

## 12. Procédure Go Live

Aucune migration n'a été appliquée. Avant application, dans l'ordre :

1. Confirmer qu'un backup production valide et restaurable existe (dernière vérification connue : `backups/full_20260808T180538Z.sql`, restore-testé) — sinon, **STOP**, en cohérence avec la discipline déjà établie sur ce projet.
2. Appliquer les 3 migrations (`supabase db push`), dans l'ordre chronologique (`20260809120000` → `130000` → `140000`) — aucune dépendance croisée entre elles, mais l'ordre chronologique reste la pratique la plus sûre.
3. Régénérer `types.ts` pour de vrai (`supabase gen types typescript --linked --schema public,private`) et vérifier que le diff correspond exactement aux 2 entrées ajoutées à la main dans ce commit.
4. Re-vérifier `npm run verify` après régénération.
5. Committer et pousser (sur validation explicite de votre part — pas automatique, comme convenu).

---

## 🚦 VERDICT

## 🟢 IMPLEMENTATION READY

Tous les tests (automatisés et transactionnels) passent. Aucune migration n'a été appliquée en production. En attente de votre validation pour appliquer les migrations puis committer/pousser.
