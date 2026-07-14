import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { useState } from "react";
import { StatusBadge } from "@/components/dashboard/status-badge";

export const Route = createFileRoute("/_authenticated/dashboard/restaurant/revenue")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "restaurant_owner" && role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: RestaurantRevenue,
});

function RestaurantRevenue() {
  const { user } = Route.useRouteContext();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(monthAgo);
  const [toDate, setToDate] = useState(today);

  const { data: restaurant } = useQuery({
    queryKey: ["me-restaurant-id", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id")
        .eq("owner_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const summary = useQuery({
    queryKey: ["restaurant-revenue", restaurant?.id, fromDate, toDate],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_restaurant_revenue_summary", {
        _restaurant_id: restaurant!.id,
        _from: fromDate,
        _to: toDate,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
  });

  const payments = useQuery({
    queryKey: ["restaurant-payments", restaurant?.id, fromDate, toDate],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, method, status, amount, created_at, orders!inner(order_number, restaurant_id, created_at)",
        )
        .eq("orders.restaurant_id", restaurant!.id)
        .gte("orders.created_at", fromDate)
        .lte("orders.created_at", toDate + "T23:59:59")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Revni ak Peman</h1>
          <p className="mt-1 text-ink-soft">
            Tout chif yo kalkile sèvè-side — pa gen kalkil manyèl.
          </p>
        </div>
        <Link
          to="/dashboard/restaurant"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
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

      {summary.isLoading && <div className="text-ink-soft">Chajman…</div>}

      {summary.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Kòmand total" value={String(summary.data.total_orders)} />
          <StatCard label="Livre" value={String(summary.data.delivered_orders)} />
          <StatCard label="Anile" value={String(summary.data.cancelled_orders)} />
          <StatCard
            label="Revni brit (livre)"
            value={formatHTG(Number(summary.data.gross_revenue))}
            accent
          />
          <StatCard
            label={`Komisyon platfòm (${summary.data.commission_rate}%)`}
            value={formatHTG(Number(summary.data.commission_amount))}
          />
          <StatCard
            label="Ou dwe resevwa (net)"
            value={formatHTG(Number(summary.data.net_payout))}
            accent
          />
          <StatCard label="Peman konfime" value={formatHTG(Number(summary.data.paid_amount))} />
          <StatCard label="Peman an atant" value={formatHTG(Number(summary.data.pending_amount))} />
        </div>
      )}

      <section className="rounded-2xl border border-brand-soft/60 bg-white shadow-sm">
        <div className="border-b border-brand-soft/40 p-4">
          <h2 className="font-display text-lg font-bold">Istwa peman</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-brand-soft/30 text-left text-xs uppercase text-ink-soft">
              <tr>
                <th className="px-3 py-2">Dat</th>
                <th className="px-3 py-2">Kòmand</th>
                <th className="px-3 py-2">Metòd</th>
                <th className="px-3 py-2 text-right">Mòn</th>
                <th className="px-3 py-2">Estati</th>
              </tr>
            </thead>
            <tbody>
              {payments.data?.map((p) => (
                <tr key={p.id} className="border-t border-brand-soft/30">
                  <td className="px-3 py-2 text-xs text-ink-soft">
                    {new Date(p.created_at).toLocaleDateString("fr-HT")}
                  </td>
                  <td className="px-3 py-2 font-bold">{p.orders?.order_number}</td>
                  <td className="px-3 py-2 uppercase">{p.method}</td>
                  <td className="px-3 py-2 text-right font-bold text-brand-deep">
                    {formatHTG(Number(p.amount))}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      tone={p.status === "paid" ? "good" : p.status === "failed" ? "bad" : "warn"}
                    >
                      {p.status}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {payments.data?.length === 0 && (
            <div className="p-6 text-center text-sm text-ink-soft">
              Pa gen peman pou peryòd sa a.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</div>
      <div
        className={`mt-1 font-display text-xl font-extrabold ${accent ? "text-brand-deep" : "text-ink"}`}
      >
        {value}
      </div>
    </div>
  );
}
