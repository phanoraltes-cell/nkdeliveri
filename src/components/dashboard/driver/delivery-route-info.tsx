import { useEffect } from "react";
import { Navigation } from "lucide-react";
import { useRoute } from "@/hooks/useRoute";
import type { ActiveDelivery } from "@/hooks/useLiveOrders";

function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function formatDuration(s: number) {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}` : `${min} min`;
}

function nextStopFor(d: ActiveDelivery) {
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

type DeliveryRouteInfoProps = {
  d: ActiveDelivery;
  /** Lifts the polyline up to the parent so it can be drawn on the shared map. */
  onRoute?: (path: [number, number][] | null) => void;
};

/** Route + distance/ETA from the driver's last known position to their next stop (restaurant, then client). */
export function DeliveryRouteInfo({ d, onRoute }: DeliveryRouteInfoProps) {
  const { from, target, headingToPickup } = nextStopFor(d);
  const route = useRoute(from, target);

  useEffect(() => {
    onRoute?.(route.data?.path ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.data]);

  if (!from)
    return <span className="text-xs text-ink-soft">Aktive pozisyon w pou wè distans/tan</span>;
  if (route.isLoading) return <span className="text-xs text-ink-soft">Ap kalkile wout…</span>;
  if (!route.data) return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-deep">
      <Navigation className="h-3.5 w-3.5" />
      {formatDistance(route.data.distanceMeters)} · {formatDuration(route.data.durationSeconds)}
      <span className="font-normal text-ink-soft">
        {headingToPickup ? "jiska restoran" : "jiska kliyan"}
      </span>
    </span>
  );
}
