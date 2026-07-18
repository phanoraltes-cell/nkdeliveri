import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DisputeThread } from "@/components/disputes/dispute-thread";
import { sendDisputeUpdatePush } from "@/lib/send-dispute-push.functions";
import { inputClsCompact } from "@/lib/utils";

const CATEGORIES = ["Manje ki manke", "Kalite manje", "Livrezon an reta", "Konpòtman livrè", "Lòt"];

const NOT_YET_ELIGIBLE_STATUSES = new Set(["pending", "confirmed", "preparing"]);

type DisputeSectionProps = {
  orderId: string;
  orderStatus: string;
};

/** Order-detail page's dispute card: report form when none exists, or the live thread otherwise. */
export function DisputeSection({ orderId, orderStatus }: DisputeSectionProps) {
  const qc = useQueryClient();
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");

  const dispute = useQuery({
    queryKey: ["dispute", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disputes")
        .select("id, category, status, resolution, created_at")
        .eq("order_id", orderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const sendPush = useServerFn(sendDisputeUpdatePush);

  const open = useMutation({
    mutationFn: async () => {
      if (description.trim().length < 5) throw new Error("Tanpri eksplike pwoblèm nan pi plis");
      const { data: row, error } = await supabase.rpc("open_dispute_secure", {
        _order_id: orderId,
        _category: category,
        _description: description.trim(),
      });
      if (error) throw error;
      try {
        await sendPush({ data: { disputeId: row.id } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: () => {
      toast.success("Pwoblèm siyale. Restoran an ap kontakte.");
      setDescription("");
      qc.invalidateQueries({ queryKey: ["dispute", orderId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const eligible = !NOT_YET_ELIGIBLE_STATUSES.has(orderStatus);
  const canReport = eligible && (!dispute.data || dispute.data.status === "resolved");

  if (!eligible && !dispute.data) return null;

  return (
    <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
      <div className="flex items-center gap-2 font-display text-base font-bold">
        <AlertTriangle className="h-4 w-4 text-brand-deep" /> Yon pwoblèm ak kòmand la?
      </div>

      {dispute.data && (
        <>
          <div className="mt-2 text-sm text-ink-soft">
            Kategori: <b className="text-ink">{dispute.data.category}</b>
          </div>
          <DisputeThread
            disputeId={dispute.data.id}
            status={dispute.data.status}
            resolution={dispute.data.resolution}
          />
        </>
      )}

      {canReport && (
        <div className="mt-4 space-y-3">
          {dispute.data?.status === "resolved" && (
            <p className="text-xs text-ink-soft">
              Litij anvan ou an rezoud. Ou ka siyale yon nouvo pwoblèm si genyen.
            </p>
          )}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClsCompact()}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Eksplike pwoblèm nan…"
            rows={3}
            className={inputClsCompact()}
          />
          <button
            disabled={open.isPending || description.trim().length < 5}
            onClick={() => open.mutate()}
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white shadow-brand-sm transition hover:-translate-y-0.5 hover:bg-brand-deep hover:shadow-brand-md disabled:pointer-events-none disabled:opacity-60"
          >
            {open.isPending ? "Ap voye…" : "Siyale pwoblèm nan"}
          </button>
        </div>
      )}
    </div>
  );
}
