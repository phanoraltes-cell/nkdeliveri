import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import type { MapMarker } from "@/components/maps/LeafletMap";
import {
  Users,
  Store,
  Bike,
  CreditCard,
  BarChart3,
  Wallet,
  Percent,
  Inbox,
  RotateCcw,
  Megaphone,
  AlertTriangle,
} from "lucide-react";
import { useLiveOrders, type ActiveDelivery } from "@/hooks/useLiveOrders";
import { useAdminDashboardData } from "@/hooks/useAdminDashboardData";
import { buildAdminMapMarkers } from "@/lib/admin-map-markers";
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
  const active = useLiveOrders({ admin: true });
  const {
    onlineDrivers,
    approvedRestaurants,
    stats,
    weeklyRevenue,
    pendingRestaurants,
    pendingDrivers,
    updateResto,
    updateDriver,
  } = useAdminDashboardData();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [restaurantFilter, setRestaurantFilter] = useState<string>("all");
  const [zoneQuery, setZoneQuery] = useState("");

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

  // Rebuilding this array is the heaviest per-render work on this page, and
  // it feeds LeafletMap — a library component that reconciles markers on
  // every prop change. Without memoization it was recomputed (and the map
  // re-processed every marker) on every render of this fairly large
  // dashboard, including ones triggered by state that has nothing to do
  // with the map (e.g. the payments/approval mutations below).
  const markers: MapMarker[] = useMemo(
    () =>
      buildAdminMapMarkers(filteredRestaurants, onlineDrivers.data ?? [], filteredActive, active),
    [filteredRestaurants, filteredActive, onlineDrivers.data, active],
  );

  const s = stats.data;

  // Refonte Frontend Premium, Phase 4 (P4) — "Ijan" zone above. No new
  // queries: pendingRestaurants/pendingDrivers are the same data the page
  // already fetched for the sections rendered inside this zone.
  const pendingRestoCount = pendingRestaurants.data?.length ?? 0;
  const pendingDriverCount = pendingDrivers.data?.length ?? 0;
  const urgentLoading = pendingRestaurants.isLoading || pendingDrivers.isLoading;
  const hasUrgent = pendingRestoCount > 0 || pendingDriverCount > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold text-ink">Dashboard Administratè</h1>
        <p className="mt-1 text-ink-soft">Jere platfòm nan: itilizatè, restoran, livrè, peman.</p>
      </div>

      {/* Zone 1 — Ijan (Urgent): needs-action items only, always first, and
          visually distinct only when there's actually something pending —
          a red zone around an empty state would read as a false alarm on a
          calm day. Matches the Refonte spec's "hiérarchie de décision"
          wireframe: this is what used to be buried below the fold, after
          the map and the KPI grid. */}
      <div
        className={
          hasUrgent
            ? "rounded-2xl border-2 border-status-bad/30 bg-status-bad-soft p-5"
            : "rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs"
        }
      >
        <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-ink">
          <AlertTriangle
            className={`h-5 w-5 ${hasUrgent ? "text-status-bad" : "text-ink-soft"}`}
            aria-hidden="true"
          />
          Ijan — bezwen aksyon
        </h2>
        {urgentLoading ? (
          <Skeleton className="mt-3 h-16 w-full rounded-xl" />
        ) : hasUrgent ? (
          <>
            <p className="mb-4 text-sm text-ink-soft">
              {[
                pendingRestoCount > 0 ? `${pendingRestoCount} restoran` : null,
                pendingDriverCount > 0 ? `${pendingDriverCount} livrè` : null,
              ]
                .filter(Boolean)
                .join(" · ")}{" "}
              an atant valdasyon.
            </p>
            <div className="space-y-4">
              {pendingRestoCount > 0 && (
                <PendingRestaurantsSection
                  restaurants={pendingRestaurants.data}
                  isLoading={pendingRestaurants.isLoading}
                  pendingId={updateResto.isPending ? updateResto.variables?.id : undefined}
                  onApprove={(id) => updateResto.mutate({ id, status: "approved" })}
                  onReject={(id) => updateResto.mutate({ id, status: "rejected" })}
                />
              )}
              {pendingDriverCount > 0 && (
                <PendingDriversSection
                  drivers={pendingDrivers.data}
                  isLoading={pendingDrivers.isLoading}
                  pendingId={updateDriver.isPending ? updateDriver.variables?.id : undefined}
                  onApprove={(id) => updateDriver.mutate({ id, status: "approved" })}
                  onReject={(id) => updateDriver.mutate({ id, status: "rejected" })}
                />
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-soft">Anyen ki bezwen validasyon kounye a.</p>
        )}
      </div>

      {/* Zone 2 — Jodi a (Aujourd'hui): today's operational snapshot — the
          numbers and lists an admin actually glances at repeatedly through
          the day. The two "an atant" KPI tiles that used to live in this
          grid were dropped: their count is the same one now shown, more
          usefully, inside the Ijan zone above — showing it twice fought
          the whole point of this phase. */}
      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-soft">Jodi a</h2>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="Itilizatè" value={s?.users ?? "—"} icon={Users} />
            <KpiCard label="Restoran" value={s?.restaurants ?? "—"} icon={Store} />
            <KpiCard label="Livrè" value={s?.drivers ?? "—"} icon={Bike} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
              <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
                <Bike className="h-5 w-5 text-emerald-600" /> Livrè disponib (
                {onlineDrivers.data?.length ?? 0})
              </h3>
              {onlineDrivers.isLoading && <Skeleton className="h-16 w-full rounded-xl" />}
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

            <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
              <h3 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
                <Store className="h-5 w-5 text-orange-600" /> Restoran ouvè (
                {approvedRestaurants.data?.length ?? 0})
              </h3>
              {approvedRestaurants.isLoading && <Skeleton className="h-16 w-full rounded-xl" />}
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

          <section>
            <h3 className="mb-3 font-display text-xl font-bold text-ink">Livrezon an kou</h3>
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
                    d.driver
                      ? `${d.driver.first_name ?? ""} ${d.driver.last_name ?? ""}`.trim()
                      : "—",
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
        </div>
      </div>

      {/* Zone 3 — Estatistik & rapò: consulted deliberately, not glanced at
          continuously (the redesign spec's own framing for this zone) — the
          revenue trend, the full live map with its filters, and the
          quick-links grid to every deeper admin tool. Same components,
          same props, only moved down from the top of the page. */}
      <div>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink-soft">
          Estatistik &amp; rapò
        </h2>
        <div className="space-y-4">
          <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
            <h3 className="mb-4 font-display text-xl font-bold text-ink">Revni 7 dènye jou</h3>
            {weeklyRevenue.isLoading ? (
              <Skeleton className="h-[240px] w-full rounded-xl" />
            ) : (
              <Suspense fallback={<Skeleton className="h-[240px] w-full rounded-xl" />}>
                <RevenueChart data={weeklyRevenue.data ?? []} formatValue={formatHTG} />
              </Suspense>
            )}
          </section>

          <LiveMapSection
            markers={markers}
            activeDeliveries={filteredActive}
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

          <div>
            <h3 className="mb-3 font-display text-xl font-bold text-ink">Aksyon rapid</h3>
            <DashboardShortcutGrid
              items={[
                {
                  icon: CreditCard,
                  title: "Peman manyèl",
                  desc: "Valide prèv MonCash/NatCash",
                  to: "/dashboard/admin/payments",
                },
                {
                  icon: RotateCcw,
                  title: "Ranbousman",
                  desc: "Revize demann ranbousman kliyan yo",
                  to: "/dashboard/admin/refunds",
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
                {
                  icon: Bike,
                  title: "Jesyon Livrè",
                  desc: "Apwouve, sispann, swiv pèfòmans livrè yo",
                  to: "/dashboard/admin/drivers",
                },
                {
                  icon: Megaphone,
                  title: "Piblisite",
                  desc: "Jere anons sponsorize yo",
                  to: "/dashboard/admin/ads",
                },
                {
                  icon: BarChart3,
                  title: "Rapò",
                  desc: "Vant ak analiz",
                  to: "/dashboard/admin/finance",
                },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
