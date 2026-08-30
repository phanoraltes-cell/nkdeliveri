import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Radio, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { EmptyState } from "@/components/dashboard/cards/empty-state";

// Role guard lives on the parent layout (dashboard.admin.tsx).
export const Route = createFileRoute("/_authenticated/dashboard/admin/notification-log")({
  component: AdminNotificationLog,
});

type LogRow = {
  id: number;
  user_id: string | null;
  event_type: string;
  channel: string;
  title: string | null;
  body: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

const STATUS_TONE: Record<string, "good" | "bad" | "warn" | "neutral"> = {
  sent: "good",
  failed: "bad",
  skipped: "neutral",
};

/**
 * TACH 2 (siyalman F) — "yon ti ekran pou wè dènye notifikasyon yo ak
 * estati yo, pou depanaj." San filtè/pajinasyon konplè espre (spec la
 * limenm di "ti ekran") — 100 dènye antre yo, ki ase pou depanaj kout.
 */
function AdminNotificationLog() {
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");

  const logs = useQuery({
    queryKey: ["admin-notification-log", channel, status],
    queryFn: async () => {
      let query = supabase
        .from("notification_log")
        .select("id, user_id, event_type, channel, title, body, status, error, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (channel) query = query.eq("channel", channel);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data as LogRow[];
    },
  });

  const columns: DataTableColumn<LogRow>[] = [
    {
      key: "created_at",
      header: "Lè",
      cell: (r) => new Date(r.created_at).toLocaleString("fr-HT"),
    },
    {
      key: "channel",
      header: "Kanal",
      cell: (r) => <StatusBadge tone="neutral">{r.channel}</StatusBadge>,
    },
    { key: "event_type", header: "Evènman", cell: (r) => r.event_type, hideOnMobileCard: true },
    {
      key: "status",
      header: "Estati",
      cell: (r) => <StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusBadge>,
    },
    {
      key: "error",
      header: "Erè",
      cell: (r) => r.error ?? "—",
      hideOnMobileCard: true,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Jounal Notifikasyon</h1>
          <p className="mt-1 text-ink-soft">100 dènye tantativ push/SMS yo — pou depanaj sèlman.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          aria-label="Filtre pa kanal"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <option value="">Tout kanal</option>
          <option value="push">Push</option>
          <option value="sms">SMS</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filtre pa estati"
          className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <option value="">Tout estati</option>
          <option value="sent">Voye</option>
          <option value="failed">Echwe</option>
          <option value="skipped">Sote</option>
        </select>
      </div>

      {logs.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Pa ka chaje jounal la"
          description="Gen yon pwoblèm rezo oswa sèvè."
        />
      ) : (
        <DataTable<LogRow>
          rows={logs.data ?? []}
          getRowKey={(r) => r.id}
          loading={logs.isLoading}
          mobileTitleKey="event_type"
          emptyState={
            <EmptyState
              icon={Radio}
              title="Pa gen antre"
              description="Okenn notifikasyon voye toujou."
            />
          }
          columns={columns}
        />
      )}
    </div>
  );
}
