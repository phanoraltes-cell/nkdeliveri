import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { inputClsCompact } from "@/lib/utils";
import { formatHTG } from "@/lib/format";
import { assertValidUploadFile } from "@/lib/file-validation";
import { sendPayoutUpdatePush } from "@/lib/send-payout-push.functions";
import { initiateProviderPayout } from "@/lib/initiate-provider-payout.functions";
import { useReauth } from "@/hooks/useReauth";
import { ReauthDialog } from "@/components/reauth-dialog";

export type PayoutBeneficiary = {
  type: "restaurant" | "driver";
  id: string;
  name: string;
  availableBalance: number;
  moncashNumber: string | null;
  natcashNumber: string | null;
};

type PayoutPayModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beneficiary: PayoutBeneficiary | null;
  /** Query key(s) to invalidate after a successful payout (the admin wallet list). */
  invalidateKeys: readonly (readonly unknown[])[];
};

/**
 * First genuine form modal in this app (the only existing Dialog usage,
 * useConfirmDialog, is a plain yes/no confirm, not a form) — built directly
 * from the Dialog primitives, mirroring useConfirmDialog's controlled-open
 * shape and DialogFooter's outline-Cancel + colored-action-button pattern.
 * Money has already left the admin's phone by the time this form is
 * submitted — the reference/proof are evidence of a transfer that already
 * happened, collected in the same action that creates the payout record
 * (mirrors payment-proof-section.tsx's own upload-then-RPC shape).
 */
