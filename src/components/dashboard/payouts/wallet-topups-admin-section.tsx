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
import { forceCreditWalletTopup } from "@/lib/force-credit-wallet-topup.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { inputClsCompact } from "@/lib/utils";
import { useReauth, isStepUpError } from "@/hooks/useReauth";
import { stepUpErrorMessage } from "@/lib/admin-step-up";
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
  const forceCredit = useServerFn(forceCreditWalletTopup);
  const [forceTarget, setForceTarget] = useState<TopupRow | null>(null);
  const [justification, setJustification] = useState("");
  const [plopSaid, setPlopSaid] = useState<Record<string, string>>({});

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
    mutationFn: async (externalReference: string) => {
      const result = await recover({ data: { externalReference } });
      return { externalReference, result };
    },
    onSuccess: ({ externalReference, result }) => {
      if (result.outcome === "recovered") {
        toast.success("Rechaj la rekipere — balans kliyan an kredite.");
      } else if (result.outcome === "not_paid") {
        toast.error(result.error);
      } else {
        // provider_unavailable — sèl lòt rezilta ki posib.
        toast.error(result.error);
      }
      if (result.outcome === "not_paid") {
        setPlopSaid((m) => ({ ...m, [externalReference]: result.error }));
      }
      qc.invalidateQueries({ queryKey: ["admin-wallet-topups"] });
    },
    onError: (e) => {
      if (isStepUpError(e)) {
        invalidateStepUp("strict");
        toast.error(stepUpErrorMessage(e));
        return;
      }
      toast.error(e.message ?? "Erè");
    },
  });

  const runForceCredit = useMutation({
    mutationFn: async () => {
      if (!forceTarget) throw new Error("Pa gen rechaj chwazi");
      if (justification.trim().length < 10) {
        throw new Error("Jistifikasyon obligatwa (omwen 10 karaktè)");
      }
      return forceCredit({
        data: {
          externalReference: forceTarget.external_reference,
          justification: justification.trim(),
          providerTransactionId: forceTarget.provider_transaction_id ?? undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success("Balans kliyan an kredite — tras odit anrejistre kòm desizyon admin.");
      setForceTarget(null);
      setJustification("");
      qc.invalidateQueries({ queryKey: ["admin-wallet-topups"] });
    },
    onError: (e) => {
      if (isStepUpError(e)) {
        invalidateStepUp("strict");
        toast.error(stepUpErrorMessage(e));
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
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={runRecover.isPending}
                onClick={() => withReauth(() => runRecover.mutate(r.external_reference), "strict")}
              >
                <LifeBuoy className="mr-1 h-3.5 w-3.5" />
                Rekipere
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setForceTarget(r)}>
                Kredi manyèl
              </Button>
            </div>
            {plopSaid[r.external_reference] && (
              <span className="max-w-[22rem] text-right text-[10px] text-red-600">
                {plopSaid[r.external_reference]}
              </span>
            )}
          </div>
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

      <Dialog open={!!forceTarget} onOpenChange={(open) => !open && setForceTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kredi manyèl (verifye pa yon moun)</DialogTitle>
            <DialogDescription>
              {forceTarget &&
                `${forceTarget.customer_name} — ${formatHTG(Number(forceTarget.amount))} — referans ${forceTarget.external_reference.slice(0, 8)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
              <b>Atansyon:</b> aksyon sa a kredite balans kliyan an <b>SAN</b> konfimasyon API PLOP
              la. Sèvi ak li sèlman si ou verifye peman an ou menm (dashbòd PLOP, SMS MonCash kliyan
              an, elt.). Li ap anrejistre kòm yon desizyon admin nan jounal odit la.
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Jistifikasyon (obligatwa) — ki jan ou verifye peman an?
              </span>
              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                rows={3}
                placeholder="Egzanp: Peman parèt konfime nan dashbòd PLOP la, ID tranzaksyon XXXX, 50 HTG, dat 01/09."
                className={inputClsCompact()}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForceTarget(null)}>
              Anile
            </Button>
            <Button
              variant="destructive"
              disabled={runForceCredit.isPending || justification.trim().length < 10}
              onClick={() => withReauth(() => runForceCredit.mutate(), "strict")}
            >
              {runForceCredit.isPending ? "Ap kredite…" : "Kredite balans lan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReauthDialog state={dialogState} />
    </>
  );
}
