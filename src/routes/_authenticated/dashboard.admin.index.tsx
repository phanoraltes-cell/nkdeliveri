import { createFileRoute, Link } from "@tanstack/react-router";
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
  CheckCircle2,
  XCircle,
  Wallet,
  Percent,
  Inbox,
} from "lucide-react";
import { toast } from "sonner";
import type { MapMarker } from "@/components/maps/LeafletMap";
import { useLiveOrders, type ActiveDelivery } from "@/hooks/useLiveOrders";
import { ProofThumb } from "@/components/proof-thumb";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable } from "@/components/dashboard/tables/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatHTG } from "@/lib/format";
import { useWeeklySeries } from "@/hooks/useWeeklySeries";

// Leaflet (~150KB) and recharts (~350KB) are only needed once this page has
// mounted — loading them as part of the main route chunk would delay every
// dashboard visit for the sake of a map/chart below the fold.
const LeafletMap = lazy(() =>
  import("@/components/maps/LeafletMap").then((m) => ({ default: m.LeafletMap })),
);
const RevenueChart = lazy(() =>
  import("@/components/dashboard/charts/revenue-chart").then((m) => ({ default: m.RevenueChart })),
);

export const Route = createFileRoute("/_authenticated/dashboard/admin/")({
  component: AdminDashboard,
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  assigned: "Asiyen",
  en_route_pickup: "Nan wout pou pran l",
  picked_up: "Pran nan men restoran",
  en_route_dropoff: "Nan wout pou livre",
  delivered: "Livre",
};

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

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl font-bold text-ink">Kat an tan reyèl</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
              {onlineDrivers.data?.length ?? 0} livrè aktif
            </span>
            <span className="rounded-full bg-brand-soft/60 px-3 py-1 text-xs font-bold text-brand-deep">
              {filteredActive.length} livrezon an kou
            </span>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
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
            onChange={(e) => setRestaurantFilter(e.target.value)}
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
            onChange={(e) => setZoneQuery(e.target.value)}
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
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${busy ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}
                  >
                    {busy ? "An livrezon" : "Disponib"}
                  </span>
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

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">
          Restoran an atant valdasyon
        </h2>
        {pendingRestaurants.isLoading && <div className="text-ink-soft">Chajman...</div>}
        {pendingRestaurants.data?.length === 0 && (
          <div className="text-sm text-ink-soft">Pa gen okenn restoran an atant.</div>
        )}
        <div className="space-y-3">
          {pendingRestaurants.data?.map((r) => (
            <div key={r.id} className="rounded-xl border border-brand-soft/50 p-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex gap-2">
                  {r.logo_url ? (
                    <ProofThumb path={r.logo_url} alt={`Logo ${r.name}`} />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-brand-soft/60 text-[10px] text-ink-soft">
                      San logo
                    </div>
                  )}
                  {r.cover_url ? (
                    <ProofThumb path={r.cover_url} alt={`Kouvèti ${r.name}`} />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-brand-soft/60 text-[10px] text-ink-soft">
                      San kouvèti
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-ink">{r.name}</div>
                  <div className="text-xs text-ink-soft">
                    {r.cuisine || "—"} · {r.phone || "san telefòn"} · {r.address || "san adrès"}
                  </div>
                  {r.description && <p className="mt-1 text-xs text-ink-soft">{r.description}</p>}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => updateResto.mutate({ id: r.id, status: "approved" })}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Apwouve
                </button>
                <button
                  onClick={() => updateResto.mutate({ id: r.id, status: "rejected" })}
                  className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-red-700"
                >
                  <XCircle className="h-3.5 w-3.5" /> Refize
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-display text-xl font-bold text-ink">Livrè an atant valdasyon</h2>
        {pendingDrivers.isLoading && <div className="text-ink-soft">Chajman...</div>}
        {pendingDrivers.data?.length === 0 && (
          <div className="text-sm text-ink-soft">Pa gen okenn livrè an atant.</div>
        )}
        <div className="space-y-3">
          {pendingDrivers.data?.map((d) => (
            <div key={d.id} className="rounded-xl border border-brand-soft/50 p-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex flex-wrap gap-2">
                  {d.id_doc_url ? (
                    <ProofThumb
                      path={d.id_doc_url}
                      bucket="driver-documents"
                      alt={`Pyès idantite ${d.first_name}`}
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-red-300 bg-red-50 text-center text-[10px] font-semibold text-red-700">
                      Pa gen pyès idantite!
                    </div>
                  )}
                  {d.license_doc_url && (
                    <ProofThumb
                      path={d.license_doc_url}
                      bucket="driver-documents"
                      alt={`Pèmi ${d.first_name}`}
                    />
                  )}
                  {d.vehicle_photo_url && (
                    <ProofThumb
                      path={d.vehicle_photo_url}
                      bucket="driver-documents"
                      alt={`Veyikil ${d.first_name}`}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-ink">
                    {d.first_name} {d.last_name}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {d.vehicle_type || "—"} · {d.license_plate || "san plak"} ·{" "}
                    {d.phone || "san telefòn"}
                  </div>
                  <div className="text-xs text-ink-soft">{d.address || "san adrès"}</div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => updateDriver.mutate({ id: d.id, status: "approved" })}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Apwouve
                </button>
                <button
                  onClick={() => updateDriver.mutate({ id: d.id, status: "rejected" })}
                  className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-red-700"
                >
                  <XCircle className="h-3.5 w-3.5" /> Refize
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            icon: CreditCard,
            title: "Peman manyèl",
            desc: "Valide prèv MonCash/NatCash",
            to: "/dashboard/admin/payments" as const,
          },
          {
            icon: Users,
            title: "Kliyan & Newsletter",
            desc: "Swiv kliyan, ekspòte, voye imèl an mas",
            to: "/dashboard/admin/customers" as const,
          },
          {
            icon: Users,
            title: "Jere itilizatè",
            desc: "Tout kont yo, kèlkeswa wòl",
            to: "/dashboard/admin/users" as const,
          },
          {
            icon: Wallet,
            title: "Peman platfòm",
            desc: "Nimewo MonCash/NatCash fallback",
            to: "/dashboard/admin/payout-settings" as const,
          },
          {
            icon: Percent,
            title: "Restoran & Komisyon",
            desc: "Chwazi pousantaj/montan chak restoran peye",
            to: "/dashboard/admin/restaurants" as const,
          },
          { icon: BarChart3, title: "Rapò", desc: "Vant ak analiz", to: null },
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
