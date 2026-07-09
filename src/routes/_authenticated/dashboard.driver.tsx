import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Bike, Clock, MapPin, DollarSign, ClipboardList, Power, Wallet, Navigation } from "lucide-react";
import { toast } from "sonner";
import { LeafletMap, type MapMarker } from "@/components/maps/LeafletMap";
import { useLiveOrders, type ActiveDelivery } from "@/hooks/useLiveOrders";
import { useRoute } from "@/hooks/useRoute";
import { DriverLocationReporter } from "@/components/driver-location-reporter";

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

/** Route + distance/ETA from the driver's last known position to their next stop (restaurant, then client). */
function DeliveryRouteInfo({
  d,
  onRoute,
}: {
  d: ActiveDelivery;
  /** Lifts the polyline up to the parent so it can be drawn on the shared map. */
  onRoute?: (path: [number, number][] | null) => void;
}) {
  const { from, target, headingToPickup } = nextStopFor(d);
  const route = useRoute(from, target);

  useEffect(() => {
    onRoute?.(route.data?.path ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.data]);

  if (!from) return <span className="text-xs text-ink-soft">Aktive pozisyon w pou wè distans/tan</span>;
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

export const Route = createFileRoute("/_authenticated/dashboard/driver")({
  component: DriverDashboard,
});

function DriverDashboard() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: driver, isLoading } = useQuery({
    queryKey: ["me-driver", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const toggle = useMutation({
    mutationFn: async (nextOnline: boolean) => {
      const { error } = await supabase
        .from("drivers")
        .update({ status: nextOnline ? "online" : "offline" })
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me-driver"] });
      toast.success("Estati aktyalize");
    },
    onError: (e) => toast.error(e.message),
  });

  const pending = driver?.status === "pending";
  const online = driver?.status === "online";

  const active = useLiveOrders({ driverId: driver?.id });
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  const markers: MapMarker[] = active.flatMap((d) => {
    const arr: MapMarker[] = [];
    if (d.driver_lat != null && d.driver_lng != null) {
      arr.push({ id: `drv-${d.id}`, lat: Number(d.driver_lat), lng: Number(d.driver_lng), type: "driver", label: "Ou" });
    }
    if (d.order?.restaurants?.lat != null && d.order?.restaurants?.lng != null) {
      arr.push({ id: `rst-${d.id}`, lat: Number(d.order.restaurants.lat), lng: Number(d.order.restaurants.lng), type: "restaurant", label: d.order.restaurants.name ?? "Restoran" });
    }
    if (d.order?.delivery_lat != null && d.order?.delivery_lng != null) {
      arr.push({ id: `dst-${d.id}`, lat: Number(d.order.delivery_lat), lng: Number(d.order.delivery_lng), type: "client", label: d.order.order_number });
    }
    return arr;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Dashboard Livrè</h1>
          <p className="mt-1 text-ink-soft">Jere disponiblite w ak livrezon w yo.</p>
        </div>
        {driver && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
              pending
                ? "bg-amber-100 text-amber-800"
                : online
                ? "bg-emerald-100 text-emerald-800"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {driver.status}
          </span>
        )}
      </div>

      {isLoading && <div className="text-ink-soft">Chajman...</div>}

      {pending && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <Clock className="h-5 w-5" /> Kont ou an atant valdasyon
          </div>
          <p className="mt-1 text-sm text-amber-800">
            Yon administratè ap revize dokiman w yo. Ou p ap ka aksepte livrezon jiskaske ou apwouve.
          </p>
        </div>
      )}

      {!pending && driver && (
        <button
          onClick={() => toggle.mutate(!online)}
          className={`inline-flex items-center gap-2 rounded-full px-5 py-3 font-bold text-white shadow-md transition ${
            online ? "bg-emerald-600 hover:bg-emerald-700" : "bg-brand hover:bg-brand-deep"
          }`}
        >
          <Power className="h-4 w-4" />
          {online ? "Mwen an liy" : "Antre an liy"}
        </button>
      )}

      {!pending && driver && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink">Livrezon aktif</h2>
              <span className="rounded-full bg-brand-soft/60 px-3 py-1 text-xs font-bold text-brand-deep">
                {active.length}
              </span>
            </div>
            <LeafletMap markers={markers} route={routePath ?? undefined} className="h-[380px] w-full rounded-xl" />
          </section>
          <div className="space-y-4">
            <DriverLocationReporter driverId={driver.id} />
            {active.map((d, i) => (
              <div key={d.id} className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
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
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { icon: MapPin, title: "Livrezon disponib", desc: "Pran nouvo livrezon", to: "/dashboard/driver/available" as const },
          { icon: ClipboardList, title: "Livrezon m yo", desc: "Aktyèl ak istwa", to: "/dashboard/driver/history" as const },
          { icon: DollarSign, title: "Revni m yo", desc: "Peman ak komisyon", to: "/dashboard/driver/earnings" as const },
          { icon: Wallet, title: "Peman ak Komisyon", desc: "Nimewo + frekans peman", to: "/dashboard/driver/payouts" as const },
          { icon: Bike, title: "Pwofil livrè", desc: "Modifye enfo w yo", to: "/dashboard/driver/profile" as const },
        ].map((c) => {
          const Icon = c.icon;
          const body = (
            <div key={c.title} className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep">
                <Icon className="h-5 w-5" />
              </div>
              <div className="font-display text-base font-bold text-ink">{c.title}</div>
              <div className="mt-1 text-sm text-ink-soft">{c.desc}</div>
              <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-brand-deep">
                {c.to ? "Ouvri →" : "Byento"}
              </div>
            </div>
          );
          return c.to ? (
            <Link key={c.title} to={c.to} className="block">{body}</Link>
          ) : body;
        })}
      </div>
    </div>
  );
}