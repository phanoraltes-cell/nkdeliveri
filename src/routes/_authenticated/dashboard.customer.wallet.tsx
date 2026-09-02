import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Wallet, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createPollController } from "@/hooks/useCollectPaymentPoll";
import { pollWalletTopup } from "@/lib/poll-wallet-topup.functions";
import { formatHTG } from "@/lib/format";
import { inputCls } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePaymentProviderAvailability } from "@/hooks/usePaymentProviderAvailability";
import { isProviderEnabled, getProviderSetting } from "@/lib/payment-provider-availability";
import { initiateWalletTopup } from "@/lib/initiate-wallet-topup.functions";

// Role guard lives on the parent layout (dashboard.customer.tsx), same
// convention as every other customer route.
export const Route = createFileRoute("/_authenticated/dashboard/customer/wallet")({
  component: CustomerWallet,
});

const TOPUP_METHODS = [
  { id: "moncash_auto" as const, label: "MonCash", logo: "/moncash-logo-hero.png" },
  { id: "natcash_auto" as const, label: "NatCash", logo: "/natcash-logo-new.png" },
];

function CustomerWallet() {
  const [showTopup, setShowTopup] = useState(false);
  const qc = useQueryClient();

  const wallet = useQuery({
    queryKey: ["my-customer-wallet-page"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_customer_wallet_secure");
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
  });

  // Konfimasyon IMEDYA lè kliyan an tounen soti nan PLOP. Anvan sa,
  // rechaj wallet pa t gen okenn poll — sèl chemen an se te cron
  // jounalye a, ki vle di jiska 24è anvan yon kliyan wè lajan l (epi,
  // pi grav, ekspirasyon an te ka antere l anvan — wè migrasyon
  // 20260902000000). Nou chèche pwòp entansyon ki an atant moun nan
  // (RLS-scoped), epi nou poll li ak MENM machin pas la ak peman
  // kòmand yo (createPollController).
  const pendingTopup = useQuery({
    queryKey: ["my-pending-wallet-topup"],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_intents")
        .select("external_reference, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const pollTopup = useServerFn(pollWalletTopup);
  const pollRef = useRef(pollTopup);
  pollRef.current = pollTopup;
  const qcRef = useRef(qc);
  qcRef.current = qc;

  const reference = pendingTopup.data?.external_reference;
  const createdAt = pendingTopup.data?.created_at;

  useEffect(() => {
    if (!reference || !createdAt) return;

    const controller = createPollController({
      externalReference: reference,
      createdAt,
      poll: async (args) => {
        const result = await pollRef.current(args);
        if (result.status === "succeeded") {
          toast.success("Rechaj ou a konfime — lajan an nan wallet ou.");
        } else if (result.status === "failed" || result.status === "expired") {
          toast.error("Rechaj ou a pa t abouti. Si yo debite w, kontakte sipò ak referans lan.");
        }
        return result;
      },
      onSettled: () => {
        qcRef.current.invalidateQueries({ queryKey: ["my-customer-wallet-page"] });
        qcRef.current.invalidateQueries({ queryKey: ["my-customer-wallet-history"] });
        qcRef.current.invalidateQueries({ queryKey: ["my-pending-wallet-topup"] });
      },
    });
    controller.start();
    return () => controller.stop();
  }, [reference, createdAt]);

  const [history, setHistoryRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const historyQuery = useQuery({
    queryKey: ["my-customer-wallet-history", history.from, history.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_customer_wallet_history_secure", {
        _limit: 100,
        _from: history.from ? new Date(history.from).toISOString() : undefined,
        _to: history.to ? new Date(history.to + "T23:59:59").toISOString() : undefined,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 font-display text-3xl font-extrabold text-ink">
          <Wallet className="h-7 w-7 text-brand-deep" aria-hidden="true" /> Wallet mwen
        </h1>
        <p className="mt-1 text-ink-soft">
          Ajoute lajan otomatikman ak MonCash/NatCash, epi peye kòmand ou yo dirèkteman ak li.
        </p>
      </div>

      <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 shadow-brand-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase text-ink-soft">Balans disponib</div>
            <div className="font-display text-4xl font-extrabold text-ink">
              {wallet.isLoading ? "…" : formatHTG(wallet.data?.available_balance ?? 0)}
            </div>
          </div>
          <Button onClick={() => setShowTopup(true)}>
            <Plus className="h-4 w-4" /> Ajoute lajan
          </Button>
        </div>
      </div>

      {reference && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <b>Yon rechaj ap konfime…</b> Si w fenk peye sou MonCash/NatCash, rete sou paj sa a kèk
          segonn — balans ou ap mete ajou otomatikman. Referans:{" "}
          <code className="text-xs">{reference.slice(0, 8)}</code>
        </div>
      )}

      {showTopup && <TopupForm onClose={() => setShowTopup(false)} />}

      <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 shadow-brand-xs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-ink">Istorik</h2>
          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              aria-label="Depi"
              className={inputCls() + " w-auto"}
              value={history.from}
              onChange={(e) => setHistoryRange((r) => ({ ...r, from: e.target.value }))}
            />
            <span className="text-ink-soft">→</span>
            <input
              type="date"
              aria-label="Jiska"
              className={inputCls() + " w-auto"}
              value={history.to}
              onChange={(e) => setHistoryRange((r) => ({ ...r, to: e.target.value }))}
            />
          </div>
        </div>
        {historyQuery.isLoading ? (
          <p className="text-sm text-ink-soft">Chajman…</p>
        ) : !historyQuery.data?.length ? (
          <p className="text-sm text-ink-soft">Pa gen okenn mouvman pou kounye a.</p>
        ) : (
          <ul className="divide-y divide-brand-soft/40">
            {historyQuery.data.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <div className="font-semibold text-ink">{HISTORY_LABEL[h.type] ?? h.type}</div>
                  {h.note && <div className="text-xs text-ink-soft">{h.note}</div>}
                  <div className="text-xs text-ink-soft">
                    {new Date(h.created_at).toLocaleString("fr-HT")}
                  </div>
                </div>
                <div
                  className={`shrink-0 font-display text-base font-bold ${h.available_delta >= 0 ? "text-emerald-700" : "text-ink"}`}
                >
                  {h.available_delta >= 0 ? "+" : ""}
                  {formatHTG(h.available_delta)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  topup_credit: "Rechaj",
  order_payment_debit: "Peman kòmand",
  order_refund_credit: "Ranbousman kòmand",
  wallet_adjustment: "Ajisteman admin",
};

function TopupForm({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"moncash_auto" | "natcash_auto">("moncash_auto");
  const [submitting, setSubmitting] = useState(false);
  const providerAvailability = usePaymentProviderAvailability();
  const initiateTopup = useServerFn(initiateWalletTopup);

  async function submit() {
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount < 20) {
      toast.error("Antre yon montan valid (omwen 20 HTG)");
      return;
    }
    setSubmitting(true);
    try {
      const result = await initiateTopup({
        data: {
          amount: numericAmount,
          paymentMethod: method === "natcash_auto" ? "natcash" : "moncash",
        },
      });
      if (result.outcome === "failed") {
        toast.error(result.error || "Rechaj la pa t reyisi kòmanse.");
        return;
      }
      if (result.outcome === "already_confirmed") {
        toast.success("Rechaj la konfime imedyatman!");
        onClose();
        return;
      }
      if (result.outcome === "pending_confirmation") {
        // PLOP konfime men kredi a poko pase — nou pa janm di "reyisi"
        // pandan balans lan poko bouje (wè initiate-wallet-topup.logic.ts).
        toast.info("Peman ou resevwa — n ap fini konfime l, balans ou ap mete ajou talè.");
        onClose();
        return;
      }
      window.location.href = result.redirectUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erè pandan rechaj la");
    } finally {
      setSubmitting(false);
    }
  }

  const settings = providerAvailability.data ?? [];

  return (
    <div className="rounded-2xl border-2 border-brand-soft bg-brand-soft/10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display font-bold">Ajoute lajan nan wallet ou</h3>
        <button onClick={onClose} aria-label="Fèmen" className="text-ink-soft hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3">
        <input
          type="number"
          min={20}
          placeholder="Montan (HTG, minimòm 20)"
          aria-label="Montan"
          className={inputCls()}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {TOPUP_METHODS.map((m) => {
            const isDisabled = !isProviderEnabled(settings, m.id);
            const maintenanceMessage = getProviderSetting(settings, m.id)?.maintenanceMessage;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMethod(m.id)}
                disabled={isDisabled}
                className={`flex items-center gap-2.5 rounded-2xl border-2 p-3 text-left text-sm font-bold transition ${
                  isDisabled
                    ? "cursor-not-allowed border-brand-soft/60 bg-cream opacity-60"
                    : method === m.id
                      ? "border-brand bg-brand-soft shadow-brand-xs"
                      : "border-brand-soft bg-white hover:border-brand"
                }`}
              >
                <img
                  src={m.logo}
                  alt=""
                  width={32}
                  height={22}
                  className="h-[22px] w-8 shrink-0 rounded border border-brand-soft/60 bg-white object-contain p-0.5"
                />
                <span>
                  {m.label}
                  {isDisabled && (
                    <small className="mt-0.5 block text-xs font-normal text-ink-soft">
                      {maintenanceMessage || "Pa disponib kounye a"}
                    </small>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <Button disabled={submitting} isLoading={submitting} onClick={submit} className="w-full">
          Rechaje
        </Button>
      </div>
    </div>
  );
}
