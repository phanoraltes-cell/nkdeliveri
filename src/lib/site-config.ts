/**
 * Single source of truth for site-wide SEO/business metadata. Centralizing
 * this here (instead of scattering the domain/city/brand name across every
 * route's head()) is what makes it realistic to extend to another city or
 * update the canonical domain later without hunting through every file.
 */

// Apex domain 308-redirects to www in production (confirmed via curl) — SEO
// metadata/canonicals/sitemap must point at the URL that's actually served,
// not the one that immediately redirects away.
export const SITE_URL = "https://www.nkdeliveri.com";
export const SITE_NAME = "NK Deliveri";

/**
 * Today the business only operates in Gonaïves — every city-specific claim
 * in metadata/structured data must come from here, not be hardcoded inline,
 * so adding a second city later is a config change, not a content rewrite.
 */
export const PRIMARY_CITY = {
  name: "Gonaïves",
  region: "Artibonite",
  country: "HT",
  countryName: "Ayiti",
};

/**
 * `icon` is a plain string key (not a component reference) on purpose —
 * this file stays pure data, no JSX/React import here. site-footer.tsx maps
 * the key to the real icon component, since that's the one place actually
 * rendering it.
 *
 * `url` is intentionally "" for now: the real icons are wanted on the site
 * today, but the accounts themselves don't exist yet ("pita map mete lyen
 * kont yo" — the owner will fill these in directly once each profile is
 * live). site-footer.tsx renders an inert (non-clickable, dimmed) icon
 * whenever `url` is empty, and a real link the moment it isn't — filling in
 * a URL here is the only change needed later, nothing else to touch.
 */
export const SOCIAL_LINKS: {
  label: string;
  url: string;
  icon: "facebook" | "instagram" | "tiktok";
}[] = [
  { label: "Facebook", url: "", icon: "facebook" },
  { label: "Instagram", url: "", icon: "instagram" },
  { label: "TikTok", url: "", icon: "tiktok" },
];

export const CONTACT_EMAIL = "support@nkdeliveri.com";

/**
 * Sèl kote nimewo WhatsApp biznis la ekri (demand itilizatè eksplisit —
 * "pa kopye l nan plizyè fichye"). Menm konvansyon ak CONTACT_EMAIL anwo a:
 * yon nimewo biznis pa yon sekrè, kidonk yon konstan senp isit la (pa yon
 * varyab anviwònman) — chak kote ki bezwen l enpòte l isit la.
 * `WHATSAPP_LINK` deja gen mesaj prerampli a (encodeURIComponent, pa yon
 * tèks kole alamen) pou li rete kòrèk si mesaj la chanje pita.
 */
export const WHATSAPP_NUMBER_DISPLAY = "+509 47 41 9458";
// Fòma entènasyonal wa.me: san espas, san "+", san "0" dirijan.
const WHATSAPP_NUMBER_INTL = "50947419458";
export const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_NUMBER_INTL}?text=${encodeURIComponent(
  "Bonjou NK DELIVERI, mwen bezwen yon enfòmasyon",
)}`;

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
