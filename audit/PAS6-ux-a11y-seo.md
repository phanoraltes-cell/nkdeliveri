# PAS 6 — UX/UI + Aksesibilite + SEO

**Estati aksè — pi bon pase anpil lòt pas**: kontrèman ak dokiman referans lan ki prevwa "san runtime ni screenshot, tout finding UI plafone a LIKELY", sesyon sa a te gen aksè reyèl a yon sèvè dev + Playwright. Kèk chèk anba a se **CONFIRMED pa yon rannmen navigatè reyèl**, pa yon sipozisyon sou kòd sous.

## SEO — verifye nan kòd

| Chèk | Rezilta |
|---|---|
| Title/description/canonical/OG/Twitter | `pageMeta()` ([src/lib/seo.ts](src/lib/seo.ts)) bay tout 12 tag yo nan yon sèl apèl — **17 wout** itilize l |
| Kouvèti sou wout PIBLIK | **100%** (0 wout piblik san meta, verifye pa yon boucle sou tout `src/routes` eksepte `_authenticated/`) |
| Wout dashboard san meta pwòp yo | 20 jwenn, **tout** eritye `noIndexMeta()` paran `_authenticated/route.tsx` a (TanStack Router fizyone `head()` sou tout chèn nan) — **pa yon gap, se DRY entansyonèl** |
| `robots.txt` | Bloke `/dashboard`, `/admin`, `/api`, `/private`, `/auth`, `/checkout`, `/orders`, `/profile` — pwente `Sitemap:` |
| `sitemap.xml` | Egziste (`src/routes/sitemap[.]xml.ts`) |
| JSON-LD | Yon helper dedye (`jsonLdScript`) egziste pou done estriktire |

**CONFIRMED — kouvèti SEO konplè e san duplication.**

## Aksesibilite — verifye nan kòd

- `prefers-reduced-motion: reduce` jere nan [styles.css:317](src/styles.css#L317)
- **284 okirans** `aria-label`/`aria-hidden`/`aria-describedby`/`aria-live` nan tout `src/`
- **8 okirans** `focus-visible` (estil klavye vizib)
- Landmark semantik konfime: `<header>` ([site-header.tsx](src/components/site-header.tsx)), `<footer>` ([site-footer.tsx](src/components/site-footer.tsx)), `<nav>` (bottom-nav, breadcrumb), `<main>` (routes/index.tsx)
- **CI gen deja yon travay dedye** "E2E — accessibility/Lighthouse/SEO/PWA/offline/responsive" ki itilize `@axe-core/playwright` (dokimante nan PAS 0) — tès otomatik ekip la deja genyen, pa yon bagay mwen dwe envante.

## Responsive — CONFIRMED pa rannmen reyèl (pa estimasyon)

Playwright, sèvè dev lokal, **3 paj piblik** (akèy, lis restoran, konekte) × **7 lajè** (320/360/390/414/768/1024/1440px) = **21 konbinezon**:

| Rezilta | Kantite |
|---|---|
| Debòdman orizontal (`scrollWidth > clientWidth`) | **0/21** |
| Chevochman/kontni koupe (enspeksyon vizyèl 2 kaptirè mobil) | Okenn jwenn |

Ekran konekte (`/auth`) ak lis restoran (`/restaurants`) tou de klè, byen espase, bouton Google OAuth vizib, kat restoran byen fòme, pye paj (footer) òganize.

## Rezime severite PAS 6

- 🔴 0 CRITICAL / 🟠 0 HIGH / 🟡 0 MEDIUM / 🔵 0 LOW
- SEO, aksesibilite debaz, ak responsive sou paj piblik — **tout CONFIRMED bon**, plizyè pa vrè prèv rannmen (pa sèlman lekti kòd)

## Limit pas sa a (onèt)

- **Sèlman 3 paj piblik** teste vizyèlman (pa gen sesyon otantifye disponib pou teste 52 wout dashboard yo — mande yon kont tès reyèl).
- **Pa gen tès axe-core/Lighthouse egzekite pa mwen menм** — mwen sèlman KONFIME yo egziste nan CI, mwen pa relanse yo.
- Kontras koulè pa kalkile piksèl-pa-piksèl (rapò kontras egzat) — sèlman enspeksyon vizyèl jeneral.
- Navigasyon klavye (tab-order reyèl, pyèj fokis modal) pa teste ak yon klavye reyèl — sèlman prezans `focus-visible` nan CSS verifye.
- Sèl 2 lajè mobil (390) gen yon kaptirè egzamine an detay pou chevochman; 19 lòt konbinezon verifye SÈLMAN pou debòdman orizontal (metrik), pa enspeksyon vizyèl konplè chak yo.

---

**Èske mwen kontinye ak PAS 7 (DevOps + Migrations + Git + Production reality)?**
