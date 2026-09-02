import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { inputClsCompact } from "@/lib/utils";
import { formatHTG } from "@/lib/format";
import { requestWithdrawal } from "@/lib/request-withdrawal.functions";

type WithdrawalRequestSectionProps = {
  beneficiaryType: "restaurant" | "driver";
  beneficiaryId: string | undefined;
  availableBalance: number;
  moncashConfigured: boolean;
  natcashConfigured: boolean;
  /** Query key(s) to invalidate after a successful request (wallet + payout history). */
  invalidateKeys: readonly (readonly unknown[])[];
};

/**
 * Tach 3B — "Mande yon retrè", the self-service counterpart to the admin's
 * own PayoutPayModal. A restaurant owner or driver reserves money out of
 * their OWN available balance on demand, instead of waiting for an admin
 * to notice they're owed money. request-withdrawal.functions.ts handles
 * everything after submit — reservation, then (when PLOP is configured
 * and active) an immediate automatic attempt; otherwise the request just
 * waits, visible below in WalletPayoutHistorySection, for an admin to
 * process manually.
 */
export function WithdrawalRequestSection({
  beneficiaryType,
  beneficiaryId,
  availableBalance,
  moncashConfigured,
  natcashConfigured,
  invalidateKeys,
}: WithdrawalRequestSectionProps) {
  const qc = useQueryClient();
  const requestFn = useServerFn(requestWithdrawal);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"moncash" | "natcash" | "">(
    moncashConfigured ? "moncash" : natcashConfigured ? "natcash" : "",
  );

  const availableMethods = [
    moncashConfigured && ({ value: "moncash", label: "MonCash" } as const),
    natcashConfigured && ({ value: "natcash", label: "NatCash" } as const),
  ].filter(Boolean) as { value: "moncash" | "natcash"; label: string }[];

  // Tach 3D — règ frè/limit aktif la, jis pou APÈSI "montan → frè →
  // nèt" anvan menm soumèt; request_withdrawal_secure refè EGZAKTEMAN
  // menm kalkil la sèvè-side, se sa ki konte reyèlman.
  const rule = useQuery({
    queryKey: ["withdrawal-rule", beneficiaryType],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_active_withdrawal_rule_secure", {
        _role: beneficiaryType,
      });
      if (error) throw error;
      return Array.isArray(data) ? (data[0] ?? null) : data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const numAmount = Number(amount) || 0;
  const feePreview = (() => {
    if (!rule.data || numAmount <= 0) return null;
    const free = rule.data.free_threshold != null && numAmount <= rule.data.free_threshold;
    const fee = free
      ? 0
      : Math.min(
          numAmount,
          Math.round((numAmount * rule.data.fee_percentage) / 100 + rule.data.flat_fee),
        );
    return { fee, net: numAmount - fee };
  })();

  const request = useMutation({
    mutationFn: async () => {
      if (!beneficiaryId) throw new Error("Pwofil pa jwenn");
      const numAmount = Number(amount);
      if (!numAmount || numAmount <= 0) throw new Error("Montan envalid");
      if (numAmount > availableBalance) throw new Error("Balans disponib la pa ase");
      if (!method) throw new Error("Chwazi yon metòd peman");

      return requestFn({
        data: {
          restaurantId: beneficiaryType === "restaurant" ? beneficiaryId : undefined,
          driverId: beneficiaryType === "driver" ? beneficiaryId : undefined,
          amount: numAmount,
          method,
        },
      });
    },
    onSuccess: (result) => {
      if (result.outcome === "success") {
        toast.success("Retrè ou reyisi! Tanpri konfime resepsyon an nan istwa peman anba a.");
      } else if (result.outcome === "pending") {
        toast.success("Demann voye bay pwovidè a. N ap konfime rezilta a talè.");
      } else if (result.outcome === "failed") {
        toast.error(`Tantativ otomatik echwe: ${result.error}. Yon admin ap trete demann ou.`);
      } else {
        toast.success("Demann retrè anrejistre. Yon admin ap trete l talè.");
      }
      setAmount("");
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
      <h2 className="font-display text-lg font-bold text-ink">Mande yon retrè</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Mande retire lajan nan balans disponib ou a — pa gen bezwen tann yon administratè.
      </p>

      {availableMethods.length === 0 ? (
        <p className="mt-3 text-xs text-red-600">
          Konfigire yon nimewo MonCash oswa NatCash anwo a anvan ou mande yon retrè.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
              Montan pou retire
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={availableBalance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="250"
              className={inputClsCompact()}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Metòd</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as "moncash" | "natcash")}
              className={inputClsCompact()}
            >
              {availableMethods.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button
              className="w-full font-display font-extrabold"
              disabled={request.isPending || !amount || !method}
              onClick={() => request.mutate()}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {request.isPending ? "Ap voye…" : "Mande retrè"}
            </Button>
          </div>
        </div>
      )}
      {feePreview && (
        <div className="mt-3 rounded-xl bg-brand-soft/40 p-3 text-xs text-ink-soft">
          Montan mande: <b className="text-ink">{formatHTG(numAmount)}</b> — Frè:{" "}
          <b className="text-ink">{formatHTG(feePreview.fee)}</b> — Ou ap resevwa:{" "}
          <b className="text-brand-deep">{formatHTG(feePreview.net)}</b>
        </div>
      )}
      <p className="mt-3 text-xs text-ink-soft">
        Balans disponib: <b className="text-ink">{formatHTG(availableBalance)}</b>
        {rule.data && (
          <>
            {" "}
            — minimòm retrè: <b className="text-ink">{formatHTG(rule.data.min_amount)}</b>
            {rule.data.max_amount != null && (
              <>
                {" "}
                — maksimòm: <b className="text-ink">{formatHTG(rule.data.max_amount)}</b>
              </>
            )}
          </>
        )}
        .
      </p>
    </section>
  );
}
