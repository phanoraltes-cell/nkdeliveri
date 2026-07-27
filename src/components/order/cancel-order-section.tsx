import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";
import { CUSTOMER_CANCELLABLE_STATUSES } from "@/lib/order-status";

type CancelOrderSectionProps = {
  orderId: string;
  orderStatus: string;
};

/**
 * Order-detail page's cancel button — only while the restaurant hasn't
 * started preparing (private.update_order_status_secure enforces the
 * same pending/confirmed window server-side, this is just the UI gate).
 * If the order was already paid (moncash/natcash), RefundSection right
 * below this one becomes reachable automatically once the order query
 * refetches to status='cancelled' — no separate refund flow needed here.
 */
export function CancelOrderSection({ orderId, orderStatus }: CancelOrderSectionProps) {
  const qc = useQueryClient();
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  const [pending, setPending] = useState(false);

  const cancel = useMutation({
    mutationFn: async () => {
      setPending(true);
      const { error } = await supabase.rpc("update_order_status_secure", {
        _order_id: orderId,
        _new_status: "cancelled",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Kòmand anile");
      qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => setPending(false),
  });

  if (!CUSTOMER_CANCELLABLE_STATUSES.has(orderStatus)) return null;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-display text-base font-bold">
            <XCircle className="h-4 w-4 text-red-600" /> Anile kòmand
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            Ou ka anile toujou paske restoran an poko kòmanse prepare kòmand la.
          </p>
        </div>
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() => requestConfirm("Anile kòmand sa a?", () => cancel.mutate())}
        >
          {pending ? "Ap anile…" : "Anile kòmand"}
        </Button>
      </div>
      {ConfirmDialog}
    </div>
  );
}
