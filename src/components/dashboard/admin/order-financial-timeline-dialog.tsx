import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge";
import { formatHTG } from "@/lib/format";
import {
  useOrderFinancialTimeline,
  type OrderFinancialTimelineRow,
} from "@/hooks/useAdminFinanceData";

const CATEGORY_LABEL: Record<string, string> = {
  order: "Kòmand",
  commission: "Komisyon",
  wallet_transaction: "Mouvman wallet",
  payout_coverage: "Kouvèti dekesman",
  moncash_webhook: "Webhook MonCash",
  payment: "Peman kliyan",
  payment_transaction: "Kolekte otomatik",
};

const CATEGORY_TONE: Record<string, StatusTone> = {
  order: "neutral",
  commission: "info",
  wallet_transaction: "info",
  payout_coverage: "good",
  moncash_webhook: "neutral",
  payment: "good",
  payment_transaction: "good",
};

type OrderFinancialTimelineDialogProps = {
  orderId: string | null;
  orderNumber?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * "Istorik" tab's row-click drill-down — the real event chain for one
 * order (order -> commission -> wallet -> payout coverage -> payment),
 * from get_order_financial_timeline_secure. Read-only, no actions here.
 */
export function OrderFinancialTimelineDialog({
  orderId,
  orderNumber,
  open,
  onOpenChange,
}: OrderFinancialTimelineDialogProps) {
  const timeline = useOrderFinancialTimeline(open ? orderId : null);
  const rows = timeline.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Istorik finansye{orderNumber ? ` — ${orderNumber}` : ""}</DialogTitle>
          <DialogDescription>
            Chèn evènman reyèl pou kòmand sa a, soti nan kreyasyon li jiska konfimasyon
            peman/dekesman.
          </DialogDescription>
        </DialogHeader>

        {timeline.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink-soft">Pa gen evènman finansye pou kòmand sa a.</p>
        ) : (
          <ol className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {rows.map((r: OrderFinancialTimelineRow) => (
              <li
                key={r.event_id}
                className="relative border-l-2 border-brand-soft/60 py-1 pl-4 last:border-transparent"
              >
                <span className="absolute -left-[7px] top-2 h-3 w-3 rounded-full bg-brand" />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={CATEGORY_TONE[r.category] ?? "neutral"}>
                      {CATEGORY_LABEL[r.category] ?? r.category}
                    </StatusBadge>
                    {r.beneficiary_name && (
                      <span className="text-xs font-semibold text-ink">{r.beneficiary_name}</span>
                    )}
                  </div>
                  <span className="text-xs text-ink-soft">
                    {new Date(r.event_time).toLocaleString("fr-HT")}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink-soft">{r.description}</p>
                  {r.amount != null && (
                    <span className="shrink-0 font-bold text-brand-deep">
                      {formatHTG(r.amount)}
                    </span>
                  )}
                </div>
                {(r.status || r.method || r.reference) && (
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-soft">
                    {r.status && <span>Estati: {r.status}</span>}
                    {r.method && <span className="uppercase">{r.method}</span>}
                    {r.reference && <span>Ref: {r.reference}</span>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}
