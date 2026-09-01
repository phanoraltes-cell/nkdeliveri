import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { absoluteUrl } from "@/lib/site-config";

export const InitiateWalletTopupInputSchema = z.object({
  amount: z.number().min(20).max(100000),
  paymentMethod: z.enum(["moncash", "natcash"]),
});
export type InitiateWalletTopupInput = z.infer<typeof InitiateWalletTopupInputSchema>;

type PaymentIntentRow = Database["public"]["Tables"]["payment_intents"]["Row"];

/**
 * Rechaj wallet kliyan — menm apwòch egzat ak
 * runInitiateCollectPayment (initiate-collect-payment.logic.ts), sèl
 * diferans: pa gen okenn `payment_id`/`order_id` deja egziste, wallet la
 * rechaje endepandan de yon kòmand. Rele APRE plopProvider.initiatePayment()
 * deja rele, jamè avan — chak apèl (echwe oswa pandan) anrejistre nan
 * payment_intents atravè create_wallet_topup_secure.
 *
 * Sèl PLOP itilize isit la (pa Stripe) — rechaj wallet se yon mekanis
 * MonCash/NatCash sèlman, jan spesifikasyon Tach 1B mande ("rechaj MonCash/
 * NatCash — otomatik sèlman"). Reyitilize payment_provider_settings
 * (moncash_auto/natcash_auto) — menm rezon: se menm kont/kle PLOP la, dezaktive
 * yon rèl pou checkout ta dwe dezaktive l pou rechaj wallet tou.
 */
export async function runInitiateWalletTopup(
  supabase: SupabaseClient<Database>,
  data: InitiateWalletTopupInput,
): Promise<
  | { outcome: "failed"; error: string }
  | { outcome: "pending"; redirectUrl: string; intent: PaymentIntentRow }
  | { outcome: "already_confirmed"; intent: PaymentIntentRow }
> {
  const reference = crypto.randomUUID();
  const providerKey = data.paymentMethod === "natcash" ? "natcash_auto" : "moncash_auto";
  const providerLabel = data.paymentMethod === "natcash" ? "NatCash Otomatik" : "MonCash Otomatik";

  const { fetchPaymentProviderSettings, isProviderEnabled, getProviderSetting } =
    await import("@/lib/payment-provider-availability");
  const settings = await fetchPaymentProviderSettings(supabase);
  if (!isProviderEnabled(settings, providerKey)) {
    const message =
      getProviderSetting(settings, providerKey)?.maintenanceMessage ??
      `${providerLabel} pa disponib pou kounye a.`;
    const { error: logError } = await supabase.rpc("create_wallet_topup_secure", {
      _amount: data.amount,
      _payment_method: data.paymentMethod,
      _external_reference: reference,
      _status: "failed",
      _error: message,
    });
    if (logError)
      console.warn("[wallet-topup] failed to record disabled-provider attempt", logError.message);
    return { outcome: "failed", error: message };
  }

  const { plopProvider } = await import("@/lib/payment-providers/plop-provider.server");
  if (!plopProvider.isConfigured()) {
    const message = "Rechaj otomatik pa konfigire toujou";
    const { error: logError } = await supabase.rpc("create_wallet_topup_secure", {
      _amount: data.amount,
      _payment_method: data.paymentMethod,
      _external_reference: reference,
      _status: "failed",
      _error: message,
    });
    if (logError)
      console.warn("[wallet-topup] failed to record not-configured attempt", logError.message);
    return { outcome: "failed", error: message };
  }

  const result = await plopProvider.initiatePayment({
    direction: "collect",
    amount: data.amount,
    reference,
    paymentMethod: data.paymentMethod,
    returnUrl: absoluteUrl("/dashboard/customer/wallet"),
  });

  if (result.status === "failed") {
    const { error: logError } = await supabase.rpc("create_wallet_topup_secure", {
      _amount: data.amount,
      _payment_method: data.paymentMethod,
      _external_reference: reference,
      _status: "failed",
      _error: result.error,
    });
    if (logError) console.warn("[wallet-topup] failed to record failed attempt", logError.message);
    return { outcome: "failed", error: result.error };
  }

  const { data: intent, error: rpcError } = await supabase.rpc("create_wallet_topup_secure", {
    _amount: data.amount,
    _payment_method: data.paymentMethod,
    _external_reference: reference,
    _status: "pending",
    _provider_transaction_id: result.providerReference,
  });
  if (rpcError) throw new Error(rpcError.message);

  if (result.status === "success") {
    return { outcome: "already_confirmed", intent };
  }

  const raw = result.raw as { redirectUrl?: string } | undefined;
  if (!raw?.redirectUrl) {
    return { outcome: "failed", error: `${providerLabel} pa retounen yon lyen peman` };
  }

  return { outcome: "pending", redirectUrl: raw.redirectUrl, intent };
}
