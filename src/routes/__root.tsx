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
import { Toaster } from "@/components/ui/sonner";
import { registerPWA } from "@/lib/pwa-register";
import { AuthProvider } from "@/hooks/useAuth";
import { InstallPrompt } from "@/components/install-prompt";
import { BottomNav } from "@/components/bottom-nav";
import { SITE_URL, SITE_NAME, PRIMARY_CITY, absoluteUrl } from "@/lib/site-config";
import { jsonLdScript } from "@/lib/seo";
import { initSentryClient, captureExceptionClient } from "@/lib/sentry-browser";

function NotFoundComponent() {
  // The route match here never resolves to a real route, so there's no
  // head() to hook into — the actual "don't index this" signal is the 404
  // HTTP status TanStack Router already sends (confirmed: crawlers respect
  // that over any meta tag). This just fixes the client-visible title/copy,
  // which was still in English while the rest of the app is in Kreyòl.
  useEffect(() => {
    document.title = "Paj la pa jwenn (404) — NK Deliveri";
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Paj la pa jwenn</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Paj w ap chèche a pa egziste ankò, oswa li chanje plas.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Retounen lakay
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  captureExceptionClient(error);
  const router = useRouter();
  useEffect(() => {
    document.title = "Yon erè rive — NK Deliveri";
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Paj sa a pa t chaje
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Gen yon bagay ki mal pase bò kote nou. Ou ka eseye rafrechi oswa retounen lakay.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Eseye ankò
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Retounen lakay
          </a>
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
          "Kòmande manje nan meyè restoran nan Gonaïves epi resevwa l lakay ou. Peman ak MonCash, NatCash oswa kach.",
      },
      { name: "author", content: "NK Deliveri" },
      // Sensible default for any route that forgets to set its own — pages
      // that shouldn't be indexed (dashboard, auth, checkout, orders,
      // profile) explicitly override this to noindex via lib/seo.ts.
      { name: "robots", content: "index, follow" },
      { property: "og:title", content: "NK Deliveri — Manje lakay, livre lakay ou" },
      {
        property: "og:description",
        content: "Livrezon manje nan Gonaïves. MonCash, NatCash, Kach.",
      },
      { property: "og:url", content: SITE_URL },
      { property: "og:type", content: "website" },
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
        content: "Livrezon manje nan Gonaïves. MonCash, NatCash, Kach.",
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
        url: SITE_URL,
        logo: absoluteUrl("/nk-logo.png"),
        areaServed: { "@type": "City", name: PRIMARY_CITY.name },
      }),
      jsonLdScript({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: SITE_URL,
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
    initSentryClient();
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
        </MotionConfig>
      </AuthProvider>
    </QueryClientProvider>
  );
}
