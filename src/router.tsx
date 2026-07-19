import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { getGlobalStartContext } from "@tanstack/react-start";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // The default (0) makes every query refetch on every mount, even
        // when nothing has changed — e.g. navigating back to a dashboard
        // tab re-fetches everything it just fetched 5 seconds ago. Data
        // that actually needs to be live (orders, deliveries, driver
        // locations, notifications) is already kept fresh via explicit
        // Supabase Realtime invalidation (see useLiveOrders.ts and
        // dashboard-header.tsx) and mutation onSuccess invalidation, both
        // of which force a refetch immediately regardless of staleTime —
        // so this only cuts the redundant background refetches, not the
        // real-time ones.
        staleTime: 30_000,
      },
    },
  });

  // Per-request CSP nonce (generated in src/server.ts and passed down as
  // request context — see BaseContext.nonce in @tanstack/start-server-core).
  // Threading it into `ssr.nonce` here is what makes every inline script
  // TanStack Start emits — the hydration data script (ssr-server.ts) and the
  // JSON-LD blocks from __root.tsx's head() — carry a nonce matching the CSP
  // header, instead of the app needing script-src 'unsafe-inline'.
  // getGlobalStartContext() is isomorphic (returns undefined on the client)
  // so this is safe to call unconditionally, unlike importing
  // "@tanstack/react-start/server" directly, which TanStack Start's build
  // plugin statically rejects from any client-reachable file.
  let nonce: string | undefined;
  try {
    nonce = (getGlobalStartContext() as { nonce?: string } | undefined)?.nonce;
  } catch {
    // getGlobalStartContext() throws if called before global middlewares
    // have run — shouldn't happen for a normal request, but router creation
    // must never fail just because a nonce isn't available yet.
  }

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    ssr: nonce ? { nonce } : undefined,
  });

  return router;
};
