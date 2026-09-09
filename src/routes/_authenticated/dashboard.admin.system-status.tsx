import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Activity, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getIntegrationStatus,
  testIntegration,
  type IntegrationTestResult,
} from "@/lib/integrations/status.functions";
import type { IntegrationId } from "@/lib/integrations/failure";

// Role guard lives on the parent layout (dashboard.admin.tsx).
export const Route = createFileRoute("/_authenticated/dashboard/admin/system-status")({
  component: SystemStatus,
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-HT");
}

/**
 * « Eta sistèm nan » — repons dirèk la a ensidan `/api/admin/ai` la.
 *
 * Pandan twa jou, enfòmasyon ki te bezwen an te egziste (nan jounal Vercel)
 * men pa t gen okenn kote pou yon admin gade l. Paj sa a se kote sa a: pou
 * chak entegrasyon, èske li konfigire, ki lè dènye apèl ki reyisi a te
 * fèt, ki lè dènye echèk la te fèt epi poukisa.
 *
 * Li pa janm montre valè yon kle — sèlman « konfigire » oswa non varyab ki
 * manke yo.
 */
function SystemStatus() {
  const statusFn = useServerFn(getIntegrationStatus);
  const testFn = useServerFn(testIntegration);
  const [results, setResults] = useState<Partial<Record<IntegrationId, IntegrationTestResult>>>({});

  const status = useQuery({
    queryKey: ["admin-integration-status"],
    queryFn: () => statusFn({ data: undefined }),
  });

  const runTest = useMutation({
    mutationFn: (integration: IntegrationId) => testFn({ data: { integration } }),
    onSuccess: (result, integration) => setResults((r) => ({ ...r, [integration]: result })),
    onError: (err, integration) =>
      setResults((r) => ({
        ...r,
        [integration]: {
          ok: false,
          kind: null,
          message: err instanceof Error ? err.message : "Tès la echwe.",
        },
      })),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 font-display text-3xl font-extrabold text-ink">
          <Activity className="h-7 w-7 text-brand-deep" aria-hidden="true" /> Eta sistèm nan
        </h1>
        <p className="mt-1 text-ink-soft">
          Chak sèvis ekstèn aplikasyon an depann de. Paj sa a pa janm montre valè yon kle — sèlman
          si li konfigire.
        </p>
      </div>

      {status.isLoading && <p className="text-sm text-ink-soft">N ap chaje…</p>}
      {status.isError && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700">
          {status.error instanceof Error ? status.error.message : "Pa ka chaje eta a."}
        </p>
      )}

      <div className="space-y-3">
        {(status.data ?? []).map((row) => {
          const result = results[row.id];
          const testing = runTest.isPending && runTest.variables === row.id;
          return (
            <section
              key={row.id}
              className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-brand-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {row.configured ? (
                    <CheckCircle2
                      className="h-5 w-5 shrink-0 text-status-good"
                      aria-hidden="true"
                    />
                  ) : (
                    <XCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                  )}
                  <h2 className="font-display text-base font-bold text-ink">{row.label}</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      row.configured
                        ? "bg-status-good-soft text-status-good"
                        : "bg-red-50 text-destructive"
                    }`}
                  >
                    {row.configured ? "Konfigire" : "Pa konfigire"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  isLoading={testing}
                  onClick={() => runTest.mutate(row.id)}
                >
                  Teste
                </Button>
              </div>

              {row.missingEnv.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-destructive">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Varyab ki manke: {row.missingEnv.join(", ")}
                </p>
              )}

              <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
                <div className="flex gap-1.5">
                  <dt className="text-ink-soft">Dènye apèl ki reyisi:</dt>
                  <dd className="font-semibold text-ink">{formatDate(row.lastSuccessAt)}</dd>
                </div>
                <div className="flex gap-1.5">
                  <dt className="text-ink-soft">Dènye echèk:</dt>
                  <dd className="font-semibold text-ink">{formatDate(row.lastFailureAt)}</dd>
                </div>
              </dl>
              {row.lastFailureReason && (
                <p className="mt-1 break-words text-xs text-destructive">
                  Rezon: {row.lastFailureReason}
                </p>
              )}
              {!row.hasHistory && (
                <p className="mt-1 text-xs text-ink-soft">
                  Pa gen jounal apèl pou sèvis sa a — sèvi ak bouton Teste a.
                </p>
              )}

              {result && (
                <p
                  role="status"
                  className={`mt-3 rounded-xl px-3 py-2 text-xs font-semibold ${
                    result.ok
                      ? "bg-status-good-soft text-status-good"
                      : "bg-red-50 text-destructive"
                  }`}
                >
                  {result.message}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
