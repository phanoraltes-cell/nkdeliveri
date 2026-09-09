import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SITE_URL } from "@/lib/site-config";

type UrlEntry = { loc: string; changefreq: string; priority: string; lastmod?: string };

/**
 * Paj ki LISTE restoran. Kontni yo chanje reyèlman lè yon restoran chanje,
 * donk `lastmod` yo se dat restoran ki pi resamman modifye a — yon dat vre,
 * pa yon estimasyon.
 */
const RESTAURANT_LISTING_URLS: UrlEntry[] = [
  { loc: "/", changefreq: "daily", priority: "1.0" },
  { loc: "/restaurants", changefreq: "daily", priority: "0.9" },
];

/**
 * Paj tèks fiks. Yo PA gen `lastmod` EKSPRÈ.
 *
 * Nou ta ka mete dat jodi a oswa dat deplwaman an, men okenn nan de a pa di
 * lè kontni an chanje tout bon. Epi Google di klèman: si `lastmod` yon sit
 * pa fyab, li sispann fè konfyans ak `lastmod` POU TOUT SIT LA. Sa vle di
 * yon dat envante sou `/terms` ta fè dat restoran nou yo — ki vre epi ki
 * itil — pèdi valè yo tou.
 *
 * Pa gen `lastmod` se yon repons valab nan spesifikasyon sitemap la. Yon
 * dat ki fo pa youn.
 */
const STATIC_URLS: UrlEntry[] = [
  { loc: "/about", changefreq: "monthly", priority: "0.4" },
  { loc: "/contact", changefreq: "monthly", priority: "0.4" },
  { loc: "/faq", changefreq: "monthly", priority: "0.4" },
  { loc: "/terms", changefreq: "yearly", priority: "0.2" },
  { loc: "/privacy", changefreq: "yearly", priority: "0.2" },
];

function toXml(urls: UrlEntry[]): string {
  const items = urls
    .map(
      (u) => `  <url>
    <loc>${SITE_URL}${u.loc}</loc>
${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ""}    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>\n`;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      // Regenerated on every request from the live restaurants table, so a
      // newly-approved restaurant appears here with no redeploy needed.
      GET: async () => {
        const { data: restaurants, error } = await supabase
          .from("restaurants")
          .select("slug, updated_at")
          .eq("status", "approved");
        // A search-engine-facing sitemap shouldn't 500 on a transient DB
        // hiccup — degrade to the static URLs rather than serving nothing,
        // but log so a persistent failure (missing restaurant URLs) is
        // discoverable instead of silently shrinking the sitemap forever.
        if (error) console.error("[sitemap.xml] failed to load restaurants", error);

        const usable = (restaurants ?? []).filter((r) => r.slug);

        const restaurantUrls: UrlEntry[] = usable.map((r) => ({
          loc: `/restaurants/${r.slug}`,
          changefreq: "daily",
          priority: "0.7",
          lastmod: new Date(r.updated_at).toISOString(),
        }));

        // Dat restoran ki pi resamman modifye a — se lè paj lis yo chanje
        // tout bon. Si pa gen okenn restoran, nou pa mete okenn dat olye nou
        // envante youn.
        const newestRestaurantAt = usable.reduce<string | undefined>((newest, r) => {
          const iso = new Date(r.updated_at).toISOString();
          return !newest || iso > newest ? iso : newest;
        }, undefined);

        const listingUrls: UrlEntry[] = RESTAURANT_LISTING_URLS.map((u) => ({
          ...u,
          lastmod: newestRestaurantAt,
        }));

        const xml = toXml([...listingUrls, ...STATIC_URLS, ...restaurantUrls]);
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
