import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Bike,
  Clock,
  MapPin,
  DollarSign,
  ClipboardList,
  Power,
  Wallet,
  Navigation,
  Package,
  CheckCircle2,
  Star,
  MessageSquareText,
} from "lucide-react";
import { toast } from "sonner";
import type { MapMarker } from "@/components/maps/LeafletMap";
import { useLiveOrders, type ActiveDelivery } from "@/hooks/useLiveOrders";
import { useRoute } from "@/hooks/useRoute";
import { DriverLocationReporter } from "@/components/driver-location-reporter";
import { formatHTG } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable } from "@/components/dashboard/tables/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { useWeeklySeries } from "@/hooks/useWeeklySeries";

// See dashboard.admin.index.tsx for why these are lazy: leaflet/recharts
// are only needed once this page has mounted.
const LeafletMap = lazy(() =>
  import("@/components/maps/LeafletMap").then((m) => ({ default: m.LeafletMap })),
);
const RevenueChart = lazy(() =>
  import("@/components/dashboard/charts/revenue-chart").then((m) => ({ default: m.RevenueChart })),
);

type ReviewRow = {
  id: string;
  driver_rating: number | null;
  comment: string | null;
  created_at: string;
};

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

export const Route = createFileRoute("/_authenticated/dashboard/driver/")({
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

  const driverStats = useQuery({
    queryKey: ["driver-stats", driver?.id],
    enabled: !!driver?.id,
    queryFn: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const [todayRes, totalRes] = await Promise.all([
        supabase
          .from("deliveries")
          .select("fee")
          .eq("driver_id", driver!.id)
          .eq("status", "delivered")
          .gte("delivered_at", since.toISOString()),
        supabase
          .from("deliveries")
          .select("id", { head: true, count: "exact" })
          .eq("driver_id", driver!.id)
          .eq("status", "delivered"),
      ]);
      if (todayRes.error) throw todayRes.error;
      if (totalRes.error) throw totalRes.error;
      return {
        deliveriesToday: todayRes.data?.length ?? 0,
        revenueToday: (todayRes.data ?? []).reduce((sum, d) => sum + Number(d.fee), 0),
        totalDeliveries: totalRes.count ?? 0,
      };
    },
  });

  const weeklyEarnings = useWeeklySeries(
    ["driver-weekly-earnings", driver?.id],
    async (since) => {
      const { data, error } = await supabase
        .from("deliveries")
        .select("fee, delivered_at")
        .eq("driver_id", driver!.id)
        .eq("status", "delivered")
        .gte("delivered_at", since.toISOString());
      if (error) throw error;
      return data ?? [];
    },
    (row) => ({ date: row.delivered_at, value: Number(row.fee) }),
    { enabled: !!driver?.id },
  );

  const reviews = useQuery({
    queryKey: ["driver-reviews", driver?.id],
    enabled: !!driver?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("reviews")
        .select("id, driver_rating, comment, created_at")
        .eq("driver_id", driver!.id)
        .not("driver_rating", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ReviewRow[];
    },
  });
  const avgRating = reviews.data?.length
    ? reviews.data.reduce((sum, r) => sum + (r.driver_rating ?? 0), 0) / reviews.data.length
    : null;
  const recentReviews = reviews.data?.slice(0, 5) ?? [];

  const active = useLiveOrders({ driverId: driver?.id });
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  const markers: MapMarker[] = active.flatMap((d) => {
    const arr: MapMarker[] = [];
    if (d.driver_lat != null && d.driver_lng != null) {
      arr.push({
        id: `drv-${d.id}`,
        lat: Number(d.driver_lat),
        lng: Number(d.driver_lng),
        type: "driver",
        label: "Ou",
      });
    }
    if (d.order?.restaurants?.lat != null && d.order?.restaurants?.lng != null) {
      arr.push({
        id: `rst-${d.id}`,
        lat: Number(d.order.restaurants.lat),
        lng: Number(d.order.restaurants.lng),
        type: "restaurant",
        label: d.order.restaurants.name ?? "Restoran",
      });
    }
    if (d.order?.delivery_lat != null && d.order?.delivery_lng != null) {
      arr.push({
        id: `dst-${d.id}`,
        lat: Number(d.order.delivery_lat),
        lng: Number(d.order.delivery_lng),
        type: "client",
        label: d.order.order_number,
      });
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
          <StatusBadge
            tone={pending ? "warn" : online ? "good" : "neutral"}
            className="px-3 py-1 text-xs"
          >
            {driver.status}
          </StatusBadge>
        )}
      </div>

      {isLoading && <div className="text-ink-soft">Chajman...</div>}

      {pending && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <Clock className="h-5 w-5" /> Kont ou an atant valdasyon
          </div>
          <p className="mt-1 text-sm text-amber-800">
            Yon administratè ap revize dokiman w yo. Ou p ap ka aksepte livrezon jiskaske ou
            apwouve.
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Livrezon jodi a"
            value={driverStats.data?.deliveriesToday ?? "—"}
            icon={Package}
          />
          <KpiCard
            label="Total livrezon"
            value={driverStats.data?.totalDeliveries ?? "—"}
            icon={CheckCircle2}
          />
          <KpiCard
            label="Revni jodi a"
            value={driverStats.data ? formatHTG(driverStats.data.revenueToday) : "—"}
            icon={Wallet}
          />
          <KpiCard
            label="Nòt mwayèn"
            value={avgRating != null ? `${avgRating.toFixed(1)} / 5` : "—"}
            icon={Star}
          />
        </div>
      )}

      {!pending && driver && (
        <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">Revni 7 dènye jou</h2>
          {weeklyEarnings.isLoading ? (
            <div className="text-sm text-ink-soft">Chajman…</div>
          ) : (
            <Suspense fallback={<Skeleton className="h-[240px] w-full rounded-xl" />}>
              <RevenueChart data={weeklyEarnings.data ?? []} formatValue={formatHTG} />
            </Suspense>
          )}
        </section>
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
            <Suspense
              fallback={
                <Skeleton className="h-[240px] w-full rounded-xl sm:h-[320px] lg:h-[380px]" />
              }
            >
              <LeafletMap
                markers={markers}
                route={routePath ?? undefined}
                className="h-[240px] sm:h-[320px] lg:h-[380px] w-full rounded-xl"
              />
            </Suspense>
          </section>
          <div className="space-y-4">
            <DriverLocationReporter driverId={driver.id} />
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
      )}

      {!pending && driver && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
            <MessageSquareText className="h-5 w-5 text-brand-deep" /> Dènye avi
          </h2>
          <DataTable<ReviewRow>
            rows={recentReviews}
            getRowKey={(r) => r.id}
            mobileTitleKey="driver_rating"
            emptyState={
              <EmptyState
                icon={Star}
                title="Poko gen avi"
                description="Nòt ak kòmantè kliyan yo ap parèt isit la."
              />
            }
            columns={[
              { key: "driver_rating", header: "Nòt", cell: (r) => `${r.driver_rating} / 5` },
              { key: "comment", header: "Kòmantè", cell: (r) => r.comment || "—" },
              {
                key: "date",
                header: "Dat",
                cell: (r) => new Date(r.created_at).toLocaleDateString("fr-HT"),
                hideOnMobileCard: true,
              },
            ]}
          />
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            icon: MapPin,
            title: "Livrezon disponib",
            desc: "Pran nouvo livrezon",
            to: "/dashboard/driver/available" as const,
          },
          {
            icon: ClipboardList,
            title: "Livrezon m yo",
            desc: "Aktyèl ak istwa",
            to: "/dashboard/driver/history" as const,
          },
          {
            icon: DollarSign,
            title: "Revni m yo",
            desc: "Peman ak komisyon",
            to: "/dashboard/driver/earnings" as const,
          },
          {
            icon: Wallet,
            title: "Peman ak Komisyon",
            desc: "Nimewo + frekans peman",
            to: "/dashboard/driver/payouts" as const,
          },
          {
            icon: Bike,
            title: "Pwofil livrè",
            desc: "Modifye enfo w yo",
            to: "/dashboard/driver/profile" as const,
          },
        ].map((c) => {
          const Icon = c.icon;
          const body = (
            <div
              key={c.title}
              className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm"
            >
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
            <Link key={c.title} to={c.to} className="block">
              {body}
            </Link>
          ) : (
            body
          );
        })}
      </div>
    </div>
  );
}
