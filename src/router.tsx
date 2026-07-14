import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
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

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
