
## Objektif
Bay itilizatè yo yon fason klè pou navige plat ayisyen yo pa kategori otantik — sou paj akèy la (chwazi yon tip plat) ak sou paj chak restoran (filtre meni an).

## 1. Baz done — kategori plat global

Ajoute yon nouvo kolòn tèks `dish_type` sou tab `products` pou pèmèt filtre ki travèse restoran yo. Chak plat ap resevwa youn nan valè sa yo:

- `diri_sos` — Diri ak Sòs (diri kole, diri blan ak sòs pwa, diri ak pwa)
- `griyo` — Griyo, Tasso, Vyann fri
- `fritay` — Fritay konplè, akra, marinad, bannann peze
- `soup` — Soup joumou, bouyon, lalo, kalalou
- `pwason` — Pwason gwo sèl, lambi
- `sandwich` — Sandwich, pat, patat frit
- `bwason` — Ji, dlo, kola
- `pizza` — Pizza
- `lot` — Lòt

Aplike valè yo sou plat egzistan yo via yon migration (mapping pa non).

## 2. Paj akèy — nouvo filtre kategori plat

Anba seksyon "Plat popilè", ranplase (oswa konplete) filtè aktyèl la:
- Yon ranje "chip" ki gen ikòn/emoji + non kreyòl (Tout, 🍚 Diri ak Sòs, 🍖 Griyo, 🍤 Fritay, 🥣 Soup, 🐟 Pwason, 🥪 Sandwich, 🍕 Pizza, 🥤 Bwason).
- Klike sou yon chip filtre lis plat popilè yo pa `dish_type`.
- Chip aktif la itilize koulè brand (`bg-brand text-white`) — menm style ak chip restoran yo.
- Konsève filtre restoran popilè yo jan yo ye a (pa `cuisine`).

## 3. Paj restoran (`/restaurants/$slug`) — filtè meni

- Anba header restoran an, ajoute yon ranje chip stiky (`sticky top-16`) ki liste kategori meni restoran an (`menu_categories.name`) plis yon chip "Tout".
- Chip aktif la filtre pwodwi yo montre nan gri a — sèlman kategori chwazi a parèt. Konpòtman "Tout" montre tout kategori jan yo ye jodi a.
- State lokal ak `useState`, pa nan URL (pi senp).
- Ajoute konte plat bò kote non chak chip (ex: "Griyo · 4").

## 4. Enjeksyon done demo (fritay + soup)

Ajoute 2-3 plat nouvo pou kouvri kategori ki manke:
- **Chez Marie** — "Soup Joumou" (soup, 400 HTG) ak imaj `lalo.webp` (oswa jenere pi devan).
- **Griyo Express** — deja gen Fritay Konplè.
- **Ocean Fresh** — bay `dish_type = pwason` bay plat egzistan yo.

## 5. Detay teknik

```text
Migration:
  ALTER TABLE public.products
    ADD COLUMN dish_type text;
  UPDATE public.products SET dish_type = ... WHERE name IN (...);
  INSERT ... (Soup Joumou, ...);

Fichye afekte:
  supabase/migrations/<new>.sql       — ajoute kolòn + mapping + seed
  src/routes/index.tsx                — nouvo lis DISH_TYPES + filtre sou "Plat popilè"
  src/routes/restaurants.$slug.tsx    — chip kategori + filtre lokal
```

Pa gen chanjman sou logik komèsyal (panye, checkout, RLS). Sèlman prezantasyon + yon kolòn deskriptif.

## Sa ki pa nan plan sa a
- Pa gen chanjman sou header, footer, oswa flo peman.
- Pa gen paj kategori dedye (`/kategori/griyo`) — sèlman filtè entèraktif.
- Pa gen jenerasyon nouvo imaj — n ap reyitilize aktif yo deja ap sèvi yo.
