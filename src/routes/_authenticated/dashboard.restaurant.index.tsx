import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { toast } from "sonner";
import {
  Store,
  ClipboardList,
  Package,
  BarChart3,
  Users,
  Percent,
  Clock,
  Wallet,
  ShoppingBag,
  ChefHat,
  Flame,
  Inbox,
  Power,
  PowerOff,
} from "lucide-react";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatHTG } from "@/lib/format";
import { sumAmounts } from "@/lib/money";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable } from "@/components/dashboard/tables/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import {
  DashboardShortcutGrid,
  type DashboardShortcutItem,
} from "@/components/dashboard/dashboard-shortcut-grid";
import { useWeeklySeries } from "@/hooks/useWeeklySeries";
import { ORDER_STATUS_LABEL } from "@/lib/order-status";
import { ContractSigningCard } from "@/components/dashboard/restaurant/contract-signing-card";

// See dashboard.admin.index.tsx for why this is lazy: recharts (~350KB) is
// only needed once this page has mounted.
const RevenueChart = lazy(() =>
  import("@/components/dashboard/charts/revenue-chart").then((m) => ({ default: m.RevenueChart })),
);

export const Route = createFileRoute("/_authenticated/dashboard/restaurant/")({
  component: RestaurantDashboard,
});

type Tile = DashboardShortcutItem;
type RecentOrder = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "order_number" | "status" | "total" | "created_at"
>;

