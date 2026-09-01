import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Zap,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Timer,
  RefreshCw,
  Activity,
  Gauge,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge";
import { getProviderDisplayLabel } from "@/lib/payment-provider-display";
import { getPlopStatus } from "@/lib/get-plop-status.functions";
import { getStripeStatus } from "@/lib/get-stripe-status.functions";

export const Route = createFileRoute("/_authenticated/dashboard/admin/collect")({
  component: AdminCollect,
});

type Wallet = "moncash" | "natcash" | "stripe";

const CONSECUTIVE_ERROR_THRESHOLD = 5;
const FAILURE_RATE_ALERT_THRESHOLD = 0.5;
// PLOP's only safety net beyond the client-side poll is a cron that runs
// once a day (Vercel Hobby plan cap — docs/archive/plop/PLOP_PHASE1_ARCHITECTURE.md §
// "rôle du cron") — a short threshold here would fire constant false
// alarms for perfectly normal in-flight payments. Stripe has no
// equivalent reconciliation cron at all (only its own webhook + the same
// client poll), so a stuck row genuinely has no automatic self-healer and
// deserves a shorter warning window (docs/archive/audits/STRIPE_INTEGRATION_REPORT.md).
const STUCK_PENDING_MINUTES: Record<Wallet, number> = { moncash: 1440, natcash: 1440, stripe: 120 };

const TAB_LABEL: Record<Wallet, string> = {
  moncash: "MonCash Otomatik",
  natcash: "NatCash Otomatik",
  stripe: "Kat Kredi",
};
const PROVIDER_SETTING_KEY: Record<Wallet, string> = {
  moncash: "moncash_auto",
  natcash: "natcash_auto",
  stripe: "stripe",
};

