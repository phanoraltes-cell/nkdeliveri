# NK Deliveri — Incident Response Plan (v1.0)

## 1. Classification de sévérité

| Niveau    | Définition                                                                              | Exemple                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **SEV-1** | Perte de données, faille de sécurité activement exploitée, paiement réel perdu/dupliqué | Un webhook MonCash dupliqué crédite deux fois un décaissement ; une policy RLS cassée expose des données d'un autre utilisateur |
| **SEV-2** | Fonctionnalité critique indisponible pour tous les utilisateurs                         | `/checkout` ou `/auth` retourne 500 en boucle ; le webhook MonCash ne répond plus                                               |
| **SEV-3** | Fonctionnalité dégradée ou indisponible pour un sous-ensemble d'utilisateurs/rôle       | Le dashboard livreur ne charge plus, mais client/restaurant fonctionnent                                                        |
| **SEV-4** | Bug visible, non bloquant                                                               | Bug de contraste, erreur cosmétique, lenteur ponctuelle                                                                         |

## 2. Réaction immédiate par sévérité

### SEV-1

- [ ] Couper l'accès concerné en premier (ex. si un flag de paiement est en cause, le désactiver côté config — jamais de rollback de code à l'aveugle sur un incident de paiement, voir `ROLLBACK_CHECKLIST.md` § 3)
- [ ] Sauvegarde immédiate de l'état actuel avant toute correction (`npm run db:backup`) — préserver la preuve avant de la faire disparaître en corrigeant
- [ ] Informer l'utilisateur/l'équipe immédiatement, ne pas attendre d'avoir la solution
- [ ] Ne restaurer un dump complet qu'après confirmation explicite — une restauration efface les transactions survenues depuis le dump

### SEV-2

- [ ] Rollback applicatif immédiat vers le dernier déploiement connu-bon (`ROLLBACK_CHECKLIST.md` § 1) si la cause est un déploiement récent
- [ ] Si la cause est une migration : ne pas paniquer-corriger en direct sur la prod — écrire le correctif, le valider en transactionnel, puis l'appliquer (`ROLLBACK_CHECKLIST.md` § 2)
- [ ] Vérifier `/api/webhooks/moncash` et `/api/webhooks/moncash/collect` répondent toujours si le paiement est concerné, même pendant l'incident

### SEV-3

- [ ] Isoler la cause au rôle/route concerné avant d'agir sur le reste du système
- [ ] Correctif ciblé, pas de rollback global si l'impact est limité à un sous-ensemble

### SEV-4

- [ ] Consigner (issue/ticket), traiter dans le cycle normal, pas d'action d'urgence

## 3. Scénarios spécifiques à ce projet

### Paiement MonCash bloqué en `pending` anormalement longtemps

- [ ] Consulter `dashboard.admin.moncash.tsx` (alerte "Peman bloke twò lontan" déjà codée)
- [ ] Vérifier les logs webhook (`webhookEvents` sur le même dashboard) pour un webhook manqué
- [ ] Ne jamais modifier manuellement le statut d'un paiement en base sans passer par les RPC dédiées (`complete_collect_payment_secure`, etc.) — elles portent la logique d'audit et de notification qu'un `UPDATE` direct casserait silencieusement

### RLS suspectée cassée (données visibles par le mauvais utilisateur)

- [ ] SEV-1 immédiat
- [ ] Vérifier en direct la policy concernée (`SELECT * FROM pg_policies WHERE tablename = '...'`) plutôt que de supposer — ce projet a déjà un historique de policies `TO public` fonctionnellement sûres grâce à `has_role()`/`auth.uid()` NULL-safe (voir `RELEASE_V1_AUDIT_REPORT.md` § 5) ; ne pas confondre "porte le rôle public" avec "vulnérable" sans vérifier le corps de la fonction utilisée dans `qual`/`with_check`

### Cron `moncash-reconcile` en échec silencieux

- [ ] Actuellement aucune alerte automatique — vérification manuelle requise (`MONITORING_CHECKLIST.md` § 5)
- [ ] Inerte par conception tant que le décaissement MonCash n'est pas activé — un échec avant activation n'a aucun impact utilisateur

### Perte du bucket Storage (`payment-proofs`, `driver-documents`, etc.)

- [ ] Actuellement irrécupérable, aucune sauvegarde de Storage n'existe (`BACKUP_CHECKLIST.md` § 3) — traiter comme SEV-1, informer immédiatement, documenter l'impact légal potentiel (preuves de paiement/documents chauffeur perdus)

## 4. Post-mortem

- [ ] Tout SEV-1/SEV-2 fait l'objet d'un post-mortem écrit (cause, chronologie, correctif, action préventive) même en l'absence d'impact client final
- [ ] Toute action préventive identifiée est ajoutée explicitement au backlog, pas seulement mentionnée oralement

## 5. Contacts / points d'escalade

- [ ] À compléter par l'utilisateur — ce document n'invente pas de contacts d'astreinte non fournis. Renseigner ici qui contacter pour : accès Supabase Dashboard, accès Vercel Dashboard, compte Digicel/MonCash Business, DNS/domaine `nkdeliveri.com`.
