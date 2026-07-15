import { Suspense, lazy } from "react";
import { Navigation } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { MapMarker } from "@/components/maps/LeafletMap";
import type { ActiveDelivery } from "@/hooks/useLiveOrders";
import type { useRoute } from "@/hooks/useRoute";

// See dashboard.admin.index.tsx for why this is lazy: leaflet (~150KB) is
// only needed once this section has mounted.
const LeafletMap = lazy(() =>
  import("@/components/maps/LeafletMap").then((m) => ({ default: m.LeafletMap })),
);

type DeliveryTrackingSectionProps = {
  delivery: ActiveDelivery;
  markers: MapMarker[];
  route: ReturnType<typeof useRoute>;
  headingToPickup: boolean;
};

/** Order-detail page's live tracking card: driver/restaurant/client map + distance/ETA to the next stop. */
export function DeliveryTrackingSection({
  delivery,
  markers,
  route,
  headingToPickup,
}: DeliveryTrackingSectionProps) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(194,90,5,0.08)]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-display text-base font-bold">Swiv livrezon w</div>
          {delivery.location_updated_at && (
            <div className="text-xs text-ink-soft">
              Dènye mizajou: {new Date(delivery.location_updated_at).toLocaleTimeString()}
            </div>
          )}
        </div>
        <span className="rounded-full bg-brand-soft/60 px-3 py-1 text-xs font-bold text-brand-deep">
          {delivery.status}
        </span>
      </div>
      <Suspense fallback={<Skeleton className="h-[320px] w-full rounded-xl" />}>
        <LeafletMap
          markers={markers}
          route={route.data?.path}
          className="h-[320px] w-full rounded-xl"
        />
      </Suspense>
      {route.data && (
        <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-brand-deep">
          <Navigation className="h-3.5 w-3.5" />
          {(route.data.distanceMeters / 1000).toFixed(1)} km ·{" "}
          {Math.round(route.data.durationSeconds / 60)} min{" "}
          <span className="font-normal text-ink-soft">
            {headingToPickup ? "jiska restoran" : "jiska ou"}
          </span>
        </div>
      )}
    </div>
  );
}
