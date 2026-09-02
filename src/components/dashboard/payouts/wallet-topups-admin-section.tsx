import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { LifeBuoy, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { StatusBadge } from "@/components/dashboard/status-badge";
import type { StatusTone } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { formatHTG } from "@/lib/format";
import { recoverWalletTopup } from "@/lib/recover-wallet-topup.functions";
import { useReauth, isStepUpError } from "@/hooks/useReauth";
import { ReauthDialog } from "@/components/reauth-dialog";

type TopupRow = {
  id: string;
  user_id: string;
  customer_name: string;
  amount: number;
  payment_method: string;
  status: string;
  external_reference: string;
  provider_transaction_id: string | null;
  error: string | null;
  created_at: string;
  confirmed_at: string | null;
  total_count: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "An atant",
  succeeded: "Reyisi",
  failed: "Echwe",
  expired: "Ekspire",
};
const STATUS_TONE: Record<string, StatusTone> = {
  pending: "warn",
  succeeded: "good",
  failed: "bad",
  expired: "bad",
};

/**
 * Vizibilite + rekiperasyon admin pou rechaj wallet kliyan.
 *
 * POUKISA LI EGZISTE: anvan ensidan 50 HTG la, pa te gen OKENN kote nan
 * admin dashbòd la kote yon rechaj wallet te vizib. Yon peman reyèl ki
 * pa t rive nan yon balans te envizib nèt — se sa ki fè bug la te ka
 * pase san yo pa wè l. Bouton "Rekipere" a MANDE PLOP anvan (jamè yon
 * kredi sou pawòl), epi kredi a pwoteje kont doub pa ledger la menm.
 */
export function WalletTopupsAdminSection() {
  const qc = useQueryClient();
  const recover = useServerFn(recoverWalletTopup);
  const { withReauth, invalidateStepUp, dialogState } = useReauth();
  const [status, setStatus] = useState<string>("");

  const topups = useQuery({
    queryKey: ["admin-wallet-topups", status],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_wallet_topups_admin_secure", {
        _status: status || undefined,
        _limit: 50,
      });
      if (error) throw error;
      return (data ?? []) as TopupRow[];
    },
    refetchInterval: 60_000,
  });

  const runRecover = useMutation({
    mutationFn: (externalReference: string) => recover({ data: { externalReference } }),
    onSuccess: (result) => {
      if (result.outcome === "recovered") {
        toast.success("Rechaj la rekipere — balans kliyan an kredite.");
      } else if (result.outcome === "not_paid") {
        toast.error(result.error);
      } else {
        toast.error(result.error ?? "Pa ka rekipere kounye a");
      }
      qc.invalidateQueries({ queryKey: ["admin-wallet-topups"] });
    },
    onError: (e) => {
      if (isStepUpError(e)) {
        invalidateStepUp("strict");
        toast.error("Verifikasyon sekirite ekspire — klike ankò pou re-verifye.");
        return;
      }
      toast.error(e.message ?? "Erè");
    },
  });

  const columns: DataTableColumn<TopupRow>[] = [
    {
      key: "created_at",
      header: "Dat",
      cell: (r) => new Date(r.created_at).toLocaleString("fr-HT"),
    },
    { key: "customer_name", header: "Kliyan", cell: (r) => r.customer_name },
    { key: "amount", header: "Montan", cell: (r) => formatHTG(Number(r.amount)) },
    { key: "payment_method", header: "Metòd", cell: (r) => r.payment_method.toUpperCase() },
    {
      key: "status",
      header: "Estati",
      cell: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge tone={STATUS_TONE[r.status] ?? "neutral"}>
            {STATUS_LABEL[r.status] ?? r.status}
          </StatusBadge>
          {r.error && <span className="text-[10px] text-red-600">{r.error}</span>}
        </div>
      ),
    },
    {
      key: "external_reference",
      header: "Referans",
      cell: (r) => <code className="text-[10px]">{r.external_reference.slice(0, 8)}</code>,
      hideOnMobileCard: true,
    },
    {
      key: "actions",
      header: "Aksyon",
      cell: (r) =>
        r.status === "succeeded" ? (
          <span className="text-xs text-ink-soft">—</span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={runRecover.isPending}
            onClick={() => withReauth(() => runRecover.mutate(r.external_reference), "strict")}
          >
            <LifeBuoy className="mr-1 h-3.5 w-3.5" />
            Rekipere
          </Button>
        ),
    },
  ];

  return (
    <>
      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-bold text-ink">Rechaj wallet kliyan</h2>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filtre pa estati"
            className="rounded-lg border-2 border-brand-soft bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-brand"
          >
            <option value="">Tout estati</option>
            <option value="pending">An atant</option>
            <option value="succeeded">Reyisi</option>
            <option value="failed">Echwe</option>
            <option value="expired">Ekspire</option>
          </select>
        </div>
        <p className="mb-3 text-xs text-ink-soft">
          "Rekipere" mande PLOP anvan tout bagay: si PLOP konfime peman an, balans kliyan an kredite
          (yon sèl fwa, garanti pa ledger la). Si PLOP pa konfime, anyen pa touche.
        </p>
        <DataTable<TopupRow>
          rows={topups.data ?? []}
          getRowKey={(r) => r.id}
          loading={topups.isLoading}
          mobileTitleKey="amount"
          emptyState={
            <EmptyState
              icon={Wallet}
              title="Pa gen rechaj"
              description="Pa gen okenn rechaj wallet ki koresponn ak filtè sa a."
            />
          }
          columns={columns}
        />
      </section>
      <ReauthDialog state={dialogState} />
    </>
  );
}
