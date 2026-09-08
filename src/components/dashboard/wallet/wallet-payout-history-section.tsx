import { useQuery } from "@tanstack/react-query";
import { Download, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { Button } from "@/components/ui/button";
import { ProofThumb } from "@/components/proof-thumb";
import { PayoutConfirmSection } from "@/components/order/payout-confirm-section";
import { formatHTG } from "@/lib/format";
import { toAmount } from "@/lib/money";
import { generatePayoutReceipt } from "@/lib/payout-receipt";

type PayoutHistoryRow = {
  id: string;
  amount: number;
  fee_amount: number;
  net_amount: number;
  method: string;
  status: string;
  resolution: string | null;
  created_at: string;
  receiver_number: string;
  receiver_account_name: string | null;
  transaction_reference: string;
  dispute_reason: string | null;
  proof_url: string | null;
};

type WalletPayoutHistorySectionProps = {
  beneficiaryType: "restaurant" | "driver";
  beneficiaryId: string | undefined;
  beneficiaryName: string;
  /** The caller's own wallet query key, invalidated alongside the history query after confirm/dispute. */
  walletQueryKey: readonly unknown[];
};

/** Shared "Istwa peman" table for the restaurant/driver My Payments pages — same columns, same confirm/dispute action per row. */
export function WalletPayoutHistorySection({
  beneficiaryType,
  beneficiaryId,
  beneficiaryName,
  walletQueryKey,
}: WalletPayoutHistorySectionProps) {
  const queryKey = ["me-payout-history", beneficiaryType, beneficiaryId] as const;

  const history = useQuery({
    queryKey,
    enabled: !!beneficiaryId,
    queryFn: async () => {
      const column = beneficiaryType === "restaurant" ? "restaurant_id" : "driver_id";
      const { data, error } = await supabase
        .from("payouts")
        .select(
          "id, amount, fee_amount, net_amount, method, status, resolution, created_at, receiver_number, receiver_account_name, transaction_reference, dispute_reason, proof_url",
        )
        .eq(column, beneficiaryId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PayoutHistoryRow[];
    },
  });

  const columns: DataTableColumn<PayoutHistoryRow>[] = [
    {
      key: "created_at",
      header: "Dat",
      cell: (r) => new Date(r.created_at).toLocaleString("fr-HT"),
    },
    { key: "amount", header: "Montan", cell: (r) => formatHTG(Number(r.amount)) },
    { key: "method", header: "Metòd", cell: (r) => r.method.toUpperCase() },
    {
      key: "status",
      header: "Estati",
      cell: (r) => (
        <PayoutConfirmSection
          payoutId={r.id}
          status={r.status}
          resolution={r.resolution}
          invalidateKeys={[queryKey, walletQueryKey]}
        />
      ),
    },
    {
      key: "proof",
      header: "Prèv",
      cell: (r) =>
        r.proof_url ? (
          <ProofThumb
            path={r.proof_url}
            bucket="payout-proofs"
            alt={`Prèv peman ${beneficiaryName}`}
          />
        ) : (
          <span className="text-xs text-ink-soft">—</span>
        ),
      hideOnMobileCard: true,
    },
    {
      key: "actions",
      header: "Resi",
      cell: (r) => (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Telechaje resi"
          onClick={() =>
            generatePayoutReceipt({
              id: r.id,
              // toAmount, pa Number(): `Number(null)` bay 0, epi yon peman
              // ki pre-Tach 3D gen `net_amount` NULL — resi a t ap ekri
              // "Montan resevwa (nèt): 0 HTG" sou yon dokiman benefisyè a
              // kenbe. `undefined` kite resi a rekalkile brit - frè.
              amount: toAmount(r.amount) ?? 0,
              feeAmount: toAmount(r.fee_amount) ?? undefined,
              netAmount: toAmount(r.net_amount) ?? undefined,
              method: r.method,
              receiverNumber: r.receiver_number,
              receiverAccountName: r.receiver_account_name,
              transactionReference: r.transaction_reference,
              status: r.status,
              beneficiaryName,
              createdAt: r.created_at,
            })
          }
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      ),
      hideOnMobileCard: true,
    },
  ];

  return (
    <section>
      <h2 className="mb-3 font-display text-lg font-bold text-ink">Istwa peman</h2>
      <DataTable<PayoutHistoryRow>
        rows={history.data ?? []}
        getRowKey={(r) => r.id}
        loading={history.isLoading}
        mobileTitleKey="amount"
        emptyState={
          <EmptyState
            icon={History}
            title="Poko gen peman"
            description="Ou poko resevwa okenn peman manyèl."
          />
        }
        columns={columns}
      />
    </section>
  );
}
