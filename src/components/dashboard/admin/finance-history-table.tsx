import { useState } from "react";
import { Download, FileText, History as HistoryIcon } from "lucide-react";
import { toast } from "sonner";
import { formatHTG } from "@/lib/format";
import { downloadCSV } from "@/lib/csv-export";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge";
import {
  useAdminFinanceHistory,
  type FinanceHistoryFilters,
  type FinanceHistoryRow,
} from "@/hooks/useAdminFinanceData";

const EVENT_TYPE_LABEL: Record<string, string> = {
  commission: "Komisyon",
  payout: "Dekesman",
  payment: "Peman",
};

const STATUS_TONE: Record<string, StatusTone> = {
  paid: "good",
  confirmed: "good",
  resolved: "good",
  available: "neutral",
  pending: "warn",
  partially_paid: "warn",
  awaiting_proof: "warn",
  under_review: "warn",
  disputed: "bad",
  failed: "bad",
  reversed: "bad",
  refunded: "info",
};

const STATUS_OPTIONS = Object.keys(STATUS_TONE);

const inputCls =
  "rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30";

const PAGE_SIZE = 25;

const EMPTY_FILTERS: FinanceHistoryFilters = {
  search: "",
  restaurantId: "",
  driverId: "",
  from: "",
  to: "",
  amountMin: "",
  amountMax: "",
  status: "",
  method: "",
  eventType: "",
  sort: "date_desc",
};

type FinanceHistoryTableProps = {
  onRowClick: (row: FinanceHistoryRow) => void;
};

/**
 * "Istorik" tab — the unified cross-entity feed (commission_ledger +
 * payouts + payments) from get_admin_finance_history_secure. Clicking a
 * row with an order_id opens the caller's order-timeline drill-down
 * (payout rows have no single order_id — see the RPC's own comment —
 * so those rows aren't clickable).
 */
