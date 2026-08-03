import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Send, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FinanceOverviewSection } from "@/components/dashboard/admin/finance-overview-section";
import { FinanceHistoryTable } from "@/components/dashboard/admin/finance-history-table";
import { OrderFinancialTimelineDialog } from "@/components/dashboard/admin/order-financial-timeline-dialog";
import {
  PayoutPayModal,
  type PayoutBeneficiary,
} from "@/components/dashboard/payouts/payout-pay-modal";
import type { FinanceHistoryRow } from "@/hooks/useAdminFinanceData";

// recharts (~350KB) only loaded once the Revenus tab actually mounts —
// same lazy-import + Suspense/Skeleton pattern as dashboard.admin.payouts.tsx.
const RevenueChart = lazy(() =>
  import("@/components/dashboard/charts/revenue-chart").then((m) => ({ default: m.RevenueChart })),
);

export const Route = createFileRoute("/_authenticated/dashboard/admin/finance")({
  component: AdminFinance,
});

const TABS = [
  "overview",
  "history",
  "revenue",
  "commissions",
  "payouts",
  "payments",
  "moncash",
  "wallets",
] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  overview: "Vue globale",
  history: "Istorik",
  revenue: "Revni",
  commissions: "Komisyon",
  payouts: "Dekesman",
  payments: "Peman",
  moncash: "MonCash",
  wallets: "Wallets",
};

const inputCls =
  "rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30";

const PERIOD_LABEL: Record<string, string> = {
  "": "Tout tan",
  month: "Mwa sa a",
  custom: "Pèsonalize",
};