function RestaurantDashboard() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { data: restaurant, isLoading } = useMyRestaurant(user?.id);

  const pending = restaurant?.status === "pending";
  // Tach 7 — etap siyati kontra, apre aplikasyon apwouve men anvan restoran
  // an reyèlman aktif. Blòk tout paj la pou pwopriyetè a (li dwe siyen
  // anvan li ka wè done operasyonèl ki poko egziste kanmenm — zewo kòmand
  // posib pandan restoran an pa 'approved').
  const pendingContract = restaurant?.status === "pending_contract";
  const isOwner = restaurant?.isOwner ?? false;
  const restaurantId = restaurant?.id;

  // Tach 1, Objektif A — pòtay louvri/fèmen manyèl. Pwopriyetè/admin sèlman
  // (set_restaurant_open_secure li menm ranfòse sa a sèvè-kote); anplwaye
  // wè estati a (li li nan `restaurant` deja chaje) men pa gen bouton pou
  // chanje l — konsistan ak yo pa gen aksè "Pwofil restoran" non plis.
  const toggleOpen = useMutation({
    mutationFn: async (nextOpen: boolean) => {
      const { error } = await supabase.rpc("set_restaurant_open_secure", {
        _restaurant_id: restaurantId!,
        _is_open: nextOpen,
      });
      if (error) throw error;
    },
    onSuccess: (_data, nextOpen) => {
      toast.success(nextOpen ? "Restoran ou louvri kounye a" : "Restoran ou fèmen kounye a");
      qc.invalidateQueries({ queryKey: ["my-restaurant-or-staff", user?.id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const todayStats = useQuery({
    queryKey: ["restaurant-today-stats", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("orders")
        .select("status, total")
        .eq("restaurant_id", restaurantId!)
        .gte("created_at", since.toISOString());
      if (error) throw error;
      const rows = data ?? [];
      return {
        ordersToday: rows.length,
        pending: rows.filter((o) => o.status === "pending").length,
        preparing: rows.filter((o) => o.status === "preparing").length,
        // Menm rezon ak revni livrè a: yon sèl `total` ki pa yon nonb
        // kontamine tout sòm nan an silans. Pi bon montre « — » pase yon
        // revni jounen ki fo.
        revenueToday: sumAmounts(
          rows
            .filter((o) => o.status !== "cancelled" && o.status !== "refunded")
            .map((o) => o.total),
        ),
      };
    },
  });

  const weeklyRevenue = useWeeklySeries(
    ["restaurant-weekly-revenue", restaurantId],
    async (since) => {
      const { data, error } = await supabase
        .from("orders")
        .select("created_at, total")
        .eq("restaurant_id", restaurantId!)
        .gte("created_at", since.toISOString())
        .neq("status", "cancelled")
        .neq("status", "refunded");
      if (error) throw error;
      return data ?? [];
    },
    (o) => ({ date: o.created_at, value: Number(o.total) }),
    { enabled: !!restaurantId && isOwner },
  );

  const popularDishes = useQuery({
    queryKey: ["restaurant-popular-dishes", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data, error } = await supabase
        .from("order_items")
        .select("product_name, quantity, orders!inner(restaurant_id, created_at)")
        .eq("orders.restaurant_id", restaurantId!)
        .gte("orders.created_at", since.toISOString());
      if (error) throw error;

      const byDish = new Map<string, number>();
      for (const item of data ?? []) {
        byDish.set(item.product_name, (byDish.get(item.product_name) ?? 0) + item.quantity);
      }
      return Array.from(byDish.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, qty]) => ({ name, qty }));
    },
  });

  const recentOrders = useQuery({
    queryKey: ["restaurant-recent-orders", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_number, status, total, created_at")
        .eq("restaurant_id", restaurantId!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const ownerTiles: Tile[] = [
    {
      icon: ClipboardList,
      title: "Kòmand",
      desc: "Konfime, refize, swiv estati an tan reyèl",
      to: "/dashboard/restaurant/orders",
    },
    {
      icon: Package,
      title: "Meni",
      desc: "Kategori, plat ak foto",
      to: "/dashboard/restaurant/menu",
    },
    {
      icon: BarChart3,
      title: "Revni",
      desc: "Vant, komisyon ak istwa peman",
      to: "/dashboard/restaurant/revenue",
    },
    {
      icon: Wallet,
      title: "Peman ak Komisyon",
      desc: "Nimewo MonCash/NatCash, mòd + komisyon",
      to: "/dashboard/restaurant/payouts",
    },
    {
      icon: Percent,
      title: "Pwomosyon",
      desc: "Ofri espesyal",
      to: "/dashboard/restaurant/promotions",
    },
    {
      icon: Store,
      title: "Pwofil restoran",
      desc: "Enfo, logo, kouvèti, orè ouvèti",
      to: "/dashboard/restaurant/profile",
    },
    {
      icon: Users,
      title: "Anplwaye",
      desc: "Ajoute manm ekip la",
      to: "/dashboard/restaurant/employees",
    },
  ];
  const staffTiles: Tile[] = [
    {
      icon: ClipboardList,
      title: "Kòmand",
      desc: "Konfime, refize, swiv estati an tan reyèl",
      to: "/dashboard/restaurant/orders",
    },
    {
      icon: Package,
      title: "Meni",
      desc: "Kategori, plat ak foto",
      to: "/dashboard/restaurant/menu",
    },
  ];
  const tiles = isOwner ? ownerTiles : staffTiles;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">
            {restaurant?.name ?? "Restoran mwen"}
          </h1>
          <p className="mt-1 text-ink-soft">
            {isOwner ? "Jere manje w, kòmand ak vant ou yo." : "Jere kòmand ak meni restoran an."}
          </p>
        </div>
        {restaurant && isOwner && (
          <div className="flex shrink-0 flex-col items-end gap-2">
            <StatusBadge
              tone={
                pending || pendingContract
                  ? "warn"
                  : restaurant.status === "approved"
                    ? "good"
                    : "bad"
              }
              className="px-3 py-1 text-xs"
            >
              {pendingContract ? "ap tann siyati" : restaurant.status}
            </StatusBadge>
            {restaurant.status === "approved" && (
              <Button
                type="button"
                size="sm"
                variant={restaurant.isOpen ? "outline" : "default"}
                isLoading={toggleOpen.isPending}
                onClick={() => toggleOpen.mutate(!restaurant.isOpen)}
                className={
                  restaurant.isOpen
                    ? "border-status-good text-status-good hover:bg-status-good-soft"
                    : "bg-status-bad text-white hover:bg-status-bad"
                }
              >
                {restaurant.isOpen ? (
                  <>
                    <Power className="h-4 w-4" /> Fèmen restoran
                  </>
                ) : (
                  <>
                    <PowerOff className="h-4 w-4" /> Louvri restoran
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      {isLoading && <div className="text-ink-soft">Chajman...</div>}

      {isOwner && pending && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <Clock className="h-5 w-5" /> Kont ou an atant valdasyon
          </div>
          <p className="mt-1 text-sm text-amber-800">
            Yon administratè ap revize enfòmasyon restoran ou. Ou pral resevwa yon email lè kont ou
            apwouve. Nan entèval, ou ka konplete pwofil ou ak menu ou.
          </p>
        </div>
      )}

      {/* Tach 7 — blòk tout kontni operasyonèl la (KPI, revni, kòmand)
          pandan etap siyati a: yo ta tout vid/san sans kanmenm depi
          restoran an pa 'approved' toujou, donk pa ka janm resevwa kòmand.
          isOwner ki siyen; anplwaye jis wè yon bannyè enfòmatif — se
          pwopriyetè a sèlman ki gen dwa legal siyen (RPC a ranfòse sa a
          sèvè-kote tou). */}
      {pendingContract && isOwner && restaurantId && user?.id ? (
        <ContractSigningCard restaurantId={restaurantId} userId={user.id} />
      ) : pendingContract ? (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <Clock className="h-5 w-5" /> Ap tann siyati kontra
          </div>
          <p className="mt-1 text-sm text-amber-800">
            Aplikasyon restoran an apwouve — l ap tann pwopriyetè a siyen kontra platfòm lan anvan
            li vin aktif.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Kòmand jodi a"
              value={todayStats.data?.ordersToday ?? "—"}
              icon={ShoppingBag}
            />
            <KpiCard
              label="An atant"
              value={todayStats.data?.pending ?? "—"}
              icon={ClipboardList}
            />
            <KpiCard label="Ap prepare" value={todayStats.data?.preparing ?? "—"} icon={ChefHat} />
            {isOwner && (
              <KpiCard
                label="Revni jodi a"
                value={todayStats.data ? formatHTG(todayStats.data.revenueToday) : "—"}
                icon={Wallet}
              />
            )}
          </div>

          {isOwner && (
            <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
              <h2 className="mb-4 font-display text-xl font-bold text-ink">Revni 7 dènye jou</h2>
              {weeklyRevenue.isLoading ? (
                <Skeleton className="h-[240px] w-full rounded-xl" />
              ) : (
                <Suspense fallback={<Skeleton className="h-[240px] w-full rounded-xl" />}>
                  <RevenueChart data={weeklyRevenue.data ?? []} formatValue={formatHTG} />
                </Suspense>
              )}
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
              <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
                <Flame className="h-5 w-5 text-brand-deep" /> Plat popilè (30 jou)
              </h2>
              {!popularDishes.isLoading && !popularDishes.data?.length && (
                <div className="text-sm text-ink-soft">
                  Poko gen ase kòmand pou montre plat popilè.
                </div>
              )}
              <ul className="space-y-1.5">
                {popularDishes.data?.map((d, i) => (
                  <li
                    key={d.name}
                    className="flex items-center justify-between rounded-lg bg-brand-soft/20 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate font-semibold text-ink">
                      {i + 1}. {d.name}
                    </span>
                    <span className="shrink-0 text-xs font-bold text-brand-deep">{d.qty} vann</span>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="mb-3 font-display text-lg font-bold text-ink">Dènye kòmand</h2>
              <DataTable<RecentOrder>
                rows={recentOrders.data ?? []}
                getRowKey={(o) => o.id}
                mobileTitleKey="order_number"
                emptyState={
                  <EmptyState
                    icon={Inbox}
                    title="Pa gen kòmand"
                    description="Kòmand ki fèk antre yo ap parèt isit la."
                  />
                }
                columns={[
                  { key: "order_number", header: "Kòmand", cell: (o) => o.order_number },
                  { key: "total", header: "Total", cell: (o) => formatHTG(Number(o.total)) },
                  {
                    key: "status",
                    header: "Estati",
                    cell: (o) => ORDER_STATUS_LABEL[o.status] ?? o.status,
                  },
                ]}
              />
            </section>
          </div>

          <DashboardShortcutGrid items={tiles} />
        </>
      )}
    </div>
  );
}
