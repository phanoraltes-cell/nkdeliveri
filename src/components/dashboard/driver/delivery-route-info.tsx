import { useEffect } from "react";
import { Navigation } from "lucide-react";
import { useRoute } from "@/hooks/useRoute";
import type { ActiveDelivery } from "@/hooks/useLiveOrders";
import { formatDistance, formatDuration, nextStopFor } from "./delivery-route-info.logic";

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
