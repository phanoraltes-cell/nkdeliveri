import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  FileSearch,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  RotateCcw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { downloadCSV } from "@/lib/csv-export";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { useBackfillPreviewData, type PreviewRow } from "@/hooks/useBackfillPreviewData";

export const Route = createFileRoute("/_authenticated/dashboard/admin/payout-migration")({
  component: PayoutMigrationWizard,
});

const PAGE_SIZE = 20;

type ExecuteResultRow = {
  order_id: string;
  order_number: string;
  outcome: string;
  detail: string | null;
};

type Step = "scan" | "preview" | "confirm" | "execute" | "report";

const OUTCOME_LABEL: Record<string, string> = {
  migrated: "Migre",
  already_migrated: "Deja migre",
  skipped: "Sote",
  error: "Erè",
};
const OUTCOME_TONE: Record<string, StatusTone> = {
  migrated: "good",
  already_migrated: "neutral",
  skipped: "warn",
  error: "bad",
};

/**
 * Backfill Wizard — migrates delivered orders that predate the commission
 * engine (no commission_ledger row exists for them) into the ledger, via
 * the SECURITY DEFINER RPCs that reuse the exact same calculation/write
 * logic as the automatic delivery trigger (private.generate_commission_for_order).
 * Never runs on page load — every step here is either read-only or
 * requires an explicit confirmed click.
 */
