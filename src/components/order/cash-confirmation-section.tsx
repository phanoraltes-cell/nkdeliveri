import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { inputClsCompact } from "@/lib/utils";

type CashConfirmationSectionProps = {
  orderId: string;
  orderStatus: string;
  payment:
    | {
        method: string;
        cash_confirmation_status: string | null;
        customer_confirmed_at: string | null;
      }
    | undefined;
};

/**
 * Phase 4 of the admin evolution plan: cash orders are never validated on
 * one party's word alone. Shown only once the order is delivered and the
 * payment method is 'kach' — the customer confirms ("Mwen peye") or flags
 * a mismatch, which opens a real dispute (dispute_cash_payment_secure,
 * reusing the existing dispute system) rather than silently disagreeing.
 * The commission/wallet credit already happened at delivery time and is
 * never affected by this — this is a reconciliation layer, not a gate.
 */
export function CashConfirmationSection({
  orderId,
  orderStatus,
  payment,
}: CashConfirmationSectionProps) {
  const qc = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const [description, setDescription] = useState("");

  const confirm = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("confirm_cash_payment_secure", { _order_id: orderId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Konfimasyon anrejistre");
      qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const dispute = useMutation({
    mutationFn: async () => {
      if (description.trim().length < 5) throw new Error("Tanpri eksplike pwoblèm nan pi plis");
      const { error } = await supabase.rpc("dispute_cash_payment_secure", {
        _order_id: orderId,
        _description: description.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pwoblèm siyale");
      setReporting(false);
      setDescription("");
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["dispute", orderId] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (!payment || payment.method !== "kach" || orderStatus !== "delivered") return null;
  if (payment.cash_confirmation_status === "disputed") return null; // DisputeSection below shows the thread

  if (payment.cash_confirmation_status === "validated") {
    return (
      <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
        <div className="flex items-center gap-2 font-display text-base font-bold">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Peman kach konfime
        </div>
        <StatusBadge tone="good">Konfime pa toulède</StatusBadge>
      </div>
    );
  }

  const alreadyConfirmed = !!payment.customer_confirmed_at;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
      <div className="font-display text-base font-bold">Konfime peman kach la</div>
      <p className="mt-1 text-sm text-ink-soft">Èske ou peye livrè a kach lè kòmand la rive?</p>

      {alreadyConfirmed ? (
        <p className="mt-3 text-sm text-emerald-700">✓ Ou konfime. Ap tann konfimasyon livrè a.</p>
      ) : reporting ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Eksplike pwoblèm nan…"
            aria-label="Eksplike pwoblèm nan…"
            rows={3}
            className={inputClsCompact()}
          />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setReporting(false)}>
              Anile
            </Button>
            <Button
              variant="destructive"
              disabled={dispute.isPending || description.trim().length < 5}
              onClick={() => dispute.mutate()}
            >
              {dispute.isPending ? "Ap voye…" : "Siyale pwoblèm nan"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={confirm.isPending} onClick={() => confirm.mutate()}>
            {confirm.isPending ? "Ap konfime…" : "✓ Mwen peye"}
          </Button>
          <Button variant="outline" onClick={() => setReporting(true)}>
            Sa a pa kòrèk
          </Button>
        </div>
      )}
    </div>
  );
}
