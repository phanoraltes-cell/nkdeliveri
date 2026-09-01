# NKD-022 — Kondisyon Itilizasyon (CGU) ak Politik Konfidansyalite

**Dat :** 18 Out 2026
**Estati :** Ekri, teste an rehearsal (BEGIN…ROLLBACK) — **PA APLIKE sou pwodiksyon, PA POUSE**, an atant otorizasyon eksplisit (Règ A6/A5).

> **Avètisman legal (obligatwa, dapre demand orijinal la) :** moun ki ekri dokiman sa yo pa yon
> avoka, ni founisè sèvis NK Deliveri a pa youn tou. `/terms` ak `/privacy` reflete egzakteman
> jan sistèm nan fonksyone jodi a (chak fraz verifye kont kòd la) — yo se yon baz solid, men yo
> **pa ranplase yon revizyon fòmèl pa yon jiris ki lisansye an Ayiti**. Nou rekòmande fòtman yon
> revizyon legal anvan volim biznis la grandi anpil.

---

## Etap 1 — Envantè (prezante epi konfime avan ekriti kontni)

Done kolekte, règ metye verifye — gade mesaj presedan nan konvèsasyon sa a pou tablo konplè
`fichye:liy` la. Rezime rapid:

- Done: `orders` (adrès/telefòn/nòt), `customer_delivery_locations` (GPS, opt-in, efase a fen
  livrezon), `profiles` (**⚠️ lizib piblikman**, `USING (true)` + `GRANT ... TO anon`), `payments`
  (metòd/montan/referans), `push_subscriptions`, dokiman KYC nan storage privé.
- Règ metye verifye nan kòd la : frè 150 HTG (`platform_delivery_zones`), anilasyon
  pending/confirmed sèlman (`update_order_status_secure`), livrezon echwe 2èdtan san ranbousman
  (NKD-016), estòk rejte si ensifizan (NKD-010), rate limit 8/10min (NKD-011).
- **Repwogramasyon (NKD-017) konfime PA IMPLEMANTE** — 0 rezilta pou `reschedul|repwogram` nan
  tout istwa migrasyon. **Pa parèt okenn kote nan `/terms`.**

## Kesyon `KANPE EPI MANDE` — repons pwopriyetè a

| Kesyon | Repons |
|---|---|
| Retansyon done (NKD-021: pa gen politik jodi a) | Dokimante reyalite a: "pou tout tan pou kounye a" — pa envante yon chif |
| Kote pou estoke akseptasyon | Nouvo kolòn sou `profiles` (`terms_accepted_at`, `terms_version`) |
| Kliyan egzistan (2 kont tès) | Mande yo aksepte nan pwochen koneksyon — **pa** backfill/grandfather |

## Kontni — `/privacy` ak `/terms`

Reyekri konplètman an Kreyòl (te gen placeholder anvan) — gade [src/routes/privacy.tsx](../../../src/routes/privacy.tsx)
ak [src/routes/terms.tsx](../../../src/routes/terms.tsx). Chak seksyon obligatwa nan pwonpt la prezan:
done kolekte konkrè (pa jenerik), poukisa/pa kategori, ki moun ki wè, retansyon (onèt), twazyèm
pati (Supabase/Vercel/MonCash/NatCash/Stripe/OSM), dwa itilizatè (aksè/koreksyon/efasman — jodi a
se yon demand manyèl, **pa gen bouton otomatik**, sa fè NKD-020 pi ijan), GPS an detay, kontak.
Seksyon 6 `/terms` (livrezon echwe) make eksplisitteman kòm "seksyon ki pi enpòtan".

## Chanjman migrasyon + UI (`fichye:liy`)

