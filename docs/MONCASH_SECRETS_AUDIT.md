# Rapport de vérification des secrets — MonCash

Audit ciblé des 4 catégories demandées : Client Secret, API Keys, Access
Tokens, Webhook Secret. Toutes les vérifications ci-dessous ont été
exécutées activement le 2026-07-31 (pas une réutilisation d'un résultat
antérieur) — commandes réelles contre Vercel, Git, et le système de
fichiers local.

## Résultat

| Catégorie                                                                  | Où                                      | Trouvé ?                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONCASH_CLIENT_SECRET`                                                    | Git (tout l'historique)                 | ❌ Non — seule une valeur de test explicite (`"test-client-secret"`) dans les fichiers Vitest                                                                                                                     |
| `MONCASH_CLIENT_SECRET`                                                    | Vercel Production                       | ❌ Non — `vercel env ls production` : 10 variables, aucune `MONCASH_*`                                                                                                                                            |
| `MONCASH_CLIENT_SECRET`                                                    | `.env.local`                            | ❌ Non                                                                                                                                                                                                            |
| `MONCASH_MERCHANT_ID`/`MONCASH_CLIENT_ID`                                  | Git/Vercel/local                        | ❌ Non, mêmes vérifications                                                                                                                                                                                       |
| `MONCASH_WEBHOOK_SECRET`                                                   | Git/Vercel/local                        | ❌ Non, mêmes vérifications                                                                                                                                                                                       |
| Access Token OAuth2 (`access_token` MonCash)                               | Code source                             | ❌ Jamais retourné par aucune fonction exportée — reste privé à `moncash-client.server.ts` (variable de module `cachedToken`, jamais exportée)                                                                    |
| Access Token OAuth2                                                        | `moncash_api_logs` (journal d'audit)    | ❌ Non — `request_summary`/`response_summary` sont construits à la main par endpoit, `has_access_token: true/false` seulement, jamais la valeur — voir test dédié ci-dessous                                      |
| Access Token OAuth2                                                        | React / bundle client                   | ❌ Structurellement impossible — `moncash-client.server.ts` n'est accessible que par import dynamique depuis un autre `.server.ts`, jamais depuis un composant (vérifié après build, voir ci-dessous)             |
| Payment token MonCash (`payment_token.token`, différent de l'access token) | `moncash_api_logs`                      | ⚠️ Tronqué (4 premiers + 4 derniers caractères, `redactToken()`), jamais en clair — voir MONCASH_FINANCIAL_AUDIT.md                                                                                               |
| Tout secret                                                                | Notifications (`private.notify_secure`) | ❌ Non — les corps de notification n'interpolent que `amount`/`provider_code`/`reason` textuel, jamais un champ contenant un token ou secret (vérifié par lecture des 3 migrations qui appellent `notify_secure`) |

## Preuves (commandes exécutées, résultats bruts)

### Git — tout l'historique, tous les commits

```
git log --all --oneline -- '*.env*'   → 5 commits, tous des ajouts de .env.example/documentation, aucun .env réel
git grep "MONCASH_CLIENT_SECRET" $(git rev-list --all)   → seules 2 occurrences,
  dans src/lib/payment-providers/__tests__/*.test.ts, valeur "test-client-secret" (fictive, explicite)
```

### Vercel Production

```
npx vercel env ls production
→ 10 variables : SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, SUPABASE_PROJECT_ID,
  SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_*,
  VITE_SUPABASE_*. Aucune MONCASH_*.
```

### Local

```
grep -c "^MONCASH_" .env.local   → 0
```

### Logs (test automatisé dédié, pas une inspection manuelle ponctuelle)

`moncash-client.test.ts` → `"createPayment: never logs the Authorization
header, client secret, or raw tokens"` — construit un scénario où
l'access token (`"SUPER-SECRET-TOKEN"`) et un payment token complet
(`"paytok-abcdefghij"`) transitent réellement dans l'exécution, puis
vérifie que **rien** de ce qui a été passé à
`supabaseAdmin.from("moncash_api_logs").insert(...)` ne contient ces
chaînes, ni le mot `Authorization`, ni `Bearer`. Ce test s'exécute à
chaque `npm test`/`npm run verify` — une régression future (un
développeur qui ajouterait par erreur un log plus verbeux) serait
détectée automatiquement, pas seulement lors d'un audit ponctuel.

### Bundle client (React)

```
npm run build
grep -rl "MONCASH_CLIENT_SECRET\|redactToken\|writeApiLog\|Authorization.*Basic\|Authorization.*Bearer" .vercel/output/static
→ 2 fichiers, tous deux du code Supabase Realtime/Auth non lié à MonCash
  (vérifié par inspection du contexte — voir historique de session)
```

Confirmé pour chacun des fichiers `.server.ts` du module MonCash
(`moncash-config.server.ts`, `moncash-client.server.ts`,
`moncash-provider.server.ts`, `moncash-webhook-handler.server.ts`,
`moncash-reconcile.server.ts`) : aucun n'est importé statiquement
ailleurs que depuis un autre `.server.ts` — le build TanStack Start
échouerait sinon (garantie du compilateur, pas une convention de revue).

## Conclusion

**Aucun secret trouvé nulle part où il ne devrait pas être.** L'absence
totale de variables `MONCASH_*` configurées (Git, Vercel, local)
confirme, indépendamment de tout le reste de cet audit, que le canal
MonCash Automatik est inerte à 100 % aujourd'hui — rien à révoquer, rien
à faire tourner en urgence. Ce rapport devra être ré-exécuté (même
procédure, même commandes) au moment où de vrais identifiants seront
provisionnés, pour confirmer qu'ils suivent les mêmes garanties une fois
réels.
