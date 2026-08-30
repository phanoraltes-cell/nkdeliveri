import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Flag, AlertTriangle, Clock, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sendReportUpdatePush } from "@/lib/send-report-push.functions";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import {
  ReportDetailDialog,
  type ReportAdminDetail,
} from "@/components/dashboard/admin/report-detail-dialog";
import {
  REPORT_STATUS_LABEL,
  REPORT_STATUS_TONE,
  REPORT_TARGET_LABEL,
  reportReasonLabel,
} from "@/lib/report-status";

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/reports")({
  component: AdminReports,
});

const PAGE_SIZE = 20;

function AdminReports() {
  const qc = useQueryClient();
  const sendPush = useServerFn(sendReportUpdatePush);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [targetType, setTargetType] = useState("");
  const [sort, setSort] = useState("created_desc");
  const [page, setPage] = useState(1);
  const [detailTarget, setDetailTarget] = useState<ReportAdminDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const queryKey = ["admin-reports", search, status, targetType, sort, page] as const;
  const reports = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_reports_admin", {
        _search: search.trim() || undefined,
        _status: status || undefined,
        _target_type: targetType || undefined,
        _sort: sort,
        _limit: PAGE_SIZE,
        _offset: (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const totalCount = reports.data?.[0]?.total_count ?? 0;

  const openCount = useQuery({
    queryKey: ["admin-reports-count", "open"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_reports_admin", {
        _status: "open",
        _limit: 1,
      });
      if (error) throw error;
      return Number(data?.[0]?.total_count ?? 0);
    },
  });
  const reviewingCount = useQuery({
    queryKey: ["admin-reports-count", "reviewing"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_reports_admin", {
        _status: "reviewing",
        _limit: 1,
      });
      if (error) throw error;
      return Number(data?.[0]?.total_count ?? 0);
    },
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["admin-reports"] });
    qc.invalidateQueries({ queryKey: ["admin-reports-count"] });
    qc.invalidateQueries({ queryKey: ["report-messages", detailTarget?.id] });
  }

  function refreshDetail(row: ReportAdminDetail | undefined) {
    if (row) setDetailTarget(row);
    invalidateAll();
  }

  async function notifyUpdate(reportId: string) {
    try {
      await sendPush({ data: { reportId } });
    } catch (e) {
      console.warn("push send failed", e);
    }
  }

  const setStatusMutation = useMutation({
    mutationFn: async ({ newStatus, note }: { newStatus: "open" | "reviewing"; note: string }) => {
      if (!detailTarget) throw new Error("Pa gen dosye chwazi");
      const { data, error } = await supabase.rpc("set_report_status_secure", {
        _report_id: detailTarget.id,
        _status: newStatus,
        _admin_note: note || undefined,
      });
      if (error) throw error;
      await notifyUpdate(detailTarget.id);
      return data;
    },
    onSuccess: (row) => {
      toast.success("Dosye aktyalize");
      refreshDetail(row as ReportAdminDetail | undefined);
    },
    onError: (e) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async (note: string) => {
      if (!detailTarget) throw new Error("Pa gen dosye chwazi");
      const { data, error } = await supabase.rpc("reject_report_secure", {
        _report_id: detailTarget.id,
        _admin_note: note,
      });
      if (error) throw error;
      await notifyUpdate(detailTarget.id);
      return data;
    },
    onSuccess: (row) => {
      toast.success("Dosye rejte");
      refreshDetail(row as ReportAdminDetail | undefined);
    },
    onError: (e) => toast.error(e.message),
  });

  const resolve = useMutation({
    mutationFn: async ({ resolution, note }: { resolution: string; note: string }) => {
      if (!detailTarget) throw new Error("Pa gen dosye chwazi");
      const { data, error } = await supabase.rpc("resolve_report_secure", {
        _report_id: detailTarget.id,
        _resolution: resolution,
        _admin_note: note,
      });
      if (error) throw error;
      await notifyUpdate(detailTarget.id);
      return data;
    },
    onSuccess: (row) => {
      toast.success("Dosye rezoud");
      refreshDetail(row as ReportAdminDetail | undefined);
    },
    onError: (e) => toast.error(e.message),
  });

  const requestExplanation = useMutation({
    mutationFn: async (question: string) => {
      if (!detailTarget) throw new Error("Pa gen dosye chwazi");
      const { data, error } = await supabase.rpc("request_target_explanation_secure", {
        _report_id: detailTarget.id,
        _question: question,
      });
      if (error) throw error;
      await notifyUpdate(detailTarget.id);
      return data;
    },
    onSuccess: (row) => {
      toast.success("Demand voye bay sib la");
      refreshDetail(row as ReportAdminDetail | undefined);
    },
    onError: (e) => toast.error(e.message),
  });

  const isBusy =
    setStatusMutation.isPending ||
    reject.isPending ||
    resolve.isPending ||
    requestExplanation.isPending;

  function openDetail(row: ReportAdminDetail) {
    setDetailTarget(row);
    setDetailOpen(true);
  }

  function updateSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  const columns: DataTableColumn<ReportAdminDetail>[] = [
    {
      key: "order_number",
      header: "Kòmand",
      cell: (r) => <span className="font-bold text-ink">{r.order_number}</span>,
    },
    {
      key: "target",
      header: "Sib",
      cell: (r) => (
        <span>
          <StatusBadge tone="neutral">{REPORT_TARGET_LABEL[r.target_type]}</StatusBadge>
          <span className="block text-xs text-ink-soft">{r.target_name}</span>
        </span>
      ),
    },
    {
      key: "reason_code",
      header: "Rezon",
      cell: (r) => reportReasonLabel(r.target_type, r.reason_code),
      hideOnMobileCard: true,
    },
    {
      key: "status",
      header: "Estati",
      cell: (r) => (
        <StatusBadge tone={REPORT_STATUS_TONE[r.status] ?? "neutral"}>
          {REPORT_STATUS_LABEL[r.status] ?? r.status}
        </StatusBadge>
      ),
    },
    {
      key: "target_founded_reports_90d",
      header: "Istorik sib (90j)",
      cell: (r) => (r.target_founded_reports_90d > 0 ? String(r.target_founded_reports_90d) : "—"),
      hideOnMobileCard: true,
    },
    {
      key: "created_at",
      header: "Kreye",
      cell: (r) => new Date(r.created_at).toLocaleDateString("fr-HT"),
      hideOnMobileCard: true,
    },
    {
      key: "actions",
      header: "Aksyon",
      cell: (r) => (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Wè detay"
          onClick={() => openDetail(r)}
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
          <h1 className="font-display text-3xl font-extrabold text-ink">Siyalman</h1>
          <p className="mt-1 text-ink-soft">
            Plent konfidansyèl kliyan yo depoze kont yon restoran oswa yon livrè.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Total" value={String(totalCount)} icon={Flag} />
        <KpiCard label="Resevwa" value={String(openCount.data ?? 0)} icon={AlertTriangle} />
        <KpiCard label="Anba etid" value={String(reviewingCount.data ?? 0)} icon={Clock} />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
          placeholder="Chèche kòmand…"
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
          {Object.entries(REPORT_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value);
            setPage(1);
          }}
          aria-label="Filtre pa tip sib"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <option value="">Tout sib</option>
          {Object.entries(REPORT_TARGET_LABEL).map(([k, v]) => (
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

      {reports.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Pa ka chaje lis siyalman yo"
          description="Gen yon pwoblèm rezo oswa sèvè. Tanpri eseye ankò."
          action={
            <Button variant="outline" onClick={() => reports.refetch()}>
              Eseye ankò
            </Button>
          }
        />
      ) : (
        <>
          <DataTable<ReportAdminDetail>
            rows={reports.data ?? []}
            getRowKey={(r) => r.id}
            loading={reports.isLoading}
            mobileTitleKey="order_number"
            emptyState={
              <EmptyState
                icon={Flag}
                title="Pa gen siyalman"
                description="Okenn siyalman pa koresponn ak rechèch/filtè sa a."
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

      <ReportDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        report={detailTarget}
        isBusy={isBusy}
        onSetStatus={(newStatus, note) => setStatusMutation.mutate({ newStatus, note })}
        onReject={(note) => reject.mutate(note)}
        onResolve={(resolution, note) => resolve.mutate({ resolution, note })}
        onRequestExplanation={(question) => requestExplanation.mutate(question)}
      />
    </div>
  );
}