export function PayoutPayModal({
  open,
  onOpenChange,
  beneficiary,
  invalidateKeys,
}: PayoutPayModalProps) {
  const qc = useQueryClient();
  const sendPush = useServerFn(sendPayoutUpdatePush);
  const initiateProvider = useServerFn(initiateProviderPayout);
  const { withReauth, dialogState } = useReauth();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"moncash" | "natcash" | "">("");
  const [providerCode, setProviderCode] = useState("manual");
  const [transactionReference, setTransactionReference] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // Phase 3 of the admin evolution plan: which method (moncash/natcash) is
  // already selectable; this is the separate "who executes it" axis —
  // 100% manual today, ready for a real API provider without touching
  // the manual flow. moncash_api/natcash_api stay is_active=false until a
  // real integration exists (src/lib/payment-providers/).
  const providers = useQuery({
    queryKey: ["payment-providers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_providers")
        .select("code, label, is_active")
        .order("code");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!beneficiary) return;
    setAmount(String(beneficiary.availableBalance));
    setMethod(beneficiary.moncashNumber ? "moncash" : beneficiary.natcashNumber ? "natcash" : "");
    setProviderCode("manual");
    setTransactionReference("");
    setNotes("");
    setFile(null);
  }, [beneficiary]);

  const isManual = providerCode === "manual";

  const pay = useMutation({
    mutationFn: async () => {
      if (!beneficiary) throw new Error("Pa gen benefisyè");
      const numAmount = Number(amount);
      if (!numAmount || numAmount <= 0) throw new Error("Montan envalid");
      if (numAmount > beneficiary.availableBalance) throw new Error("Balans disponib la pa ase");
      if (!method) throw new Error("Chwazi yon metòd peman");

      // Non-manual providers execute the transfer themselves and return
      // their own transaction reference — never through this component
      // directly (see payment-providers/types.ts), always through the one
      // server function allowed to call getPaymentProvider().
      if (!isManual) {
        const result = await initiateProvider({
          data: {
            restaurantId: beneficiary.type === "restaurant" ? beneficiary.id : undefined,
            driverId: beneficiary.type === "driver" ? beneficiary.id : undefined,
            amount: numAmount,
            method,
            providerCode: providerCode as "moncash_api" | "natcash_api",
            notes: notes.trim() || undefined,
          },
        });
        if (result.outcome === "failed") throw new Error(result.error);
        // "pending": a real payout row now exists (status='pending') --
        // not an error, but not done either. The webhook
        // (moncash-webhook-handler.server.ts) or a later reconciliation
        // finalizes it; nothing here sends a "paid" push since nothing
        // is actually paid yet.
        return { payout: result.payout, outcome: result.outcome };
      }

      if (!transactionReference.trim()) throw new Error("Referans tranzaksyon obligatwa");

      let proofUrl: string | undefined;
      if (file) {
        assertValidUploadFile(file, "payout-proofs");
        const path = `${beneficiary.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("payout-proofs").upload(path, file, {
          upsert: false,
        });
        if (upErr) throw upErr;
        proofUrl = path;
      }

      const { data, error } = await supabase.rpc("initiate_payout_secure", {
        _restaurant_id: beneficiary.type === "restaurant" ? beneficiary.id : undefined,
        _driver_id: beneficiary.type === "driver" ? beneficiary.id : undefined,
        _amount: numAmount,
        _method: method,
        _transaction_reference: transactionReference.trim(),
        _proof_url: proofUrl,
        _notes: notes.trim() || undefined,
        _provider_code: providerCode,
      });
      if (error) throw error;
      return { payout: data, outcome: "success" as const };
    },
    onSuccess: ({ payout, outcome }) => {
      if (outcome === "pending") {
        toast.success("Demann peman voye bay pwovidè a. N ap konfime lè li reponn.");
      } else {
        toast.success("Peman voye. Benefisyè a resevwa yon notifikasyon.");
      }
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
      if (outcome === "success" && payout?.id) {
        sendPush({ data: { payoutId: payout.id, event: "paid" } }).catch((e) =>
          console.warn("[push] payout paid notify failed", e),
        );
      }
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  const availableMethods: { value: "moncash" | "natcash"; label: string }[] = beneficiary
    ? [
        ...(beneficiary.moncashNumber ? [{ value: "moncash" as const, label: "MonCash" }] : []),
        ...(beneficiary.natcashNumber ? [{ value: "natcash" as const, label: "NatCash" }] : []),
      ]
    : [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voye yon peman</DialogTitle>
            <DialogDescription>
              {beneficiary?.name} — Balans disponib: {formatHTG(beneficiary?.availableBalance ?? 0)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Montan pou peye
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={beneficiary?.availableBalance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inputClsCompact()}
              />
            </label>

            {beneficiary && (
              <div className="text-xs text-ink-soft">
                Balans ki ap rete apre peman:{" "}
                <b className="text-ink">
                  {formatHTG(Math.max(0, beneficiary.availableBalance - (Number(amount) || 0)))}
                </b>
              </div>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Metòd peman
              </span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as "moncash" | "natcash")}
                className={inputClsCompact()}
              >
                <option value="" disabled>
                  Chwazi yon metòd
                </option>
                {availableMethods.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              {availableMethods.length === 0 && (
                <span className="mt-1 block text-xs text-red-600">
                  Benefisyè a poko konfigire okenn nimewo peman.
                </span>
              )}
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Ki jan peman an egzekite
              </span>
              <select
                value={providerCode}
                onChange={(e) => setProviderCode(e.target.value)}
                className={inputClsCompact()}
              >
                {(providers.data ?? []).map((p) => (
                  <option key={p.code} value={p.code} disabled={!p.is_active}>
                    {p.label}
                    {!p.is_active ? " (byento)" : ""}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-soft">
                Manyèl = ou voye lajan an ou menm nan telefòn ou, tankou jodi a.
              </span>
            </label>

            {isManual ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                    Referans tranzaksyon
                  </span>
                  <input
                    value={transactionReference}
                    onChange={(e) => setTransactionReference(e.target.value)}
                    placeholder="Nimewo tranzaksyon MonCash/NatCash"
                    className={inputClsCompact()}
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                    Prèv peman (opsyonèl)
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className={inputClsCompact()}
                  />
                </label>
              </>
            ) : (
              <p className="text-xs text-ink-soft">
                Peman an ap egzekite otomatikman pa pwovidè a — pa gen referans oswa prèv pou antre
                manyèlman.
              </p>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Nòt (opsyonèl)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className={inputClsCompact()}
              />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Anile
            </Button>
            <Button
              disabled={
                pay.isPending || !method || !amount || (isManual && !transactionReference.trim())
              }
              onClick={() => withReauth(() => pay.mutate())}
            >
              {pay.isPending ? "Ap voye…" : "Konfime peman"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ReauthDialog state={dialogState} />
    </>
  );
}
