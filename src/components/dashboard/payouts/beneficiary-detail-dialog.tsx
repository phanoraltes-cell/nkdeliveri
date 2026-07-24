import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { WalletSummaryCards } from "@/components/dashboard/wallet/wallet-summary-cards";
import { CommissionHistoryTable } from "@/components/dashboard/commission/commission-history-table";
import { PayoutHistoryTable } from "@/components/dashboard/payouts/payout-history-table";

export type BeneficiaryDetail = {
  type: "restaurant" | "driver";
  id: string;
  name: string;
  available_balance: number;
  pending_balance: number;
  paid_balance: number;
  lifetime_earnings: number;
  total_orders: number;
  last_payment_date: string | null;
  moncash_number: string | null;
  natcash_number: string | null;
};

type BeneficiaryDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beneficiary: BeneficiaryDetail | null;
};

/**
 * Full financial profile opened when the admin clicks a restaurant/driver —
 * wallet summary, commission history (why they're owed), and payout
 * history (what's already been sent), each already-built and reused
 * verbatim from the restaurant/driver-facing pages. Replaces the old
 * small "View" dialog + separate "History" button — one click, one
 * complete picture, per the "detailed financial profile" requirement.
 */
export function BeneficiaryDetailDialog({
  open,
  onOpenChange,
  beneficiary,
}: BeneficiaryDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{beneficiary?.name}</DialogTitle>
          <DialogDescription>
            Pwofil finansye konplè —{" "}
            {beneficiary?.last_payment_date
              ? `dènye peman ${new Date(beneficiary.last_payment_date).toLocaleDateString("fr-HT")}`
              : "poko gen peman"}
          </DialogDescription>
        </DialogHeader>

        {beneficiary && (
          <div className="space-y-6">
            <WalletSummaryCards
              wallet={{
                available_balance: beneficiary.available_balance,
                pending_balance: beneficiary.pending_balance,
                paid_balance: beneficiary.paid_balance,
                lifetime_earnings: beneficiary.lifetime_earnings,
              }}
              totalOrders={beneficiary.total_orders}
            />

            <div className="flex flex-wrap gap-4 rounded-xl bg-brand-soft/30 p-3 text-sm">
              <span>
                MonCash: <b className="text-ink">{beneficiary.moncash_number ?? "Pa konfigire"}</b>
              </span>
              <span>
                NatCash: <b className="text-ink">{beneficiary.natcash_number ?? "Pa konfigire"}</b>
              </span>
            </div>

            <CommissionHistoryTable
              beneficiaryType={beneficiary.type}
              beneficiaryId={beneficiary.id}
            />

            <PayoutHistoryTable
              beneficiaryType={beneficiary.type}
              beneficiaryId={beneficiary.id}
              beneficiaryName={beneficiary.name}
              enabled={open}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
