# Sandbox / Production — MonCash

Confirme et documente une propriété déjà vraie du code existant : **le
passage sandbox ↔ production ne dépend que des variables
d'environnement, jamais d'un changement de code.** Rien dans
`moncash-client.server.ts`/`moncash-provider.server.ts` ne teste
`NODE_ENV`, `VERCEL_ENV`, ni aucune autre condition d'environnement — le
seul paramètre qui détermine contre quel serveur MonCash l'application
parle est `MONCASH_API_URL`, une simple chaîne lue par
`moncash-config.server.ts`.

## Comment ça marche

```
MONCASH_API_URL = https://sandbox.moncashbutton.digicelgroup.com/Api   → tout le trafic va en sandbox
MONCASH_API_URL = https://moncashbutton.digicelgroup.com/Api           → tout le trafic va en production MonCash
```

`buildMonCashRedirectUrl()` (`moncash-client.server.ts`) dérive même
l'URL de redirection client à partir de cette même variable
(`gatewayRootFromApiUrl()`, retire le suffixe `/Api`) — un seul point de
vérité, jamais une deuxième variable à synchroniser.

Les 4 autres secrets (`MONCASH_CLIENT_ID`/`MONCASH_CLIENT_SECRET`/
`MONCASH_MERCHANT_ID`/`MONCASH_WEBHOOK_SECRET`) suivent le même principe
— MonCash délivre des identifiants **différents** pour son environnement
sandbox et pour la production ; les 5 variables changent ensemble, comme
un seul groupe cohérent.

## Où ça se configure (suit ENVIRONMENTS.md, rien de nouveau)

Reprend exactement la règle déjà établie pour Supabase dans
[ENVIRONMENTS.md § Base de données partagée entre Preview et Production](./ENVIRONMENTS.md#️-base-de-données-partagée-entre-preview-et-production) :
Vercel permet une valeur différente par **portée** (Production / Preview
/ Development) pour un même nom de variable.

| Portée Vercel | `MONCASH_API_URL` attendue | `MONCASH_CLIENT_ID`/etc. |
|---|---|---|
| Production | URL sandbox **jusqu'à** confirmation du contrat B2C (voir PAYMENT_PROVIDERS.md) ; ensuite, l'URL de production réelle | Identifiants correspondants |
| Preview | URL sandbox, toujours | Identifiants sandbox |
| Development (`.env.local`) | URL sandbox, toujours | Identifiants sandbox |

**Ne jamais mettre les identifiants de production MonCash en portée
Preview** — même risque déjà documenté pour Supabase : un déploiement de
PR pourrait autrement déclencher un vrai appel API MonCash en conditions
réelles.

## Aucun changement de code requis — vérifié, pas supposé

- `MONCASH_API_URL` n'est lue qu'à un seul endroit
  (`moncash-config.server.ts`), jamais recopiée ni codée en dur ailleurs
  (`grep -rn "moncashbutton.digicelgroup.com" src/` ne trouve que le
  commentaire explicatif dans `moncash-client.server.ts`, aucune URL en
  dur dans le code exécuté).
- Aucun `if (process.env.VERCEL_ENV === "production")` ni équivalent
  dans tout `src/lib/payment-providers/` — confirmé par lecture directe
  des 6 fichiers du module.
- `payment_providers.moncash_api.is_active` (le verrou qui active
  réellement le canal dans l'UI admin) est une donnée en base, pas une
  variable d'environnement — **elle doit être positionnée séparément par
  environnement** si plusieurs bases Supabase existent (une par portée
  Vercel, recommandé mais non confirmé mis en place — voir
  ENVIRONMENTS.md) : activer en sandbox ne doit pas activer en
  production par accident si les deux partagent la même base
  aujourd'hui.

## Procédure de bascule sandbox → production (le jour venu)

1. Confirmer le contrat B2C avec Digicel (préalable bloquant, externe,
   déjà documenté dans PAYMENT_PROVIDERS.md — cette procédure ne le
   lève pas).
2. Obtenir les identifiants de production MonCash (distincts du
   sandbox).
3. Remplacer les 5 variables `MONCASH_*` en portée Production sur
   Vercel — un redéploiement suffit à les prendre en compte (pas de
   migration, pas de changement de code).
4. `payment_providers.moncash_api.is_active = true` en production
   uniquement — geste distinct, volontaire, jamais automatique (voir
   PAYMENT_PROVIDERS.md § Procédure de configuration).
5. Vérifier `/dashboard/admin/moncash` : "Konfigire sou sèvè a" passe à
   "Wi", "Aktive nan sistèm nan" passe à "Wi" une fois l'étape 4 faite.
