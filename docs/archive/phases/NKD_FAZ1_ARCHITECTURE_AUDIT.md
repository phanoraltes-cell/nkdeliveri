# NKD — FAZ 1 : ARCHITECTURE AUDIT

**Dat orijinal** : 2026-08-13 (delivre nan chat, jodi a fòmalize nan yon fichye pou Faz 2+ ka site l ak `fichye:liy`)
**Dat koreksyon** : 2026-08-14
**Estati** : Pati A NKD-003 korije (commit `faea881`) ; NKD-001/NKD-002 pa touche (diferе jiskaske Faz 11 fini)

---

## Konstatasyon

**NKD-001 — Pa gen vrè "service layer" ; ~~29/66~~ fichye wout rele Supabase dirèkteman nan "kontwolè"**

- Nivo : P3
- Fichye:Liy : `src/services/` (1 sèl fichye — `src/services/routing.ts`) ; `src/routes/checkout.tsx:155,250`
- Chif : ~~29 sou 66 fichye wout~~ → **⚠️ ESTIMASYON, pa KONFIME** (nòt 2026-08-14, wè korije anba a)
- Enpak : kouplaj fò ant UI ak Supabase
- Efò : Mwayen-Gwo

**NKD-002 — Plizyè "god file" (>500 liy, plizyè responsablite melanje)**

- Nivo : P3
- Fichye:Liy : `src/routes/checkout.tsx` (630L, 7 `useState`), `dashboard.admin.collect.tsx` (590L), `dashboard.admin.payouts.tsx` (535L), `komand-detail-dialog.tsx` (518L), `dashboard.admin.finance.tsx` (509L), `dashboard.restaurant.orders.tsx` (487L)
- Prèv : `wc -l` sou chak fichye
- Efò : Mwayen

**NKD-003 — Mesaj erè RPC monte dirèkteman bay itilizatè, san kouch sanitizasyon santral**

- Nivo : P2
- Fichye:Liy : `src/routes/checkout.tsx:337`, `src/routes/_authenticated/dashboard.restaurant.orders.tsx:178`
- Chif : ~~67 sit~~ → **73 sit (44 fichye)** — wè koreksyon anba a
- **Estati : Pati A KORIJE** (`src/lib/rpc-errors.ts`, commit `faea881`, 2026-08-14). Pati B (migrasyon 73 sit yo) DIFERE — `docs/NKD-003_MIGRATION_BACKLOG.md`

---

## ⚠️ KOREKSYON (2026-08-14) — pa efase, bare

### NKD-003 : ~~67 sit~~ → **73 sit, 44 fichye**

Patwon grep orijinal Faz 1 la (`toast.error(e instanceof Error\|toast.error(e\.message\|toast.error(e ??`) te rate 6 sit ki itilize yon lòt varyant :

| Sit rate                                                          | Patwon reyèl                                |
| ----------------------------------------------------------------- | ------------------------------------------- |
| `src/components/dashboard/admin/admin-idle-lock.tsx:181`          | `toast.error(err.message)`                  |
| `src/components/driver-location-reporter.tsx:15`                  | `toast.error(error)` (brit, san `.message`) |
| `src/components/home/newsletter-section.tsx:23`                   | `toast.error(error.message)`                |
| `src/components/order/customer-location-toggle.tsx:17`            | `toast.error(error)` (brit, san `.message`) |
| `src/routes/_authenticated/dashboard.admin.security.tsx:89`       | `toast.error(error.message)`                |
| _(+1 lòt, wè `docs/NKD-003_MIGRATION_BACKLOG.md` pou lis konplè)_ |                                             |

**Patwon korije, verifye 2026-08-14** : `grep -rn "toast.error(e" src/routes src/components` → **73 rezilta, 44 fichye distenk** (`wc -l` + `cut -d: -f1 \| sort -u \| wc -l`). Lis konplè ak `fichye:liy` : `docs/NKD-003_MIGRATION_BACKLOG.md`.

**Leson metòd** : yon konte ki soti nan yon sèl patwon grep pa yon chif "KONFIME" — se yon **ESTIMASYON** jiskaske li verifye ak plizyè patwon altènatif pou menm konsèp la. Aplike pou tout chif Faz 2+ (kondisyon eksplisit resevwa pou Faz 2).

### NKD-001 : ~~29/66~~ → **ESTIMASYON, pa re-verifye ak plizyè patwon**

Chif "29 sou 66 fichye wout rele Supabase dirèkteman" te soti nan **yon sèl patwon** : `grep -rl "supabase\.\(rpc\|from\)(" src/routes/*.tsx src/routes/_authenticated/*.tsx`. Patwon sa a rate, pa egzanp : yon lòt non varyab pou kliyan Supabase a (`client.rpc(...)` olye `supabase.rpc(...)`), yon apèl ki gaye sou plizyè liy, oswa yon wrapper lokal ki fè apèl la endirèkteman.

**Estati** : `29/66` rete make **⚠️ ESTIMASYON** — pa re-verifye ak plizyè patwon nan sesyon sa a (aksyon report pou lè fichye sa a rouvri, pa fèt kounye a). Konklizyon jeneral la (« pa gen yon sèl kouch abstraction, apèl Supabase yo gaye nan plizyè kalite fichye ») rete valab kèlkeswa presizyon egzat chif la, men chif la limenm pa dwe site tankou yon fè verifye.

---

_Fichye sa a kreye 2026-08-14 pou fòmalize rapò Faz 1 (delivre orijinèlman nan chat) ak koreksyon yo, konsistan ak konvansyon "bare, pa efase" deja itilize pou H-01/CF-01. Okenn nouvo travay Faz 1 pa fèt — sèlman koreksyon/klarifikasyon chif ki deja bay._
