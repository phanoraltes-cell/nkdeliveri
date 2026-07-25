import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Scale, Clock, Flag, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { sendDisputeUpdatePush } from "@/lib/send-dispute-push.functions";
import {
  DisputeDetailDialog,
  type DisputeAdminDetail,
} from "@/components/dashboard/admin/dispute-detail-dialog";
import {
  DISPUTE_STATUS_LABEL,
  DISPUTE_STATUS_TONE,
  DISPUTE_CATEGORY_GROUP_LABEL,
} from "@/lib/dispute-status";

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/disputes")({
  component: AdminDisputes,
});

const PAGE_SIZE = 20;

function AdminDisputes() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const sendPush = useServerFn(sendDisputeUpdatePush);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [categoryGroup, setCategoryGroup] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);
  const [detailTarget, setDetailTarget] = useState<DisputeAdminDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const queryKey = ["admin-disputes", search, status, categoryGroup, sort, page] as const;
  const disputes = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_disputes_admin", {
        _search: search.trim() || undefined,
        _status: status || undefined,
        _category_group: categoryGroup || undefined,
        _sort: sort,
        _limit: PAGE_SIZE,
        _offset: (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? []) as (DisputeAdminDetail & { total_count: number })[];
    },
  });
  const totalCount = disputes.data?.[0]?.total_count ?? 0;

  // Same "cheap global count via a _limit:1 call" trick already used by
  // get_drivers_admin's KPI row — total_count is a window-function count
  // over the whole filtered set, not just the current page.
  const openCount = useQuery({
    queryKey: ["admin-disputes-count", "open"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_disputes_admin", {
        _status: "open",
        _limit: 1,
      });
      if (error) throw error;
      return Number(data?.[0]?.total_count ?? 0);
    },
  });
  const actionRequiredCount = useQuery({
    queryKey: ["admin-disputes-count", "action_required"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_disputes_admin", {
        _status: "action_required",
        _limit: 1,
      });
      if (error) throw error;
      return Number(data?.[0]?.total_count ?? 0);
    },
  });
  const escalatedCount = useQuery({
    queryKey: ["admin-disputes-count", "escalated"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_disputes_admin", {
        _status: "escalated",
        _limit: 1,
      });
      if (error) throw error;
      return Number(data?.[0]?.total_count ?? 0);
    },
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["admin-disputes"] });
    qc.invalidateQueries({ queryKey: ["admin-disputes-count"] });
    qc.invalidateQueries({ queryKey: ["dispute-messages", detailTarget?.id] });
  }

  const updateStatus = useMutation({
    mutationFn: async ({
      newStatus,
      notes,
      assignToMe,
    }: {
      newStatus: string;
      notes: string;
      assignToMe?: boolean;
    }) => {
      if (!detailTarget) throw new Error("Pa gen litij chwazi");
      const { data, error } = await supabase.rpc("update_dispute_status_secure", {
        _dispute_id: detailTarget.id,
        _status: newStatus,
        _admin_notes: notes || undefined,
        _assigned_to: assignToMe ? user?.id : undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      toast.success("Litij aktyalize");
      if (row) setDetailTarget((prev) => (prev ? { ...prev, ...row } : prev));
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const resolve = useMutation({
    mutationFn: async (resolution: string) => {
      if (!detailTarget) throw new Error("Pa gen litij chwazi");
      const { data, error } = await supabase.rpc("resolve_dispute_secure", {
        _dispute_id: detailTarget.id,
        _resolution: resolution,
      });
      if (error) throw error;
      try {
        await sendPush({ data: { disputeId: detailTarget.id } });
      } catch (e) {
        console.warn("push send failed", e);
      }
      return data;
    },
    onSuccess: (row) => {
      toast.success("Litij rezoud");
      if (row) setDetailTarget((prev) => (prev ? { ...prev, ...row } : prev));
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  function openDetail(row: DisputeAdminDetail) {
    setDetailTarget(row);
    setDetailOpen(true);
  }

  function updateSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  const columns: DataTableColumn<DisputeAdminDetail>[] = [
    {
      key: "order_number",
      header: "Kòmand",
      cell: (d) => <span className="font-bold text-ink">{d.order_number}</span>,
    },
    {
      key: "restaurant_name",
      header: "Restoran / Livrè",
      cell: (d) => (
        <span>
          {d.restaurant_name}
          {d.driver_first_name && (
            <span className="block text-xs text-ink-soft">
              {d.driver_first_name} {d.driver_last_name}
            </span>
          )}
        </span>
      ),
      hideOnMobileCard: true,
    },
    {
      key: "category",
      header: "Kategori",
      cell: (d) => (
        <span>
          <StatusBadge tone="neutral">
            {DISPUTE_CATEGORY_GROUP_LABEL[d.category_group] ?? d.category_group}
          </StatusBadge>
          <span className="block text-xs text-ink-soft">{d.category}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Estati",
      cell: (d) => (
        <StatusBadge tone={DISPUTE_STATUS_TONE[d.status] ?? "neutral"}>
          {DISPUTE_STATUS_LABEL[d.status] ?? d.status}
        </StatusBadge>
      ),
    },
    {
      key: "assigned_email",
      header: "Chaje pa",
      cell: (d) => d.assigned_email ?? "—",
      hideOnMobileCard: true,
    },
    {
      key: "created_at",
      header: "Kreye",
      cell: (d) => new Date(d.created_at).toLocaleDateString("fr-HT"),
      hideOnMobileCard: true,
    },
    {
      key: "actions",
      header: "Aksyon",
      cell: (d) => (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Wè detay"
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
          <h1 className="font-display text-3xl font-extrabold text-ink">Litij</h1>
          <p className="mt-1 text-ink-soft">Achitre pwoblèm ant kliyan, restoran ak livrè.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total" value={String(totalCount)} icon={Scale} />
        <KpiCard label="Louvri" value={String(openCount.data ?? 0)} icon={AlertTriangle} />
        <KpiCard label="Aksyon nesesè" value={String(actionRequiredCount.data ?? 0)} icon={Clock} />
        <KpiCard label="Eskalade" value={String(escalatedCount.data ?? 0)} icon={Flag} />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
          placeholder="Chèche kòmand, restoran…"
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
          {Object.entries(DISPUTE_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={categoryGroup}
          onChange={(e) => {
            setCategoryGroup(e.target.value);
            setPage(1);
          }}
          aria-label="Filtre pa kategori"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <option value="">Tout kategori</option>
          {Object.entries(DISPUTE_CATEGORY_GROUP_LABEL).map(([k, v]) => (
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
          <option value="created_desc">Pi resan</option>
          <option value="created_asc">Pi ansyen</option>
          <option value="updated_desc">Dènye aktivite</option>
        </select>
      </div>

      {disputes.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Pa ka chaje lis litij yo"
          description="Gen yon pwoblèm rezo oswa sèvè. Tanpri eseye ankò."
          action={
            <Button variant="outline" onClick={() => disputes.refetch()}>
              Eseye ankò
            </Button>
          }
        />
      ) : (
        <>
          <DataTable<DisputeAdminDetail>
            rows={disputes.data ?? []}
            getRowKey={(d) => d.id}
            loading={disputes.isLoading}
            mobileTitleKey="order_number"
            emptyState={
              <EmptyState
                icon={Scale}
                title="Pa gen litij"
                description="Okenn litij pa koresponn ak rechèch/filtè sa a."
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

      <DisputeDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        dispute={detailTarget}
        currentUserId={user?.id}
        onStatusChange={(newStatus, notes, assignToMe) =>
          updateStatus.mutate({ newStatus, notes, assignToMe })
        }
        onResolve={(resolution) => resolve.mutate(resolution)}
        isChangingStatus={updateStatus.isPending}
        isResolving={resolve.isPending}
      />
    </div>
  );
}
