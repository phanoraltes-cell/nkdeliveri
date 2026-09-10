import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";

import appCss from "../styles.css?url";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { registerPWA } from "@/lib/pwa-register";
import { AuthProvider } from "@/hooks/useAuth";
import { InstallPrompt } from "@/components/install-prompt";
import { PopupAdModal } from "@/components/ads/popup-ad-modal";
import { BottomNav } from "@/components/bottom-nav";
import { SITE_URL, SITE_NAME, PRIMARY_CITY, absoluteUrl } from "@/lib/site-config";
import { jsonLdScript } from "@/lib/seo";

// Refonte Frontend Premium, Phase 8 (P8) — sentry-browser.ts (and the
// @sentry/react SDK it pulls in) used to be a static import here, which
// put it in the shared app-shell chunk loaded on *every* page before
// first paint, whether or not that page ever errors. A dynamic import
// fetches it after mount instead — error reporting only needs to be
// *ready* shortly after the page is already visible, not block getting
// there. Both call sites below share this one loader so the module (and
// its internal `initialized` guard in sentry-browser.ts) is only ever
// fetched/evaluated once per session.
function loadSentry() {
  return import("@/lib/sentry-browser");
}

function NotFoundComponent() {
  // The route match here never resolves to a real route, so there's no
  // head() to hook into — the actual "don't index this" signal is the 404
  // HTTP status TanStack Router already sends (confirmed: crawlers respect
  // that over any meta tag). This just fixes the client-visible title/copy,
  // which was still in English while the rest of the app is in Kreyòl.
  useEffect(() => {
    // Menm rezònman ak ErrorComponent: estati 404 la se sinyal prensipal
    // la, men Googlebot egzekite JS, donk nou ranfòse l nan tit la ak nan
    // balis robots la tou. Non mak la retire — yon paj « pa jwenn » pa dwe
    // ka parèt nan yon rezilta rechèch ak non mak la ladan l.
    document.title = "Paj la pa jwenn (404)";

    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    robots.setAttribute("content", "noindex, nofollow");

    document.querySelector('link[rel="canonical"]')?.remove();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="max-w-md text-center">
        <img
          src="/nk-logo.png"
          alt=""
          aria-hidden="true"
          width={56}
          height={56}
          className="mx-auto mb-4 h-14 w-14 rounded-full"
        />
        {/* Decorative — the actual heading below ("Paj la pa jwenn") is what
            a screen reader user needs; "404" restated as an h1 would be
            redundant with it. */}
        <div aria-hidden="true" className="font-display text-7xl font-extrabold text-brand">
          404
        </div>
        <h1 className="mt-3 font-display text-xl font-extrabold text-ink">Paj la pa jwenn</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Paj w ap chèche a pa egziste ankò, oswa li chanje plas.
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link to="/">Retounen lakay</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  void loadSentry().then((m) => m.captureExceptionClient(error));
  const router = useRouter();
  useEffect(() => {
    // SE ISIT LA BUG LA TE YE. Ansyen tit la te « Yon erè rive — NK
    // Deliveri », epi Googlebot EGZEKITE JavaScript pandan faz rann li an:
    // li te wè tit sa a, li te endekse l kòm tit dakèy la, epi rezilta
    // rechèch la te di « Yon erè rive — NK Deliveri ».
    //
    // Twa koreksyon, tout twa nan menm mekanis ki te lakòz pwoblèm nan —
    // paske se mekanis sa a robo a wè:
    //   1. Tit SAN NON MAK LA. Menm si yon paj erè endekse ankò, non
    //      « NK Deliveri » pa ka parèt nan yon rezilta rechèch.
    //   2. `noindex, nofollow` — Google respekte yon balis robots yon
    //      script ajoute pandan rann lan.
    //   3. Retire `canonical` la. Yon paj erè ki deklare dakèy la kòm
    //      kanonik li ap mande Google endekse kontni erè a SOU URL dakèy
    //      la — egzakteman sa ki te pase.
    document.title = "Erè — paj la pa disponib";

    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.setAttribute("name", "robots");
      document.head.appendChild(robots);
    }
    robots.setAttribute("content", "noindex, nofollow");

    document.querySelector('link[rel="canonical"]')?.remove();
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="max-w-md text-center">
        <img
          src="/nk-logo.png"
          alt=""
          aria-hidden="true"
          width={56}
          height={56}
          className="mx-auto mb-4 h-14 w-14 rounded-full"
        />
        <h1 className="font-display text-xl font-extrabold text-ink">Paj sa a pa t chaje</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Gen yon bagay ki mal pase bò kote nou. Ou ka eseye rafrechi oswa retounen lakay.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Eseye ankò
          </Button>
          <Button variant="outline" asChild>
            <a href="/">Retounen lakay</a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "NK Deliveri — Manje lakay, livre lakay ou" },
      {
        name: "description",
        content:
          "NK Deliveri se platfòm livrezon manje Gonaïves, Ayiti. Kòmande manje nan meyè restoran yo epi resevwa l lakay ou. Peman ak MonCash, NatCash oswa kach.",
      },
      { name: "author", content: "NK Deliveri" },
      // Sensible default for any route that forgets to set its own — pages
      // that shouldn't be indexed (dashboard, auth, checkout, orders,
      // profile) explicitly override this to noindex via lib/seo.ts.
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "NK Deliveri — Manje lakay, livre lakay ou" },
      {
        property: "og:description",
        content: "Livrezon manje nan Gonaïves, Ayiti. MonCash, NatCash, Kach.",
      },
      { property: "og:url", content: SITE_URL },
      { property: "og:type", content: "website" },
      // SEO brand-authority audit — the constant site/brand name, distinct
      // from og:title (which varies per page via lib/seo.ts's pageMeta()).
      // Missing before: Facebook/LinkedIn/etc. link previews had no
      // explicit signal for which *site* a shared page belonged to.
      { property: "og:site_name", content: SITE_NAME },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#F97316" },
      { name: "application-name", content: "NK Deliveri" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "NK Deliveri" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "twitter:title", content: "NK Deliveri — Manje lakay, livre lakay ou" },
      {
        name: "twitter:description",
        content: "Livrezon manje nan Gonaïves, Ayiti. MonCash, NatCash, Kach.",
      },
      { property: "og:image", content: absoluteUrl("/nk-logo.png") },
      { name: "twitter:image", content: absoluteUrl("/nk-logo.png") },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      // No default canonical here on purpose: TanStack Router appends child
      // route `links` rather than deduping by `rel`, so a root-level
      // canonical would render alongside every page's own canonical as two
      // conflicting <link rel="canonical"> tags. Each indexable page sets
      // its own via lib/seo.ts's pageMeta().
    ],
    scripts: [
      jsonLdScript({
        "@context": "https://schema.org",
        "@type": "Organization",
        name: SITE_NAME,
        // SEO brand-authority audit — schema.org's sanctioned way to tell
        // Google "this same entity is also searched as X" without
        // claiming X is the official name (`name` above stays "NK
        // Deliveri", unchanged). Addresses the "NK Delivery" ⇄
        // "NK Deliveri" spelling-suggestion behavior at the structured-
        // data level — this can't force Google's spell-check UI to stop
        // suggesting the alternate spelling (no on-site signal can), but
        // it is a real, non-manipulative signal that both strings name
        // the same organization.
        alternateName: "NK Delivery",
        description:
          "NK Deliveri se platfòm livrezon manje nan Gonaïves, Ayiti — chwazi yon restoran, kòmande, epi resevwa manje w lakay ou.",
        url: SITE_URL,
        logo: absoluteUrl("/nk-logo.png"),
        areaServed: { "@type": "City", name: PRIMARY_CITY.name },
        // No `sameAs` — deliberately omitted rather than populated with
        // invented URLs. site-config.ts's SOCIAL_LINKS is empty because
        // no official NK Deliveri social profile exists yet; add both
        // together the day one does (see docs/archive/misc/SEO_BRAND_AUTHORITY_NK_DELIVERI.md).
      }),
      jsonLdScript({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: SITE_URL,
        // Real, working search — /restaurants?q= is the actual
        // server-side filter used by restaurants.index.tsx (validated
        // via its own searchSchema), not a hypothetical capability
        // described for schema-enrichment's sake.
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_URL}/restaurants?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      }),
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ht">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    void registerPWA();
  }, []);

  useEffect(() => {
    // useEffect never runs during SSR, so this is inherently client-only —
    // no extra `typeof window` guard needed on top of it.
    void loadSentry().then((m) => m.initSentryClient());
  }, []);

  return (
    // AuthProvider lives inside QueryClientProvider (not outside) because it
    // now needs useQueryClient()/useRouter() itself to invalidate the
    // router/query cache on sign-in/out — that used to be a second, separate
    // onAuthStateChange subscription here in RootComponent; it's folded into
    // AuthProvider's own listener now, so there is exactly one for the
    // whole app.
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Framer Motion never checks the OS "reduce motion" preference on its
            own — the CSS rule in styles.css only shortens real CSS
            transitions/animations, not Framer Motion's JS-driven opacity/
            transform animations. Without this, every `initial={{opacity:0}}`
            section (hero, "Kijan li travay", etc.) starts invisible and stays
            that way for anyone with reduce-motion enabled unless Framer
            Motion's own animation actually runs it to completion. `"user"`
            makes every motion component here respect that OS setting by
            applying the end state instantly instead of animating. */}
        <MotionConfig reducedMotion="user">
          <Outlet />
          <BottomNav />
          <Toaster
            position="bottom-center"
            richColors
            offset={{ bottom: "calc(4rem + var(--sab) + 1rem)" }}
            mobileOffset={{ bottom: "calc(4rem + var(--sab) + 1rem)" }}
          />
          <InstallPrompt />
          <PopupAdModal />
        </MotionConfig>
      </AuthProvider>
    </QueryClientProvider>
  );
}
