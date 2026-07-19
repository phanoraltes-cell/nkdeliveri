import { CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { ProofThumb } from "@/components/proof-thumb";

export async function fetchPendingPayments() {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, method, status, amount, currency, created_at, transaction_ref, sender_phone, order_id, orders(order_number, total, customer_id, restaurants(name)), payment_proofs(id, file_url, transaction_ref, sender_phone, notes, created_at)",
    )
    .in("method", ["moncash", "natcash"])
    .in("status", ["awaiting_proof", "under_review"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export type PendingPayment = NonNullable<Awaited<ReturnType<typeof fetchPendingPayments>>>[number];

type PendingPaymentsSectionProps = {
  payments: PendingPayment[] | undefined;
  isLoading: boolean;
  notes: Record<string, string>;
  onNoteChange: (id: string, value: string) => void;
  onDecide: (id: string, decision: "paid" | "failed", note?: string) => void;
  isDeciding: boolean;
};

/** Admin dashboard's manual MonCash/NatCash payment review queue, with proof previews and an approve/reject action pair. */
export function PendingPaymentsSection({
  payments,
  isLoading,
  notes,
  onNoteChange,
  onDecide,
  isDeciding,
}: PendingPaymentsSectionProps) {
  return (
    <>
      {isLoading && <div className="text-ink-soft">Chajman…</div>}
      {payments?.length === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen peman manyèl an atant.
        </div>
      )}

      <div className="space-y-4">
        {payments?.map((p) => (
          <div
            key={p.id}
            className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-lg font-extrabold">
                  {p.orders?.order_number}
                  <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-brand-deep">
                    {p.method}
                  </span>
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                    {p.status}
                  </span>
                </div>
                <div className="text-xs text-ink-soft">
                  {p.orders?.restaurants?.name} · {new Date(p.created_at).toLocaleString("fr-HT")}
                </div>
              </div>
              <div className="text-right font-display text-xl font-extrabold text-brand-deep">
                {formatHTG(Number(p.amount))}
              </div>
            </div>

            {p.transaction_ref && (
              <div className="mt-2 text-sm">
                Tx: <b>{p.transaction_ref}</b>
              </div>
            )}
            {p.sender_phone && (
              <div className="text-sm">
                Soti nan: <b>{p.sender_phone}</b>
              </div>
            )}

            {p.payment_proofs?.length > 0 ? (
              <div className="mt-3">
                <div className="mb-2 text-xs font-bold uppercase text-ink-soft">Prèv peman</div>
                <div className="flex flex-wrap gap-3">
                  {p.payment_proofs.map((pr) => (
                    <div key={pr.id} className="space-y-1">
                      <ProofThumb path={pr.file_url} />
                      {(pr.transaction_ref || pr.sender_phone) && (
                        <div className="max-w-[96px] text-[10px] leading-tight text-ink-soft">
                          {pr.transaction_ref && (
                            <div>
                              Tx: <b>{pr.transaction_ref}</b>
                            </div>
                          )}
                          {pr.sender_phone && <div>{pr.sender_phone}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Poko gen prèv voye.
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={notes[p.id] || ""}
                onChange={(e) => onNoteChange(p.id, e.target.value)}
                placeholder="Nòt (opsyonèl)"
                className="min-w-0 flex-1 rounded-full border-2 border-brand-soft bg-white px-3 py-2.5 text-sm"
              />
              <button
                disabled={!p.payment_proofs?.length || isDeciding}
                onClick={() => onDecide(p.id, "paid", notes[p.id])}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Apwouve
              </button>
              <button
                disabled={isDeciding}
                onClick={() => onDecide(p.id, "failed", notes[p.id])}
                className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-red-700"
              >
                <XCircle className="h-3.5 w-3.5" /> Rejte
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
