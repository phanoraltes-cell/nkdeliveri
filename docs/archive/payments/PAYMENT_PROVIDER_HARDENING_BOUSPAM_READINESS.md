# Payment Provider Hardening — Phase 8 — Préparation Bouspam

**Date** : 2026-08-03

---

## Ce que cette mission livre réellement pour Bouspam

**Vrai, vérifié** : une fois qu'une implémentation (Digicel restauré, ou Bouspam construit) répond correctement derrière `moncashProvider`, l'activer pour de vrai clients ne nécessite que :

1. Configurer les variables d'environnement nécessaires côté Vercel.
2. Vérifier la connexion API (test manuel ou script de vérification, hors périmètre de cette mission).
3. `enabled = true` pour `provider = 'moncash_auto'` — via `docs/PAYMENT_PROVIDER_HARDENING_ARCHITECTURE.md`'s nouvelle page admin "Fournisseurs" (`/dashboard/admin/payment-providers`), aucune ligne de code.

**Aucun redéploiement** : `checkout.tsx` lit `payment_provider_settings` en direct via Supabase à chaque chargement de page (`usePaymentProviderAvailability`, `staleTime: 60s`) — un changement en base est visible côté client en moins d'une minute, jamais après un nouveau build/déploiement Vercel.
**Aucune modification React** : confirmé — le composant ne connaît que `enabled`/`visible`/`maintenanceMessage`/`defaultProvider`, jamais le nom d'un fournisseur particulier (Digicel, Bouspam, ou autre).
**Aucune migration supplémentaire** : le flag est une simple `UPDATE`, déjà couverte par la RPC existante `update_payment_provider_setting_secure`.

## ⚠️ Précision nécessaire — ce que ce mécanisme NE fait PAS

**`enabled = true` réactive l'implémentation actuellement branchée derrière `moncashProvider` — pas spécifiquement Bouspam.**

Aujourd'hui, `src/lib/payment-providers/moncash-provider.server.ts` appelle toujours l'intégration Digicel directe (`moncash-client.server.ts`, `/oauth/token`, `/v1/CreatePayment`) — **le code Bouspam n'a jamais été écrit**. La mission "MonCash Automatik (Phase 0.5)" a produit un audit complet (`docs/MONCASH_AUTOMATIK_PHASE0_AUDIT.md`, `docs/MONCASH_AUTOMATIK_PHASE0_CLARIFICATIONS.md`) puis a été **explicitement mise en pause** sur votre instruction ("on arrête là sur l'intégration de l'API automatique") avant toute écriture de code d'implémentation.

**Conséquence concrète** : si `enabled = true` est activé aujourd'hui (avec les 5 variables `MONCASH_*` Digicel restaurées), le trafic repart vers **Digicel**, pas Bouspam. Pour que ce même bouton active réellement Bouspam un jour, il faut d'abord :

1. Reprendre et terminer l'implémentation Bouspam (Phase 1 à 10 de la mission mise en pause) — remplacement du corps de `moncash-provider.server.ts`, nouveau client `moncash-automatik-client.server.ts`, route de retour utilisateur (inexistante aujourd'hui), résolution des points bloquants documentés dans `MONCASH_AUTOMATIK_PHASE0_CLARIFICATIONS.md` (notamment le mécanisme de `return_url`, absent de la documentation fournisseur).
2. **Une fois cette implémentation terminée**, ce mécanisme de hardening (`payment_provider_settings`, `enabled=true`) devient exactement le point d'activation à un clic décrit ci-dessus — construit et vérifié dès aujourd'hui, prêt à l'emploi, mais gouvernant une implémentation qui reste à écrire.

## Ce qui est vraiment prêt dès aujourd'hui

| Composant                                                                               | Statut                                                                                                                            |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Contrôle d'activation (`payment_provider_settings`, RPC, page admin)                    | ✅ Construit, testé, en production                                                                                                |
| Le contrôle est agnostique de l'implémentation sous-jacente                             | ✅ Vérifié — aucune référence à Digicel ou Bouspam dans `payment-provider-availability.ts`, `checkout.tsx`, ou la table elle-même |
| Backend refuse toute tentative tant que `enabled=false`, quel que soit le moyen d'appel | ✅ Vérifié en direct en production (§ Rapport Sécurité)                                                                           |
| Implémentation Bouspam elle-même                                                        | ❌ Non commencée — en pause, hors périmètre de cette mission                                                                      |
