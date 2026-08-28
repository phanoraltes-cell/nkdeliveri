# PAS 6 — UX/UI + Aksesibilite + SEO

**Estati aksè — pi bon pase anpil lòt pas**: kontrèman ak dokiman referans lan ki prevwa "san runtime ni screenshot, tout finding UI plafone a LIKELY", sesyon sa a te gen aksè reyèl a yon sèvè dev + Playwright. Kèk chèk anba a se **CONFIRMED pa yon rannmen navigatè reyèl**, pa yon sipozisyon sou kòd sous.

## SEO — verifye nan kòd

| Chèk                                   | Rezilta                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title/description/canonical/OG/Twitter | `pageMeta()` ([src/lib/seo.ts](src/lib/seo.ts)) bay tout 12 tag yo nan yon sèl apèl — **17 wout** itilize l                                                            |
| Kouvèti sou wout PIBLIK                | **100%** (0 wout piblik san meta, verifye pa yon boucle sou tout `src/routes` eksepte `_authenticated/`)                                                               |
| Wout dashboard san meta pwòp yo        | 20 jwenn, **tout** eritye `noIndexMeta()` paran `_authenticated/route.tsx` a (TanStack Router fizyone `head()` sou tout chèn nan) — **pa yon gap, se DRY entansyonèl** |
| `robots.txt`                           | Bloke `/dashboard`, `/admin`, `/api`, `/private`, `/auth`, `/checkout`, `/orders`, `/profile` — pwente `Sitemap:`                                                      |
| `sitemap.xml`                          | Egziste (`src/routes/sitemap[.]xml.ts`)                                                                                                                                |
| JSON-LD                                | Yon helper dedye (`jsonLdScript`) egziste pou done estriktire                                                                                                          |

**CONFIRMED — kouvèti SEO konplè e san duplication.**

## Aksesibilite — verifye nan kòd

- `prefers-reduced-motion: reduce` jere nan [styles.css:317](src/styles.css#L317)
- **284 okirans** `aria-label`/`aria-hidden`/`aria-describedby`/`aria-live` nan tout `src/`
- **8 okirans** `focus-visible` (estil klavye vizib)
- Landmark semantik konfime: `<header>` ([site-header.tsx](src/components/site-header.tsx)), `<footer>` ([site-footer.tsx](src/components/site-footer.tsx)), `<nav>` (bottom-nav, breadcrumb), `<main>` (routes/index.tsx)
- ~~CI gen deja yon travay dedye "E2E — accessibility/Lighthouse/SEO/PWA/offline/responsive" ki itilize `@axe-core/playwright` — tès otomatik ekip la deja genyen~~ — **KOREKSYON PAS 9 (2026-08-28)**: sa a se yon fo-siyal pozitif mwen te itilize kòm prèv. Verifikasyon (PAS 9, Etap 9.1) montre travay sa a **an echèk** sou `2d8a037` (branch anvan menм tout remediation, konfime pa `gh api .../check-runs`) — **44 tès pase, 14 echwe** (rezilta egzat, pa yon estimasyon). Egzistans yon job CI pa pwouve anyen sou kalite a11y/SEO/PWA — sèl bagay li pwouve se ke yon SWIT tès egziste, pa ke li PASE. Gade `OPS-003` pou finding konplè a. **Kouvèti tès otomatik a11y/SEO/PWA reyèl la: 44/58 tès (76%), 0 travay CI konplè ki pase.**

## Responsive — CONFIRMED pa rannmen reyèl (pa estimasyon)

Playwright, sèvè dev lokal, **3 paj piblik** (akèy, lis restoran, konekte) × **7 lajè** (320/360/390/414/768/1024/1440px) = **21 konbinezon**:

| Rezilta                                                     | Kantite     |
| ----------------------------------------------------------- | ----------- |
| Debòdman orizontal (`scrollWidth > clientWidth`)            | **0/21**    |
| Chevochman/kontni koupe (enspeksyon vizyèl 2 kaptirè mobil) | Okenn jwenn |

Ekran konekte (`/auth`) ak lis restoran (`/restaurants`) tou de klè, byen espase, bouton Google OAuth vizib, kat restoran byen fòme, pye paj (footer) òganize.

## Rezime severite PAS 6

- 🔴 0 CRITICAL / 🟠 0 HIGH / 🟡 0 MEDIUM / 🔵 0 LOW
- Frame: paj piblik → N=3 teste (Playwright dirèk, 21/21 konbinezon san debòdman, CONFIRMED). SEO kouvèti kòd → N=17 wout ak meta, 17/17 verifye (CONFIRMED). Tès axe-core/Lighthouse CI → 58 tès total, 44/58 pase (76%) — **pa 100%, korije pa PAS 9** (gade koreksyon anwo).

## Limit pas sa a (onèt)

- **Sèlman 3 paj piblik** teste vizyèlman (pa gen sesyon otantifye disponib pou teste 52 wout dashboard yo — mande yon kont tès reyèl).
- **PAS 9 koreksyon**: mwen te sipoze "yon job CI egziste" te yon siyal pozitif — sa te fo. Job la egziste e egzekite, men li echwe (14/58 tès), e li te DEJA echwe anvan tout remediation. Mwen pa mwen menм egzekite/apwofondi tès axe-core/Lighthouse yo endividyèlman — sèl done mwen genyen se konte pase/echwe soti nan CI.
- Kontras koulè pa kalkile piksèl-pa-piksèl (rapò kontras egzat) — sèlman enspeksyon vizyèl jeneral.
- Navigasyon klavye (tab-order reyèl, pyèj fokis modal) pa teste ak yon klavye reyèl — sèlman prezans `focus-visible` nan CSS verifye.
- Sèl 2 lajè mobil (390) gen yon kaptirè egzamine an detay pou chevochman; 19 lòt konbinezon verifye SÈLMAN pou debòdman orizontal (metrik), pa enspeksyon vizyèl konplè chak yo.

---

**Èske mwen kontinye ak PAS 7 (DevOps + Migrations + Git + Production reality)?**