| Chanjman | Fichye |
|---|---|
| `profiles.terms_accepted_at` / `terms_version` + `accept_terms_secure()` + `handle_new_user()` mete ajou | [supabase/migrations/20260818140000_nkd022_terms_acceptance.sql](../../../supabase/migrations/20260818140000_nkd022_terms_acceptance.sql) |
| Vèsyon dokiman santralize | [src/lib/legal.ts](../../../src/lib/legal.ts) |
| Lyen reyèl `/terms`/`/privacy` + `terms_version` nan metadata siyati | [src/components/auth/customer-form.tsx](../../../src/components/auth/customer-form.tsx):27-33,113-134; [driver-form.tsx](../../../src/components/auth/driver-form.tsx):36-49,189-210; [restaurant-form.tsx](../../../src/components/auth/restaurant-form.tsx):45-59,191-212 |
| Gate re-akseptasyon pou kont egzistan | [src/components/terms-acceptance-gate.tsx](../../../src/components/terms-acceptance-gate.tsx) (nouvo) |
| Gate a mare nan chak paj dashboard | [src/routes/_authenticated/route.tsx](../../../src/routes/_authenticated/route.tsx):3,62-67 |
| Kontni `/privacy`/`/terms` konplè | [src/routes/privacy.tsx](../../../src/routes/privacy.tsx), [src/routes/terms.tsx](../../../src/routes/terms.tsx) |
| Tip Supabase (`profiles` + `accept_terms_secure`) | [src/integrations/supabase/types.ts](../../../src/integrations/supabase/types.ts) |

**Poukisa nouvo siyati pa mande TOTP/re-otantifikasyon:** `accept_terms_secure()` sèlman ekri
`auth.uid()`'s pwòp ranje — pa gen paramèt itilizatè sib, donk pa gen sifas eskalasyon privilèj.

## Tès (Règ A10 — rezilta nan tab tanporè + SELECT, pa `RAISE NOTICE`)

Fichye: [docs/NKD022_TERMS_ACCEPTANCE_TEST.sql](../sql-tests/NKD022_TERMS_ACCEPTANCE_TEST.sql) — migrasyon +
tès nan menm `BEGIN…ROLLBACK` (pa gen restriksyon enum tankou NKD-016, kidonk yon sèl fichye
sifi, menm apwòch ak NKD-011).

| Tès | Verifye |
|---|---|
| T0 | Kolòn `terms_accepted_at`/`terms_version` egziste sou `profiles` |
| T1 | Siyati SAN `terms_version` nan metadata → toude kolòn rete NULL |
| T2 | Siyati AK `terms_version=1.0` → toude kolòn ranpli nan menm moman siyati a |
| T3 | `accept_terms_secure()` san sesyon → rejte |
| T4 | `accept_terms_secure('1.0')` kòm yon kont ki pa t aksepte → siksè, kolòn ranpli |
| T5 | `accept_terms_secure(NULL)` → rejte |
| T6 | Akseptasyon yon kont pa afekte yon lòt kont (pòtee `auth.uid()` sèlman) |
| T7 | Menm konpòtman an aplike pou siyati restoran (pa sèlman kliyan) |

**⚠️ Pa gen ankò rezilta reyèl — fichye a ekri, tès la poko kouri nan SQL Editor.** Pwochen etap
se ou menm kouri l, kole rezilta a isit la, epi apwouve aplikasyon anvan nou kontinye.

## Kontwòl "règ CGU ki pa matche kòd la" (dwe vid)

| Règ nan `/terms` | Verifye kont kòd | Rezilta |
|---|---|---|
| Frè livrezon 150 HTG | `platform_delivery_zones`, NKD-015 | ✅ Matche |
| Anilasyon sèlman anvan preparasyon | `update_order_status_secure`, NKD-010:361 | ✅ Matche |
| Livrezon echwe: 2èdtan, san ranbousman | NKD-016 migrasyon | ✅ Matche |
| 4 metòd peman (MonCash/NatCash/Stripe/Kach) | `payment_method` enum | ✅ Matche |
| **Repwogramasyon pa mansyone** | NKD-017 pa implemante | ✅ Egzakteman konsa — pa parèt |

**Lis la vid** — pa gen okenn règ nan `/terms` ki pa reflete kòd la reyèlman.

## Pwochen etap

1. Ou kouri [NKD022_TERMS_ACCEPTANCE_TEST.sql](../sql-tests/NKD022_TERMS_ACCEPTANCE_TEST.sql) nan SQL Editor.
2. Ou konfime rezilta (tout PASS oswa yon FAIL espesifik pou nou korije).
3. Otorizasyon eksplisit pou aplike migrasyon an pou vre sou pwodiksyon.
4. Backfill `supabase_migrations.schema_migrations` nan menm aplikasyon an (Règ A11).
5. `npm run verify` konfime vèt, ou otorize push kòd frontend lan (sèlman **apre** migrasyon an
   aplike — menm lòd deplwaman ak chak tikè anvan sa a).
