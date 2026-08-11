import type { ActiveDelivery } from "@/hooks/useLiveOrders";

/**
 * Pure route/distance/ETA helpers shared by the driver route info badge,
 * the admin live map, and the delivery route fetcher — split out of
 * delivery-route-info.tsx into its own file
 * (react-refresh/only-export-components cleanup, remediation 07) so that
 * component file only exports the component. No behavior change.
 */
export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function formatDuration(s: number) {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}` : `${min} min`;
}

/** Where a delivery is headed next (restaurant while heading to pickup, otherwise the client) and the driver's current position, for route/ETA calculation. */
export function nextStopFor(d: ActiveDelivery) {
  const headingToPickup = d.status === "assigned" || d.status === "en_route_pickup";
  const r = d.order?.restaurants;
  const target = headingToPickup
    ? r?.lat != null && r?.lng != null
      ? { lat: Number(r.lat), lng: Number(r.lng) }
      : undefined
    : d.order?.delivery_lat != null && d.order?.delivery_lng != null
      ? { lat: Number(d.order.delivery_lat), lng: Number(d.order.delivery_lng) }
      : undefined;
  const from =
    d.driver_lat != null && d.driver_lng != null
      ? { lat: Number(d.driver_lat), lng: Number(d.driver_lng) }
      : undefined;
  return { from, target, headingToPickup };
}
