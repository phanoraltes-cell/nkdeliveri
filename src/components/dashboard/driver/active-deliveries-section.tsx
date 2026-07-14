import { Suspense, lazy, useState } from "react";
import type { MapMarker } from "@/components/maps/LeafletMap";
import { Skeleton } from "@/components/ui/skeleton";
import { DriverLocationReporter } from "@/components/driver-location-reporter";
import { DeliveryRouteInfo } from "@/components/dashboard/driver/delivery-route-info";
import type { ActiveDelivery } from "@/hooks/useLiveOrders";

// See dashboard.admin.index.tsx for why this is lazy: leaflet (~150KB) is
// only needed once this section has mounted.
const LeafletMap = lazy(() =>
  import("@/components/maps/LeafletMap").then((m) => ({ default: m.LeafletMap })),
);

type ActiveDeliveriesSectionProps = {
  driverId: string;
  active: ActiveDelivery[];
  markers: MapMarker[];
};

/** Driver dashboard's "Livrezon aktif" card: shared live map + per-delivery route/ETA list. */
export function ActiveDeliveriesSection({
  driverId,
  active,
  markers,
}: ActiveDeliveriesSectionProps) {
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Livrezon aktif</h2>
          <span className="rounded-full bg-brand-soft/60 px-3 py-1 text-xs font-bold text-brand-deep">
            {active.length}
          </span>
        </div>
        <Suspense
          fallback={<Skeleton className="h-[240px] w-full rounded-xl sm:h-[320px] lg:h-[380px]" />}
        >
          <LeafletMap
            markers={markers}
            route={routePath ?? undefined}
            className="h-[240px] sm:h-[320px] lg:h-[380px] w-full rounded-xl"
          />
        </Suspense>
      </section>
      <div className="space-y-4">
        <DriverLocationReporter driverId={driverId} />
        {active.map((d, i) => (
          <div
            key={d.id}
            className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
          >
            <div className="text-xs uppercase tracking-wider text-ink-soft">{d.status}</div>
            <div className="font-bold text-ink">{d.order?.order_number}</div>
            <div className="text-xs text-ink-soft">{d.order?.delivery_address}</div>
            <div className="mt-2">
              <DeliveryRouteInfo d={d} onRoute={i === 0 ? setRoutePath : undefined} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
