import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
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
  /** PLOP konfime imedyatman men kredi a echwe — poll la/cron an ap reprann li. Jamè prezante kòm yon siksè. */
  | { outcome: "pending_confirmation"; intent: PaymentIntentRow }
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
    // BUG KORIJE (ensidan 50 HTG, wè migrasyon 20260902000000): anvan,
    // nou t ap retounen "already_confirmed" — epi UI a t ap di kliyan an
    // "Rechaj la konfime imedyatman!" — pandan entansyon an te fèk
    // anrejistre kòm 'pending' e OKENN kredi pa t janm fèt. Nou te bay
    // yon manti bay kliyan an sou pwòp lajan l. Kounye a nou kredite
    // pou vre anvan nou di li konfime; si kredi a echwe, nou di se
    // "pending" (poll la ap reprann li), jamè yon fo siksè.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: completeError } = await supabaseAdmin.rpc("complete_wallet_topup_secure", {
      _external_reference: reference,
      _decision: "succeeded",
      _provider_transaction_id: result.providerReference,
      _raw_payload: (result.raw ?? null) as Json,
    });
    if (completeError) {
      console.error(
        `[wallet-topup] PLOP confirmed ${reference} immediately but the credit RPC failed: ${completeError.message}`,
      );
      return { outcome: "pending_confirmation", intent };
    }
    return { outcome: "already_confirmed", intent };
  }

  const raw = result.raw as { redirectUrl?: string } | undefined;
  if (!raw?.redirectUrl) {
    return { outcome: "failed", error: `${providerLabel} pa retounen yon lyen peman` };
  }

  return { outcome: "pending", redirectUrl: raw.redirectUrl, intent };
}
