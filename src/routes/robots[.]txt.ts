import { createFileRoute } from "@tanstack/react-router";
import { SITE_URL } from "@/lib/site-config";

const BODY = `User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /admin
Disallow: /api
Disallow: /private
Disallow: /auth
Disallow: /checkout
Disallow: /orders
Disallow: /profile

Sitemap: ${SITE_URL}/sitemap.xml
`;

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(BODY, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=86400",
          },
        }),
    },
  },
});
