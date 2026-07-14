import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard/driver/earnings")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "driver" && role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: DriverEarnings,
});

function DriverEarnings() {
  const { user } = Route.useRouteContext();
  const today = new Date().toISOString().slice(0, 10);
  const monthsAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const [fromDate] = useState(monthsAgo);
  const [toDate] = useState(today);

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
  const maxWeek = Math.max(1, ...(earnings.data?.map((w) => Number(w.week_earnings)) ?? [1]));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Revni mwen yo</h1>
          <p className="mt-1 text-ink-soft">Dènye 90 jou — tout chif kalkile sèvè-side.</p>
        </div>
        <Link to="/dashboard/driver" className="text-sm font-bold text-brand-deep hover:underline">
          ← Dashboard
        </Link>
      </div>

      {earnings.isLoading && <div className="text-ink-soft">Chajman…</div>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">
            Livrezon fèt
          </div>
          <div className="mt-1 font-display text-2xl font-extrabold text-ink">
            {totalDeliveries}
          </div>
        </div>
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">
            Total ranmase
          </div>
          <div className="mt-1 font-display text-2xl font-extrabold text-brand-deep">
            {formatHTG(Number(totalEarnings))}
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-display text-lg font-bold">Pa semèn</h2>
        {(earnings.data?.length ?? 0) === 0 ? (
          <div className="text-center text-sm text-ink-soft">Pa gen revni pou peryòd sa a.</div>
        ) : (
          <div className="flex items-end gap-2 overflow-x-auto pb-2" style={{ height: 160 }}>
            {earnings.data?.map((w) => (
              <div
                key={w.week_start}
                className="flex flex-1 min-w-[48px] flex-col items-center gap-1.5"
              >
                <div
                  className="w-full rounded-t-md bg-brand transition-all"
                  style={{ height: `${Math.max(4, (Number(w.week_earnings) / maxWeek) * 120)}px` }}
                  title={formatHTG(Number(w.week_earnings))}
                />
                <span className="text-[10px] text-ink-soft">
                  {new Date(w.week_start).toLocaleDateString("fr-HT", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
