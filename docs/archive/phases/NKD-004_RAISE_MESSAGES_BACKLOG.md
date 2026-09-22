# NKD-004 — Backlog mesaj `RAISE EXCEPTION` an angle

**Dat** : 2026-08-14 (finalizasyon Faz 2)
**Sitiyasyon** : Kategori B nan `docs/NKD_FAZ2_SECURITY_AUDIT.md` §2. **AUKENN kòd pa modifye pou dokiman sa a** — se yon envantè, pa yon fiks. Fiks reyèl la se yon sèl migrasyon dedye, **apre Faz 11**, pa kounye a.

---

## 1. Metodoloji — chanjman kont premye pas Faz 2 a

Premye pas Faz 2 a te itilize yon rechèch mo-kle otomatik (`the|is|not|must|cannot|invalid|already|error|failed|required|found|does|only`) sou 157 mesaj distenk yo, ki te jwenn 65/157, ajiste a ≥68/157 apre yon verifikasyon manyèl pasyèl. Dokiman an te deklare eksplisitteman sa se yon **ESTIMASYON**, pa yon chif final.

Pou dokiman sa a, **chak 157 mesaj yo li endividyèlman, alamen**, pa yon patwon mo-kle — pa gen rekèt SQL/CLI itilize, sèlman lekti fichye lokal (konsistan ak règ ensidan 2026-08-14 la, ki pa konsène lekti kòd lokal ditou, sèlman rekèt DB).