type TransactionRow = {
  id: string;
  amount: number;
  status: string;
  external_reference: string;
  provider_transaction_id: string | null;
  payment_method_requested: string | null;
  payment_method_used: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  orders: { order_number: string; restaurants: { name: string } | null } | null;
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

type ProviderSettingRow = {
  provider: string;
  enabled: boolean;
  visible: boolean;
  maintenance_message: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "An atant",
  paid: "Peye",
  failed: "Echwe",
};
const STATUS_TONE: Record<string, StatusTone> = {
  pending: "warn",
  paid: "good",
  failed: "bad",
};

function tabButtonClass(active: boolean): string {
  return `px-4 py-2 text-sm font-bold ${
    active ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"
  }`;
}

/**
 * Admin monitoring page for the 3 automatic Collect checkout methods —
 * "MonCash Otomatik"/"NatCash Otomatik" (both backed by PLOP,
 * docs/archive/plop/PLOP_NATCASH_INTEGRATION_PLAN.md) and "Kat Kredi" (Stripe,
 * docs/archive/audits/STRIPE_INTEGRATION_REPORT.md). Distinct from
 * dashboard.admin.payments.tsx (manual proof-review flow,
 * review_manual_payment_secure — no PLOP/Stripe data at all). This is
 * the first admin surface ever built for the Collect flow — read-only,
 * no mutation exists here or anywhere in the codebase for
 * payment_transactions (the client poll and the daily PLOP
 * reconciliation cron are the only writers, both fully automatic).
 *
 * MonCash Otomatik and NatCash Otomatik share the SAME underlying data —
 * both write to `payment_transactions` with provider='moncash_api' and
 * to `plop_api_logs` — distinguished only by `payment_method_requested`.
 * `plop_api_logs` itself doesn't carry that column, so each log row is
 * attributed to a wallet by joining on `transaction_reference` against
 * the already-fetched payment_transactions rows (built once as a Map,
 * not a second query) — see referenceToWallet below. A log row with no
 * match (the few-millisecond window between the PLOP API call and the
 * payment_transactions insert, or a genuinely pre-migration NULL
 * payment_method_requested) renders "—", never guessed.
 */
function AdminCollect() {
  const [tab, setTab] = useState<Wallet>("moncash");

  const getPlopStatusFn = useServerFn(getPlopStatus);
  const getStripeStatusFn = useServerFn(getStripeStatus);

  const providerSettings = useQuery({
    queryKey: ["admin-collect-provider-settings"],
    queryFn: async (): Promise<ProviderSettingRow[]> => {
      const { data, error } = await supabase
        .from("payment_provider_settings")
        .select("provider, enabled, visible, maintenance_message")
        .in("provider", ["moncash_auto", "natcash_auto", "stripe"]);
      if (error) throw error;
      return data ?? [];
    },
  });

  const plopStatus = useQuery({
    queryKey: ["admin-collect-plop-status"],
    queryFn: () => getPlopStatusFn(),
    staleTime: 60 * 1000,
  });

  const stripeStatus = useQuery({
    queryKey: ["admin-collect-stripe-status"],
    queryFn: () => getStripeStatusFn(),
    staleTime: 60 * 1000,
  });

  const TRANSACTION_SELECT =
    "id, amount, status, external_reference, provider_transaction_id, payment_method_requested, payment_method_used, error, created_at, updated_at, orders(order_number, restaurants(name))";

  const plopTransactions = useQuery({
    queryKey: ["admin-collect-plop-transactions"],
    queryFn: async (): Promise<TransactionRow[]> => {
      const { data, error } = await supabase
        .from("payment_transactions")
        .select(TRANSACTION_SELECT)
        .eq("provider", "moncash_api")
        .order("created_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      return data as unknown as TransactionRow[];
    },
  });

  const stripeTransactions = useQuery({
    queryKey: ["admin-collect-stripe-transactions"],
    queryFn: async (): Promise<TransactionRow[]> => {
      const { data, error } = await supabase
        .from("payment_transactions")
        .select(TRANSACTION_SELECT)
        .eq("provider", "stripe_api")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as TransactionRow[];
    },
  });

  const plopApiLogs = useQuery({
    queryKey: ["admin-collect-plop-api-logs"],
    queryFn: async (): Promise<ApiLogRow[]> => {
      const { data, error } = await supabase
        .from("plop_api_logs")
        .select(
          "id, endpoint, attempt, http_status, duration_ms, error, is_timeout, transaction_reference, provider_transaction_id, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const stripeApiLogs = useQuery({
    queryKey: ["admin-collect-stripe-api-logs"],
    queryFn: async (): Promise<ApiLogRow[]> => {
      const { data, error } = await supabase
        .from("stripe_api_logs")
        .select(
          "id, endpoint, attempt, http_status, duration_ms, error, is_timeout, transaction_reference, provider_transaction_id, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const allPlopTx = plopTransactions.data ?? [];
  const moncashTx = allPlopTx.filter((t) => t.payment_method_requested === "moncash");
  const natcashTx = allPlopTx.filter((t) => t.payment_method_requested === "natcash");
  const stripeTx = stripeTransactions.data ?? [];

  // external_reference -> wallet, built once from every PLOP transaction
  // fetched above (not a second query) — see this component's own header
  // comment for why plop_api_logs itself can't be filtered by wallet
  // directly.
  const referenceToWallet = new Map<string, "moncash" | "natcash">(
    allPlopTx
      .filter(
        (t): t is TransactionRow & { payment_method_requested: "moncash" | "natcash" } =>
          t.payment_method_requested === "moncash" || t.payment_method_requested === "natcash",
      )
      .map((t) => [t.external_reference, t.payment_method_requested]),
  );
  const allPlopLogs = plopApiLogs.data ?? [];
  const moncashLogs = allPlopLogs.filter(
    (l) =>
      l.transaction_reference != null &&
      referenceToWallet.get(l.transaction_reference) === "moncash",
  );
  const natcashLogs = allPlopLogs.filter(
    (l) =>
      l.transaction_reference != null &&
      referenceToWallet.get(l.transaction_reference) === "natcash",
  );
  const stripeLogs = stripeApiLogs.data ?? [];

  const byTab: Record<Wallet, { tx: TransactionRow[]; logs: ApiLogRow[] }> = {
    moncash: { tx: moncashTx, logs: moncashLogs },
    natcash: { tx: natcashTx, logs: natcashLogs },
    stripe: { tx: stripeTx, logs: stripeLogs },
  };
  const { tx, logs } = byTab[tab];

  const settingRow = providerSettings.data?.find((s) => s.provider === PROVIDER_SETTING_KEY[tab]);
  const configuredStatus = tab === "stripe" ? stripeStatus.data : plopStatus.data;

  const stats = {
    succeeded: tx.filter((t) => t.status === "paid").length,
    failed: tx.filter((t) => t.status === "failed").length,
    pending: tx.filter((t) => t.status === "pending").length,
    timeouts: logs.filter((l) => l.is_timeout).length,
    retries: logs.filter((l) => l.attempt > 1).length,
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
  // no separate polling/push mechanism. "Webhook manquant" is deliberately not
  // included here: neither PLOP nor this Stripe integration write a
  // dedicated webhook-receipt log (Stripe's handler calls
  // complete_collect_payment_secure directly, no row anywhere), and
  // payment_transactions.webhook_data is populated by 3 different callers
  // (webhook, poll, cron) — there is no honest way to compute "webhook
  // missing" separately from "stuck pending" below, so only the latter is
  // shown.
  const now = Date.now();
  const stuckPending = tx.filter(
    (t) =>
      t.status === "pending" &&
      now - new Date(t.created_at).getTime() > STUCK_PENDING_MINUTES[tab] * 60_000,
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
            body: `Dènye ${CONSECUTIVE_ERROR_THRESHOLD} apèl API ${TAB_LABEL[tab]} yo tout echwe san rete.`,
          },
        ]
      : []),
    ...(stuckPending.length > 0
      ? [
          {
            title: "Peman bloke twò lontan",
            body: `${stuckPending.length} peman ${TAB_LABEL[tab]} rete "an atant" depi plis pase ${
              STUCK_PENDING_MINUTES[tab] >= 60
                ? `${Math.round(STUCK_PENDING_MINUTES[tab] / 60)}è`
                : `${STUCK_PENDING_MINUTES[tab]} minit`
            }.`,
          },
        ]
      : []),
    ...(abnormalFailureRate
      ? [
          {
            title: "Ogmantasyon echèk sispèk",
            body: `Plis pase ${Math.round(FAILURE_RATE_ALERT_THRESHOLD * 100)}% nan dènye apèl ${TAB_LABEL[tab]} yo echwe.`,
          },
        ]
      : []),
  ];

  const columns: DataTableColumn<TransactionRow>[] = [
    {
      key: "order",
      header: "Kòmand",
      cell: (r) => (
        <div className="text-xs">
          <div className="font-mono text-ink">{r.orders?.order_number ?? "—"}</div>
          {r.orders?.restaurants?.name && (
            <div className="text-ink-soft">{r.orders.restaurants.name}</div>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Montan",
      cell: (r) => <span className="font-bold text-brand-deep">{formatHTG(r.amount)}</span>,
    },
    {
      key: "status",
      header: "Statut",
      cell: (r) => (
        <div className="space-y-1">
          <StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>
            {STATUS_LABEL[r.status] ?? r.status}
          </StatusBadge>
          {r.status === "failed" && r.error && (
            <div className="text-[11px] text-red-700">{r.error}</div>
          )}
        </div>
      ),
    },
    {
      key: "wallet",
      header: "Wallet",
      cell: (r) => (
        <div className="text-xs text-ink-soft">
          <div>Mande: {r.payment_method_requested ?? "—"}</div>
          {r.payment_method_used && r.payment_method_used !== r.payment_method_requested && (
            <div>Itilize: {r.payment_method_used}</div>
          )}
        </div>
      ),
      hideOnMobileCard: true,
    },
    {
      key: "reference",
      header: "Referans",
      cell: (r) => (
        <div className="text-xs">
          <div className="font-mono text-ink">{r.external_reference}</div>
          {r.provider_transaction_id && (
            <div className="font-mono text-ink-soft">{r.provider_transaction_id}</div>
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
    { key: "duration_ms", header: "Delè", cell: (r) => `${r.duration_ms} ms` },
    {
      key: "reference",
      header: "Referans",
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
    { key: "error", header: "Erè", cell: (r) => r.error ?? "—", hideOnMobileCard: true },
    {
      key: "created_at",
      header: "Dat",
      cell: (r) => new Date(r.created_at).toLocaleString("fr-HT"),
      hideOnMobileCard: true,
    },
  ];

  const loadingTx = tab === "stripe" ? stripeTransactions.isLoading : plopTransactions.isLoading;
  const loadingLogs = tab === "stripe" ? stripeApiLogs.isLoading : plopApiLogs.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Peman Otomatik</h1>
          <p className="mt-1 text-ink-soft">
            Estati, istwa ak jounal API pou 3 metòd peman otomatik yo — MonCash Otomatik ak NatCash
            Otomatik (pa PLOP) ak Kat Kredi (pa Stripe). Paj sa a se lekti sèlman.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-brand-soft/60">
        {(["moncash", "natcash", "stripe"] as const).map((w) => (
          <button key={w} onClick={() => setTab(w)} className={tabButtonClass(tab === w)}>
            {TAB_LABEL[w]}
          </button>
        ))}
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
          value={settingRow ? (settingRow.enabled ? "Wi" : "Non") : "—"}
          icon={settingRow?.enabled ? ShieldCheck : ShieldAlert}
          hint={`payment_provider_settings.${PROVIDER_SETTING_KEY[tab]}.enabled`}
        />
        <KpiCard
          label="Konfigire sou sèvè a"
          value={configuredStatus ? (configuredStatus.configured ? "Wi" : "Non") : "—"}
          icon={configuredStatus?.configured ? ShieldCheck : ShieldAlert}
          hint={
            tab === "stripe"
              ? "Prezans STRIPE_* — gade docs/archive/audits/STRIPE_INTEGRATION_REPORT.md"
              : "Prezans PLOP_* — gade docs/archive/plop/PLOP_PHASE1_ARCHITECTURE.md"
          }
        />
        <KpiCard label="Peman total nan istwa a" value={tx.length} icon={Zap} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Peman reyisi" value={stats.succeeded} icon={CheckCircle2} />
        <KpiCard label="Peman echwe" value={stats.failed} icon={XCircle} />
        <KpiCard label="Peman an atant" value={stats.pending} icon={Clock} />
        <KpiCard label="Delè ekoule (timeout)" value={stats.timeouts} icon={Timer} />
        <KpiCard label="Repriz (retries)" value={stats.retries} icon={RefreshCw} />
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
          hint={logs.length === 0 ? "Pa gen apèl toujou pou kalkile sa" : `Sou ${logs.length} apèl`}
        />
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          Istwa peman {TAB_LABEL[tab]}
          {tab === "stripe" && (
            <span className="ml-2 text-xs font-normal text-ink-soft">
              ({getProviderDisplayLabel("stripe_api")})
            </span>
          )}
        </h2>
        <DataTable<TransactionRow>
          rows={tx}
          getRowKey={(r) => r.id}
          loading={loadingTx}
          mobileTitleKey="order"
          emptyState={
            <EmptyState
              icon={Zap}
              title={`Pa gen okenn peman ${TAB_LABEL[tab]} toujou`}
              description="Nòmal si kanal sa a poko aktive oswa poko konfigire."
            />
          }
          columns={columns}
        />
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          Jounal apèl API — {TAB_LABEL[tab]}
        </h2>
        <p className="mb-3 text-xs text-ink-soft">
          Chak tantativ (ansanm ak repriz yo) — pa janm efase, pa janm modifye.
        </p>
        <DataTable<ApiLogRow>
          rows={logs}
          getRowKey={(r) => r.id}
          loading={loadingLogs}
          mobileTitleKey="endpoint"
          emptyState={
            <EmptyState
              icon={Zap}
              title="Pa gen okenn apèl API toujou"
              description="Nòmal si kanal sa a poko aktive."
            />
          }
          columns={apiLogColumns}
        />
      </section>
    </div>
  );
}
