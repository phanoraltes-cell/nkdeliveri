import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bike, CheckCircle2, Clock, Star, AlertTriangle, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import {
  DriverDetailDialog,
  type DriverAdminDetail,
} from "@/components/dashboard/admin/driver-detail-dialog";

export const Route = createFileRoute("/_authenticated/dashboard/admin/drivers")({
  component: AdminDrivers,
});

const PAGE_SIZE = 20;

const DRIVER_STATUS_LABEL: Record<string, string> = {
  pending: "An atant",
  approved: "Apwouve",
  suspended: "Sispann",
  rejected: "Rejte",
  online: "An liy",
  offline: "Òfliy",
};
const DRIVER_STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "info"> = {
  pending: "warn",
  approved: "good",
  suspended: "bad",
  rejected: "bad",
  online: "good",
  offline: "neutral",
};

function AdminDrivers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);
  const [detailTarget, setDetailTarget] = useState<DriverAdminDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const driversQueryKey = ["admin-drivers", search, status, sort, page] as const;
  const drivers = useQuery({
    queryKey: driversQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_drivers_admin", {
        _search: search || undefined,
        _status: status || undefined,
        _sort: sort,
        _limit: PAGE_SIZE,
        _offset: (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? []).map((d) => ({
        ...d,
        avg_delivery_minutes:
          d.avg_delivery_minutes != null ? Number(d.avg_delivery_minutes) : null,
        avg_rating: d.avg_rating != null ? Number(d.avg_rating) : null,
        success_rate: d.success_rate != null ? Number(d.success_rate) : null,
        available_balance: Number(d.available_balance),
        total_deliveries: Number(d.total_deliveries),
        delivered_count: Number(d.delivered_count),
        cancelled_count: Number(d.cancelled_count),
        total_count: Number(d.total_count),
      })) as (DriverAdminDetail & { total_count: number })[];
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      newStatus,
      reason,
    }: {
      id: string;
      newStatus: "approved" | "rejected" | "suspended";
      reason?: string;
    }) => {
      const { error } = await supabase.rpc("update_driver_status_secure", {
        _driver_id: id,
        _status: newStatus,
        _reason: reason || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Estati livrè aktyalize");
      qc.invalidateQueries({ queryKey: ["admin-drivers"] });
      qc.invalidateQueries({ queryKey: ["admin-drivers-count"] });
      qc.invalidateQueries({ queryKey: ["pending-drivers"] });
      setDetailOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  function openDetail(row: DriverAdminDetail) {
    setDetailTarget(row);
    setDetailOpen(true);
  }

  const totalCount = drivers.data?.[0]?.total_count ?? 0;

  // Cheap way to get an accurate *global* count per status (not just the
  // current page): total_count is a window-function count over the full
  // filtered set, so a _limit:1 call with a status filter reads it without
  // fetching every row. Reusing get_drivers_admin rather than a new RPC.
  const pendingCount = useQuery({
    queryKey: ["admin-drivers-count", "pending"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_drivers_admin", {
        _status: "pending",
        _limit: 1,
      });
      if (error) throw error;
      return Number(data?.[0]?.total_count ?? 0);
    },
  });
  const approvedCount = useQuery({
    queryKey: ["admin-drivers-count", "approved"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_drivers_admin", {
        _status: "approved",
        _limit: 1,
      });
      if (error) throw error;
      return Number(data?.[0]?.total_count ?? 0);
    },
  });

  const kpis = {
    total: totalCount,
    pending: pendingCount.data ?? 0,
    approved: approvedCount.data ?? 0,
    avgRating:
      drivers.data && drivers.data.length > 0 && drivers.data.some((d) => d.avg_rating != null)
        ? drivers.data.reduce((s, d) => s + (d.avg_rating ?? 0), 0) /
          drivers.data.filter((d) => d.avg_rating != null).length
        : null,
  };

  const columns: DataTableColumn<DriverAdminDetail>[] = [
    {
      key: "name",
      header: "Non",
      cell: (d) => (
        <span className="font-bold text-ink">
          {[d.first_name, d.last_name].filter(Boolean).join(" ") || "—"}
        </span>
      ),
    },
    {
      key: "phone",
      header: "Telefòn",
      cell: (d) =>
        d.phone ? (
          <a href={`tel:${d.phone}`} className="font-bold text-brand-deep">
            {d.phone}
          </a>
        ) : (
          "—"
        ),
      hideOnMobileCard: true,
    },
    {
      key: "total_deliveries",
      header: "Livrezon",
      cell: (d) => `${d.delivered_count}/${d.total_deliveries}`,
    },
    {
      key: "success_rate",
      header: "Tux reyisit",
      cell: (d) => (d.success_rate != null ? `${Math.round(d.success_rate * 100)}%` : "—"),
      hideOnMobileCard: true,
    },
    {
      key: "avg_rating",
      header: "Nòt",
      cell: (d) => (d.avg_rating != null ? d.avg_rating.toFixed(1) : "—"),
    },
    {
      key: "available_balance",
      header: "Balans",
      cell: (d) => (
        <span className="font-bold text-brand-deep">{formatHTG(d.available_balance)}</span>
      ),
      hideOnMobileCard: true,
    },
    {
      key: "status",
      header: "Estati",
      cell: (d) => (
        <StatusBadge tone={DRIVER_STATUS_TONE[d.status] ?? "neutral"}>
          {DRIVER_STATUS_LABEL[d.status] ?? d.status}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "Aksyon",
      cell: (d) => (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Wè pwofil"
          onClick={() => openDetail(d)}
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Jesyon Livrè</h1>
          <p className="mt-1 text-ink-soft">Apwouve, sispann, ak swiv tout livrè platfòm nan.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total livrè" value={String(kpis.total)} icon={Bike} />
        <KpiCard label="An atant apwobasyon" value={String(kpis.pending)} icon={Clock} />
        <KpiCard label="Apwouve" value={String(kpis.approved)} icon={CheckCircle2} />
        <KpiCard
          label="Nòt mwayèn (paj sa a)"
          value={kpis.avgRating != null ? kpis.avgRating.toFixed(1) : "—"}
          icon={Star}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Chèche non, telefòn, imèl…"
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
          {Object.entries(DRIVER_STATUS_LABEL).map(([k, v]) => (
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
          <option value="created_desc">Enskripsyon (pi resan)</option>
          <option value="created_asc">Enskripsyon (pi ansyen)</option>
          <option value="name_asc">Non (A-Z)</option>
          <option value="rating_desc">Nòt (pi wo)</option>
          <option value="deliveries_desc">Livrezon (pi plis)</option>
        </select>
      </div>

      {drivers.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Pa ka chaje lis livrè yo"
          description="Gen yon pwoblèm rezo oswa sèvè. Tanpri eseye ankò."
          action={
            <Button variant="outline" onClick={() => drivers.refetch()}>
              Eseye ankò
            </Button>
          }
        />
      ) : (
        <>
          <DataTable<DriverAdminDetail>
            rows={drivers.data ?? []}
            getRowKey={(d) => d.id}
            loading={drivers.isLoading}
            mobileTitleKey="name"
            emptyState={
              <EmptyState
                icon={Bike}
                title="Pa gen livrè"
                description="Okenn livrè pa koresponn ak rechèch/filtè sa a."
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

      <DriverDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        driver={detailTarget}
        isPending={updateStatus.isPending}
        onStatusChange={(id, newStatus, reason) => updateStatus.mutate({ id, newStatus, reason })}
      />
    </div>
  );
}