**Rezilta** : **67/157 mesaj Kategori B** (angle), pa 68. Diferans 1 mesaj la byen konprann : premye pas mo-kle a te gen anpil chans pran `'Jounal odit sa a se append-only — % pa pèmèt sou %.%'` (NKD-005, Kategori C) kòm yon match paske `only` parèt kòm yon mo apa nan `append-only` (yon tirè konte kòm yon fwontyè mo pou anpil motor regex) — men mesaj sa a se Kreyòl nan glo li, e Faz 2 li menm klase l Kategori C separeman, pa Kategori B. Chif **67 la se pi presi**, paske li soti nan yon lekti konplè, pa yon patwon apwoksimatif — men li rete konsistan ak fondasyon Faz 2 a (menm 3 mesaj "chape" yo te jwenn manyèlman — `Forbidden`, `Specify exactly one beneficiary`, `Unknown payment provider: %` — parèt tou nan lis 67 la, item #18, #61, #66 pi ba).

**Chif final : 67/157 (42.7%) KONFIME pa lekti konplè** — ranplase estimasyon `≥68` a nan `docs/NKD_FAZ2_SECURITY_AUDIT.md`.

---

## 2. 4 mesaj DEJA REZOUD — pa mete nan backlog aksyon an

4 nan 67 mesaj yo se **tèks istorik** ki soti nan yon vèsyon `private.claim_delivery_secure` ki egziste anvan migrasyon F-02 (`20260813140000_translate_claim_delivery_messages.sql`, Faz 1, commit `ecc9a65`) ranplase fonksyon an nèt (`CREATE OR REPLACE FUNCTION`). Fichye istorik yo **rete jan yo ye** (pa janm modifye apre kou, se konvansyon pwojè a) — men fonksyon **k ap viv la kounye a** pa gen tèks angle sa yo ankò. Lis anba a se referans achiv sèlman :

| #   | Tèks (istorik, mò)                           | Fichye:Liy                                                                       |
| --- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| —   | `Only a driver account can claim deliveries` | `supabase/migrations/20260704180000_c2c3d48b-a50f-44aa-a727-3256ca6f2eed.sql:80` |
| —   | `Order is not ready for pickup`              | `supabase/migrations/20260704180000_c2c3d48b-a50f-44aa-a727-3256ca6f2eed.sql:91` |
| —   | `This order has already been claimed`        | `supabase/migrations/20260704180000_c2c3d48b-a50f-44aa-a727-3256ca6f2eed.sql:94` |
| —   | `You must be online to claim a delivery`     | `supabase/migrations/20260704180000_c2c3d48b-a50f-44aa-a727-3256ca6f2eed.sql:83` |

**Pa touche fichye sa yo** — yo se istwa migrasyon, jan konvansyon pwojè a mande.

## 3. 63 mesaj TOUJOU OUVÈ — backlog reyèl la

| #   | Mesaj                                                             | Fichye:Liy                                                                         |
| --- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | `action required`                                                 | `supabase/migrations/20260719090000_auth_hardening.sql:33`                         |
| 2   | `actor required for service-role rate limit checks`               | `supabase/migrations/20260713121500_rate_limiting.sql:53`                          |
| 3   | `Cannot change fee`                                               | `supabase/migrations/20260708120000_pin_delivery_sensitive_columns.sql:31`         |
| 4   | `Cannot change order_id`                                          | `supabase/migrations/20260708120000_pin_delivery_sensitive_columns.sql:28`         |
| 5   | `Category does not belong to this restaurant`                     | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:132`  |
| 6   | `Category name is required`                                       | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:58`   |
| 7   | `Category not found`                                              | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:76`   |
| 8   | `Commission rate must be between 0 and 100`                       | `supabase/migrations/20260709070000_fix_menu_overload_and_commission_admin.sql:65` |
| 9   | `Contact phone is required`                                       | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:46`   |
| 10  | `Delivery address is required`                                    | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:43`   |
| 11  | `Discount value must be greater than zero`                        | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:219`  |
| 12  | `Dish name is required`                                           | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:124`  |
| 13  | `Dish not found`                                                  | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:153`  |
| 14  | `Dispute not found`                                               | `supabase/migrations/20260714131500_disputes.sql:197`                              |
| 15  | `Driver not found`                                                | `supabase/migrations/20260704180000_c2c3d48b-a50f-44aa-a727-3256ca6f2eed.sql:54`   |
| 16  | `email required`                                                  | `supabase/migrations/20260719090000_auth_hardening.sql:30`                         |
| 17  | `Employee not found`                                              | `supabase/migrations/20260709090000_restaurant_staff_feature.sql:342`              |
| 18  | `Forbidden`                                                       | `supabase/migrations/20260703200000_decffb41-62cc-4c5d-ab49-aa0da48d8c71.sql:64`   |
| 19  | `Illegal delivery status transition: % -> %`                      | `supabase/migrations/20260704180000_c2c3d48b-a50f-44aa-a727-3256ca6f2eed.sql:161`  |
| 20  | `Illegal status transition: % -> %`                               | `supabase/migrations/20260703200000_decffb41-62cc-4c5d-ab49-aa0da48d8c71.sql:82`   |
| 21  | `Invalid assistance status`                                       | `supabase/migrations/20260812100000_komand_admin_module.sql:526`                   |
| 22  | `Invalid commission type`                                         | `supabase/migrations/20260709070000_fix_menu_overload_and_commission_admin.sql:62` |
| 23  | `Invalid coordinates`                                             | `supabase/migrations/20260723090000_notifications_engine_and_gps_sharing.sql:212`  |
| 24  | `Invalid decision`                                                | `supabase/migrations/20260714130000_refunds.sql:153`                               |
| 25  | `Invalid discount type`                                           | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:216`  |
| 26  | `Invalid event`                                                   | `supabase/migrations/20260811120000_admin_step_up_enforcement.sql:241`             |
| 27  | `Invalid payout frequency`                                        | `supabase/migrations/20260708130000_submit_payment_proof_secure.sql:93`            |
| 28  | `Invalid payout mode`                                             | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:364`  |
| 29  | `Invalid quantity`                                                | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:67`   |
| 30  | `invalid rate limit parameters`                                   | `supabase/migrations/20260713121500_rate_limiting.sql:61`                          |
| 31  | `Invalid resolution`                                              | `supabase/migrations/20260722100200_payout_rpcs.sql:256`                           |
| 32  | `Monthly commission amount must be zero or more`                  | `supabase/migrations/20260709070000_fix_menu_overload_and_commission_admin.sql:68` |
| 33  | `Not authenticated`                                               | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:37`   |
| 34  | `Only an admin can change driver approval status`                 | `supabase/migrations/20260704180000_c2c3d48b-a50f-44aa-a727-3256ca6f2eed.sql:26`   |
| 35  | `Only an admin can reassign a delivery`                           | `supabase/migrations/20260704180000_c2c3d48b-a50f-44aa-a727-3256ca6f2eed.sql:144`  |
| 36  | `Only an approved refund can be marked completed`                 | `supabase/migrations/20260714130000_refunds.sql:215`                               |
| 37  | `Order id required`                                               | `supabase/migrations/20260731140000_admin_finance_dashboard_rpcs.sql:306`          |
| 38  | `Order must have at least one item`                               | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:40`   |
| 39  | `Order not found`                                                 | `supabase/migrations/20260703200000_decffb41-62cc-4c5d-ab49-aa0da48d8c71.sql:51`   |
| 40  | `Payment not found`                                               | `supabase/migrations/20260708130000_submit_payment_proof_secure.sql:39`            |
| 41  | `Payout not found`                                                | `supabase/migrations/20260722100200_payout_rpcs.sql:140`                           |
| 42  | `Percentage discount cannot exceed 100`                           | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:222`  |
| 43  | `Placement not found`                                             | `supabase/migrations/20260722220000_sponsored_placements.sql:170`                  |
| 44  | `Platform payout settings not configured`                         | `supabase/migrations/20260718160000_restaurant_payout_always_via_admin.sql:190`    |
| 45  | `Preferences must be a JSON object`                               | `supabase/migrations/20260723090000_notifications_engine_and_gps_sharing.sql:65`   |
| 46  | `Price must be zero or more`                                      | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:127`  |
| 47  | `Product % is not available`                                      | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:75`   |
| 48  | `Product % not found`                                             | `supabase/migrations/20260703080345_334c0504-5e5f-4ce8-acad-1daf9475fe7c.sql:171`  |
| 49  | `Product does not belong to this restaurant`                      | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:72`   |
| 50  | `Product not found`                                               | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:70`   |
| 51  | `Promotion not found`                                             | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:243`  |
| 52  | `Promotion title is required`                                     | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:213`  |
| 53  | `Provide at least a MonCash or NatCash number for direct payouts` | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:367`  |
| 54  | `Refund not found`                                                | `supabase/migrations/20260714130000_refunds.sql:158`                               |
| 55  | `Restaurant has not configured this payment method`               | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:107`  |
| 56  | `Restaurant is not available`                                     | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:52`   |
| 57  | `Restaurant name is required`                                     | `supabase/migrations/20260704120500_034039c7-4308-4f2f-a618-6e4a769a0573.sql:299`  |
| 58  | `Restaurant not found`                                            | `supabase/migrations/20260703080425_a8cbad5c-4045-4fe3-a50f-914e30a2c91b.sql:51`   |
| 59  | `Specify exactly one beneficiary`                                 | `supabase/migrations/20260722100200_payout_rpcs.sql:41`                            |
| 60  | `Stock quantity must be zero or more`                             | `supabase/migrations/20260706151929_add_product_stock_quantity.sql:32`             |
| 61  | `This payment is not awaiting proof`                              | `supabase/migrations/20260708130000_submit_payment_proof_secure.sql:43`            |
| 62  | `This refund has already been reviewed`                           | `supabase/migrations/20260714130000_refunds.sql:161`                               |
| 63  | `Unknown payment provider: %`                                     | `supabase/migrations/20260803120000_payment_provider_settings.sql:109`             |

---

## 4. Enpak ak sekans (rapèl §2 NKD_FAZ2_SECURITY_AUDIT.md)

- Chemen reyèl bay itilizatè a se **73 sit** `toast.error(e.message)`-style (NKD-003 Pati A) — mesaj sa yo rive tankou yo ye, san tradiksyon, kèlkeswa sit la.
- `translateSupabaseError` (NKD-003 Pati A, deja aplike) **jamè touche kòd `P0001`** (RAISE EXCEPTION koutim) — se yon chwa delibere pou pa kraze mesaj biznis egzistan yo. Sa vle di 63 mesaj sa yo ap **rete an angle** menm apre yon migrasyon Pati B NKD-003 fini — NKD-004 (lang) ak NKD-003 (sekirite/fuit estrikti) se **2 pwoblèm distenk**, 2 koreksyon separe, konfime nan Faz 2.
- **Nivo** : P3 (UX), pa yon vilnerabilite sekirite — okenn nan 63 mesaj sa yo pa fè fuit estrikti DB (sa se NKD-005, trete apa).

## 5. Plan (pa kounye a)

Yon **sèl migrasyon dedye**, apre Faz 11, ki tradui tout 63 mesaj ki rete ouvè yo an Kreyòl, swiv menm disiplin ak F-02 (`20260813140000_translate_claim_delivery_messages.sql`) : `CREATE OR REPLACE FUNCTION` konplè pou chak fonksyon, chak liy ki pa yon mesaj verifye idantik ak vèsyon an dirèk (`pg_get_functiondef()`) anvan ekri, jamè retape sot nan memwa. **Okenn nan 63 mesaj sa yo pa touche kounye a** — dokiman sa a se yon envantè, pa yon fiks.
