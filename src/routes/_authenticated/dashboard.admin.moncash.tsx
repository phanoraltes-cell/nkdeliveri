import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Smartphone,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Timer,
  RefreshCw,
  Webhook,
  Activity,
  Gauge,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge";
import { getMonCashStatus } from "@/lib/get-moncash-status.functions";

const SUCCESS_STATUSES = new Set(["paid", "confirmed", "resolved"]);
// How long a 'pending' payout is allowed to sit before it's flagged as
// stuck — matches the "reprise après incident" concern from Phase 9:
// if MonCash never calls the webhook back, this is how an admin finds
// out instead of the payout silently sitting in limbo forever.
const STUCK_PENDING_MINUTES = 30;
const WEBHOOK_MISSING_MINUTES = 15;
const CONSECUTIVE_ERROR_THRESHOLD = 5;
const FAILURE_RATE_ALERT_THRESHOLD = 0.5;

type WebhookEventRow = {
  event_id: string;
  transaction_reference: string | null;
  status: string;
  received_at: string;
};

export const Route = createFileRoute("/_authenticated/dashboard/admin/moncash")({
  component: AdminMonCash,
});

type MonCashPayoutRow = {
  id: string;
  amount: number;
  status: string;
  transaction_reference: string;
  provider_transaction_id: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
  restaurants: { name: string } | null;
  drivers: { first_name: string | null; last_name: string | null } | null;
};

type ProviderErrorRow = {
  id: number;
  action: string;
  metadata: { provider_code?: string; method?: string; amount?: number; error?: string } | null;
  created_at: string;
};

type ApiLogRow = {
  id: string;
  endpoint: string;
  attempt: number;
  http_status: number | null;
  duration_ms: number;
  error: string | null;
  is_timeout: boolean;
  transaction_reference: string | null;
  provider_transaction_id: string | null;
  created_at: string;
};

// "Statut" (progression) — 'pending' is the only state create_pending_payout_secure
// can produce; 'paid' is where a webhook-confirmed payout lands (the exact
// same status the manual flow starts at, so confirm_payout_secure/
// dispute_payout_secure keep working unmodified downstream — see
// PAYMENT_PROVIDERS.md). 'failed' is fail_pending_payout_secure's terminal
// state; 'confirmed'/'disputed'/'resolved' can still follow 'paid' exactly
// like any manual payout.
const STATUS_LABEL: Record<string, string> = {
  pending: "An atant konfimasyon pwovidè a",
  paid: "Voye — an atant benefisyè",
  confirmed: "Konfime pa benefisyè",
  disputed: "Kontete",
  resolved: "Regle",
  failed: "Echwe",
};
const STATUS_TONE: Record<string, StatusTone> = {
  pending: "warn",
  paid: "info",
  confirmed: "good",
  disputed: "bad",
  resolved: "neutral",
  failed: "bad",
};

/**
 * Admin monitoring page for the MonCash Automatik provider channel —
 * status, transaction history, and errors, all sourced from tables that
 * already exist for other reasons (payouts, audit_log,
 * moncash_webhook_events) rather than a new data pipeline. Genuinely
 * empty today by construction: MonCash disbursement isn't supported yet
 * (see PAYMENT_PROVIDERS.md § Ce qui n'est PAS fait), so no
 * provider_code='moncash_api' payout can exist in production — this page
 * becomes populated the moment that changes, without further code.
 *
 * The manual channels (MonCash Manyèl / NatCash Manyèl) are never
 * touched or hidden by this page — see payout-pay-modal.tsx's unified
 * channel selector, which keeps them as the default, always-available
 * choice.
 */
