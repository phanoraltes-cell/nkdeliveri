import { SITE_NAME, absoluteUrl } from "@/lib/site-config";

const DEFAULT_IMAGE = absoluteUrl("/nk-logo.png");

type PageMetaOptions = {
  title: string;
  description: string;
  /** Path only, e.g. "/restaurants/le-bon-gout" — turned into the absolute canonical/og:url. */
  path: string;
  /** Absolute image URL. Defaults to the site logo. */
  image?: string;
  type?: "website" | "article";
};

/** Title + description + canonical + robots(index) + full OG/Twitter set for a public, indexable page. */
export function pageMeta({ title, description, path, image, type = "website" }: PageMetaOptions) {
  const url = absoluteUrl(path);
  const ogImage = image ?? DEFAULT_IMAGE;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:type", content: type },
      { property: "og:image", content: ogImage },
      // SEO brand-authority audit — every indexable page should identify
      // which *site* it belongs to, not just carry its own page title.
      // Distinct from og:title (varies per page): this is the constant
      // brand name, so crawlers attribute e.g. the FAQ page to "NK
      // Deliveri" as the site, not just to "Kesyon Moun Poze Souvan".
      { property: "og:site_name", content: SITE_NAME },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: ogImage },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/** For private/auth/cart/dashboard pages: keep them out of search results entirely. */
export function noIndexMeta(title: string) {
  return {
    meta: [{ title }, { name: "robots", content: "noindex, nofollow" }],
  };
}

/** A JSON-LD block, ready to spread into a route's head().scripts array. */
export function jsonLdScript(data: Record<string, unknown>) {
  return { type: "application/ld+json", children: JSON.stringify(data) };
}

/** Limit Google montre nan yon rezilta rechèch anvan li koupe. */
export const MAX_TITLE_LENGTH = 60;

/**
 * Chwazi premye tit ki antre nan 60 karaktè.
 *
 * Gabari tit restoran an — `{Non} — Meni ak livrezon | NK Deliveri` — gen
 * yon sifiks 33 karaktè. Sa kite 27 karaktè pou non an. Yon restoran ki gen
 * yon non pi long ta bay yon tit Google koupe nan mitan yon mo.
 *
 * Olye nou koupe san reflechi, nou eseye kandida yo nan LÒD: tit konplè a,
 * apre sa yon vèsyon san non mak la, apre sa non an sèl. Nou koupe sèlman
 * si menm dènye kandida a twò long — epi lè sa a ak yon eleps, pa nan
 * mitan yon mo.
 */
export function fitTitle(candidates: string[]): string {
  for (const candidate of candidates) {
    if (candidate.length <= MAX_TITLE_LENGTH) return candidate;
  }
  const last = candidates[candidates.length - 1] ?? "";
  return `${last.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}
