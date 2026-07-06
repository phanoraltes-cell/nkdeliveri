/**
 * Single source of truth for site-wide SEO/business metadata. Centralizing
 * this here (instead of scattering the domain/city/brand name across every
 * route's head()) is what makes it realistic to extend to another city or
 * update the canonical domain later without hunting through every file.
 */

export const SITE_URL = "https://nkdeliveri.com";
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

export const SOCIAL_LINKS: { label: string; url: string }[] = [
  // Populate once NK Deliveri's social profiles exist — omitted for now
  // rather than linking to accounts that don't exist yet.
];

export const CONTACT_EMAIL = "support@nkdeliveri.com";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
