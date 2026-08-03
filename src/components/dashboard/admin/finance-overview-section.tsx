import {
  Percent,
  Clock,
  HandCoins,
  Wallet,
  CalendarDays,
  CalendarRange,
  Calendar,
  Store,
  Bike,
  Smartphone,
  Banknote,
  CreditCard,
} from "lucide-react";
import { formatHTG } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminFinanceOverview } from "@/hooks/useAdminFinanceData";

type FinanceOverviewSectionProps = {
  from: string;
  to: string;
};

/**
 * Vue globale — the 12 KPI tiles from get_admin_finance_overview_secure.
 * "Aujourd'hui/semaine/mois" and the two balance snapshots always reflect
 * the current moment regardless of `from`/`to` (see the RPC's own
 * comment) — the hint text says so explicitly instead of leaving an
 * admin to wonder why the number didn't move when they changed the
 * date range.
 */
export function FinanceOverviewSection({ from, to }: FinanceOverviewSectionProps) {
  const { overview } = useAdminFinanceOverview(from, to);
  const d = overview.data;

  if (overview.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total komisyon"
          value={d ? formatHTG(d.total_commissions) : "—"}
          icon={Percent}
          hint="Nan peryòd la"
        />
        <KpiCard
          label="Komisyon an atant"
          value={d ? formatHTG(d.commissions_pending) : "—"}
          icon={Clock}
          hint="Balans kounye a"
        />
        <KpiCard
          label="Komisyon peye"
          value={d ? formatHTG(d.commissions_paid) : "—"}
          icon={HandCoins}
          hint="Nan peryòd la"
        />
        <KpiCard
          label="Montan pou dekèse"
          value={d ? formatHTG(d.amount_to_disburse) : "—"}
          icon={Wallet}
          hint="Balans kounye a"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Dekesman jodi a"
          value={d ? formatHTG(d.payouts_today) : "—"}
          icon={CalendarDays}
        />
        <KpiCard
          label="Dekesman semèn sa a"
          value={d ? formatHTG(d.payouts_this_week) : "—"}
          icon={CalendarRange}
        />
        <KpiCard
          label="Dekesman mwa sa a"
          value={d ? formatHTG(d.payouts_this_month) : "—"}
          icon={Calendar}
        />
        <KpiCard
          label="Restoran remèt"
          value={d ? String(d.restaurants_paid_count) : "—"}
          icon={Store}
          hint="Nan peryòd la"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Livrè remèt"
          value={d ? String(d.drivers_paid_count) : "—"}
          icon={Bike}
          hint="Nan peryòd la"
        />
        <KpiCard
          label="Volim MonCash"
          value={d ? formatHTG(d.moncash_volume) : "—"}
          icon={Smartphone}
        />
        <KpiCard label="Volim Kach" value={d ? formatHTG(d.cash_volume) : "—"} icon={Banknote} />
        <KpiCard
          label="Volim NatCash"
          value={d ? formatHTG(d.natcash_volume) : "—"}
          icon={CreditCard}
        />
      </div>
    </div>
  );
}