function PayoutMigrationWizard() {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("scan");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [results, setResults] = useState<ExecuteResultRow[]>([]);

  const [search, setSearch] = useState("");
  const [restaurantFilter, setRestaurantFilter] = useState("");
  const [driverFilter, setDriverFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const { summary, preview, filterOptions } = useBackfillPreviewData(
    step,
    search,
    restaurantFilter,
    driverFilter,
    from,
    to,
    page,
    PAGE_SIZE,
  );

  const execute = useMutation({
    mutationFn: async (): Promise<ExecuteResultRow[]> => {
      const { data, error } = await supabase.rpc("execute_commission_backfill_secure", {});
      if (error) throw error;
      return data ?? [];
    },
    onSuccess: (rows) => {
      setResults(rows);
      setStep("report");
      qc.invalidateQueries({ queryKey: ["backfill-summary"] });
      qc.invalidateQueries({ queryKey: ["backfill-preview"] });
      qc.invalidateQueries({ queryKey: ["admin-wallets"] });
      qc.invalidateQueries({ queryKey: ["admin-payout-kpis"] });
    },
  });

  function startOver() {
    setStep("scan");
    setConfirmChecked(false);
    setResults([]);
    setPage(1);
    qc.invalidateQueries({ queryKey: ["backfill-summary"] });
    qc.invalidateQueries({ queryKey: ["backfill-preview"] });
  }

  const totalCount = preview.data?.[0]?.total_count ?? 0;

  const columns: DataTableColumn<PreviewRow>[] = [
    { key: "order_number", header: "Kòmand", cell: (r) => r.order_number },
    {
      key: "order_date",
      header: "Dat",
      cell: (r) => new Date(r.order_date).toLocaleDateString("fr-HT"),
    },
    { key: "restaurant_name", header: "Restoran", cell: (r) => r.restaurant_name ?? "—" },
    {
      key: "driver_name",
      header: "Livrè",
      cell: (r) => r.driver_name ?? "—",
      hideOnMobileCard: true,
    },
    {
      key: "subtotal",
      header: "Subtotal",
      cell: (r) => formatHTG(r.subtotal),
      hideOnMobileCard: true,
    },
    {
      key: "delivery_fee",
      header: "Frè livrezon",
      cell: (r) => formatHTG(r.delivery_fee),
      hideOnMobileCard: true,
    },
    {
      key: "restaurant_commission_amount",
      header: "Kom. restoran",
      cell: (r) =>
        r.restaurant_commission_amount != null ? formatHTG(r.restaurant_commission_amount) : "—",
    },
    {
      key: "driver_commission_amount",
      header: "Kom. livrè",
      cell: (r) =>
        r.driver_commission_amount != null ? formatHTG(r.driver_commission_amount) : "—",
    },
    {
      key: "platform_commission_amount",
      header: "Kom. platfòm",
      cell: (r) => (
        <span className="font-bold text-brand-deep">{formatHTG(r.platform_commission_amount)}</span>
      ),
    },
    {
      key: "migration_status",
      header: "Estati",
      cell: () => <StatusBadge tone="warn">An atant</StatusBadge>,
    },
  ];

  const resultColumns: DataTableColumn<ExecuteResultRow>[] = [
    { key: "order_number", header: "Kòmand", cell: (r) => r.order_number },
    {
      key: "outcome",
      header: "Rezilta",
      cell: (r) => (
        <StatusBadge tone={OUTCOME_TONE[r.outcome] ?? "neutral"}>
          {OUTCOME_LABEL[r.outcome] ?? r.outcome}
        </StatusBadge>
      ),
    },
    { key: "detail", header: "Detay", cell: (r) => r.detail ?? "—" },
  ];

  const migratedCount = results.filter((r) => r.outcome === "migrated").length;
  const alreadyCount = results.filter((r) => r.outcome === "already_migrated").length;
  const skippedCount = results.filter((r) => r.outcome === "skipped").length;
  const errorCount = results.filter((r) => r.outcome === "error").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Asistan Migrasyon</h1>
          <p className="mt-1 text-ink-soft">
            Migre ansyen kòmand ki te livre anvan motè komisyon an te egziste, san doub, san danje.
          </p>
        </div>
        <Link
          to="/dashboard/admin/payouts"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dekesman
        </Link>
      </div>

      <Steps current={step} />

      {step === "scan" && (
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              label="Kòmand istorik"
              value={summary.data ? String(summary.data.total_orders) : "—"}
              icon={ClipboardList}
            />
            <KpiCard
              label="Restoran konsène"
              value={summary.data ? String(summary.data.restaurant_count) : "—"}
              icon={FileSearch}
            />
            <KpiCard
              label="Livrè konsène"
              value={summary.data ? String(summary.data.driver_count) : "—"}
              icon={FileSearch}
            />
            <KpiCard
              label="Revni restoran estime"
              value={
                summary.data ? formatHTG(Number(summary.data.estimated_restaurant_earnings)) : "—"
              }
              icon={ClipboardList}
            />
            <KpiCard
              label="Revni livrè estime"
              value={summary.data ? formatHTG(Number(summary.data.estimated_driver_earnings)) : "—"}
              icon={ClipboardList}
            />
            <KpiCard
              label="Komisyon platfòm estime"
              value={
                summary.data ? formatHTG(Number(summary.data.estimated_platform_commission)) : "—"
              }
              icon={ClipboardList}
            />
          </div>

          {summary.data && summary.data.total_orders === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Pa gen kòmand pou migre"
              description="Tout kòmand ki livre gen tan gen yon antre komisyon. Pa gen anyen pou fè."
            />
          ) : (
            <Button onClick={() => setStep("preview")} disabled={summary.isLoading}>
              Wè detay yo
            </Button>
          )}
        </section>
      )}

      {step === "preview" && (
        <section className="space-y-4">
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
              value={restaurantFilter}
              onChange={(e) => {
                setRestaurantFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filtre pa restoran"
              className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <option value="">Tout restoran</option>
              {(filterOptions.data?.restaurants ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select
              value={driverFilter}
              onChange={(e) => {
                setDriverFilter(e.target.value);
                setPage(1);
              }}
              aria-label="Filtre pa livrè"
              className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs font-semibold outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
            >
              <option value="">Tout livrè</option>
              {(filterOptions.data?.drivers ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <DataTable<PreviewRow>
            rows={preview.data ?? []}
            getRowKey={(r) => r.order_id}
            loading={preview.isLoading}
            mobileTitleKey="order_number"
            emptyState={
              <EmptyState
                icon={FileSearch}
                title="Pa gen rezilta"
                description="Okenn kòmand pa koresponn ak filtè sa a."
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

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("scan")}>
              Retounen
            </Button>
            <Button onClick={() => setStep("confirm")}>Kontinye</Button>
          </div>
        </section>
      )}

      {step === "confirm" && summary.data && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="h-6 w-6 shrink-0 text-amber-700" />
              <div>
                <h2 className="font-display text-lg font-bold text-ink">
                  Konfime migrasyon istorik la
                </h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Aksyon sa a pral kreye antre komisyon pèmanan pou{" "}
                  <b>{summary.data.total_orders} kòmand istorik</b> — Revni restoran{" "}
                  <b>{formatHTG(Number(summary.data.estimated_restaurant_earnings))}</b>, Revni
                  livrè <b>{formatHTG(Number(summary.data.estimated_driver_earnings))}</b>, Komisyon
                  platfòm <b>{formatHTG(Number(summary.data.estimated_platform_commission))}</b>.
                </p>
                <p className="mt-2 text-sm text-ink-soft">
                  Chak kòmand ki deja gen yon komisyon ap otomatikman sote — operasyon sa a pa ka
                  kreye doub menm si ou lanse l plizyè fwa.
                </p>
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              className="h-4 w-4 rounded border-2 border-brand-soft"
            />
            Mwen konprann sa a pral kreye done finansye pèmanan
          </label>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("preview")}>
              Retounen
            </Button>
            <Button
              disabled={!confirmChecked}
              onClick={() => {
                setStep("execute");
                execute.mutate();
              }}
            >
              Konfime migrasyon an
            </Button>
          </div>
        </section>
      )}

      {step === "execute" && (
        <section className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-brand-soft/60 bg-white p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-deep" />
          <p className="font-display text-lg font-bold text-ink">Ap migre kòmand yo…</p>
          <p className="text-sm text-ink-soft">Tanpri pa fèmen paj sa a.</p>
        </section>
      )}

      {step === "report" && (
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Migre" value={migratedCount} icon={CheckCircle2} />
            <KpiCard label="Deja migre" value={alreadyCount} icon={ClipboardList} />
            <KpiCard label="Sote" value={skippedCount} icon={AlertTriangle} />
            <KpiCard label="Erè" value={errorCount} icon={ShieldAlert} />
          </div>

          <DataTable<ExecuteResultRow>
            rows={results}
            getRowKey={(r) => r.order_id}
            mobileTitleKey="order_number"
            emptyState={<EmptyState icon={ClipboardList} title="Pa gen rezilta" />}
            columns={resultColumns}
          />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                downloadCSV(
                  `migrasyon-komisyon-${new Date().toISOString().slice(0, 10)}.csv`,
                  ["Kòmand", "Rezilta", "Detay"],
                  results.map((r) => [
                    r.order_number,
                    OUTCOME_LABEL[r.outcome] ?? r.outcome,
                    r.detail ?? "",
                  ]),
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> Telechaje rapò (CSV)
            </Button>
            <Button onClick={startOver}>
              <RotateCcw className="h-3.5 w-3.5" /> Nouvo migrasyon
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

const STEP_LABEL: Record<Step, string> = {
  scan: "1. Rechèch",
  preview: "2. Detay",
  confirm: "3. Konfimasyon",
  execute: "4. Migrasyon",
  report: "5. Rapò",
};
const STEP_ORDER: Step[] = ["scan", "preview", "confirm", "execute", "report"];

function Steps({ current }: { current: Step }) {
  const currentIndex = STEP_ORDER.indexOf(current);
  return (
    <ol className="flex flex-wrap gap-2 text-xs font-bold">
      {STEP_ORDER.map((s, i) => (
        <li
          key={s}
          className={`rounded-full px-3 py-1.5 ${
            i === currentIndex
              ? "bg-brand-deep text-white"
              : i < currentIndex
                ? "bg-brand-soft/70 text-brand-deep"
                : "bg-ink/5 text-ink-soft"
          }`}
        >
          {STEP_LABEL[s]}
        </li>
      ))}
    </ol>
  );
}
