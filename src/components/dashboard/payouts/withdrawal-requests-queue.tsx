import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Inbox, Send, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { inputClsCompact } from "@/lib/utils";
import { formatHTG } from "@/lib/format";
import { assertValidUploadFile } from "@/lib/file-validation";
import { attemptWithdrawalProviderFn } from "@/lib/attempt-withdrawal-provider.functions";
import { useReauth, isStepUpError } from "@/hooks/useReauth";
import { ReauthDialog } from "@/components/reauth-dialog";

type RequestRow = {
  id: string;
  amount: number;
  fee_amount: number;
  net_amount: number;
  method: string;
  receiver_number: string;
  created_at: string;
  restaurant_id: string | null;
  driver_id: string | null;
  restaurants: { name: string } | null;
  drivers: { first_name: string | null; last_name: string | null } | null;
};

/**
 * Tach 3B — "Demann Retrè" queue: every self-service withdrawal request
 * (payouts.status = 'requested') waiting for either an automatic PLOP
 * attempt or a manual admin payment, distinct from the existing wallet-
 * aggregate queue above it on this page (which is about who's OWED money
 * in general, not about a specific request a beneficiary already made).
 */
export function WithdrawalRequestsQueue() {
  const qc = useQueryClient();
  const attemptProvider = useServerFn(attemptWithdrawalProviderFn);
  const { withReauth, invalidateStepUp, dialogState } = useReauth();
  const [payTarget, setPayTarget] = useState<RequestRow | null>(null);
  const [transactionReference, setTransactionReference] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const requests = useQuery({
    queryKey: ["admin-withdrawal-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payouts")
        .select(
          "id, amount, fee_amount, net_amount, method, receiver_number, created_at, restaurant_id, driver_id, restaurants(name), drivers(first_name, last_name)",
        )
        .eq("status", "requested")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as RequestRow[];
    },
    refetchInterval: 30_000,
  });

  function beneficiaryName(r: RequestRow): string {
    if (r.restaurants) return r.restaurants.name;
    if (r.drivers) return [r.drivers.first_name, r.drivers.last_name].filter(Boolean).join(" ");
    return "—";
  }

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["admin-withdrawal-requests"] });
    qc.invalidateQueries({ queryKey: ["admin-wallets"] });
  }

  const attempt = useMutation({
    mutationFn: (payoutId: string) => attemptProvider({ data: { payoutId } }),
    onSuccess: (result) => {
      if (result.outcome === "success") toast.success("Retrè egzekite otomatikman ak siksè.");
      else if (result.outcome === "pending")
        toast.success("Demann voye bay pwovidè a. N ap konfime rezilta a talè.");
      else if (result.outcome === "failed") toast.error(`Pwovidè echwe: ${result.error}`);
      else if (result.outcome === "not_yet_available") toast.error(result.error);
      else toast.error("Pwovidè otomatik pa disponib toujou — peye l manyèlman.");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  const payManually = useMutation({
    mutationFn: async () => {
      if (!payTarget) throw new Error("Pa gen demann chwazi");
      if (!transactionReference.trim()) throw new Error("Referans tranzaksyon obligatwa");

      let proofUrl: string | undefined;
      if (file) {
        const beneficiaryId = payTarget.restaurant_id ?? payTarget.driver_id ?? "unknown";
        assertValidUploadFile(file, "payout-proofs");
        const path = `${beneficiaryId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("payout-proofs").upload(path, file, {
          upsert: false,
        });
        if (upErr) throw upErr;
        proofUrl = path;
      }

      const { error } = await supabase.rpc("admin_mark_requested_withdrawal_paid_secure", {
        _payout_id: payTarget.id,
        _transaction_reference: transactionReference.trim(),
        _proof_url: proofUrl,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Peman anrejistre. Benefisyè a resevwa yon notifikasyon.");
      setPayTarget(null);
      setTransactionReference("");
      setFile(null);
      invalidateAll();
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

  const columns: DataTableColumn<RequestRow>[] = [
    {
      key: "created_at",
      header: "Dat",
      cell: (r) => new Date(r.created_at).toLocaleString("fr-HT"),
    },
    { key: "name", header: "Benefisyè", cell: (r) => beneficiaryName(r) },
    { key: "amount", header: "Montan", cell: (r) => formatHTG(Number(r.amount)) },
    {
      key: "net_amount",
      header: "Nèt (apre frè)",
      cell: (r) => (
        <span className={r.fee_amount > 0 ? "font-bold text-brand-deep" : ""}>
          {formatHTG(Number(r.net_amount))}
        </span>
      ),
      hideOnMobileCard: true,
    },
    { key: "method", header: "Metòd", cell: (r) => r.method.toUpperCase() },
    { key: "receiver_number", header: "Nimewo", cell: (r) => r.receiver_number },
    {
      key: "actions",
      header: "Aksyon",
      cell: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={attempt.isPending}
            onClick={() => attempt.mutate(r.id)}
          >
            <Zap className="mr-1 h-3.5 w-3.5" />
            Otomatik
          </Button>
          <Button size="sm" onClick={() => setPayTarget(r)}>
            <Send className="mr-1 h-3.5 w-3.5" />
            Manyèl
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">Demann retrè pwòp-tèt</h2>
        <DataTable<RequestRow>
          rows={requests.data ?? []}
          getRowKey={(r) => r.id}
          loading={requests.isLoading}
          mobileTitleKey="amount"
          emptyState={
            <EmptyState
              icon={Inbox}
              title="Pa gen demann"
              description="Pa gen okenn demann retrè pwòp-tèt k ap tann tretman kounye a."
            />
          }
          columns={columns}
        />
      </section>

      <Dialog open={!!payTarget} onOpenChange={(open) => !open && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Peye demann retrè a manyèlman</DialogTitle>
            <DialogDescription>
              {payTarget && `${beneficiaryName(payTarget)} — sou ${payTarget.receiver_number}`}
            </DialogDescription>
          </DialogHeader>
          {payTarget && payTarget.fee_amount > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
              Montan mande: <b>{formatHTG(Number(payTarget.amount))}</b> — Frè:{" "}
              <b>{formatHTG(Number(payTarget.fee_amount))}</b> — Voye:{" "}
              <b>{formatHTG(Number(payTarget.net_amount))}</b> sèlman (pa montan brit la).
            </div>
          )}
          {payTarget && payTarget.fee_amount === 0 && (
            <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">
              Voye: <b>{formatHTG(Number(payTarget.net_amount))}</b> (okenn frè sou demann sa a).
            </div>
          )}
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Referans tranzaksyon
              </span>
              <input
                value={transactionReference}
                onChange={(e) => setTransactionReference(e.target.value)}
                placeholder="Nimewo tranzaksyon MonCash/NatCash"
                className={inputClsCompact()}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Prèv peman (opsyonèl)
              </span>
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className={inputClsCompact()}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>
              Anile
            </Button>
            <Button
              disabled={payManually.isPending || !transactionReference.trim()}
              onClick={() => withReauth(() => payManually.mutate(), "strict")}
            >
              {payManually.isPending ? "Ap voye…" : "Konfime peman"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReauthDialog state={dialogState} />
    </>
  );
}
