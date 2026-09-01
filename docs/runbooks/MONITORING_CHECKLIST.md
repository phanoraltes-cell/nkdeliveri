# NK Deliveri — Monitoring Checklist (v1.0)

## 1. Ce qui existe déjà (vérifié)

| Surface                                        | Mécanisme                                                       | Push ou Pull ?                                                        |
| ---------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Dashboard admin principal (`/dashboard/admin`) | Canal Supabase Realtime (`live-orders`, `admin-online-drivers`) | **Push** — invalidation React Query en direct                         |
| Dashboard MonCash (`/dashboard/admin/moncash`) | `useQuery`, `staleTime: 60_000`, pas de `refetchInterval`       | **Pull** — se met à jour seulement à l'ouverture/re-focus de l'onglet |
| Dashboard Finance (`/dashboard/admin/finance`) | `useQuery`, pas de `refetchInterval`                            | **Pull**                                                              |
| Cron MonCash reconcile                         | `vercel.json`, quotidien 03:00                                  | Planifié, pas d'alerting sur échec                                    |
| Erreurs runtime                                | `@sentry/node`/`@sentry/react` en dépendances                   | **Non confirmé activé** — DSN à vérifier                              |
| Logs applicatifs                               | Logs Vercel (stdout/stderr)                                     | Consultation manuelle, pas d'alerting                                 |

## 2. Checklist avant Go-Live

- [ ] Confirmer si un DSN Sentry est réellement configuré en production (`VITE_SENTRY_DSN`/`SENTRY_DSN` sur Vercel) — si absent, décider de l'activer avant v1.0 ou d'accepter "logs Vercel uniquement" comme stratégie de monitoring pour cette version
- [ ] Si Sentry est activé : confirmer qu'une alerte (email/Slack) est configurée sur un taux d'erreur anormal, pas seulement la capture passive
- [ ] Décider si les dashboards MonCash/Finance ont besoin d'un `refetchInterval` (ex. 60-120s) avant le Go-Live, ou si le point 3 ci-dessous (alerting réel) suffit à combler le manque de temps réel

## 3. Alerting MonCash (les 4 conditions existent déjà dans le code, visibles uniquement à l'ouverture du dashboard)

Fichier : `src/routes/_authenticated/dashboard.admin.moncash.tsx`

| Condition                                       | Détection actuelle                                             |
| ----------------------------------------------- | -------------------------------------------------------------- |
| Plizyè erè youn apre lòt (erreurs consécutives) | Calculée côté client, visible seulement si la page est ouverte |
| Webhook pa jwenn (webhook manquant)             | Idem                                                           |
| Peman bloke twò lontan (paiement bloqué)        | Idem                                                           |
| Ogmantasyon echèk sispèk (taux d'échec anormal) | Idem                                                           |

- [ ] Décision : faire remonter au moins une de ces 4 conditions vers un canal push réel (email admin, webhook Slack, notification `notify_secure` vers les admins) avant le Go-Live — actuellement, un incident MonCash pendant la nuit ne serait détecté que par un admin ouvrant la page le lendemain
- [ ] À défaut, documenter explicitement (fait ici) que la surveillance MonCash est manuelle et planifier une vérification humaine régulière (voir § 4)

## 4. Routine de surveillance manuelle (tant que le point 3 n'est pas résolu)

- [ ] Vérification quotidienne du dashboard MonCash par un admin (les 4 indicateurs)
- [ ] Vérification quotidienne du dashboard Finance pour toute anomalie de commission/décaissement
- [ ] Vérification hebdomadaire des logs Vercel pour des erreurs 5xx récurrentes non capturées ailleurs

## 5. Cron

- [ ] Vérifier après chaque déploiement que `GET /api/cron/moncash-reconcile` (avec `CRON_SECRET`) répond toujours 200/401 comme attendu (401 si secret erroné, 200 sinon) — pas de monitoring automatique de son exécution planifiée à ce jour
- [ ] Si le décaissement MonCash est activé un jour : ce cron cessera d'être inerte — prévoir alors un monitoring de son taux de succès de réconciliation

## 6. Base de données

- [ ] Surveiller la table `pg_stat_activity`/le tableau de bord Supabase pour toute connexion anormalement longue après une migration
- [ ] Aucun monitoring de performance de requêtes (slow query log) confirmé configuré — décision à prendre si le volume de production dépasse l'échelle actuelle (dev/faible volume, voir snapshot § 7 de l'audit backend)
