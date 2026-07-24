import { useQuery } from "@tanstack/react-query";
import { Download, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import {
  PAYOUT_RESOLUTION_LABEL,
  PAYOUT_STATUS_LABEL,
  PAYOUT_STATUS_TONE,
} from "@/lib/payout-status";
import { formatHTG } from "@/lib/format";
import { generatePayoutReceipt } from "@/lib/payout-receipt";

type PayoutHistoryRow = {
  id: string;
  amount: number;
  method: string;
  status: string;
  resolution: string | null;
  created_at: string;
  receiver_number: string;
  receiver_account_name: string | null;
  transaction_reference: string;
  dispute_reason: string | null;
};

type PayoutHistoryTableProps = {
  beneficiaryType: "restaurant" | "driver";
  beneficiaryId: string | undefined;
  beneficiaryName: string;
  enabled?: boolean;
};

/**
 * A beneficiary's full payout history — direct RLS-gated select (no RPC
 * needed). Plain table, no Dialog wrapper, so it can be embedded inside the
 * admin's BeneficiaryDetailDialog as well as the restaurant/driver "My
 * Payments" pages' own history section.
 */
export function PayoutHistoryTable({
  beneficiaryType,
  beneficiaryId,
  beneficiaryName,
  enabled = true,
}: PayoutHistoryTableProps) {
  const history = useQuery({
    queryKey: ["payout-history", beneficiaryType, beneficiaryId],
    enabled: enabled && !!beneficiaryId,
    queryFn: async () => {
      const column = beneficiaryType === "restaurant" ? "restaurant_id" : "driver_id";
      const { data, error } = await supabase
        .from("payouts")
        .select(
          "id, amount, method, status, resolution, created_at, receiver_number, receiver_account_name, transaction_reference, dispute_reason",
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
    { key: "receiver_number", header: "Nimewo", cell: (r) => r.receiver_number },
    {
      key: "status",
      header: "Estati",
      cell: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge tone={PAYOUT_STATUS_TONE[r.status]}>
            {PAYOUT_STATUS_LABEL[r.status] ?? r.status}
          </StatusBadge>
          {r.status === "resolved" && r.resolution && (
            <span className="text-[10px] text-ink-soft">
              {PAYOUT_RESOLUTION_LABEL[r.resolution]}
            </span>
          )}
        </div>
      ),
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
              amount: Number(r.amount),
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
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold text-ink">Istwa peman</h2>
      <DataTable<PayoutHistoryRow>
        rows={history.data ?? []}
        getRowKey={(r) => r.id}
        loading={history.isLoading}
        mobileTitleKey="amount"
        emptyState={
          <EmptyState
            icon={History}
            title="Poko gen peman"
            description="Okenn peman pa poko voye bay benefisyè sa a."
          />
        }
        columns={columns}
      />
    </section>
  );
}
