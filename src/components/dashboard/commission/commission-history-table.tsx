import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { COMMISSION_STATUS_LABEL, COMMISSION_STATUS_TONE } from "@/lib/payout-status";
import { formatHTG } from "@/lib/format";
import { useRealtimeTableSync } from "@/hooks/useRealtimeTableSync";

type CommissionRow = {
  id: string;
  order_id: string | null;
  order_number: string | null;
  order_date: string | null;
  contact_phone: string | null;
  gross_amount: number;
  commission_rate: number | null;
  commission_amount: number;
  net_amount: number;
  covered_amount: number;
  entry_type: string;
  commission_status: string;
  payout_id: string | null;
  created_at: string;
  total_count: number;
};

const PAGE_SIZE = 20;

type CommissionHistoryTableProps = {
  beneficiaryType: "restaurant" | "driver";
  beneficiaryId: string | undefined;
  /** Extra query keys to invalidate together with this table's own query (e.g. the page's wallet summary). */
  extraInvalidateKeys?: readonly (readonly unknown[])[];
};

/**
 * Full commission-by-commission breakdown — shared verbatim by the
 * restaurant and driver "Mes Komisyon" pages (identical columns/filters per
 * the "exactly the same experience" requirement) and by the admin
 * beneficiary detail profile, which passes the target's own id instead of
 * the caller's.
 */
export function CommissionHistoryTable({
  beneficiaryType,
  beneficiaryId,
  extraInvalidateKeys = [],
}: CommissionHistoryTableProps) {
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);

  const queryKey = [
    "commission-history",
    beneficiaryType,
    beneficiaryId,
    search,
    from,
    to,
    status,
    sort,
    page,
  ] as const;

  const commissions = useQuery({
    queryKey,
    enabled: !!beneficiaryId,
    queryFn: async () => {
      const rpcName =
        beneficiaryType === "restaurant"
          ? "get_restaurant_commissions_secure"
          : "get_driver_commissions_secure";
      const idParam = beneficiaryType === "restaurant" ? "_restaurant_id" : "_driver_id";
      const { data, error } = await supabase.rpc(rpcName, {
        [idParam]: beneficiaryId!,
        _search: search || undefined,
        _from: from || undefined,
        _to: to || undefined,
        _status: status || undefined,
        _sort: sort,
        _limit: PAGE_SIZE,
        _offset: (page - 1) * PAGE_SIZE,
      } as never);
      if (error) throw error;
      return (data ?? []) as CommissionRow[];
    },
  });

  useRealtimeTableSync(
    "wallets",
    beneficiaryType === "restaurant"
      ? `restaurant_id=eq.${beneficiaryId}`
      : `driver_id=eq.${beneficiaryId}`,
    [queryKey.slice(0, 3), ...extraInvalidateKeys],
    !!beneficiaryId,
  );

  const columns: DataTableColumn<CommissionRow>[] = [
    { key: "order_number", header: "Kòmand", cell: (r) => r.order_number ?? "—" },
    {
      key: "order_date",
      header: "Dat kòmand",
      cell: (r) => (r.order_date ? new Date(r.order_date).toLocaleDateString("fr-HT") : "—"),
    },
    {
      key: "contact_phone",
      header: "Kliyan",
      cell: (r) =>
        r.contact_phone ? (
          <a href={`tel:${r.contact_phone}`} className="font-bold text-brand-deep">
            {r.contact_phone}
          </a>
        ) : (
          "—"
        ),
    },
    { key: "gross_amount", header: "Montan brit", cell: (r) => formatHTG(Number(r.gross_amount)) },
    {
      key: "net_amount",
      header: "Pou ou",
      cell: (r) => (
        <span className="font-bold text-brand-deep">{formatHTG(Number(r.net_amount))}</span>
      ),
    },
    {
      key: "commission_amount",
      header: "Komisyon platfòm",
      cell: (r) => formatHTG(Number(r.commission_amount)),
      hideOnMobileCard: true,
    },
    {
      key: "commission_status",
      header: "Estati",
      cell: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge tone={COMMISSION_STATUS_TONE[r.commission_status]}>
            {COMMISSION_STATUS_LABEL[r.commission_status] ?? r.commission_status}
          </StatusBadge>
          {r.commission_status === "partially_paid" && (
            <span className="text-[10px] text-ink-soft">
              {formatHTG(Number(r.covered_amount))} / {formatHTG(Number(r.net_amount))}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "created_at",
      header: "Dat ajoute",
      cell: (r) => new Date(r.created_at).toLocaleDateString("fr-HT"),
      hideOnMobileCard: true,
    },
  ];

  const totalCount = commissions.data?.[0]?.total_count ?? 0;

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold text-ink">Istwa komisyon</h2>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Chèche yon nimewo kòmand…"
          aria-label="Chèche yon nimewo kòmand…"
          className="min-w-0 flex-1 rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
          aria-label="Depi"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
          aria-label="Jiska"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
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
          {Object.entries(COMMISSION_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Klase pa"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <option value="date_desc">Dat (pi resan)</option>
          <option value="date_asc">Dat (pi ansyen)</option>
          <option value="amount_desc">Montan (pi wo)</option>
          <option value="amount_asc">Montan (pi ba)</option>
        </select>
      </div>

      {commissions.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Pa ka chaje istwa komisyon an"
          description="Gen yon pwoblèm rezo oswa sèvè. Tanpri eseye ankò."
          action={
            <Button variant="outline" onClick={() => commissions.refetch()}>
              Eseye ankò
            </Button>
          }
        />
      ) : (
        <>
          <DataTable<CommissionRow>
            rows={commissions.data ?? []}
            getRowKey={(r) => r.id}
            loading={commissions.isLoading}
            mobileTitleKey="order_number"
            emptyState={
              <EmptyState
                icon={FileText}
                title="Pa gen komisyon"
                description="Okenn komisyon pa koresponn ak rechèch/filtè sa a."
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
        </>
      )}
    </section>
  );
}
