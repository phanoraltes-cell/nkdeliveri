import { absoluteUrl } from "@/lib/site-config";

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
