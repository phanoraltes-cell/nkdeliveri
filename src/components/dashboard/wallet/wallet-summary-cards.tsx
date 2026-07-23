import { Wallet, Clock, HandCoins, TrendingUp } from "lucide-react";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { formatHTG } from "@/lib/format";

type WalletSummaryCardsProps = {
  wallet: {
    available_balance: number;
    pending_balance: number;
    paid_balance: number;
    lifetime_earnings: number;
  } | null;
};

/** Shared "Bous mwen" KPI row for the restaurant/driver My Payments sections — same 4 numbers, same layout, for both roles. */
export function WalletSummaryCards({ wallet }: WalletSummaryCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        label="Balans disponib"
        value={formatHTG(wallet?.available_balance ?? 0)}
        icon={Wallet}
      />
      <KpiCard
        label="An atant konfimasyon"
        value={formatHTG(wallet?.pending_balance ?? 0)}
        icon={Clock}
      />
      <KpiCard label="Total peye" value={formatHTG(wallet?.paid_balance ?? 0)} icon={HandCoins} />
      <KpiCard
        label="Total antre (lavi)"
        value={formatHTG(wallet?.lifetime_earnings ?? 0)}
        icon={TrendingUp}
      />
    </div>
  );
}
