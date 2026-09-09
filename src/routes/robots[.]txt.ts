import { createFileRoute } from "@tanstack/react-router";
import { SITE_URL } from "@/lib/site-config";
import { PRIVATE_PATH_PREFIXES } from "@/lib/private-paths";

/**
 * `robots.txt` — jenere depi `PRIVATE_PATH_PREFIXES`, pa ekri alamen.
 *
 * Anvan, lis `Disallow` la te tape alamen isit la. Sa vle di li te ka
 * dekale an silans ak vrè lis paj prive yo — ajoute yon nouvo seksyon
 * prive san mete l isit epi Google ta endekse l. Kounye a gen yon sèl sous
 * verite, epi antèt `X-Robots-Tag` nan `src/server.ts` la sèvi ak MENM lis
 * la.
 *
 * ---------------------------------------------------------------------------
 * POUKISA GEN TWA GWOUP OLYE YON SÈL
 *
 * Cloudflare enjekte yon blòk "managed content" ANWO fichye sa a, epi blòk
 * sa a genyen pwòp gwoup `User-agent: *` pa l ak `Allow: /`. Rezilta:
 * `/robots.txt` gen DE gwoup `User-agent: *`.
 *
 * Google dokimante li fizyone gwoup ki gen menm user-agent, donk pou
 * Googlebot règ nou yo aplike kanmenm. Men se pa tout robo ki fè sa: yon
 * enplemantasyon ki pran PREMYE gwoup ki matche a sèlman ap wè `Allow: /`
 * san okenn `Disallow`.
 *
 * Yon gwoup ki nonmen `Googlebot` ak youn ki nonmen `Bingbot` pi espesifik
 * pase `*`, donk yo pran priyorite san okenn anbigwite sou fizyon. De
 * moteur sa yo se sa ki konte pou mache a; pou tout lòt, antèt
 * `X-Robots-Tag` la se gadfou a.
 */

const DISALLOW_BLOCK = PRIVATE_PATH_PREFIXES.map((p) => `Disallow: ${p}`).join("\n");

const GROUP = (userAgent: string) => `User-agent: ${userAgent}
Allow: /
${DISALLOW_BLOCK}`;

const BODY = `${GROUP("Googlebot")}

${GROUP("Bingbot")}

${GROUP("*")}

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
