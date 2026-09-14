import { useEffect } from "react";
import { Navigation, TriangleAlert } from "lucide-react";
import { useRoute } from "@/hooks/useRoute";
import type { ActiveDelivery } from "@/hooks/useLiveOrders";
import { straightLineMeters, externalDirectionsUrl } from "@/services/routing";
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

  // CHEMEN SEKOU. Anvan, tout sa ki pa yon siksè te bay `return null` — yon
  // livrè k ap kondi pa t wè ANYEN, san yon mo esplikasyon. Sèvis itinerè a
  // se yon depandans ekstèn (wè src/services/routing.ts); lè li tonbe, livrè
  // a dwe kanmenm konnen ki bò pou l ale.
  //
  // Distans a vòl dwazo TOUJOU pi kout pase vrè wout la, donk nou make l
  // « apeprè ». Yon chif ki sanble egzak men ki fo pi mal pase yon apeprè.
  if (route.isError || !route.data) {
    if (!target) return null;
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
        <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-brand-deep" />
        <span>
          Wout la pa disponib — apeprè{" "}
          <strong className="text-ink">{formatDistance(straightLineMeters(from, target))}</strong> a
          vòl dwazo
        </span>
        <a
          href={externalDirectionsUrl(from, target)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-brand-deep underline"
        >
          Louvri nan kat
        </a>
      </span>
    );
  }

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
