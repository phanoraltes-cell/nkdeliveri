import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
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
  Package,
  CheckCircle2,
  Star,
  MessageSquareText,
} from "lucide-react";
import { toast } from "sonner";
import type { MapMarker } from "@/components/maps/LeafletMap";
import { useLiveOrders } from "@/hooks/useLiveOrders";
import { formatHTG } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable } from "@/components/dashboard/tables/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { DashboardShortcutGrid } from "@/components/dashboard/dashboard-shortcut-grid";
import { ActiveDeliveriesSection } from "@/components/dashboard/driver/active-deliveries-section";
import { useWeeklySeries } from "@/hooks/useWeeklySeries";

// recharts (~350KB) is only needed once this page has mounted. (LeafletMap
// is lazy too, but that import now lives inside ActiveDeliveriesSection,
// which owns the whole "Livrezon aktif" card.)
const RevenueChart = lazy(() =>
  import("@/components/dashboard/charts/revenue-chart").then((m) => ({ default: m.RevenueChart })),
);

type ReviewRow = {
  id: string;
  driver_rating: number | null;
  comment: string | null;
  created_at: string;
};

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
      const r = d.order.restaurants;
      arr.push({
        id: `rst-${d.id}`,
        lat: Number(r.lat),
        lng: Number(r.lng),
        type: "restaurant",
        label: r.name ?? "Restoran",
        info: {
          title: r.name ?? "Restoran",
          lines: [r.address, r.phone].filter((v): v is string => !!v),
        },
      });
    }
    if (d.order?.delivery_lat != null && d.order?.delivery_lng != null) {
      const o = d.order;
      arr.push({
        id: `dst-${d.id}`,
        lat: Number(o.delivery_lat),
        lng: Number(o.delivery_lng),
        type: "client",
        label: o.order_number,
        info: {
          title: `Kòmand ${o.order_number}`,
          lines: [o.delivery_address, o.contact_phone].filter((v): v is string => !!v),
        },
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
        <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">Revni 7 dènye jou</h2>
          {weeklyEarnings.isLoading ? (
            <Skeleton className="h-[240px] w-full rounded-xl" />
          ) : (
            <Suspense fallback={<Skeleton className="h-[240px] w-full rounded-xl" />}>
              <RevenueChart data={weeklyEarnings.data ?? []} formatValue={formatHTG} />
            </Suspense>
          )}
        </section>
      )}

      {!pending && driver && (
        <ActiveDeliveriesSection driverId={driver.id} active={active} markers={markers} />
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

      <DashboardShortcutGrid
        items={[
          {
            icon: MapPin,
            title: "Livrezon disponib",
            desc: "Pran nouvo livrezon",
            to: "/dashboard/driver/available",
          },
          {
            icon: ClipboardList,
            title: "Livrezon m yo",
            desc: "Aktyèl ak istwa",
            to: "/dashboard/driver/history",
          },
          {
            icon: DollarSign,
            title: "Revni m yo",
            desc: "Peman ak komisyon",
            to: "/dashboard/driver/earnings",
          },
          {
            icon: Wallet,
            title: "Peman ak Komisyon",
            desc: "Nimewo + frekans peman",
            to: "/dashboard/driver/payouts",
          },
          {
            icon: Bike,
            title: "Pwofil livrè",
            desc: "Modifye enfo w yo",
            to: "/dashboard/driver/profile",
          },
        ]}
      />
    </div>
  );
}
