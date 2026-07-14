import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  Store,
  Bike,
  ClipboardList,
  CreditCard,
  BarChart3,
  Wallet,
  Percent,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";
import type { MapMarker } from "@/components/maps/LeafletMap";
import { useLiveOrders, type ActiveDelivery } from "@/hooks/useLiveOrders";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable } from "@/components/dashboard/tables/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { DashboardShortcutGrid } from "@/components/dashboard/dashboard-shortcut-grid";
import { LiveMapSection } from "@/components/dashboard/admin/live-map-section";
import { PendingRestaurantsSection } from "@/components/dashboard/admin/pending-restaurants-section";
import { PendingDriversSection } from "@/components/dashboard/admin/pending-drivers-section";
import { formatHTG } from "@/lib/format";
import { useWeeklySeries } from "@/hooks/useWeeklySeries";
import { escapeHtml } from "@/lib/html";
import { DELIVERY_STATUS_LABEL } from "@/lib/delivery-status";

// recharts (~350KB) is only needed once this page has mounted — loading it
// as part of the main route chunk would delay every dashboard visit for the
// sake of a chart below the fold. (LeafletMap is lazy too, but that import
// now lives inside LiveMapSection, which owns the whole map card.)
const RevenueChart = lazy(() =>
  import("@/components/dashboard/charts/revenue-chart").then((m) => ({ default: m.RevenueChart })),
);

export const Route = createFileRoute("/_authenticated/dashboard/admin/")({
  component: AdminDashboard,
});

