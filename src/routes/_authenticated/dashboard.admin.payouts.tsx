import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import {
  Wallet,
  Clock,
  HandCoins,
  Percent,
  Eye,
  Send,
  AlertTriangle,
  Users,
  Timer,
} from "lucide-react";
import { formatHTG } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { WALLET_STATUS_LABEL, WALLET_STATUS_TONE } from "@/lib/payout-status";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ProofThumb } from "@/components/proof-thumb";
import {
  PayoutPayModal,
  type PayoutBeneficiary,
} from "@/components/dashboard/payouts/payout-pay-modal";
import {
  BeneficiaryDetailDialog,
  type BeneficiaryDetail,
} from "@/components/dashboard/payouts/beneficiary-detail-dialog";
import { useAdminPayoutsData, type WalletRow } from "@/hooks/useAdminPayoutsData";

// recharts (~350KB) is only needed once this section has mounted — see
// dashboard.admin.index.tsx for the same lazy-import + Suspense/Skeleton pattern.
const RevenueChart = lazy(() =>
  import("@/components/dashboard/charts/revenue-chart").then((m) => ({ default: m.RevenueChart })),
);

export const Route = createFileRoute("/_authenticated/dashboard/admin/payouts")({
  component: AdminPayouts,
});

const PAGE_SIZE = 20;

function AdminPayouts() {
  const [tab, setTab] = useState<"restaurant" | "driver">("restaurant");
  const [search, setSearch] = useState("");
  // Defaults to "pending" (Feature 3 — auto-detect who's waiting to be
  // paid; the admin never has to manually search) — the dropdown still
  // lets them browse every other status.
  const [status, setStatus] = useState("pending");
  const [sort, setSort] = useState("priority");
  const [page, setPage] = useState(1);
  // Method = which rail the beneficiary is configured to receive on;
  // period = since when their oldest unpaid commission was earned (see
  // the RPC's own comment for why it isn't last_payment_date).
  const [method, setMethod] = useState("");
  const [period, setPeriod] = useState<"" | "today" | "week" | "month" | "custom">("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [payTarget, setPayTarget] = useState<PayoutBeneficiary | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<BeneficiaryDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const today = new Date();
  const periodRange: { from: string; to: string } =
    period === "today"
      ? { from: today.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) }
      : period === "week"
        ? {
            from: new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10),
            to: today.toISOString().slice(0, 10),
          }
        : period === "month"
          ? {
              from: new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10),
              to: today.toISOString().slice(0, 10),
            }
          : period === "custom"
            ? { from: customFrom, to: customTo }
            : { from: "", to: "" };

  const {
    kpisQueryKey,
    kpis,
    commissionSeries,
    payoutsSeries,
    topRestaurants,
    topDrivers,
    wallets,
  } = useAdminPayoutsData(
    tab,
    search,
    status,
    sort,
    page,
    PAGE_SIZE,
    method,
    periodRange.from,
    periodRange.to,
  );

  function switchTab(next: "restaurant" | "driver") {
    setTab(next);
    setSearch("");
    setStatus("");
    setMethod("");
    setPeriod("");
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

  function openDetail(row: WalletRow) {
    setDetailTarget({ type: tab, ...row });
    setDetailOpen(true);
  }

  const columns: DataTableColumn<WalletRow>[] = [
    {
      key: "photo",
      header: "Foto",
      cell: (r) => {
        const path = tab === "restaurant" ? r.logo_url : r.id_doc_url;
        if (!path) return <span className="text-ink-soft">—</span>;
        return tab === "restaurant" ? (
          <ProofThumb path={path} alt={r.name} />
        ) : (
          <ProofThumb path={path} bucket="driver-documents" alt={r.name} />
        );
      },
      hideOnMobileCard: true,
    },
    {
      key: "name",
      header: "Non",
      cell: (r) => (
        <div>
          <div className="font-bold text-ink">{r.name}</div>
          {r.phone && (
            <a href={`tel:${r.phone}`} className="text-xs font-semibold text-brand-deep">
              {r.phone}
            </a>
          )}
        </div>
      ),
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
            aria-label="Wè pwofil"
            onClick={() => openDetail(r)}
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
        <div className="flex items-center gap-4">
          <Link
            to="/dashboard/admin/payout-migration"
            className="text-sm font-bold text-brand-deep hover:underline"
          >
            Asistan Migrasyon
          </Link>
          <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
            ← Admin
          </Link>
        </div>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Restoran k ap tann"
          value={kpis.data ? String(kpis.data.restaurants_waiting_count) : "—"}
          icon={Users}
        />
        <KpiCard
          label="Livrè k ap tann"
          value={kpis.data ? String(kpis.data.drivers_waiting_count) : "—"}
          icon={Users}
        />
        <KpiCard
          label="Pi gwo restoran san peye"
          value={
            kpis.data?.largest_unpaid_restaurant_name
              ? `${kpis.data.largest_unpaid_restaurant_name} · ${formatHTG(Number(kpis.data.largest_unpaid_restaurant_amount))}`
              : "—"
          }
          icon={Wallet}
        />
        <KpiCard
          label="Pi gwo livrè san peye"
          value={
            kpis.data?.largest_unpaid_driver_name
              ? `${kpis.data.largest_unpaid_driver_name} · ${formatHTG(Number(kpis.data.largest_unpaid_driver_amount))}`
              : "—"
          }
          icon={Wallet}
        />
        <KpiCard
          label="Peman mwayèn"
          value={
            kpis.data?.avg_payout_amount ? formatHTG(Number(kpis.data.avg_payout_amount)) : "—"
          }
          icon={HandCoins}
        />
        <KpiCard
          label="Delè mwayèn anvan peman"
          value={
            kpis.data?.avg_payment_delay_hours != null
              ? `${Math.round(Number(kpis.data.avg_payment_delay_hours))} è`
              : "—"
          }
          icon={Timer}
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
          <option value="priority">Priyorite (defo)</option>
          <option value="balance_desc">Balans (pi wo)</option>
          <option value="balance_asc">Balans (pi ba)</option>
          <option value="oldest_unpaid_commission">Pi ansyen komisyon san peye</option>
          <option value="oldest_last_payment">Pi ansyen dènye peman</option>
          <option value="name_asc">Non (A-Z)</option>
          <option value="name_desc">Non (Z-A)</option>
        </select>
        <select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
            setPage(1);
          }}
          aria-label="Filtre pa metòd"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <option value="">Tout metòd</option>
          <option value="moncash">MonCash</option>
          <option value="natcash">NatCash</option>
        </select>
        <select
          value={period}
          onChange={(e) => {
            setPeriod(e.target.value as typeof period);
            setPage(1);
          }}
          aria-label="Filtre pa peryòd"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <option value="">Tout peryòd</option>
          <option value="today">Jodi a</option>
          <option value="week">Semèn sa a</option>
          <option value="month">Mwa sa a</option>
          <option value="custom">Peryòd pèsonalize</option>
        </select>
        {period === "custom" && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                setPage(1);
              }}
              aria-label="Depi"
              className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
            />
            <input
              type="date"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                setPage(1);
              }}
              aria-label="Jiska"
              className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
            />
          </>
        )}
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
        invalidateKeys={[["admin-wallets"], kpisQueryKey]}
      />

      <BeneficiaryDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        beneficiary={detailTarget}
      />
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
