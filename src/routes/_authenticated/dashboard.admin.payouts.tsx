import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet,
  Clock,
  HandCoins,
  Percent,
  Eye,
  Send,
  History as HistoryIcon,
  AlertTriangle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { WALLET_STATUS_LABEL, WALLET_STATUS_TONE } from "@/lib/payout-status";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  PayoutPayModal,
  type PayoutBeneficiary,
} from "@/components/dashboard/payouts/payout-pay-modal";
import { PayoutHistoryDialog } from "@/components/dashboard/payouts/payout-history-dialog";

// recharts (~350KB) is only needed once this section has mounted — see
// dashboard.admin.index.tsx for the same lazy-import + Suspense/Skeleton pattern.
const RevenueChart = lazy(() =>
  import("@/components/dashboard/charts/revenue-chart").then((m) => ({ default: m.RevenueChart })),
);

export const Route = createFileRoute("/_authenticated/dashboard/admin/payouts")({
  component: AdminPayouts,
});

const PAGE_SIZE = 20;

type WalletRow = {
  id: string;
  name: string;
  moncash_number: string | null;
  moncash_account_name: string | null;
  natcash_number: string | null;
  natcash_account_name: string | null;
  available_balance: number;
  pending_balance: number;
  paid_balance: number;
  lifetime_earnings: number;
  total_orders: number;
  last_payment_date: string | null;
  computed_status: string;
  total_count: number;
};

const MONTH_LABEL = new Intl.DateTimeFormat("fr-HT", { month: "short" });

function bucketMonthly(rows: { month: string; value: number }[]) {
  return rows.map((r) => ({ label: MONTH_LABEL.format(new Date(r.month)), value: r.value }));
}

