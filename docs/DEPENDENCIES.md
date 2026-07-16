# Audit des dépendances — NK Deliveri

Réalisé le 15 juillet 2026, dans le cadre de la Phase 6 (industrialisation
DevOps). Méthode : `npm audit` pour les vulnérabilités connues, `npm
outdated` pour l'obsolescence, et une recherche d'usage réel (`grep`) de
chaque paquet dans `src/`, les fichiers de configuration et les feuilles de
style pour détecter les dépendances inutilisées.

## Vulnérabilités de sécurité

```
npm audit
found 0 vulnerabilities
```

Aucune action requise.

## Dépendances inutilisées

**Aucune trouvée.** Les 34 dépendances de production ont toutes un usage
réel confirmé. Deux cas méritent une explication car leur usage n'est pas
un import direct dans `src/` :

- `@tailwindcss/vite` et `vite-tsconfig-paths` — jamais importés
  directement dans notre code, mais déclarés comme `peerDependencies` par
  `@lovable.dev/vite-tanstack-config` (le wrapper Vite du projet, voir
  `vite.config.ts`), qui les utilise en interne. Les retirer casserait le
  build.

Pas de doublons fonctionnels identifiés (une seule bibliothèque par
fonction : cartes → `leaflet`/`react-leaflet`, graphiques → `recharts`, PDF
→ `jspdf`, validation → `zod`, notifications → `sonner`, etc.).

## Mises à jour appliquées (compatibles, sans changement de version majeure)

Exécuté via `npm update` — respecte les plages semver déjà déclarées dans
`package.json`, ne saute jamais une version majeure :

| Paquet | Avant | Après |
|---|---|---|
| `@supabase/supabase-js` | 2.110.0 | 2.110.6 |
| `@tanstack/react-router` | 1.170.17 | 1.170.18 |
| `@tanstack/react-start` | 1.168.27 | 1.168.28 |
| `@radix-ui/react-dropdown-menu` | 2.1.19 | 2.1.20 |
| `eslint` | 9.39.4 | 9.39.5 |
| `@eslint/js` | 9.39.4 | 9.39.5 |
| `typescript-eslint` | 8.62.1 | 8.64.0 |
| `prettier` | 3.9.4 | 3.9.5 |
| `vite` | 8.1.3 | 8.1.4 |
| `@types/node` | 22.20.0 | 22.20.1 |

Vérifié après coup : `tsc --noEmit`, `eslint`, et un build de production
complet restent propres.

## Mises à jour majeures disponibles — **volontairement non appliquées**

Chacune de ces mises à jour saute au moins une version majeure et comporte
un risque réel de changement d'API cassant. Les appliquer à l'aveugle
contredirait la consigne de cette phase ("ne pas modifier la logique
métier", "infrastructure simple et robuste") — elles nécessitent une passe
de test dédiée, pas un bump groupé.

| Paquet | Actuel | Disponible | Pourquoi ce n'est pas un bump trivial |
|---|---|---|---|
| `zod` | 3.25.x | 4.x | Changements d'API cassants documentés par l'équipe Zod (`.parse`/schema shape) — utilisé dans plusieurs fonctions serveur (`send-*.functions.ts`) pour valider les payloads ; une régression silencieuse ici affecterait la validation d'entrée de RPC sensibles |
| `lucide-react` | 0.575.x | 1.24.x | Bibliothèque d'icônes utilisée dans quasiment tous les composants du projet — un changement de nom d'icône entre versions casserait silencieusement (icône manquante, pas d'erreur TypeScript) plutôt que bruyamment |
| `eslint` | 9.x | 10.x | Nouvelle version majeure du moteur de lint lui-même — risque de règles par défaut modifiées faisant apparaître (ou disparaître) des erreurs dans tout le dépôt |
| `eslint-plugin-react-hooks` | 5.x | 7.x | Deux versions majeures d'écart — règles de hooks potentiellement plus strictes, à valider fichier par fichier avant d'activer en CI |
| `typescript` | 5.9.x | 7.0.x | Saut de deux versions majeures (5→7, aucune 6.x listée) — trop risqué sans une passe de compatibilité dédiée sur l'ensemble du code |
| `@vitejs/plugin-react` | 5.x | 6.x | Lié de près à la version de Vite/React utilisée — à mettre à jour de façon coordonnée, pas isolément |
| `globals` | 15.x | 17.x | Dépendance de configuration ESLint uniquement — faible risque, mais non testée dans cette phase |
| `@lovable.dev/vite-tanstack-config` | 2.7.0 (épinglé exact) | 2.7.6 | Wrapper Vite critique pour le build — cette phase vient justement de documenter son comportement interne en détail (preset Nitro, protection d'imports) ; un bump non testé pourrait changer ce comportement sans avertissement |
| `@types/node` | 22.20.x | 26.x | **Délibérément non suivi** : `.nvmrc` épingle Node 22 pour l'exécution — passer les types à la version 26 les désynchroniserait du runtime réel et masquerait des APIs qui n'existent pas encore sur Node 22 |

**Recommandation** : traiter chaque ligne ci-dessus comme un ticket
séparé, avec sa propre PR et sa propre vérification manuelle, plutôt que de
les grouper.
