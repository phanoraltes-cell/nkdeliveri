import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WalletSummaryCards } from "@/components/dashboard/wallet/wallet-summary-cards";
import { CommissionHistoryTable } from "@/components/dashboard/commission/commission-history-table";
import { PayoutHistoryTable } from "@/components/dashboard/payouts/payout-history-table";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatHTG } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import {
  ShoppingBag,
  CheckCircle2,
  XCircle,
  Wallet,
  Bike,
  Star,
  Clock,
  TrendingUp,
} from "lucide-react";

export type BeneficiaryDetail = {
  type: "restaurant" | "driver";
  id: string;
  name: string;
  available_balance: number;
  pending_balance: number;
  paid_balance: number;
  lifetime_earnings: number;
  total_orders: number;
  last_payment_date: string | null;
  moncash_number: string | null;
  natcash_number: string | null;
};

type BeneficiaryDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beneficiary: BeneficiaryDetail | null;
};

/**
 * Full profile opened when the admin clicks a restaurant/driver — "Finans"
 * keeps the original wallet/commission/payout content, "Aktivite" adds
 * operational data (Phase 2 of the admin evolution plan): order counts +
 * top products + peak hours for a restaurant (get_restaurant_activity_summary,
 * a new RPC), or delivery/rating stats for a driver (get_drivers_admin with
 * an exact _driver_id filter — reuses the same aggregation Gestion Livreurs
 * already computes, no second implementation of the same numbers).
 */
export function BeneficiaryDetailDialog({
  open,
  onOpenChange,
  beneficiary,
}: BeneficiaryDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{beneficiary?.name}</DialogTitle>
          <DialogDescription>
            Pwofil konplè —{" "}
            {beneficiary?.last_payment_date
              ? `dènye peman ${new Date(beneficiary.last_payment_date).toLocaleDateString("fr-HT")}`
              : "poko gen peman"}
          </DialogDescription>
        </DialogHeader>

        {beneficiary && (
          <Tabs defaultValue="finans">
            <TabsList>
              <TabsTrigger value="finans">Finans</TabsTrigger>
              <TabsTrigger value="aktivite">Aktivite</TabsTrigger>
            </TabsList>

            <TabsContent value="finans" className="space-y-6">
              <WalletSummaryCards
                wallet={{
                  available_balance: beneficiary.available_balance,
                  pending_balance: beneficiary.pending_balance,
                  paid_balance: beneficiary.paid_balance,
                  lifetime_earnings: beneficiary.lifetime_earnings,
                }}
                totalOrders={beneficiary.total_orders}
              />

              <div className="flex flex-wrap gap-4 rounded-xl bg-brand-soft/30 p-3 text-sm">
                <span>
                  MonCash:{" "}
                  <b className="text-ink">{beneficiary.moncash_number ?? "Pa konfigire"}</b>
                </span>
                <span>
                  NatCash:{" "}
                  <b className="text-ink">{beneficiary.natcash_number ?? "Pa konfigire"}</b>
                </span>
              </div>

              <CommissionHistoryTable
                beneficiaryType={beneficiary.type}
                beneficiaryId={beneficiary.id}
              />

              <PayoutHistoryTable
                beneficiaryType={beneficiary.type}
                beneficiaryId={beneficiary.id}
                beneficiaryName={beneficiary.name}
                enabled={open}
              />
            </TabsContent>

            <TabsContent value="aktivite">
              {beneficiary.type === "restaurant" ? (
                <RestaurantActivityTab restaurantId={beneficiary.id} enabled={open} />
              ) : (
                <DriverActivityTab driverId={beneficiary.id} enabled={open} />
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RestaurantActivityTab({
  restaurantId,
  enabled,
}: {
  restaurantId: string;
  enabled: boolean;
}) {
  const [days] = useState(30);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const activity = useQuery({
    queryKey: ["restaurant-activity-summary", restaurantId, from, to],
    enabled: enabled && !!restaurantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_restaurant_activity_summary", {
        _restaurant_id: restaurantId,
        _from: from,
        _to: to,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  if (activity.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (!activity.data) {
    return <p className="text-sm text-ink-soft">Pa gen done aktivite pou 30 dènye jou yo.</p>;
  }

  const topProducts = (activity.data.top_products ?? []) as { name: string; qty: number }[];
  const peakHours = (activity.data.peak_hours ?? []) as { hour: number; count: number }[];

  return (
    <div className="space-y-5">
      <p className="text-xs text-ink-soft">30 dènye jou yo</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Kòmand resevwa"
          value={String(activity.data.orders_received)}
          icon={ShoppingBag}
        />
        <KpiCard label="Livre" value={String(activity.data.orders_completed)} icon={CheckCircle2} />
        <KpiCard label="Anile" value={String(activity.data.orders_cancelled)} icon={XCircle} />
        <KpiCard label="Revni" value={formatHTG(Number(activity.data.revenue))} icon={Wallet} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <h4 className="mb-2 text-xs font-bold uppercase text-ink-soft">Pwodwi ki pi vann</h4>
          {topProducts.length === 0 ? (
            <p className="text-sm text-ink-soft">Pa gen done.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {topProducts.map((p, i) => (
                <li key={p.name} className="flex items-center justify-between gap-2">
                  <span>
                    {i + 1}. {p.name}
                  </span>
                  <span className="font-bold text-brand-deep">{p.qty}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section>
          <h4 className="mb-2 text-xs font-bold uppercase text-ink-soft">Lè ki gen plis kòmand</h4>
          {peakHours.length === 0 ? (
            <p className="text-sm text-ink-soft">Pa gen done.</p>
          ) : (
            <ol className="space-y-1.5 text-sm">
              {peakHours.map((h) => (
                <li key={h.hour} className="flex items-center justify-between gap-2">
                  <span>{String(h.hour).padStart(2, "0")}:00</span>
                  <span className="font-bold text-brand-deep">{h.count} kòmand</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function DriverActivityTab({ driverId, enabled }: { driverId: string; enabled: boolean }) {
  const stats = useQuery({
    queryKey: ["driver-activity-summary", driverId],
    enabled: enabled && !!driverId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_drivers_admin", {
        _driver_id: driverId,
        _limit: 1,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  if (stats.isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    );
  }
  if (!stats.data) {
    return <p className="text-sm text-ink-soft">Pa gen done operasyonèl.</p>;
  }

  const successRate = stats.data.success_rate != null ? Number(stats.data.success_rate) : null;
  const avgMinutes =
    stats.data.avg_delivery_minutes != null ? Number(stats.data.avg_delivery_minutes) : null;
  const avgRating = stats.data.avg_rating != null ? Number(stats.data.avg_rating) : null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard label="Livrezon total" value={String(stats.data.total_deliveries)} icon={Bike} />
      <KpiCard
        label="Tux reyisit"
        value={successRate != null ? `${Math.round(successRate * 100)}%` : "—"}
        icon={TrendingUp}
      />
      <KpiCard label="Anile" value={String(stats.data.cancelled_count)} icon={XCircle} />
      <KpiCard
        label="Tan mwayèn livrezon"
        value={avgMinutes != null ? `${Math.round(avgMinutes)} min` : "—"}
        icon={Clock}
      />
      <KpiCard
        label="Nòt mwayèn"
        value={avgRating != null ? avgRating.toFixed(1) : "—"}
        icon={Star}
      />
    </div>
  );
}
