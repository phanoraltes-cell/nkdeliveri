/**
 * Home page's "Kategori Pla" discovery rail content — added post-P10,
 * sourced from the `Kategori/` asset drop (10 dish photos, see
 * docs/archive/audits/HOME_KATEGORI_PLA_VIDEO_REPORT.md for the full asset audit). Names
 * and taglines below are taken directly from the source filenames (each
 * one already carried a real Haitian dish name and a short French
 * description, e.g. `haiti-1-soup-joumou-symbole-de-liberte-*.webp`) —
 * translated to Kreyòl to match the rest of the site's voice, not
 * invented. `dishType` only set where it genuinely matches an existing
 * `DISH_TYPES` key in popular-dishes-section.tsx (5 of 10) — clicking
 * those cards reuses that section's real filter instead of pretending a
 * category system exists where it doesn't.
 *
 * Split out of kategori-pla-section.tsx into its own file
 * (react-refresh/only-export-components cleanup, remediation 07) so that
 * component file only exports the component, and this content data can be
 * edited on its own without touching render/animation logic. No behavior
 * change.
 */
export type Kategori = {
  key: string;
  name: string;
  tagline: string;
  image: string;
  /** Matches a DISH_TYPES key in popular-dishes-section.tsx, when a real one exists. */
  dishType?: string;
};

export const KATEGORI_PLA: Kategori[] = [
  {
    key: "soup-joumou",
    name: "Soup Joumou",
    tagline: "Senbòl endepandans",
    image: "/kategori/haiti-1-soup-joumou-symbole-de-liberte-1739209611.webp",
    dishType: "soup",
  },
  {
    key: "diri-sos-pwa",
    name: "Diri Blan ak Sòs Pwa",
    tagline: "Manje chak jou",
    image: "/kategori/haiti-2-diri-blan-sos-pwa-legim-l039essence-du-quotidien-1739209664.webp",
    dishType: "diri_sos",
  },
  {
    key: "ragou",
    name: "Ragou",
    tagline: "Rekonfòtan e epise",
    image: "/kategori/haiti-7-ragou-un-plat-reconfortant-et-epice-1739210329.webp",
  },
  {
    key: "diri-pwa-kongo",
    name: "Diri ak Sòs Pwa Kongo",
    tagline: "Melanj gou pafè",
    image: "/kategori/haiti-9-diri-sos-pwa-kongo-un-mariage-parfait-de-saveurs--1739210578.webp",
    dishType: "diri_sos",
  },
  {
    key: "mayi-moulen",
    name: "Mayi Moulen ak Sòs Pwa",
    tagline: "Rekonfòtan",
    image: "/kategori/haiti-10-mayi-moulen-ak-sos-pwa-un-plat-reconfortant--1739210703.webp",
  },
  {
    key: "fritay",
    name: "Fritay",
    tagline: "Snack ri Ayisyen",
    image: "/kategori/haiti-11-fritay-le-snack-incontournable-des-rues-haitiennes--1739210736.webp",
    dishType: "fritay",
  },
  {
    key: "tonmtonm",
    name: "Tonmtonm ak Sòs Kalalou",
    tagline: "Espesyalite Grandsid",
    image:
      "/kategori/haiti-12-tonmtonm-ak-sos-kalalou-une-specialite-du-grand-sud--1739210770.webp",
  },
  {
    key: "lalo",
    name: "Lalo",
    tagline: "Legim tradisyonèl",
    image: "/kategori/haiti-16-lalo-l-epinard-haitien--1739211070.webp",
  },
  {
    key: "pate-kode",
    name: "Patè Kòde",
    tagline: "Street food pa ekselans",
    image: "/kategori/haiti-17-pate-kode-le-street-food-par-excellence--1739211190.webp",
  },
  {
    key: "pwason-gro-sel",
    name: "Pwason Gro Sèl",
    tagline: "Gou lanmè otantik",
    image:
      "/kategori/haiti-21-pwason-gro-sel-l-authenticite-des-saveurs-de-la-mer--1739211784.webp",
    dishType: "pwason",
  },
];
