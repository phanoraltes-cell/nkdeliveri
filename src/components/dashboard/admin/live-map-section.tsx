import { Suspense, lazy, useMemo, useState } from "react";
import { Navigation, MessageCircle } from "lucide-react";
import type { MapMarker, MapRoute } from "@/components/maps/LeafletMap";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DELIVERY_STATUS_LABEL } from "@/lib/delivery-status";
import { CHAT_OPEN_STATUSES } from "@/lib/order-status";
import type { ActiveDelivery } from "@/hooks/useLiveOrders";
import {
  DeliveryRouteFetcher,
  type DeliveryRouteResult,
} from "@/components/dashboard/admin/delivery-route-fetcher";
import { formatDistance, formatDuration } from "@/components/dashboard/driver/delivery-route-info";
import { OrderChatThread } from "@/components/order/order-chat-thread";

// See dashboard.admin.index.tsx for why this is lazy: leaflet (~150KB) is
// only needed once this section has mounted.
const LeafletMap = lazy(() =>
  import("@/components/maps/LeafletMap").then((m) => ({ default: m.LeafletMap })),
);

// A live route/ETA per delivery means one OSRM request per delivery
// (useRoute can't batch across a loop) — fine for a single-city fleet, but
// capped so a runaway "active deliveries" count can never turn one admin
// page load into dozens of simultaneous routing requests.
const MAX_LIVE_ROUTES = 20;

type LiveMapSectionProps = {
  markers: MapMarker[];
  activeDeliveries: ActiveDelivery[];
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

/** The admin dashboard's "Kat an tan reyèl" card: filters + live Leaflet map (with per-delivery routes) + ETA list + legend. */
export function LiveMapSection({
  markers,
  activeDeliveries,
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
  const [routeResults, setRouteResults] = useState<Record<string, DeliveryRouteResult>>({});
  const [chatDelivery, setChatDelivery] = useState<ActiveDelivery | null>(null);
  const routedDeliveries = activeDeliveries.slice(0, MAX_LIVE_ROUTES);

  const routes: MapRoute[] = useMemo(
    () =>
      routedDeliveries
        .map((d) => {
          const r = routeResults[d.id];
          return r?.path ? { id: d.id, path: r.path } : null;
        })
        .filter((r): r is MapRoute => r != null),
    [routedDeliveries, routeResults],
  );
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
          aria-label="Filtre pa estati"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
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
          aria-label="Filtre pa restoran"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
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
          aria-label="Chèche yon zòn/adrès…"
          className="min-w-0 flex-1 rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        />
      </div>

      {routedDeliveries.map((d) => (
        <DeliveryRouteFetcher
          key={d.id}
          delivery={d}
          onRoute={(id, result) => setRouteResults((prev) => ({ ...prev, [id]: result }))}
        />
      ))}

      <Suspense
        fallback={<Skeleton className="h-[260px] w-full rounded-xl sm:h-[340px] lg:h-[420px]" />}
      >
        <LeafletMap
          markers={markers}
          routes={routes}
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
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-brand" /> Wout an tan reyèl
        </span>
      </div>

      {routedDeliveries.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {routedDeliveries.map((d) => {
            const r = routeResults[d.id];
            return (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-soft/20 px-3 py-2 text-xs"
              >
                <span className="font-semibold text-ink">
                  {d.order?.order_number ?? "—"}{" "}
                  <span className="font-normal text-ink-soft">
                    · {DELIVERY_STATUS_LABEL[d.status] ?? d.status}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {r?.isLoading && <span className="text-ink-soft">Ap kalkile…</span>}
                  {!r?.isLoading && r?.distanceMeters != null && r?.durationSeconds != null && (
                    <span className="inline-flex items-center gap-1 font-bold text-brand-deep">
                      <Navigation className="h-3 w-3" />
                      {formatDistance(r.distanceMeters)} · {formatDuration(r.durationSeconds)}
                    </span>
                  )}
                  {!r?.isLoading && r?.path == null && (
                    <span className="text-ink-soft">Pa gen pozisyon</span>
                  )}
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="Chat"
                    onClick={() => setChatDelivery(d)}
                  >
                    <MessageCircle className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!chatDelivery} onOpenChange={(open) => !open && setChatDelivery(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chat — {chatDelivery?.order?.order_number}</DialogTitle>
          </DialogHeader>
          {chatDelivery && (
            <OrderChatThread
              orderId={chatDelivery.order_id}
              isOpen={
                !!chatDelivery.order?.status && CHAT_OPEN_STATUSES.has(chatDelivery.order.status)
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
