import { useQuery } from "@tanstack/react-query";
import { getRoute, type RoutePoint } from "@/services/routing";

// ~50m grid so a driver's GPS jitter between pings reuses the same query
// cache entry instead of refetching an almost-identical route every tick.
const round = (n: number) => Math.round(n * 2000) / 2000;

/** Driving route (polyline + distance + duration) between two points via OSRM. Recomputes when either point moves. */
export function useRoute(from: RoutePoint | undefined, to: RoutePoint | undefined) {
  return useQuery({
    queryKey: [
      "route",
      from ? [round(from.lat), round(from.lng)] : null,
      to ? [round(to.lat), round(to.lng)] : null,
    ],
    queryFn: () => getRoute(from!, to!),
    enabled: !!from && !!to,
    staleTime: 60_000,
    retry: 1,
  });
}