export function FinanceHistoryTable({ onRowClick }: FinanceHistoryTableProps) {
  const [filters, setFilters] = useState<FinanceHistoryFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const { history } = useAdminFinanceHistory(filters, page, PAGE_SIZE);

  function setFilter<K extends keyof FinanceHistoryFilters>(
    key: K,
    value: FinanceHistoryFilters[K],
  ) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  const rows = history.data ?? [];
  const totalCount = rows[0]?.total_count ?? 0;

  function exportCSV() {
    downloadCSV(
      `finance-history_${filters.from || "all"}_${filters.to || "all"}.csv`,
      [
        "Dat",
        "Tip",
        "Kòmand",
        "Restoran",
        "Livrè",
        "Mòn (HTG)",
        "Estati",
        "Metòd",
        "Referans",
        "Deskripsyon",
      ],
      rows.map((r) => [
        new Date(r.event_date).toLocaleString("fr-HT"),
        EVENT_TYPE_LABEL[r.event_type] ?? r.event_type,
        r.order_number ?? "",
        r.restaurant_name ?? "",
        r.driver_name ?? "",
        r.amount,
        r.status ?? "",
        r.method ?? "",
        r.reference ?? "",
        r.description ?? "",
      ]),
    );
    toast.success("CSV telechaje");
  }

  async function exportPDF() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text("NK Deliveri - Istorik Finansye", 40, 40);
    doc.setFontSize(10);
    doc.text(`Peryòd: ${filters.from || "tout"} → ${filters.to || "tout"}`, 40, 58);
    doc.text(`${rows.length} evènman nan paj sa a (sou ${totalCount} total)`, 40, 74);
    autoTable(doc, {
      startY: 90,
      head: [["Dat", "Tip", "Kòmand", "Restoran", "Livrè", "Mòn", "Estati", "Metòd"]],
      body: rows.map((r) => [
        new Date(r.event_date).toLocaleDateString("fr-HT"),
        EVENT_TYPE_LABEL[r.event_type] ?? r.event_type,
        r.order_number ?? "—",
        r.restaurant_name ?? "—",
        r.driver_name ?? "—",
        formatHTG(r.amount),
        r.status ?? "—",
        r.method ?? "—",
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [234, 88, 12] },
    });
    doc.save(`finance-history_${filters.from || "all"}_${filters.to || "all"}.pdf`);
    toast.success("PDF telechaje");
  }

  const columns: DataTableColumn<FinanceHistoryRow>[] = [
    {
      key: "event_date",
      header: "Dat",
      cell: (r) => (
        <span className="text-xs text-ink-soft">
          {new Date(r.event_date).toLocaleString("fr-HT")}
        </span>
      ),
    },
    {
      key: "event_type",
      header: "Tip",
      cell: (r) => (
        <StatusBadge tone="info">{EVENT_TYPE_LABEL[r.event_type] ?? r.event_type}</StatusBadge>
      ),
    },
    {
      key: "who",
      header: "Restoran/Livrè",
      cell: (r) => (
        <div>
          <div className="font-bold text-ink">{r.restaurant_name || r.driver_name || "—"}</div>
          {r.order_number && <div className="text-xs text-ink-soft">{r.order_number}</div>}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Mòn",
      cell: (r) => <span className="font-bold text-brand-deep">{formatHTG(r.amount)}</span>,
    },
    {
      key: "status",
      header: "Estati",
      cell: (r) =>
        r.status ? (
          <StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusBadge>
        ) : (
          <span className="text-ink-soft">—</span>
        ),
      hideOnMobileCard: true,
    },
    {
      key: "method",
      header: "Metòd",
      cell: (r) => <span className="uppercase text-ink-soft">{r.method ?? "—"}</span>,
      hideOnMobileCard: true,
    },
    {
      key: "description",
      header: "Deskripsyon",
      cell: (r) => <span className="text-xs text-ink-soft">{r.description}</span>,
      hideOnMobileCard: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={filters.search}
          onChange={(e) => setFilter("search", e.target.value)}
          placeholder="Chèche kòmand, restoran, livrè, referans…"
          aria-label="Chèche"
          className={`min-w-0 flex-1 ${inputCls}`}
        />
        <select
          value={filters.eventType}
          onChange={(e) => setFilter("eventType", e.target.value)}
          aria-label="Filtre pa tip"
          className={inputCls}
        >
          <option value="">Tout tip</option>
          <option value="commission">Komisyon</option>
          <option value="payout">Dekesman</option>
          <option value="payment">Peman</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => setFilter("status", e.target.value)}
          aria-label="Filtre pa estati"
          className={inputCls}
        >
          <option value="">Tout estati</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={filters.method}
          onChange={(e) => setFilter("method", e.target.value)}
          aria-label="Filtre pa metòd"
          className={inputCls}
        >
          <option value="">Tout metòd</option>
          <option value="moncash">MonCash</option>
          <option value="natcash">NatCash</option>
          <option value="kach">Kach</option>
        </select>
        <select
          value={filters.sort}
          onChange={(e) => setFilter("sort", e.target.value)}
          aria-label="Klase pa"
          className={inputCls}
        >
          <option value="date_desc">Dat (pi resan)</option>
          <option value="date_asc">Dat (pi ansyen)</option>
          <option value="amount_desc">Mòn (pi wo)</option>
          <option value="amount_asc">Mòn (pi ba)</option>
        </select>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          Depi
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilter("from", e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          Jiska
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilter("to", e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          Mòn min
          <input
            type="number"
            inputMode="decimal"
            value={filters.amountMin}
            onChange={(e) => setFilter("amountMin", e.target.value)}
            className={`w-24 ${inputCls}`}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          Mòn max
          <input
            type="number"
            inputMode="decimal"
            value={filters.amountMax}
            onChange={(e) => setFilter("amountMax", e.target.value)}
            className={`w-24 ${inputCls}`}
          />
        </label>
        <button
          onClick={exportCSV}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
        <button
          onClick={exportPDF}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1 rounded-full bg-brand-deep px-3 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          <FileText className="h-3.5 w-3.5" /> PDF
        </button>
      </div>

      <DataTable<FinanceHistoryRow>
        rows={rows}
        getRowKey={(r) => r.event_id}
        loading={history.isLoading}
        mobileTitleKey="who"
        emptyState={
          <EmptyState
            icon={HistoryIcon}
            title="Pa gen rezilta"
            description="Pa gen okenn evènman finansye ki koresponn ak rechèch/filtè sa a."
          />
        }
        columns={columns.map((col) =>
          col.key === "who"
            ? {
                ...col,
                cell: (r: FinanceHistoryRow) =>
                  r.order_id ? (
                    <button
                      type="button"
                      onClick={() => onRowClick(r)}
                      className="text-left hover:underline"
                    >
                      {col.cell(r)}
                    </button>
                  ) : (
                    col.cell(r)
                  ),
              }
            : col,
        )}
      />

      <PaginationControls
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={setPage}
      />
    </div>
  );
}
