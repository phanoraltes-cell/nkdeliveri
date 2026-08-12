import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Compass, Search, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { useRealtimeTableSync } from "@/hooks/useRealtimeTableSync";
import { ORDER_STATUS_LABEL } from "@/lib/order-status";
import {
  KOMAND_HEALTH_LABEL,
  KOMAND_HEALTH_TONE,
  KOMAND_HEALTH_FILTERS,
  KOMAND_ASSISTANCE_LABEL,
  KOMAND_ASSISTANCE_TONE,
} from "@/lib/komand-status";
import { KomandDetailDialog } from "@/components/dashboard/admin/komand-detail-dialog";

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/komand")({
  component: AdminKomand,
});

const PAGE_SIZE = 25;

type KomandRow = {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
  last_activity: string;
  customer_name: string | null;
  restaurant_name: string | null;
  driver_name: string | null;
  assistance_status: string;
  komand_health: string;
  total_count: number;
};

function AdminKomand() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState<string>("");
  const [page, setPage] = useState(1);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const queryKey = ["admin-komand", search, health, page] as const;
  const rows = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_orders_admin", {
        _search: search.trim() || undefined,
        _health: health || undefined,
        _limit: PAGE_SIZE,
        _offset: (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? []) as KomandRow[];
    },
  });
  const totalCount = rows.data?.[0]?.total_count ?? 0;

  // Cheap _limit:1 window-count calls, same trick as get_disputes_admin's
  // KPI row on dashboard.admin.disputes.tsx — total_count is a count over
  // the whole filtered set (here: just the health bucket), not the page.
  const assistanceCount = useQuery({
    queryKey: ["admin-komand-count", "assistance_required"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_orders_admin", {
        _health: "assistance_required",
        _limit: 1,
      });
      if (error) throw error;
      return Number(data?.[0]?.total_count ?? 0);
    },
  });
  const blockedCount = useQuery({
    queryKey: ["admin-komand-count", "blocked"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_orders_admin", {
        _health: "blocked",
        _limit: 1,
      });
      if (error) throw error;
      return Number(data?.[0]?.total_count ?? 0);
    },
  });
  const incompleteCount = useQuery({
    queryKey: ["admin-komand-count", "incomplete"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_orders_admin", {
        _health: "incomplete",
        _limit: 1,
      });
      if (error) throw error;
      return Number(data?.[0]?.total_count ?? 0);
    },
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["admin-komand"] });
    qc.invalidateQueries({ queryKey: ["admin-komand-count"] });
  }

  // orders/deliveries/payments changes are already the source data behind
  // every "Komand health" bucket, and none of them have Komand-specific
  // filters here (the whole point is admin-wide supervision) — listening
  // unfiltered, same as the other admin-wide realtime pages.
  useRealtimeTableSync("orders", undefined, [queryKey, ["admin-komand-count"]]);
  useRealtimeTableSync("komand_assistance", undefined, [queryKey, ["admin-komand-count"]]);

  function updateSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  function openDetail(id: string) {
    setDetailOrderId(id);
    setDetailOpen(true);
  }

  const columns: DataTableColumn<KomandRow>[] = [
    {
      key: "order_number",
      header: "Kòmand",
      cell: (r) => <span className="font-bold text-ink">{r.order_number}</span>,
    },
    {
      key: "customer_name",
      header: "Kliyan",
      cell: (r) => r.customer_name || "—",
    },
    {
      key: "restaurant_name",
      header: "Restoran / Livrè",
      cell: (r) => (
        <span>
          {r.restaurant_name || "—"}
          {r.driver_name && <span className="block text-xs text-ink-soft">{r.driver_name}</span>}
        </span>
      ),
      hideOnMobileCard: true,
    },
    {
      key: "status",
      header: "Estati",
      cell: (r) => (
        <span className="text-xs text-ink-soft">{ORDER_STATUS_LABEL[r.status] ?? r.status}</span>
      ),
    },
    {
      key: "komand_health",
      header: "Sante",
      cell: (r) => (
        <StatusBadge tone={KOMAND_HEALTH_TONE[r.komand_health] ?? "neutral"}>
          {KOMAND_HEALTH_LABEL[r.komand_health] ?? r.komand_health}
        </StatusBadge>
      ),
    },
    {
      key: "assistance_status",
      header: "Asistans",
      cell: (r) =>
        r.assistance_status !== "none" ? (
          <StatusBadge tone={KOMAND_ASSISTANCE_TONE[r.assistance_status] ?? "neutral"}>
            {KOMAND_ASSISTANCE_LABEL[r.assistance_status] ?? r.assistance_status}
          </StatusBadge>
        ) : (
          <span className="text-xs text-ink-soft">—</span>
        ),
      hideOnMobileCard: true,
    },
    {
      key: "total",
      header: "Total",
      cell: (r) => <span className="font-medium text-ink">{formatHTG(Number(r.total))}</span>,
      hideOnMobileCard: true,
    },
    {
      key: "last_activity",
      header: "Dènye aktivite",
      cell: (r) => new Date(r.last_activity).toLocaleString("fr-HT"),
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
          onClick={() => openDetail(r.id)}
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
          <h1 className="font-display text-3xl font-extrabold text-ink">Komand</h1>
          <p className="mt-1 text-ink-soft">
            Sipèvizyon tout kòmand aktif yo — pa yon dezyèm sistèm kòmand.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Bezwen asistans"
          value={String(assistanceCount.data ?? 0)}
          icon={AlertTriangle}
        />
        <KpiCard label="Bloke" value={String(blockedCount.data ?? 0)} icon={Compass} />
        <KpiCard label="Enkonplè" value={String(incompleteCount.data ?? 0)} icon={Compass} />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft" />
          <input
            value={search}
            onChange={(e) => updateSearch(e.target.value)}
            placeholder="Chèche kòmand, kliyan, restoran…"
            aria-label="Chèche"
            className="w-full rounded-lg border-2 border-brand-soft bg-white py-2.5 pl-8 pr-3 text-xs outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          />
        </div>
        <select
          value={health}
          onChange={(e) => {
            setHealth(e.target.value);
            setPage(1);
          }}
          aria-label="Filtre pa sante"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <option value="">Tout</option>
          {KOMAND_HEALTH_FILTERS.map((h) => (
            <option key={h} value={h}>
              {KOMAND_HEALTH_LABEL[h]}
            </option>
          ))}
        </select>
      </div>

      {rows.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Pa ka chaje lis kòmand yo"
          description="Gen yon pwoblèm rezo oswa sèvè. Tanpri eseye ankò."
          action={
            <Button variant="outline" onClick={() => rows.refetch()}>
              Eseye ankò
            </Button>
          }
        />
      ) : (
        <>
          <DataTable<KomandRow>
            rows={rows.data ?? []}
            getRowKey={(r) => r.id}
            loading={rows.isLoading}
            mobileTitleKey="order_number"
            emptyState={
              <EmptyState
                icon={Compass}
                title="Pa gen kòmand"
                description="Okenn kòmand pa koresponn ak rechèch/filtè sa a."
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

      <KomandDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        orderId={detailOrderId}
        health={rows.data?.find((r) => r.id === detailOrderId)?.komand_health}
        currentUserId={user?.id}
        onChanged={invalidateAll}
      />
    </div>
  );
}
