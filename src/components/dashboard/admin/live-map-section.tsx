import { Suspense, lazy } from "react";
import type { MapMarker } from "@/components/maps/LeafletMap";
import { Skeleton } from "@/components/ui/skeleton";
import { DELIVERY_STATUS_LABEL } from "@/lib/delivery-status";

// See dashboard.admin.index.tsx for why this is lazy: leaflet (~150KB) is
// only needed once this section has mounted.
const LeafletMap = lazy(() =>
  import("@/components/maps/LeafletMap").then((m) => ({ default: m.LeafletMap })),
);

type LiveMapSectionProps = {
  markers: MapMarker[];
  onlineDriverCount: number;
  activeDeliveryCount: number;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  restaurantFilter: string;
  onRestaurantFilterChange: (value: string) => void;
  restaurantOptions: string[];
  zoneQuery: string;
  onZoneQueryChange: (value: string) => void;
};

/** The admin dashboard's "Kat an tan reyèl" card: filters + live Leaflet map + legend. */
export function LiveMapSection({
  markers,
  onlineDriverCount,
  activeDeliveryCount,
  statusFilter,
  onStatusFilterChange,
  restaurantFilter,
  onRestaurantFilterChange,
  restaurantOptions,
  zoneQuery,
  onZoneQueryChange,
}: LiveMapSectionProps) {
  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-bold text-ink">Kat an tan reyèl</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
            {onlineDriverCount} livrè aktif
          </span>
          <span className="rounded-full bg-brand-soft/60 px-3 py-1 text-xs font-bold text-brand-deep">
            {activeDeliveryCount} livrezon an kou
          </span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand"
        >
          <option value="all">Tout estati</option>
          {Object.entries(DELIVERY_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={restaurantFilter}
          onChange={(e) => onRestaurantFilterChange(e.target.value)}
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand"
        >
          <option value="all">Tout restoran</option>
          {restaurantOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          value={zoneQuery}
          onChange={(e) => onZoneQueryChange(e.target.value)}
          placeholder="Chèche yon zòn/adrès…"
          className="min-w-[160px] flex-1 rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs outline-none focus:border-brand"
        />
      </div>

      <Suspense
        fallback={<Skeleton className="h-[260px] w-full rounded-xl sm:h-[340px] lg:h-[420px]" />}
      >
        <LeafletMap
          markers={markers}
          className="h-[260px] sm:h-[340px] lg:h-[420px] w-full rounded-xl"
        />
      </Suspense>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> Restoran
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Livrè
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Adrès kliyan
        </span>
      </div>
    </section>
  );
}
