# NKD-003 — Migration Backlog (Pati B, diferе)

**Kontèks** : Faz 1 (Architecture Audit) → NKD-003, koreksyon Pati A (`src/lib/rpc-errors.ts`, `translateSupabaseError()`) fèt. Dokiman sa a se lis konplè 73 sit `toast.error(...)` ki toujou pase mesaj erè brit (`e.message`/`error.message`/`error`) dirèkteman bay itilizatè, san pase pa nouvo kouch santral la. **Pa gen okenn nan yo ki modifye nan sesyon sa a** — pati B eksplisiteman diferе jiskaske Faz 11 fini (wè prompt remédiation la).

**Metòd verifikasyon konte a** : `grep -rn "toast.error(e" src/routes src/components` (patwon jeneral, 73 rezilta) — pi laj pase patwon 3-altènativ Faz 1 a te itilize a (67, ki te rate 6 sit tankou `err.message`/`error.message`/`toast.error(error)` brit). 73 se chif kòrèk/verifye jodi a, sou 44 fichye distenk.

## Pi wo priyorite pou premye batch migrasyon (Pati B)

Twa sit sa yo gen yon apèl `.from("<tab>").insert/update/delete()` **dirèk** (pa RPC gadyen) toupre `toast.error(e...)` — pi wo risk pou yon vyolasyon kontrent Postgres brit (ex: `23505`/`23503`) rive san mapping. **PA VERIFYE** si youn deja montre yon mesaj brit an pwodiksyon jodi a (sa ta mande reprodwi erè a an dirèk, ki deyò periyèt sa a) — se yon priyorizasyon ki baze sou estrikti kòd, pa yon fuit obsève.

| Fichye:Liy                                                           | Tab konsène  | Operasyon                                   |
| -------------------------------------------------------------------- | ------------ | ------------------------------------------- |
| `src/components/address-manager.tsx:54,78,233`                       | `addresses`  | `.delete()` (liy 47), `.insert()` (liy 219) |
| `src/components/order/order-review-section.tsx:63`                   | `reviews`    | `.insert()` (liy 48)                        |
| `src/routes/_authenticated/dashboard.driver.history.tsx:116,136,161` | `deliveries` | `.update()` (liy 148)                       |

Kontèks sekirite anplis (pa yon fuit estrikti, men zòn sansib) : `src/components/dashboard/admin/admin-idle-lock.tsx:181` ak `src/routes/_authenticated/dashboard.admin.security.tsx:89` — tou de nan flux MFA/step-up admin.

## Lis konplè 73 sit (tri pa fichye)

```
src/components/address-manager.tsx:54,78,233
src/components/dashboard/admin/admin-idle-lock.tsx:181
src/components/dashboard/admin/komand-detail-dialog.tsx:192,217
src/components/dashboard/admin/promotional-notification-form.tsx:48
src/components/dashboard/payouts/payout-pay-modal.tsx:215
src/components/dashboard/restaurant/product-form.tsx:115
src/components/disputes/dispute-thread.tsx:67
src/components/driver-location-reporter.tsx:15
src/components/home/newsletter-section.tsx:23,32
src/components/notification-preferences-panel.tsx:56
src/components/order/cancel-order-section.tsx:41
src/components/order/cash-confirmation-section.tsx:49,68
src/components/order/customer-location-toggle.tsx:17
src/components/order/dispute-section.tsx:72
src/components/order/order-chat-thread.tsx:95
src/components/order/order-review-section.tsx:63
src/components/order/payment-proof-section.tsx:83
src/components/order/payout-confirm-section.tsx:59,81
src/components/order/refund-section.tsx:63
src/routes/_authenticated/dashboard.admin.ads.tsx:59,84,261
src/routes/_authenticated/dashboard.admin.customers.tsx:133,175
src/routes/_authenticated/dashboard.admin.disputes.tsx:131,154
src/routes/_authenticated/dashboard.admin.drivers.tsx:102
src/routes/_authenticated/dashboard.admin.payment-providers.tsx:54,102
src/routes/_authenticated/dashboard.admin.payments.tsx:69
src/routes/_authenticated/dashboard.admin.payout-settings.tsx:76
src/routes/_authenticated/dashboard.admin.refunds.tsx:61
src/routes/_authenticated/dashboard.admin.restaurants.tsx:186
src/routes/_authenticated/dashboard.admin.security.tsx:59,89,105
src/routes/_authenticated/dashboard.admin.users.tsx:125,154,176,188,199
src/routes/_authenticated/dashboard.driver.available.tsx:81
src/routes/_authenticated/dashboard.driver.history.tsx:116,136,161
src/routes/_authenticated/dashboard.driver.index.tsx:79
src/routes/_authenticated/dashboard.driver.payouts.tsx:104
src/routes/_authenticated/dashboard.driver.profile.tsx:101,141
src/routes/_authenticated/dashboard.restaurant.employees.tsx:72,84,104
src/routes/_authenticated/dashboard.restaurant.menu.tsx:82,100,113,125
src/routes/_authenticated/dashboard.restaurant.orders.tsx:178
src/routes/_authenticated/dashboard.restaurant.payouts.tsx:126
src/routes/_authenticated/dashboard.restaurant.profile.tsx:109,125
src/routes/_authenticated/dashboard.restaurant.promotions.tsx:90,102,277
src/routes/_authenticated/notifications.tsx:104,123
src/routes/checkout.tsx:337
src/routes/profile.tsx:91
```

44 fichye distenk, 73 sit total.

## Migrasyon rekòmande (pou Pati B, apre Faz 11)

Ranplasman senp, mekanik, san chanjman lojik :

```diff
- onError: (e) => toast.error(e.message),
+ onError: (e) => toast.error(translateSupabaseError(e)),
```

```diff
- toast.error(e instanceof Error ? e.message : "Erè");
+ toast.error(translateSupabaseError(e));
```

```diff
- if (error) toast.error(error);
+ if (error) toast.error(translateSupabaseError(error));
```

- `import { translateSupabaseError } from "@/lib/rpc-errors";` nan chak fichye.

**Atansyon** : kèk sit gen yon mesaj fallback koutim an Kreyòl deja ekri (ex: `"Erè pandan kreyasyon kòmand la"`, `"Pa t kapab jenere kòd sekou yo"`) — sa yo se mesaj kontekstyèl itil, PA jis yon fallback jenerik. Migrasyon dwe **prezève** mesaj kontekstyèl sa yo lè `translateSupabaseError(e)` retounen mesaj jenerik la (`GENERIC_FALLBACK_MESSAGE`), men kite pase mesaj RAISE EXCEPTION koutim yo (`P0001`) san touche. Sa vle di chak sit ka bezwen yon ti revizyon manyèl pou konsève ton/kontèks li, pa yon `sed` global — rezon anplis pou trete l kòm yon vre travay Faz 11, pa yon otomatizasyon mekanik san sipèvizyon.

---

_Kreye pandan koreksyon NKD-003 Pati A (Faz 1 remédiation). Okenn nan 73 sit sa yo pa modifye. Pa gen migrasyon SQL. Pa gen commit sou fichye sa yo._
