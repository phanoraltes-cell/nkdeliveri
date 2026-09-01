import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { assertValidUploadFile } from "@/lib/file-validation";
import { formatHTG } from "@/lib/format";
import { ProofThumb } from "@/components/proof-thumb";
import { inputClsCompact } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type PaymentProofSectionProps = {
  orderId: string;
  paymentId: string;
  total: number;
  payLabel: string;
  payRoutingNote: string;
  needsProof: boolean;
  reviewNotes: string | null | undefined;
};

/** Order-detail page's manual-payment card: instructions, proof upload form, and previously submitted proofs. */
export function PaymentProofSection({
  orderId,
  paymentId,
  total,
  payLabel,
  payRoutingNote,
  needsProof,
  reviewNotes,
}: PaymentProofSectionProps) {
  const qc = useQueryClient();
  const [txRef, setTxRef] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const proofs = useQuery({
    queryKey: ["proofs", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_proofs")
        .select("id, file_url, transaction_ref, sender_phone, notes, created_at")
        .eq("payment_id", paymentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const uploadProof = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Chwazi yon foto prèv peman");
      assertValidUploadFile(file, "payment-proofs");
      const path = `${orderId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("payment-proofs")
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      // The generator types these args as non-nullable `string` because the
      // SQL params lack a `DEFAULT NULL` marker it recognizes — Postgres
      // accepts NULL for a plain `text` param regardless, so this cast just
      // corrects an overly-strict generated type, no behavior change.
      const { error: rpcErr } = await supabase.rpc("submit_payment_proof_secure", {
        _payment_id: paymentId,
        _file_url: path,
        _transaction_ref: (txRef || null) as string,
        _sender_phone: (senderPhone || null) as string,
        _notes: (notes || null) as string,
      });
      if (rpcErr) throw rpcErr;
    },
    onSuccess: () => {
      toast.success("Prèv peman voye. Yon administratè ap verifye li.");
      setFile(null);
      setTxRef("");
      setSenderPhone("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["order", orderId] });
      qc.invalidateQueries({ queryKey: ["proofs", orderId] });
    },
    onError: (e) => toast.error(e.message),
  });
  // F-04 (docs/FRONTEND_GLOBAL_AUDIT.md §25) — upload/RPC failures used to
  // be toast-only (see onError above, kept unchanged) — also surfaced
  // inline here so it doesn't depend on catching a timed toast.
  const formError = uploadProof.isError
    ? uploadProof.error instanceof Error
      ? uploadProof.error.message
      : null
    : null;

  function submitProof(e: React.FormEvent) {
    e.preventDefault();
    // useMutation already tracks pending/error state (uploadProof.isPending,
    // onError above) — calling .mutate() instead of awaiting .mutateAsync()
    // here avoids leaving an unhandled promise rejection on failure.
    uploadProof.mutate();
  }

  return (
    <div
      id="payment-proof"
      className={
        needsProof
          ? "scroll-mt-20 rounded-2xl border-2 border-amber-400 bg-white p-5 shadow-[0_0_0_4px_rgba(251,191,36,0.15)]"
          : "scroll-mt-20 rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40"
      }
    >
      <div className="flex items-center gap-2 font-display text-base font-bold">
        {needsProof && (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        )}
        {needsProof ? "Voye prèv peman ou a" : "Enstriksyon peman"}
      </div>
      <div className="mt-2 rounded-xl bg-brand-soft/60 p-3 text-sm">
        Voye <b>{formatHTG(total)}</b> sou <b>{payLabel}</b>, epi telechaje kaptè/foto prèv la anba
        a. <span className="block text-xs text-ink-soft mt-1">{payRoutingNote}</span>
      </div>

      {needsProof ? (
        <form onSubmit={submitProof} className="mt-4 space-y-3">
          {formError && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
            >
              {formError}
            </p>
          )}
          <div>
            <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">
              Prèv (foto/kaptè)
            </label>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              aria-label="Prèv (foto/kaptè)"
              aria-invalid={!!formError}
              className={inputClsCompact()}
              required
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              value={txRef}
              onChange={(e) => setTxRef(e.target.value)}
              placeholder="Nimewo transaksyon"
              aria-label="Nimewo transaksyon"
              className={inputClsCompact()}
            />
            <input
              value={senderPhone}
              onChange={(e) => setSenderPhone(e.target.value)}
              placeholder="Nimewo ki voye lajan an"
              aria-label="Nimewo ki voye lajan an"
              className={inputClsCompact()}
            />
          </div>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Nòt (opsyonèl)"
            aria-label="Nòt (opsyonèl)"
            className={inputClsCompact()}
          />
          <Button type="submit" disabled={uploadProof.isPending || !file}>
            <Upload className="h-4 w-4" /> {uploadProof.isPending ? "Ap voye…" : "Voye prèv la"}
          </Button>
        </form>
      ) : (
        <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          Prèv peman resevwa. Yon administratè ap verifye li.
        </div>
      )}

      {proofs.data && proofs.data.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-bold uppercase text-ink-soft">Prèv voye</div>
          <ul className="space-y-2 text-sm">
            {proofs.data.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg bg-cream px-3 py-2">
                <ProofThumb path={p.file_url} />
                <div>
                  {p.transaction_ref && (
                    <div>
                      Tx: <b>{p.transaction_ref}</b>
                    </div>
                  )}
                  {p.sender_phone && (
                    <div>
                      Soti: <b>{p.sender_phone}</b>
                    </div>
                  )}
                  <div className="text-xs text-ink-soft">
                    {new Date(p.created_at).toLocaleString("fr-HT")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reviewNotes && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <b>Nòt administratè:</b> {reviewNotes}
        </div>
      )}
    </div>
  );
}
