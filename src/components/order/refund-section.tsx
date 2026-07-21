import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge";
import { formatHTG } from "@/lib/format";
import { inputClsCompact } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const REFUND_STATUS_LABEL: Record<string, string> = {
  requested: "An atant revizyon",
  approved: "Apwouve — ap trete",
  rejected: "Rejte",
  completed: "Ranbouse",
};

const REFUND_STATUS_TONE: Record<string, StatusTone> = {
  requested: "warn",
  approved: "good",
  rejected: "bad",
  completed: "good",
};

type RefundSectionProps = {
  orderId: string;
  orderStatus: string;
  paymentStatus: string | undefined;
};

/** Order-detail page's refund card: request form when eligible, or the current refund's status otherwise. */
export function RefundSection({ orderId, orderStatus, paymentStatus }: RefundSectionProps) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

  const refund = useQuery({
    queryKey: ["refund", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("refunds")
        .select("id, status, amount, reason, admin_notes, created_at, reviewed_at, completed_at")
        .eq("order_id", orderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const request = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 5) throw new Error("Tanpri eksplike rezon an (omwen 5 karaktè)");
      const { error } = await supabase.rpc("request_refund_secure", {
        _order_id: orderId,
        _reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Demann ranbousman voye. Yon administratè ap revize li.");
      setReason("");
      qc.invalidateQueries({ queryKey: ["refund", orderId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const eligible =
    (orderStatus === "delivered" || orderStatus === "cancelled") && paymentStatus === "paid";
  const canRequest = eligible && (!refund.data || refund.data.status === "rejected");

  if (!eligible && !refund.data) return null;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2 font-display text-base font-bold">
          <RotateCcw className="h-4 w-4 text-brand-deep" /> Ranbousman
        </div>
        {refund.data && (
          <StatusBadge tone={REFUND_STATUS_TONE[refund.data.status]}>
            {REFUND_STATUS_LABEL[refund.data.status] ?? refund.data.status}
          </StatusBadge>
        )}
      </div>

      {refund.data && (
        <div className="mt-3 space-y-1 text-sm text-ink-soft">
          <div>
            Montan mande: <b className="text-ink">{formatHTG(Number(refund.data.amount))}</b>
          </div>
          <div>Rezon: {refund.data.reason}</div>
          {refund.data.admin_notes && (
            <div className="rounded-lg bg-cream p-2 text-xs">
              Nòt administratè: {refund.data.admin_notes}
            </div>
          )}
        </div>
      )}

      {canRequest && (
        <div className="mt-4 space-y-3">
          {refund.data?.status === "rejected" && (
            <p className="text-xs text-ink-soft">
              Demann anvan ou an te rejte. Ou ka fè yon nouvo demann si gen yon lòt pwoblèm.
            </p>
          )}
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Eksplike poukisa ou mande yon ranbousman…"
            aria-label="Eksplike poukisa ou mande yon ranbousman…"
            rows={3}
            className={inputClsCompact()}
          />
          <Button
            disabled={request.isPending || reason.trim().length < 5}
            onClick={() => request.mutate()}
          >
            {request.isPending ? "Ap voye…" : "Mande yon ranbousman"}
          </Button>
        </div>
      )}
    </div>
  );
}
