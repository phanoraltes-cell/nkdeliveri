import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { sendPaymentReviewPush } from "@/lib/send-push.functions";
import { formatHTG } from "@/lib/format";
import { CheckCircle2, XCircle } from "lucide-react";
import { ProofThumb } from "@/components/proof-thumb";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/dashboard/admin/payments")({
  beforeLoad: ({ context }) => {
    const role = (context as any).role;
    if (role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AdminPayments,
});

function AdminPayments() {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const sendPush = useServerFn(sendPaymentReviewPush);

  const list = useQuery({
    queryKey: ["admin-manual-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, method, status, amount, currency, created_at, transaction_ref, sender_phone, order_id, orders(order_number, total, customer_id, restaurants(name)), payment_proofs(id, file_url, transaction_ref, sender_phone, notes, created_at)"
        )
        .in("method", ["moncash", "natcash"])
        .in("status", ["awaiting_proof", "under_review"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: "paid" | "failed"; note?: string }) => {
      const { error } = await supabase
        .from("payments")
        .update({
          status: decision,
          review_notes: note || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      // Fire-and-log web push to customer + merchant
      try {
        await sendPush({ data: { paymentId: id } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: (_d, v) => {
      toast.success(v.decision === "paid" ? "Peman apwouve, kòmand konfime" : "Peman rejte");
      qc.invalidateQueries({ queryKey: ["admin-manual-payments"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Peman manyèl</h1>
          <p className="mt-1 text-ink-soft">Valide prèv MonCash ak NatCash.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      {list.isLoading && <div className="text-ink-soft">Chajman…</div>}
      {list.data?.length === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen peman manyèl an atant.
        </div>
      )}

      <div className="space-y-4">
        {list.data?.map((p: any) => (
          <div key={p.id} className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
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
              <div className="mt-2 text-sm">Tx: <b>{p.transaction_ref}</b></div>
            )}
            {p.sender_phone && (
              <div className="text-sm">Soti nan: <b>{p.sender_phone}</b></div>
            )}

            {p.payment_proofs?.length > 0 ? (
              <div className="mt-3">
                <div className="mb-2 text-xs font-bold uppercase text-ink-soft">Prèv peman</div>
                <div className="flex flex-wrap gap-3">
                  {p.payment_proofs.map((pr: any) => (
                    <div key={pr.id} className="space-y-1">
                      <ProofThumb path={pr.file_url} />
                      {(pr.transaction_ref || pr.sender_phone) && (
                        <div className="max-w-[96px] text-[10px] leading-tight text-ink-soft">
                          {pr.transaction_ref && <div>Tx: <b>{pr.transaction_ref}</b></div>}
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
                onChange={(e) => setNotes((s) => ({ ...s, [p.id]: e.target.value }))}
                placeholder="Nòt (opsyonèl)"
                className="flex-1 rounded-full border-2 border-brand-soft bg-white px-3 py-1.5 text-sm"
              />
              <button
                disabled={!p.payment_proofs?.length || decide.isPending}
                onClick={() => decide.mutate({ id: p.id, decision: "paid", note: notes[p.id] })}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Apwouve
              </button>
              <button
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: p.id, decision: "failed", note: notes[p.id] })}
                className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
              >
                <XCircle className="h-3.5 w-3.5" /> Rejte
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}