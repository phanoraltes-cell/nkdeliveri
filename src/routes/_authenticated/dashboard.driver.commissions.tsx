import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WalletSummaryCards } from "@/components/dashboard/wallet/wallet-summary-cards";
import { CommissionHistoryTable } from "@/components/dashboard/commission/commission-history-table";
import { useRealtimeTableSync } from "@/hooks/useRealtimeTableSync";

// Role guard lives on the parent layout (dashboard.driver.tsx) — this used
// to repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/driver/commissions")({
  component: DriverCommissions,
});

function DriverCommissions() {
  const { user } = Route.useRouteContext();

  const { data: driver, isLoading } = useQuery({
    queryKey: ["me-driver-id", user?.id],
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

  const walletQueryKey = ["me-driver-wallet-summary", driver?.id] as const;
  const wallet = useQuery({
    queryKey: walletQueryKey,
    enabled: !!driver?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallets")
        .select("available_balance, pending_balance, paid_balance, lifetime_earnings")
        .eq("driver_id", driver!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const totalOrdersQueryKey = ["me-driver-total-orders", driver?.id] as const;
  const totalOrders = useQuery({
    queryKey: totalOrdersQueryKey,
    enabled: !!driver?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("commission_ledger")
        .select("id", { count: "exact", head: true })
        .eq("driver_id", driver!.id)
        .eq("entry_type", "order_commission");
      if (error) throw error;
      return count ?? 0;
    },
  });

  useRealtimeTableSync(
    "wallets",
    driver?.id ? `driver_id=eq.${driver.id}` : undefined,
    [walletQueryKey, totalOrdersQueryKey],
    !!driver?.id,
  );

  if (isLoading) return <div className="text-ink-soft">Chajman…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Mes Commissions</h1>
          <p className="mt-1 text-ink-soft">
            Kote chak goud ou fè soti — chak livrezon, chak komisyon, chak peman.
          </p>
        </div>
        <Link to="/dashboard/driver" className="text-sm font-bold text-brand-deep hover:underline">
          ← Dashboard
        </Link>
      </div>

      <WalletSummaryCards wallet={wallet.data ?? null} totalOrders={totalOrders.data} />

      <CommissionHistoryTable beneficiaryType="driver" beneficiaryId={driver?.id} />
    </div>
  );
}