function AdminMonCash() {
  const getStatus = useServerFn(getMonCashStatus);

  const status = useQuery({
    queryKey: ["admin-moncash-status"],
    queryFn: () => getStatus(),
    staleTime: 60 * 1000,
  });

  const activeRow = useQuery({
    queryKey: ["admin-moncash-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_providers")
        .select("is_active")
        .eq("code", "moncash_api")
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 1000,
  });

  const history = useQuery({
    queryKey: ["admin-moncash-history"],
    queryFn: async (): Promise<MonCashPayoutRow[]> => {
      const { data, error } = await supabase
        .from("payouts")
        .select(
          "id, amount, status, transaction_reference, provider_transaction_id, admin_notes, created_at, updated_at, restaurants(name), drivers(first_name, last_name)",
        )
        .eq("provider_code", "moncash_api")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const errors = useQuery({
    queryKey: ["admin-moncash-errors"],
    queryFn: async (): Promise<ProviderErrorRow[]> => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, action, metadata, created_at")
        .in("action", ["payout.provider_attempt_failed", "payout.provider_failed"])
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as ProviderErrorRow[];
    },
  });

  // The full financial audit trail — every HTTP attempt
  // moncash-client.server.ts makes, append-only at the database level
  // (see docs/MONCASH_FINANCIAL_AUDIT.md). Distinct from "Erè resan"
  // above: this includes successful/retried attempts too, not just
  // terminal failures, with timing for every one of them.
  const apiLogs = useQuery({
    queryKey: ["admin-moncash-api-logs"],
    queryFn: async (): Promise<ApiLogRow[]> => {
      const { data, error } = await supabase
        .from("moncash_api_logs")
        .select(
          "id, endpoint, attempt, http_status, duration_ms, error, is_timeout, transaction_reference, provider_transaction_id, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  // Wider sample than the display tables above (which cap at 50 rows for
  // readability) — this one purely feeds the KPI/alert computations
  // below, so a slightly deeper window gives more honest aggregates
  // without slowing the page down.
  const webhookEvents = useQuery({
    queryKey: ["admin-moncash-webhook-events"],
    queryFn: async (): Promise<WebhookEventRow[]> => {
      const { data, error } = await supabase
        .from("moncash_webhook_events")
        .select("event_id, transaction_reference, status, received_at")
        .order("received_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const payouts = history.data ?? [];
  const logs = apiLogs.data ?? [];
  const events = webhookEvents.data ?? [];

  const stats = {
    succeeded: payouts.filter((p) => SUCCESS_STATUSES.has(p.status)).length,
    failed: payouts.filter((p) => p.status === "failed").length,
    pending: payouts.filter((p) => p.status === "pending").length,
    timeouts: logs.filter((l) => l.is_timeout).length,
    retries: logs.filter((l) => l.attempt > 1).length,
    webhooksReceived: events.length,
    webhooksRejected: events.filter((e) => e.status === "rejected").length,
    apiErrors: logs.filter((l) => l.error != null).length,
    avgDurationMs:
      logs.length > 0
        ? Math.round(logs.reduce((sum, l) => sum + l.duration_ms, 0) / logs.length)
        : null,
    availabilityPct:
      logs.length > 0
        ? Math.round((logs.filter((l) => l.error == null).length / logs.length) * 100)
        : null,
  };

  // Alerts — computed straight from the same data already on the page,
  // no separate polling/push mechanism. All 4 conditions come directly
  // from the Phase 9 monitoring requirements.
  const now = Date.now();
  const stuckPending = payouts.filter(
    (p) =>
      p.status === "pending" &&
      now - new Date(p.created_at).getTime() > STUCK_PENDING_MINUTES * 60_000,
  );
  const referencesWithWebhook = new Set(events.map((e) => e.transaction_reference).filter(Boolean));
  const missingWebhook = payouts.filter(
    (p) =>
      p.status === "pending" &&
      now - new Date(p.created_at).getTime() > WEBHOOK_MISSING_MINUTES * 60_000 &&
      !referencesWithWebhook.has(p.transaction_reference),
  );
  const recentLogs = logs.slice(0, CONSECUTIVE_ERROR_THRESHOLD);
  const consecutiveErrors =
    recentLogs.length === CONSECUTIVE_ERROR_THRESHOLD && recentLogs.every((l) => l.error != null);
  const recentFailureRate =
    logs.length >= 10
      ? logs.slice(0, 20).filter((l) => l.error != null).length / Math.min(20, logs.length)
      : 0;
  const abnormalFailureRate =
    logs.length >= 10 && recentFailureRate >= FAILURE_RATE_ALERT_THRESHOLD;

  const alerts: { title: string; body: string }[] = [
    ...(consecutiveErrors
      ? [
          {
            title: "Plizyè erè youn apre lòt",
            body: `Dènye ${CONSECUTIVE_ERROR_THRESHOLD} apèl API MonCash yo tout echwe san rete.`,
          },
        ]
      : []),
    ...(missingWebhook.length > 0
      ? [
          {
            title: "Webhook pa jwenn",
            body: `${missingWebhook.length} peman an atant depi plis pase ${WEBHOOK_MISSING_MINUTES} minit san okenn webhook MonCash ki gen menm referans.`,
          },
        ]
      : []),
    ...(stuckPending.length > 0
      ? [
          {
            title: "Peman bloke twò lontan",
            body: `${stuckPending.length} peman rete "an atant" depi plis pase ${STUCK_PENDING_MINUTES} minit.`,
          },
        ]
      : []),
    ...(abnormalFailureRate
      ? [
          {
            title: "Ogmantasyon echèk sispèk",
            body: `Plis pase ${Math.round(FAILURE_RATE_ALERT_THRESHOLD * 100)}% nan dènye apèl yo echwe.`,
          },
        ]
      : []),
  ];

  const columns: DataTableColumn<MonCashPayoutRow>[] = [
    {
      key: "beneficiary",
      header: "Benefisyè",
      cell: (r) => {
        const driverName = [r.drivers?.first_name, r.drivers?.last_name].filter(Boolean).join(" ");
        return r.restaurants?.name || driverName || "—";
      },
    },
    {
      key: "amount",
      header: "Montan",
      cell: (r) => <span className="font-bold text-brand-deep">{formatHTG(r.amount)}</span>,
    },
    {
      key: "status",
      header: "Statut (pwogresyon)",
      cell: (r) => (
        <div className="space-y-1">
          <StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>
            {STATUS_LABEL[r.status] ?? r.status}
          </StatusBadge>
          {r.status === "failed" && r.admin_notes && (
            <div className="text-[11px] text-red-700">{r.admin_notes}</div>
          )}
        </div>
      ),
    },
    {
      key: "transaction_reference",
      header: "Referans MonCash",
      cell: (r) => (
        <div className="text-xs">
          <div className="font-mono text-ink">{r.transaction_reference}</div>
          {r.provider_transaction_id && (
            <div className="font-mono text-ink-soft">ID pwovidè: {r.provider_transaction_id}</div>
          )}
        </div>
      ),
      hideOnMobileCard: true,
    },
    {
      key: "created_at",
      header: "Istwa",
      cell: (r) => (
        <div className="text-xs text-ink-soft">
          <div>Kreye: {new Date(r.created_at).toLocaleString("fr-HT")}</div>
          {r.updated_at !== r.created_at && (
            <div>Dènye chanjman: {new Date(r.updated_at).toLocaleString("fr-HT")}</div>
          )}
        </div>
      ),
      hideOnMobileCard: true,
    },
  ];

  const apiLogColumns: DataTableColumn<ApiLogRow>[] = [
    {
      key: "endpoint",
      header: "Pwen final",
      cell: (r) => (
        <div>
          <div className="font-mono text-xs text-ink">{r.endpoint}</div>
          {r.attempt > 1 && <div className="text-[11px] text-ink-soft">Eseye #{r.attempt}</div>}
        </div>
      ),
    },
    {
      key: "http_status",
      header: "Repons",
      cell: (r) =>
        r.is_timeout ? (
          <StatusBadge tone="warn">Delè ekoule</StatusBadge>
        ) : r.http_status == null ? (
          <StatusBadge tone="bad">Erè rezo</StatusBadge>
        ) : r.http_status >= 200 && r.http_status < 300 ? (
          <StatusBadge tone="good">HTTP {r.http_status}</StatusBadge>
        ) : (
          <StatusBadge tone="bad">HTTP {r.http_status}</StatusBadge>
        ),
    },
    {
      key: "duration_ms",
      header: "Delè",
      cell: (r) => `${r.duration_ms} ms`,
    },
    {
      key: "reference",
      header: "Referans MonCash",
      cell: (r) => (
        <div className="text-xs">
          {r.transaction_reference && (
            <div className="font-mono text-ink">{r.transaction_reference}</div>
          )}
          {r.provider_transaction_id && (
            <div className="font-mono text-ink-soft">{r.provider_transaction_id}</div>
          )}
          {!r.transaction_reference && !r.provider_transaction_id && "—"}
        </div>
      ),
      hideOnMobileCard: true,
    },
    {
      key: "error",
      header: "Erè",
      cell: (r) => r.error ?? "—",
      hideOnMobileCard: true,
    },
    {
      key: "created_at",
      header: "Dat",
      cell: (r) => new Date(r.created_at).toLocaleString("fr-HT"),
      hideOnMobileCard: true,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">MonCash</h1>
          <p className="mt-1 text-ink-soft">
            Estati, istwa ak erè kanal peman MonCash Automatik la. Kanal manyèl yo (MonCash Manyèl,
            NatCash Manyèl) rete disponib tout tan nan "Dekesman", kèlkeswa estati paj sa a.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div
              key={a.title}
              className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-bold">{a.title}</div>
                <div className="text-xs">{a.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Aktive nan sistèm nan"
          value={activeRow.data ? (activeRow.data.is_active ? "Wi" : "Non") : "—"}
          icon={activeRow.data?.is_active ? ShieldCheck : ShieldAlert}
          hint="payment_providers.moncash_api.is_active — kontwole si li parèt nan lis chwa a"
        />
        <KpiCard
          label="Konfigire sou sèvè a"
          value={status.data ? (status.data.configured ? "Wi" : "Non") : "—"}
          icon={status.data?.configured ? ShieldCheck : ShieldAlert}
          hint="Prezans 5 varyab MONCASH_* — gade docs/PAYMENT_PROVIDERS.md"
        />
        <KpiCard
          label="Peman total nan istwa a"
          value={history.data ? history.data.length : "—"}
          icon={Smartphone}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Peman reyisi" value={stats.succeeded} icon={CheckCircle2} />
        <KpiCard label="Peman echwe" value={stats.failed} icon={XCircle} />
        <KpiCard label="Peman an atant" value={stats.pending} icon={Clock} />
        <KpiCard label="Delè ekoule (timeout)" value={stats.timeouts} icon={Timer} />
        <KpiCard label="Repriz (retries)" value={stats.retries} icon={RefreshCw} />
        <KpiCard label="Webhooks resevwa" value={stats.webhooksReceived} icon={Webhook} />
        <KpiCard label="Webhooks rejte" value={stats.webhooksRejected} icon={ShieldAlert} />
        <KpiCard label="Erè API" value={stats.apiErrors} icon={AlertTriangle} />
        <KpiCard
          label="Tan repons mwayèn"
          value={stats.avgDurationMs != null ? `${stats.avgDurationMs} ms` : "—"}
          icon={Activity}
        />
        <KpiCard
          label="Disponiblite API"
          value={stats.availabilityPct != null ? `${stats.availabilityPct}%` : "—"}
          icon={Gauge}
          hint={
            logs.length === 0
              ? "Pa gen apèl toujou pou kalkile sa"
              : `Sou ${logs.length} dènye apèl`
          }
        />
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          Istwa peman MonCash Automatik
        </h2>
        <DataTable<MonCashPayoutRow>
          rows={history.data ?? []}
          getRowKey={(r) => r.id}
          loading={history.isLoading}
          mobileTitleKey="beneficiary"
          emptyState={
            <EmptyState
              icon={Smartphone}
              title="Pa gen okenn peman MonCash Automatik toujou"
              description="Nòmal: kanal sa a poko aktive — gade docs/PAYMENT_PROVIDERS.md pou konprann poukisa."
            />
          }
          columns={columns}
        />
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">Erè resan</h2>
        {errors.isLoading ? (
          <p className="text-sm text-ink-soft">Chajman…</p>
        ) : (errors.data ?? []).length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            title="Pa gen erè"
            description="Okenn tantativ peman MonCash Automatik ki echwe pa jwenn."
          />
        ) : (
          <ul className="space-y-2">
            {(errors.data ?? []).map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold">{e.metadata?.provider_code ?? "moncash_api"}</span>
                  <span className="text-xs text-red-700">
                    {new Date(e.created_at).toLocaleString("fr-HT")}
                  </span>
                </div>
                <p className="mt-1">{e.metadata?.error ?? "Erè san detay"}</p>
                {e.metadata?.amount != null && (
                  <p className="mt-1 text-xs text-red-700">
                    Montan: {formatHTG(Number(e.metadata.amount))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          Jounal apèl API (odit finansye)
        </h2>
        <p className="mb-3 text-xs text-ink-soft">
          Chak tantativ (ansanm ak repriz yo) — pa janm efase, pa janm modifye. Gade
          docs/MONCASH_FINANCIAL_AUDIT.md.
        </p>
        <DataTable<ApiLogRow>
          rows={apiLogs.data ?? []}
          getRowKey={(r) => r.id}
          loading={apiLogs.isLoading}
          mobileTitleKey="endpoint"
          emptyState={
            <EmptyState
              icon={Smartphone}
              title="Pa gen okenn apèl API toujou"
              description="Nòmal: kanal sa a poko aktive."
            />
          }
          columns={apiLogColumns}
        />
      </section>
    </div>
  );
}