function AdminDashboard() {
  const qc = useQueryClient();
  const active = useLiveOrders({ admin: true });

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [restaurantFilter, setRestaurantFilter] = useState<string>("all");
  const [zoneQuery, setZoneQuery] = useState("");

  const onlineDrivers = useQuery({
    queryKey: ["admin-online-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, first_name, last_name, current_lat, current_lng, status")
        .eq("status", "online");
      if (error) throw error;
      return data;
    },
    refetchInterval: 15000,
  });

  const approvedRestaurants = useQuery({
    queryKey: ["admin-map-restaurants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, lat, lng, address")
        .eq("status", "approved");
      if (error) throw error;
      return data;
    },
  });

  const restaurantOptions = useMemo(() => {
    const names = new Set<string>();
    active.forEach((d) => d.order?.restaurants?.name && names.add(d.order.restaurants.name));
    approvedRestaurants.data?.forEach((r) => r.name && names.add(r.name));
    return Array.from(names).sort();
  }, [active, approvedRestaurants.data]);

  function matchesZone(text: string | null | undefined) {
    return !zoneQuery.trim() || (text ?? "").toLowerCase().includes(zoneQuery.trim().toLowerCase());
  }

  const filteredActive = useMemo(
    () =>
      active.filter((d) => {
        if (statusFilter !== "all" && d.status !== statusFilter) return false;
        if (restaurantFilter !== "all" && d.order?.restaurants?.name !== restaurantFilter)
          return false;
        if (!matchesZone(d.order?.delivery_address) && !matchesZone(d.order?.restaurants?.name))
          return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, statusFilter, restaurantFilter, zoneQuery],
  );

  const filteredRestaurants = useMemo(
    () =>
      (approvedRestaurants.data ?? []).filter((r) => {
        if (restaurantFilter !== "all" && r.name !== restaurantFilter) return false;
        if (!matchesZone(r.address) && !matchesZone(r.name)) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [approvedRestaurants.data, restaurantFilter, zoneQuery],
  );

  // Rebuilding this array (with its escapeHtml popup strings) is the
  // heaviest per-render work on this page, and it feeds LeafletMap — a
  // library component that reconciles markers on every prop change. Without
  // memoization it was recomputed (and the map re-processed every marker)
  // on every render of this fairly large dashboard, including ones
  // triggered by state that has nothing to do with the map (e.g. the
  // payments/approval mutations below).
  const markers: MapMarker[] = useMemo(
    () => [
      ...filteredRestaurants
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => ({
          id: `rst-${r.id}`,
          lat: Number(r.lat),
          lng: Number(r.lng),
          type: "restaurant" as const,
          label: r.name ?? "Restoran",
          info: `<div style="font-size:13px;line-height:1.5"><b>${escapeHtml(r.name ?? "Restoran")}</b><br>${escapeHtml(r.address ?? "")}</div>`,
        })),
      ...(onlineDrivers.data ?? [])
        .filter((d) => d.current_lat != null && d.current_lng != null)
        .map((d) => {
          const busy = active.some((a) => a.driver_id === d.id);
          const name = escapeHtml(`${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Livrè");
          return {
            id: `drv-${d.id}`,
            lat: Number(d.current_lat),
            lng: Number(d.current_lng),
            type: "driver" as const,
            label: name,
            info: `<div style="font-size:13px;line-height:1.5"><b>${name}</b><br>Estati: ${busy ? "An liv rezon" : "Disponib"}</div>`,
          };
        }),
      ...filteredActive
        .filter((d) => d.order?.delivery_lat != null && d.order?.delivery_lng != null)
        .map((d) => {
          const address = escapeHtml(d.order?.delivery_address ?? "—");
          const phone = escapeHtml(d.order?.contact_phone ?? "—");
          const orderNumber = escapeHtml(d.order?.order_number ?? "");
          return {
            id: `dst-${d.id}`,
            lat: Number(d.order!.delivery_lat),
            lng: Number(d.order!.delivery_lng),
            type: "client" as const,
            label: `Adrès ${d.order?.order_number}`,
            info: `<div style="font-size:13px;line-height:1.5"><b>Kòmand ${orderNumber}</b><br>Adrès: ${address}<br>Telefòn: ${phone}<br>Estati: ${DELIVERY_STATUS_LABEL[d.status] ?? escapeHtml(d.status)}</div>`,
          };
        }),
    ],
    [filteredRestaurants, filteredActive, onlineDrivers.data, active],
  );

  const stats = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => {
      const [users, restos, drivers, pendingR, pendingD] = await Promise.all([
        supabase.from("profiles").select("id", { head: true, count: "exact" }),
        supabase.from("restaurants").select("id", { head: true, count: "exact" }),
        supabase.from("drivers").select("id", { head: true, count: "exact" }),
        supabase
          .from("restaurants")
          .select("id", { head: true, count: "exact" })
          .eq("status", "pending"),
        supabase
          .from("drivers")
          .select("id", { head: true, count: "exact" })
          .eq("status", "pending"),
      ]);
      return {
        users: users.count ?? 0,
        restaurants: restos.count ?? 0,
        drivers: drivers.count ?? 0,
        pendingRestaurants: pendingR.count ?? 0,
        pendingDrivers: pendingD.count ?? 0,
      };
    },
  });

  const weeklyRevenue = useWeeklySeries(
    ["admin-weekly-revenue"],
    async (since) => {
      const { data, error } = await supabase
        .from("orders")
        .select("created_at, total")
        .gte("created_at", since.toISOString())
        .neq("status", "cancelled")
        .neq("status", "refunded");
      if (error) throw error;
      return data ?? [];
    },
    (o) => ({ date: o.created_at, value: Number(o.total) }),
  );

  const pendingRestaurants = useQuery({
    queryKey: ["pending-restaurants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, cuisine, phone, address, description, logo_url, cover_url, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const pendingDrivers = useQuery({
    queryKey: ["pending-drivers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select(
          "id, first_name, last_name, phone, address, vehicle_type, license_plate, id_doc_url, license_doc_url, vehicle_photo_url, created_at",
        )
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const updateResto = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "approved" | "rejected" | "suspended";
    }) => {
      const { error } = await supabase.rpc("update_restaurant_status_secure", {
        _restaurant_id: id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-restaurants"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      toast.success("Estati restoran aktyalize");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateDriver = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: "approved" | "rejected" | "suspended";
    }) => {
      const { error } = await supabase.rpc("update_driver_status_secure", {
        _driver_id: id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-drivers"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      toast.success("Estati livrè aktyalize");
    },
    onError: (e) => toast.error(e.message),
  });

  const s = stats.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold text-ink">Dashboard Administratè</h1>
        <p className="mt-1 text-ink-soft">Jere platfòm nan: itilizatè, restoran, livrè, peman.</p>
      </div>

      <LiveMapSection
        markers={markers}
        onlineDriverCount={onlineDrivers.data?.length ?? 0}
        activeDeliveryCount={filteredActive.length}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        restaurantFilter={restaurantFilter}
        onRestaurantFilterChange={setRestaurantFilter}
        restaurantOptions={restaurantOptions}
        zoneQuery={zoneQuery}
        onZoneQueryChange={setZoneQuery}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
            <Bike className="h-5 w-5 text-emerald-600" /> Livrè disponib (
            {onlineDrivers.data?.length ?? 0})
          </h2>
          {onlineDrivers.isLoading && <div className="text-sm text-ink-soft">Chajman…</div>}
          {!onlineDrivers.isLoading && !onlineDrivers.data?.length && (
            <div className="text-sm text-ink-soft">Pa gen livrè an liy kounye a.</div>
          )}
          <ul className="space-y-1.5">
            {onlineDrivers.data?.map((d) => {
              const busy = active.some((a) => a.driver_id === d.id);
              return (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-lg bg-brand-soft/20 px-3 py-2 text-sm"
                >
                  <span className="font-semibold text-ink">
                    {`${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Livrè"}
                  </span>
                  <StatusBadge tone={busy ? "warn" : "good"}>
                    {busy ? "An livrezon" : "Disponib"}
                  </StatusBadge>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
            <Store className="h-5 w-5 text-orange-600" /> Restoran ouvè (
            {approvedRestaurants.data?.length ?? 0})
          </h2>
          {approvedRestaurants.isLoading && <div className="text-sm text-ink-soft">Chajman…</div>}
          {!approvedRestaurants.isLoading && !approvedRestaurants.data?.length && (
            <div className="text-sm text-ink-soft">Pa gen restoran apwouve kounye a.</div>
          )}
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">
            {approvedRestaurants.data?.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-lg bg-brand-soft/20 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate font-semibold text-ink">{r.name}</span>
                <span className="ml-2 shrink-0 text-xs text-ink-soft">{r.address || "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Itilizatè" value={s?.users ?? "—"} icon={Users} />
        <KpiCard label="Restoran" value={s?.restaurants ?? "—"} icon={Store} />
        <KpiCard label="Livrè" value={s?.drivers ?? "—"} icon={Bike} />
        <KpiCard
          label="Restoran an atant"
          value={s?.pendingRestaurants ?? "—"}
          icon={ClipboardList}
        />
        <KpiCard label="Livrè an atant" value={s?.pendingDrivers ?? "—"} icon={ClipboardList} />
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">Revni 7 dènye jou</h2>
        {weeklyRevenue.isLoading ? (
          <div className="text-sm text-ink-soft">Chajman…</div>
        ) : (
          <Suspense fallback={<Skeleton className="h-[240px] w-full rounded-xl" />}>
            <RevenueChart data={weeklyRevenue.data ?? []} formatValue={formatHTG} />
          </Suspense>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-xl font-bold text-ink">Livrezon an kou</h2>
        <DataTable<ActiveDelivery>
          rows={filteredActive}
          getRowKey={(d) => d.id}
          mobileTitleKey="order"
          emptyState={
            <EmptyState
              icon={Inbox}
              title="Pa gen livrezon an kou"
              description="Livrezon aktif yo ap parèt isit la an tan reyèl."
            />
          }
          columns={[
            { key: "order", header: "Kòmand", cell: (d) => d.order?.order_number ?? "—" },
            {
              key: "restaurant",
              header: "Restoran",
              cell: (d) => d.order?.restaurants?.name ?? "—",
            },
            {
              key: "driver",
              header: "Livrè",
              cell: (d) =>
                d.driver ? `${d.driver.first_name ?? ""} ${d.driver.last_name ?? ""}`.trim() : "—",
            },
            { key: "address", header: "Adrès", cell: (d) => d.order?.delivery_address ?? "—" },
            {
              key: "status",
              header: "Estati",
              cell: (d) => DELIVERY_STATUS_LABEL[d.status] ?? d.status,
            },
          ]}
        />
      </section>

      <PendingRestaurantsSection
        restaurants={pendingRestaurants.data}
        isLoading={pendingRestaurants.isLoading}
        onApprove={(id) => updateResto.mutate({ id, status: "approved" })}
        onReject={(id) => updateResto.mutate({ id, status: "rejected" })}
      />

      <PendingDriversSection
        drivers={pendingDrivers.data}
        isLoading={pendingDrivers.isLoading}
        onApprove={(id) => updateDriver.mutate({ id, status: "approved" })}
        onReject={(id) => updateDriver.mutate({ id, status: "rejected" })}
      />

      <DashboardShortcutGrid
        items={[
          {
            icon: CreditCard,
            title: "Peman manyèl",
            desc: "Valide prèv MonCash/NatCash",
            to: "/dashboard/admin/payments",
          },
          {
            icon: Users,
            title: "Kliyan & Newsletter",
            desc: "Swiv kliyan, ekspòte, voye imèl an mas",
            to: "/dashboard/admin/customers",
          },
          {
            icon: Users,
            title: "Jere itilizatè",
            desc: "Tout kont yo, kèlkeswa wòl",
            to: "/dashboard/admin/users",
          },
          {
            icon: Wallet,
            title: "Peman platfòm",
            desc: "Nimewo MonCash/NatCash fallback",
            to: "/dashboard/admin/payout-settings",
          },
          {
            icon: Percent,
            title: "Restoran & Komisyon",
            desc: "Chwazi pousantaj/montan chak restoran peye",
            to: "/dashboard/admin/restaurants",
          },
          { icon: BarChart3, title: "Rapò", desc: "Vant ak analiz", to: null },
        ]}
      />
    </div>
  );
}