function AdminPayouts() {
  const [tab, setTab] = useState<"restaurant" | "driver">("restaurant");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("balance_desc");
  const [page, setPage] = useState(1);

  const [payTarget, setPayTarget] = useState<PayoutBeneficiary | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{
    type: "restaurant" | "driver";
    id: string;
    name: string;
  } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewTarget, setViewTarget] = useState<WalletRow | null>(null);
  const [viewOpen, setViewOpen] = useState(false);

  const kpis = useQuery({
    queryKey: ["admin-payout-kpis"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_payout_kpis");
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const fromStr = since.toISOString().slice(0, 10);
  const toStr = new Date().toISOString().slice(0, 10);

  const commissionSeries = useQuery({
    queryKey: ["admin-commission-monthly", fromStr, toStr],
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
    queryKey: ["admin-payouts-monthly", fromStr, toStr],
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
    queryKey: ["admin-top-restaurants", fromStr, toStr],
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
    queryKey: ["admin-top-drivers", fromStr, toStr],
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

  const walletsQueryKey = ["admin-wallets", tab, search, status, sort, page] as const;
  const wallets = useQuery({
    queryKey: walletsQueryKey,
    queryFn: async (): Promise<WalletRow[]> => {
      if (tab === "restaurant") {
        const { data, error } = await supabase.rpc("get_restaurant_wallets_admin", {
          _search: search || undefined,
          _status: status || undefined,
          _sort: sort,
          _limit: PAGE_SIZE,
          _offset: (page - 1) * PAGE_SIZE,
        });
        if (error) throw error;
        return (data ?? []).map((r) => ({
          id: r.restaurant_id,
          name: r.name,
          moncash_number: r.moncash_number,
          moncash_account_name: r.moncash_account_name,
          natcash_number: r.natcash_number,
          natcash_account_name: r.natcash_account_name,
          available_balance: Number(r.available_balance),
          pending_balance: Number(r.pending_balance),
          paid_balance: Number(r.paid_balance),
          lifetime_earnings: Number(r.lifetime_earnings),
          total_orders: r.total_orders,
          last_payment_date: r.last_payment_date,
          computed_status: r.computed_status,
          total_count: Number(r.total_count),
        }));
      }
      const { data, error } = await supabase.rpc("get_driver_wallets_admin", {
        _search: search || undefined,
        _status: status || undefined,
        _sort: sort,
        _limit: PAGE_SIZE,
        _offset: (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.driver_id,
        name: r.name,
        moncash_number: r.moncash_number,
        moncash_account_name: r.moncash_account_name,
        natcash_number: r.natcash_number,
        natcash_account_name: r.natcash_account_name,
        available_balance: Number(r.available_balance),
        pending_balance: Number(r.pending_balance),
        paid_balance: Number(r.paid_balance),
        lifetime_earnings: Number(r.lifetime_earnings),
        total_orders: r.total_orders,
        last_payment_date: r.last_payment_date,
        computed_status: r.computed_status,
        total_count: Number(r.total_count),
      }));
    },
  });

  function switchTab(next: "restaurant" | "driver") {
    setTab(next);
    setSearch("");
    setStatus("");
    setPage(1);
  }

  function openPay(row: WalletRow) {
    setPayTarget({
      type: tab,
      id: row.id,
      name: row.name,
      availableBalance: row.available_balance,
      moncashNumber: row.moncash_number,
      natcashNumber: row.natcash_number,
    });
    setPayOpen(true);
  }

  function openHistory(row: WalletRow) {
    setHistoryTarget({ type: tab, id: row.id, name: row.name });
    setHistoryOpen(true);
  }

  function openView(row: WalletRow) {
    setViewTarget(row);
    setViewOpen(true);
  }

  const columns: DataTableColumn<WalletRow>[] = [
    {
      key: "name",
      header: "Non",
      cell: (r) => <span className="font-bold text-ink">{r.name}</span>,
    },
    { key: "total_orders", header: "Kòmand", cell: (r) => r.total_orders },
    {
      key: "available_balance",
      header: "Balans disponib",
      cell: (r) => (
        <span className="font-bold text-brand-deep">{formatHTG(r.available_balance)}</span>
      ),
    },
    { key: "paid_balance", header: "Balans peye", cell: (r) => formatHTG(r.paid_balance) },
    {
      key: "pending_balance",
      header: "Rès",
      cell: (r) => formatHTG(r.pending_balance),
      hideOnMobileCard: true,
    },
    {
      key: "last_payment_date",
      header: "Dènye peman",
      cell: (r) =>
        r.last_payment_date ? new Date(r.last_payment_date).toLocaleDateString("fr-HT") : "—",
      hideOnMobileCard: true,
    },
    {
      key: "computed_status",
      header: "Estati",
      cell: (r) => (
        <StatusBadge tone={WALLET_STATUS_TONE[r.computed_status]}>
          {WALLET_STATUS_LABEL[r.computed_status] ?? r.computed_status}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "Aksyon",
      cell: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Wè detay"
            onClick={() => openView(r)}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Peye"
            disabled={r.available_balance <= 0}
            onClick={() => openPay(r)}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Istwa"
            onClick={() => openHistory(r)}
          >
            <HistoryIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  const totalCount = wallets.data?.[0]?.total_count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Dekesman</h1>
          <p className="mt-1 text-ink-soft">
            Peman manyèl bay restoran ak livrè yo, apati komisyon yo fè otomatikman.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Dwe restoran yo"
          value={kpis.data ? formatHTG(Number(kpis.data.owed_restaurants)) : "—"}
          icon={Wallet}
        />
        <KpiCard
          label="Dwe livrè yo"
          value={kpis.data ? formatHTG(Number(kpis.data.owed_drivers)) : "—"}
          icon={Wallet}
        />
        <KpiCard
          label="Komisyon mwa sa a"
          value={kpis.data ? formatHTG(Number(kpis.data.commissions_this_month)) : "—"}
          icon={Percent}
        />
        <KpiCard
          label="Total deja peye"
          value={kpis.data ? formatHTG(Number(kpis.data.total_paid)) : "—"}
          icon={HandCoins}
        />
        <KpiCard
          label="Rès an atant konfimasyon"
          value={kpis.data ? formatHTG(Number(kpis.data.total_pending)) : "—"}
          icon={Clock}
        />
        <KpiCard
          label="Kantite peman"
          value={kpis.data ? String(kpis.data.payout_count) : "—"}
          icon={HandCoins}
        />
        <KpiCard
          label="Litij"
          value={kpis.data ? String(kpis.data.dispute_count) : "—"}
          icon={AlertTriangle}
        />
      </div>

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
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Peman chak mwa</h2>
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

      <div className="flex flex-wrap items-center gap-2 border-b border-brand-soft/60">
        <button
          onClick={() => switchTab("restaurant")}
          className={`px-4 py-2 text-sm font-bold ${tab === "restaurant" ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"}`}
        >
          Restoran
        </button>
        <button
          onClick={() => switchTab("driver")}
          className={`px-4 py-2 text-sm font-bold ${tab === "driver" ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"}`}
        >
          Livrè
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={tab === "restaurant" ? "Chèche yon restoran…" : "Chèche yon livrè…"}
          aria-label="Chèche"
          className="min-w-0 flex-1 rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filtre pa estati"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <option value="">Tout estati</option>
          <option value="pending">An atant</option>
          <option value="paid">Peye</option>
          <option value="disputed">Kontete</option>
          <option value="settled">Regle</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Klase pa"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <option value="balance_desc">Balans (pi wo)</option>
          <option value="balance_asc">Balans (pi ba)</option>
          <option value="name_asc">Non (A-Z)</option>
          <option value="name_desc">Non (Z-A)</option>
          <option value="last_payment_desc">Dènye peman</option>
        </select>
      </div>

      <DataTable<WalletRow>
        rows={wallets.data ?? []}
        getRowKey={(r) => r.id}
        loading={wallets.isLoading}
        mobileTitleKey="name"
        emptyState={
          <EmptyState
            icon={Wallet}
            title="Pa gen rezilta"
            description="Pa gen okenn benefisyè ki koresponn ak rechèch/filtè sa a."
          />
        }
        columns={columns}
      />

      <PaginationControls
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
      />

      <PayoutPayModal
        open={payOpen}
        onOpenChange={setPayOpen}
        beneficiary={payTarget}
        invalidateKeys={[["admin-wallets"], ["admin-payout-kpis"]]}
      />
      <PayoutHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        beneficiary={historyTarget}
      />

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{viewTarget?.name}</DialogTitle>
            <DialogDescription>Detay balans ak enfòmasyon peman</DialogDescription>
          </DialogHeader>
          {viewTarget && (
            <div className="space-y-2 text-sm">
              <Row label="Balans disponib" value={formatHTG(viewTarget.available_balance)} />
              <Row label="An atant konfimasyon" value={formatHTG(viewTarget.pending_balance)} />
              <Row label="Total peye" value={formatHTG(viewTarget.paid_balance)} />
              <Row label="Total antre (lavi)" value={formatHTG(viewTarget.lifetime_earnings)} />
              <Row label="Kòmand total" value={String(viewTarget.total_orders)} />
              <Row
                label="Dènye peman"
                value={
                  viewTarget.last_payment_date
                    ? new Date(viewTarget.last_payment_date).toLocaleString("fr-HT")
                    : "—"
                }
              />
              <div className="mt-3 border-t border-brand-soft/40 pt-2">
                <Row label="MonCash" value={viewTarget.moncash_number ?? "Pa konfigire"} />
                <Row label="NatCash" value={viewTarget.natcash_number ?? "Pa konfigire"} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-soft">{label}</span>
      <span className="font-bold text-ink">{value}</span>
    </div>
  );
}

/** Simple ranked list for "Top restoran"/"Top livrè" — a small table doesn't
 * need a new charting dependency. */
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
