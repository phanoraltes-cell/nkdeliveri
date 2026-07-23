import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/dashboard/status-badge";
import {
  PAYOUT_RESOLUTION_LABEL,
  PAYOUT_STATUS_LABEL,
  PAYOUT_STATUS_TONE,
} from "@/lib/payout-status";
import { inputClsCompact } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { sendPayoutUpdatePush } from "@/lib/send-payout-push.functions";

type PayoutConfirmSectionProps = {
  payoutId: string;
  status: string;
  /** Only meaningful when status === "resolved" — which way the dispute was arbitrated. */
  resolution?: string | null;
  /** Query key(s) to invalidate after confirm/dispute succeeds — the caller owns its own wallet/history query. */
  invalidateKeys: readonly (readonly unknown[])[];
};

/**
 * Rendered inline per payout row on a beneficiary's own "My Payments" page
 * (not per-order — a payout isn't tied to one order). While status is
 * "paid" (admin just sent it, awaiting the beneficiary's reaction), shows
 * Confirm/Report-a-problem actions; otherwise just the status pill. Follows
 * the same conditional-form-reveal shape as RefundSection.
 */
export function PayoutConfirmSection({
  payoutId,
  status,
  resolution,
  invalidateKeys,
}: PayoutConfirmSectionProps) {
  const qc = useQueryClient();
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("");
  const sendPush = useServerFn(sendPayoutUpdatePush);

  function invalidateAll() {
    for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
  }

  const confirm = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("confirm_payout_secure", { _payout_id: payoutId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Peman konfime. Mèsi!");
      invalidateAll();
      sendPush({ data: { payoutId, event: "confirmed" } }).catch((e) =>
        console.warn("[push] payout confirmed notify failed", e),
      );
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  const dispute = useMutation({
    mutationFn: async () => {
      if (reason.trim().length < 5)
        throw new Error("Tanpri eksplike pwoblèm nan (omwen 5 karaktè)");
      const { error } = await supabase.rpc("dispute_payout_secure", {
        _payout_id: payoutId,
        _reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pwoblèm rapòte. Yon administratè ap kontakte w.");
      setReportOpen(false);
      setReason("");
      invalidateAll();
      sendPush({ data: { payoutId, event: "disputed" } }).catch((e) =>
        console.warn("[push] payout disputed notify failed", e),
      );
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  if (status !== "paid") {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <StatusBadge tone={PAYOUT_STATUS_TONE[status]}>
          {PAYOUT_STATUS_LABEL[status] ?? status}
        </StatusBadge>
        {status === "resolved" && resolution && (
          <span className="text-[10px] text-ink-soft">{PAYOUT_RESOLUTION_LABEL[resolution]}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <StatusBadge tone={PAYOUT_STATUS_TONE[status]}>{PAYOUT_STATUS_LABEL[status]}</StatusBadge>
      {!reportOpen && (
        <div className="flex gap-2">
          <Button size="sm" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
            {confirm.isPending ? "Ap konfime…" : "Konfime resepsyon"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setReportOpen(true)}>
            Rapòte yon pwoblèm
          </Button>
        </div>
      )}
      {reportOpen && (
        <div className="w-full max-w-xs space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Eksplike pwoblèm nan…"
            aria-label="Eksplike pwoblèm nan…"
            rows={2}
            className={inputClsCompact()}
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReportOpen(false);
                setReason("");
              }}
            >
              Anile
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={dispute.isPending || reason.trim().length < 5}
              onClick={() => dispute.mutate()}
            >
              {dispute.isPending ? "Ap voye…" : "Voye rapò a"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
