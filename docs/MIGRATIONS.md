# Migrations Supabase — NK Deliveri

## Ordre et reproductibilité

Chaque fichier sous `supabase/migrations/` est nommé `YYYYMMDDHHMMSS_description.sql`
(les plus anciens portent un suffixe UUID hérité de l'éditeur d'origine plutôt
qu'une description — la convention actuelle, en vigueur depuis les phases de
remédiation, est un slug descriptif). L'ordre d'application est **toujours**
l'ordre alphabétique des noms de fichiers, qui coïncide avec l'ordre
chronologique du timestamp — c'est ce qui garantit la reproductibilité :
appliquer tous les fichiers dans cet ordre sur une base vierge reproduit
exactement le schéma actuel, sur n'importe quelle machine.

**Ne jamais renommer ou insérer un fichier avec un timestamp antérieur à un
fichier déjà mergé sur `main`** — cela changerait l'ordre d'application pour
quiconque re-provisionne une base à partir de zéro (CI, nouvel environnement,
restauration), potentiellement de façon incompatible avec l'état déjà déployé
en production (qui, lui, a déjà appliqué les migrations dans l'ordre où elles
existaient au moment de leur déploiement).

## Le risque déjà rencontré : changement de signature de fonction RPC

**Incident réel, documenté dans plusieurs migrations** (voir par exemple
`20260709070000_fix_menu_overload_and_commission_admin.sql`) : `CREATE OR
REPLACE FUNCTION` ne remplace une fonction existante **que si la liste
d'arguments est strictement identique**. Changer un seul type ou ajouter un
paramètre crée une **seconde surcharge** de la fonction, silencieusement,
sans erreur — les deux versions coexistent alors dans la base, et laquelle
Postgres/PostgREST choisit d'exécuter dépend de l'appel exact, ce qui a déjà
causé un bug de production difficile à diagnostiquer.

**Règle systématique depuis lors** : toute migration qui change la liste
d'arguments (ou le type de retour) d'une fonction existante doit commencer
par :

```sql
DROP FUNCTION IF EXISTS public.ma_fonction(ancien, type, liste);
```

...avant le nouveau `CREATE OR REPLACE FUNCTION public.ma_fonction(nouvelle, liste)`.

### Détection automatique

`scripts/check-migration-hazards.mjs` (exécuté via `npm run check:migrations`,
et dans la CI sur chaque PR — voir `.github/workflows/ci.yml`) rejoue
l'historique complet des migrations et simule la gestion des surcharges de
Postgres : toute `CREATE OR REPLACE FUNCTION` dont la signature ne
correspond à aucune signature déjà connue pour ce nom, sans `DROP FUNCTION`
préalable de l'ancienne, est signalée. Vérifié propre sur l'historique
actuel : 55 migrations, 2 incidents historiques (tous deux nettoyés par une
migration ultérieure), 0 danger non résolu.

## Procédure — créer une nouvelle migration

1. `npx supabase migration new description_courte` (génère le fichier
   horodaté au bon endroit), ou créer le fichier manuellement en respectant
   le format `YYYYMMDDHHMMSS_description.sql`.
2. Écrire le SQL. Pour toute fonction dont la signature change, ajouter le
   `DROP FUNCTION IF EXISTS` correspondant en premier (voir ci-dessus).
3. Valider localement :
   ```bash
   npm run check:migrations   # détection de surcharge, instantané
   npx supabase start         # applique tout l'historique sur une base fraîche
   ```
4. Ouvrir la PR — la CI (`migrations-db` dans `.github/workflows/ci.yml`)
   rejoue automatiquement l'étape 3 sur un runner propre.

## Procédure — déploiement

Ce projet n'a pas de pipeline de déploiement automatique des migrations
(déconnexion volontaire du déploiement applicatif Vercel, qui ne touche
jamais la base de données). Après fusion sur `main` :

```bash
npx supabase link --project-ref <ref-du-projet>   # une seule fois par machine
npx supabase db push
```

`db push` applique uniquement les migrations non encore enregistrées dans la
table de suivi de Supabase (`supabase_migrations.schema_migrations`) — il
est donc sûr de le relancer plusieurs fois.

**Toujours faire une sauvegarde avant** (`npm run db:backup` — voir
`docs/BACKUP_RESTORE.md`) si la migration touche des données existantes
(pas seulement du schéma), et **toujours** répéter l'étape "valider
localement" ci-dessus avant de pousser en production.

## Procédure — rollback

Supabase/Postgres n'a pas de mécanisme de "down migration" automatique dans
ce projet (aucun fichier `*_down.sql` n'existe). La stratégie retenue :

- **Erreur de schéma pure** (une colonne, une contrainte, une fonction) :
  écrire une **nouvelle migration** qui inverse le changement — jamais
  modifier ou supprimer un fichier de migration déjà mergé sur `main`, même
  si le déploiement associé a échoué. L'historique doit rester un journal
  linéaire et véridique de ce qui a réellement été exécuté en production.
- **Migration ayant corrompu des données** : restaurer depuis la sauvegarde
  la plus récente avant la migration fautive (`scripts/restore-database.sh`
  — voir `docs/BACKUP_RESTORE.md`), puis réappliquer les migrations
  suivantes moins celle en cause, corrigée.
- **Fonction RPC en overload dupliqué** (le risque documenté plus haut) : le
  correctif est toujours un `DROP FUNCTION IF EXISTS` de l'ancienne
  signature dans une nouvelle migration — jamais un rollback, puisque
  l'overload fautif doit être supprimé explicitement, pas "annulé".

Dans tous les cas : `npm run check:migrations` et `npx supabase start`
doivent repasser au vert avant de considérer l'incident clos.
