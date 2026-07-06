import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { SITE_URL } from "@/lib/site-config";

type UrlEntry = { loc: string; changefreq: string; priority: string; lastmod?: string };

const STATIC_URLS: UrlEntry[] = [
  { loc: "/", changefreq: "daily", priority: "1.0" },
  { loc: "/restaurants", changefreq: "daily", priority: "0.9" },
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
        const { data: restaurants } = await supabase
          .from("restaurants")
          .select("slug, updated_at")
          .eq("status", "approved");

        const restaurantUrls: UrlEntry[] = (restaurants ?? [])
          .filter((r) => r.slug)
          .map((r) => ({
            loc: `/restaurants/${r.slug}`,
            changefreq: "daily",
            priority: "0.7",
            lastmod: new Date(r.updated_at).toISOString(),
          }));

        const xml = toXml([...STATIC_URLS, ...restaurantUrls]);
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
