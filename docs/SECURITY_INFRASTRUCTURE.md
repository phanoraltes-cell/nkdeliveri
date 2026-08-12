# Revue de sécurité infrastructure — NK Deliveri

Réalisée le 15 juillet 2026 (Phase 6, item 11). Portée : infrastructure et
configuration, pas la logique métier (déjà couverte par la Phase 1 de ce
plan de remédiation). Chaque section indique si le point a été **vérifié
directement dans le code/les migrations** ou s'il **nécessite une
vérification manuelle** (accès aux tableaux de bord Vercel/GitHub/Supabase
que cette session n'a pas).

## En-têtes HTTP — ✅ vérifié

`vercel.json` applique à toutes les routes (`/(.*)`) :

| En-tête                     | Valeur                                                           | Effet                                                         |
| --------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `X-Frame-Options`           | `DENY`                                                           | Bloque l'embarquement en iframe (clickjacking)                |
| `X-Content-Type-Options`    | `nosniff`                                                        | Empêche le MIME-sniffing                                      |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                | Limite les fuites d'URL vers des tiers                        |
| `Permissions-Policy`        | caméra/micro/paiement/USB désactivés, géoloc restreinte à `self` | Réduit la surface d'API navigateur exposée                    |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`                   | Force HTTPS, 2 ans, éligible à la liste de préchargement HSTS |
| `Content-Security-Policy`   | `default-src 'self'` + listes explicites pour Supabase/OSM/OSRM  | Limite les origines de script/style/connexion/image           |

Point déjà documenté (Phase 1) et toujours vrai : la CSP garde
`'unsafe-inline'` pour `script-src`/`style-src` — risque connu et accepté à
l'époque plutôt que de casser des dépendances qui injectent du style
inline (Radix UI, Leaflet). Non ré-évalué dans cette phase, hors périmètre
DevOps.

## RLS (Row Level Security) — ✅ vérifié

Scan automatisé de `supabase/migrations/*.sql` : chacune des **24 tables**
créées (schémas `public` et `private`) a une instruction `ALTER TABLE ...
ENABLE ROW LEVEL SECURITY` correspondante. Aucune table sans RLS trouvée.

### Correction (relecture Phase 7) : `profiles` — déjà corrigé, pas un point ouvert

Cette section affirmait, au moment de l'audit Phase 6, que
`public.profiles` exposait `FOR SELECT TO authenticated USING (true)` à
tout utilisateur connecté. En relisant l'historique complet des migrations
pour la Phase 7 (documentation), ce constat s'est révélé **obsolète au
moment même où il a été écrit** : la migration `20260703063224` a bien
introduit cette politique permissive (`"Profiles viewable by authenticated
users"`), mais la migration suivante, `20260703070152`, l'a remplacée le
même jour par `"Users view own profile"` — `auth.uid() = id OR
has_role(...,'admin') OR has_role(...,'super_admin')`. Aucune migration
ultérieure n'a rouvert cette politique. L'état final (et l'état au moment
de l'audit Phase 6, puisque cette migration date de juillet 2026 également)
est donc déjà correct : un utilisateur authentifié ne peut lire que son
propre profil (ou tout profil, s'il est admin). Voir
[DATABASE.md § RLS](./DATABASE.md#3-row-level-security-rls) pour l'état
vérifié. Ce point est conservé ici, corrigé, pour la traçabilité de
l'audit original plutôt que supprimé silencieusement.

## Fonctions RPC — ✅ vérifié

62 instructions `GRANT EXECUTE` au total. Seules 3 accordent l'exécution à
`anon` (utilisateur non connecté) — toutes les trois sont des fonctions de
lecture seule de vérification de rôle (`has_role`, `get_primary_role`),
nécessaires pour que certaines politiques RLS s'évaluent correctement même
hors contexte pleinement authentifié. Aucune fonction de mutation accordée
à `anon` ou `PUBLIC`.

## Buckets de stockage — ✅ vérifié

Les 5 buckets (`menu-photos`, `restaurant-assets`, `avatars`,
`driver-documents`, `payment-proofs`) ont chacun un `file_size_limit` (3 à
8 Mo selon le bucket) et un `allowed_mime_types` explicite depuis la Phase
1 (`20260713120000_secure_storage_buckets.sql`) — synchronisés avec
`src/lib/file-validation.ts` (`UPLOAD_LIMITS`), qui applique les mêmes
limites côté application avant même d'atteindre le stockage.

## Rôles administrateurs — ✅ vérifié (mécanisme), ⚠️ liste réelle à vérifier

Le mécanisme (`app_role` enum, table `user_roles`, fonction `has_role()`)
est cohérent et systématiquement utilisé pour gater les opérations
sensibles. **Ce que ce dépôt ne peut pas vérifier** : la liste réelle des
comptes ayant actuellement le rôle `admin`/`super_admin` en production —
à auditer directement dans le tableau de bord Supabase (Table Editor →
`user_roles`, ou `SELECT * FROM user_roles WHERE role IN ('admin',
'super_admin')`), en confirmant qu'elle correspond exactement aux personnes
qui doivent l'avoir.

## Secrets GitHub Actions — ✅ vérifié

Le workflow CI actuel (`.github/workflows/ci.yml`) ne déclare et n'utilise
aucun secret — voir `docs/DEVOPS.md`.

## À vérifier manuellement (hors accès de cette session)

- **Permissions Vercel** : Project Settings → Members — confirmer que seules
  les personnes qui en ont besoin ont un accès "Owner"/"Admin" (capable de
  changer les variables d'environnement ou les domaines), et que les
  autres sont en rôle "Member" restreint si l'offre Vercel le permet.
- **Collaborateurs GitHub** : Settings → Collaborators and teams — même
  logique, confirmer l'absence de comptes avec accès `write`/`admin` non
  utilisés depuis longtemps.
- **Protection de branche `main`** : non appliquée par cette session, voir
  la commande `gh api` documentée dans `docs/DEVOPS.md`.
- **Rotation des clés** : `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_JWK`
  et `RESEND_API_KEY` n'ont pas de date de rotation connue — envisager une
  politique de rotation périodique (ex. annuelle) documentée dans un futur
  runbook.
