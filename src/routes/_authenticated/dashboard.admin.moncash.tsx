import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Smartphone, ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge";
import { getMonCashStatus } from "@/lib/get-moncash-status.functions";

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
    </div>
  );
}
