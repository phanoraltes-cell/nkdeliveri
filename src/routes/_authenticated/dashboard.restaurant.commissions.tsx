import { createFileRoute, Link } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-guard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WalletSummaryCards } from "@/components/dashboard/wallet/wallet-summary-cards";
import { CommissionHistoryTable } from "@/components/dashboard/commission/commission-history-table";
import { useRealtimeTableSync } from "@/hooks/useRealtimeTableSync";

// Owner-only: commissions are financial, not operational — same exclusion
// of restaurant_staff as dashboard.restaurant.payouts.tsx.
export const Route = createFileRoute("/_authenticated/dashboard/restaurant/commissions")({
  beforeLoad: ({ context }) => {
    requireRole(context.role, ["restaurant_owner", "admin", "super_admin"]);
  },
  component: RestaurantCommissions,
});

function RestaurantCommissions() {
  const { user } = Route.useRouteContext();

  const { data: restaurant, isLoading } = useQuery({
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

  const walletQueryKey = ["me-restaurant-wallet-summary", restaurant?.id] as const;
  const wallet = useQuery({
    queryKey: walletQueryKey,
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallets")
        .select("available_balance, pending_balance, paid_balance, lifetime_earnings")
        .eq("restaurant_id", restaurant!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const totalOrdersQueryKey = ["me-restaurant-total-orders", restaurant?.id] as const;
  const totalOrders = useQuery({
    queryKey: totalOrdersQueryKey,
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("commission_ledger")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurant!.id)
        .eq("entry_type", "order_commission");
      if (error) throw error;
      return count ?? 0;
    },
  });

  useRealtimeTableSync(
    "wallets",
    restaurant?.id ? `restaurant_id=eq.${restaurant.id}` : undefined,
    [walletQueryKey, totalOrdersQueryKey],
    !!restaurant?.id,
  );

  if (isLoading) return <div className="text-ink-soft">Chajman…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Mes Commissions</h1>
          <p className="mt-1 text-ink-soft">
            Kote chak goud ou fè soti — chak kòmand, chak komisyon, chak peman.
          </p>
        </div>
        <Link
          to="/dashboard/restaurant"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      <WalletSummaryCards wallet={wallet.data ?? null} totalOrders={totalOrders.data} />

      <CommissionHistoryTable beneficiaryType="restaurant" beneficiaryId={restaurant?.id} />
    </div>
  );
}
