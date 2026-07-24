import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { useState, Suspense, lazy } from "react";
import { Bike, HandCoins, AlertTriangle } from "lucide-react";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CommissionHistoryTable } from "@/components/dashboard/commission/commission-history-table";

// recharts (~350KB) only needed once this section mounts — same lazy-import
// pattern as dashboard.admin.index.tsx/dashboard.admin.payouts.tsx.
const RevenueChart = lazy(() =>
  import("@/components/dashboard/charts/revenue-chart").then((m) => ({ default: m.RevenueChart })),
);

// Role guard lives on the parent layout (dashboard.driver.tsx) — this used
// to repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/driver/earnings")({
  component: DriverEarnings,
});

function DriverEarnings() {
  const { user } = Route.useRouteContext();
  const today = new Date().toISOString().slice(0, 10);
  const monthsAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(monthsAgo);
  const [toDate, setToDate] = useState(today);

  const { data: driver } = useQuery({
    queryKey: ["me-driver", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const earnings = useQuery({
    queryKey: ["driver-earnings", driver?.id, fromDate, toDate],
    enabled: !!driver?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_driver_earnings_summary", {
        _driver_id: driver!.id,
        _from: fromDate,
        _to: toDate,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const totalDeliveries = earnings.data?.[0]?.total_deliveries ?? 0;
  const totalEarnings = earnings.data?.[0]?.total_earnings ?? 0;
  const chartData = (earnings.data ?? []).map((w) => ({
    label: new Date(w.week_start).toLocaleDateString("fr-HT", { day: "2-digit", month: "2-digit" }),
    value: Number(w.week_earnings),
  }));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Revni mwen yo</h1>
          <p className="mt-1 text-ink-soft">
            Tout chif yo kalkile sèvè-side, dirèkteman nan Rejis Komisyon an — menm chif ak "Mes
            Komisyon".
          </p>
        </div>
        <Link to="/dashboard/driver" className="text-sm font-bold text-brand-deep hover:underline">
          ← Dashboard
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          Depi
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-md border border-brand-soft bg-white px-2 py-1 text-xs"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          Jiska
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-md border border-brand-soft bg-white px-2 py-1 text-xs"
          />
        </label>
      </div>

      {earnings.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Pa ka chaje revni yo"
          description="Gen yon pwoblèm rezo oswa sèvè. Tanpri eseye ankò."
          action={
            <Button variant="outline" onClick={() => earnings.refetch()}>
              Eseye ankò
            </Button>
          }
        />
      ) : (
        <>
          {earnings.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <KpiCard label="Livrezon fèt" value={String(totalDeliveries)} icon={Bike} />
              <KpiCard
                label="Total ranmase"
                value={formatHTG(Number(totalEarnings))}
                icon={HandCoins}
              />
            </div>
          )}

          <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-display text-lg font-bold">Pa semèn</h2>
            {earnings.isLoading ? (
              <Skeleton className="h-[220px] w-full rounded-xl" />
            ) : chartData.length === 0 ? (
              <EmptyState
                icon={HandCoins}
                title="Pa gen revni"
                description="Okenn revni pou peryòd sa a."
              />
            ) : (
              <Suspense fallback={<Skeleton className="h-[220px] w-full rounded-xl" />}>
                <RevenueChart data={chartData} formatValue={formatHTG} height={220} />
              </Suspense>
            )}
          </section>
        </>
      )}

      <CommissionHistoryTable beneficiaryType="driver" beneficiaryId={driver?.id} />
    </div>
  );
}