function AdminFinance() {
  const [tab, setTab] = useState<Tab>("overview");

  // Vue globale's own period filter — independent of Istorik's (which
  // owns its own date range internally) and of Revenus' fixed 6-month
  // trend window (matching dashboard.admin.payouts.tsx's own convention).
  const [period, setPeriod] = useState<"" | "month" | "custom">("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const today = new Date();
  const overviewRange =
    period === "month"
      ? {
          from: new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10),
          to: "",
        }
      : period === "custom"
        ? { from: customFrom, to: customTo }
        : { from: "", to: "" };

  const [timelineOrder, setTimelineOrder] = useState<{ id: string; number: string | null } | null>(
    null,
  );
  const [timelineOpen, setTimelineOpen] = useState(false);

  function openTimeline(row: FinanceHistoryRow) {
    if (!row.order_id) return;
    setTimelineOrder({ id: row.order_id, number: row.order_number });
    setTimelineOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Tablo Finansye</h1>
          <p className="mt-1 text-ink-soft">
            Vue d'ansanm sou tout aktivite finansye platfòm nan — komisyon, dekesman, peman ak
            MonCash.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-brand-soft/60">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-bold ${
              tab === t
                ? "border-b-2 border-brand-deep text-brand-deep"
                : "text-ink-soft hover:text-ink"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {(["", "month", "custom"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                  period === p ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"
                }`}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
            {period === "custom" && (
              <>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  aria-label="Depi"
                  className={inputCls}
                />
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  aria-label="Jiska"
                  className={inputCls}
                />
              </>
            )}
          </div>
          <FinanceOverviewSection from={overviewRange.from} to={overviewRange.to} />
        </div>
      )}

      {tab === "history" && (
        <>
          <FinanceHistoryTable onRowClick={openTimeline} />
          <OrderFinancialTimelineDialog
            orderId={timelineOrder?.id ?? null}
            orderNumber={timelineOrder?.number}
            open={timelineOpen}
            onOpenChange={setTimelineOpen}
          />
        </>
      )}

      {tab === "revenue" && <RevenueTab />}

      {tab === "commissions" && (
        <LinkOutCard
          title="Komisyon"
          description="Istorik konplè komisyon pa restoran/livrè, ak rechèch pa benefisyè."
          to="/dashboard/admin/commissions"
        />
      )}

      {tab === "payouts" && <PayoutsTab />}

      {tab === "payments" && (
        <LinkOutCard
          title="Peman Kliyan"
          description="Peman manyèl MonCash/NatCash an atant revizyon, ak istorik konplè peman yo."
          to="/dashboard/admin/payments"
        />
      )}

      {tab === "moncash" && (
        <LinkOutCard
          title="MonCash"
          description="Sante kanal MonCash Automatik — webhook, dekesman kwense, erè API."
          to="/dashboard/admin/moncash"
        />
      )}

      {tab === "wallets" && (
        <LinkOutCard
          title="Wallets"
          description="Balans konplè chak restoran/livrè, ak zouti peman/filtè yo."
          to="/dashboard/admin/payouts"
        />
      )}
    </div>
  );
}

function LinkOutCard({
  title,
  description,
  to,
}: {
  title: string;
  description: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-4 rounded-2xl border border-brand-soft/60 bg-white p-6 shadow-brand-xs transition hover:shadow-brand-sm"
    >
      <div>
        <div className="font-display text-lg font-bold text-ink">{title}</div>
        <p className="mt-1 text-sm text-ink-soft">{description}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-brand-deep" />
    </Link>
  );
}

function bucketMonthly(rows: { month: string; value: number }[]) {
  const MONTH_LABEL = new Intl.DateTimeFormat("fr-HT", { month: "short" });
  return rows.map((r) => ({ label: MONTH_LABEL.format(new Date(r.month)), value: r.value }));
}

function RevenueTab() {
  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const fromStr = since.toISOString().slice(0, 10);
  const toStr = new Date().toISOString().slice(0, 10);

  const commissionSeries = useQuery({
    queryKey: ["admin-finance-commission-monthly", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_commission_monthly_series", {
        _from: fromStr,
        _to: toStr,
      });
      if (error) throw error;
      return bucketMonthly(
        (data ?? []).map((d) => ({ month: d.month, value: Number(d.total_commission) })),
      );
    },
  });
  const payoutsSeries = useQuery({
    queryKey: ["admin-finance-payouts-monthly", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_payouts_monthly_series", {
        _from: fromStr,
        _to: toStr,
      });
      if (error) throw error;
      return bucketMonthly(
        (data ?? []).map((d) => ({ month: d.month, value: Number(d.total_paid) })),
      );
    },
  });
  const topRestaurants = useQuery({
    queryKey: ["admin-finance-top-restaurants", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_top_restaurants_by_commission", {
        _from: fromStr,
        _to: toStr,
        _limit: 5,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({ name: r.name, value: Number(r.total_commission) }));
    },
  });
  const topDrivers = useQuery({
    queryKey: ["admin-finance-top-drivers", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_top_drivers_by_commission", {
        _from: fromStr,
        _to: toStr,
        _limit: 5,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({ name: r.name, value: Number(r.total_commission) }));
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Komisyon chak mwa</h2>
          {commissionSeries.isLoading ? (
            <Skeleton className="h-[220px] w-full rounded-xl" />
          ) : (
            <Suspense fallback={<Skeleton className="h-[220px] w-full rounded-xl" />}>
              <RevenueChart
                data={commissionSeries.data ?? []}
                formatValue={formatHTG}
                height={220}
              />
            </Suspense>
          )}
        </section>
        <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Dekesman chak mwa</h2>
          {payoutsSeries.isLoading ? (
            <Skeleton className="h-[220px] w-full rounded-xl" />
          ) : (
            <Suspense fallback={<Skeleton className="h-[220px] w-full rounded-xl" />}>
              <RevenueChart data={payoutsSeries.data ?? []} formatValue={formatHTG} height={220} />
            </Suspense>
          )}
        </section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Top restoran</h2>
          <TopList rows={topRestaurants.data ?? []} loading={topRestaurants.isLoading} />
        </section>
        <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Top livrè</h2>
          <TopList rows={topDrivers.data ?? []} loading={topDrivers.isLoading} />
        </section>
      </div>
    </div>
  );
}

/** Same shape as the private TopList in dashboard.admin.payouts.tsx — not
 * exported there, so duplicated here rather than reaching into that file. */
function TopList({ rows, loading }: { rows: { name: string; value: number }[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-[180px] w-full rounded-xl" />;
  if (rows.length === 0) {
    return <p className="text-sm text-ink-soft">Pa gen done pou peryòd sa a.</p>;
  }
  return (
    <ol className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.name} className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft/60 text-xs font-bold text-brand-deep">
              {i + 1}
            </span>
            <span className="text-ink">{r.name}</span>
          </span>
          <span className="font-bold text-brand-deep">{formatHTG(r.value)}</span>
        </li>
      ))}
    </ol>
  );
}

type QuickWalletRow = {
  id: string;
  name: string;
  available_balance: number;
  moncash_number: string | null;
  natcash_number: string | null;
};

function PayoutsTab() {
  const [beneficiaryType, setBeneficiaryType] = useState<"restaurant" | "driver">("restaurant");
  const [search, setSearch] = useState("");
  const [payTarget, setPayTarget] = useState<PayoutBeneficiary | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const results = useQuery({
    queryKey: ["admin-finance-payout-quick-search", beneficiaryType, search],
    queryFn: async (): Promise<QuickWalletRow[]> => {
      // Two literal RPC names, not one dynamic variable -- Supabase's
      // generated types can only discriminate get_restaurant_wallets_admin
      // vs. get_driver_wallets_admin's differently-shaped rows (restaurant_id
      // vs. driver_id) when the function name is a literal at each call site.
      if (beneficiaryType === "restaurant") {
        const { data, error } = await supabase.rpc("get_restaurant_wallets_admin", {
          _search: search || undefined,
          _status: "pending",
          _sort: "balance_desc",
          _limit: 8,
          _offset: 0,
        });
        if (error) throw error;
        return (data ?? []).map((r) => ({
          id: r.restaurant_id,
          name: r.name,
          available_balance: Number(r.available_balance),
          moncash_number: r.moncash_number,
          natcash_number: r.natcash_number,
        }));
      }
      const { data, error } = await supabase.rpc("get_driver_wallets_admin", {
        _search: search || undefined,
        _status: "pending",
        _sort: "balance_desc",
        _limit: 8,
        _offset: 0,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.driver_id,
        name: r.name,
        available_balance: Number(r.available_balance),
        moncash_number: r.moncash_number,
        natcash_number: r.natcash_number,
      }));
    },
  });

  function openPay(row: QuickWalletRow) {
    setPayTarget({
      type: beneficiaryType,
      id: row.id,
      name: row.name,
      availableBalance: row.available_balance,
      moncashNumber: row.moncash_number,
      natcashNumber: row.natcash_number,
    });
    setPayOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
        <h2 className="mb-1 font-display text-lg font-bold text-ink">Peye rapid</h2>
        <p className="mb-3 text-sm text-ink-soft">
          Chèche yon benefisyè ki gen balans an atant, epi peye l san w pa kite paj sa a — pou tablo
          konplè a ak tout filtè yo, gade "Wè tout" anba a.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setBeneficiaryType("restaurant")}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${
              beneficiaryType === "restaurant"
                ? "bg-brand-deep text-white"
                : "bg-brand-soft/60 text-brand-deep"
            }`}
          >
            Restoran
          </button>
          <button
            onClick={() => setBeneficiaryType("driver")}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${
              beneficiaryType === "driver"
                ? "bg-brand-deep text-white"
                : "bg-brand-soft/60 text-brand-deep"
            }`}
          >
            Livrè
          </button>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                beneficiaryType === "restaurant" ? "Chèche yon restoran…" : "Chèche yon livrè…"
              }
              aria-label="Chèche benefisyè"
              className={`w-full pl-8 ${inputCls}`}
            />
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {results.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))
          ) : (results.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-soft">Pa gen benefisyè ki koresponn.</p>
          ) : (
            (results.data ?? []).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-brand-soft/50 bg-cream/40 p-3"
              >
                <div>
                  <div className="font-bold text-ink">{r.name}</div>
                  <div className="text-xs text-ink-soft">
                    Balans: {formatHTG(r.available_balance)}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={r.available_balance <= 0}
                  onClick={() => openPay(r)}
                  className="gap-1.5"
                >
                  <Send className="h-3.5 w-3.5" /> Peye
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      <LinkOutCard
        title="Wè tout dekesman"
        description="Tablo konplè ak tout filtè, istorik, ak asistan migrasyon."
        to="/dashboard/admin/payouts"
      />

      <PayoutPayModal
        open={payOpen}
        onOpenChange={setPayOpen}
        beneficiary={payTarget}
        invalidateKeys={[["admin-finance-payout-quick-search"], ["admin-finance-overview"]]}
      />
    </div>
  );
}
