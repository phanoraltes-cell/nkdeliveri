import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  InitiateWalletTopupInputSchema,
  runInitiateWalletTopup,
} from "@/lib/initiate-wallet-topup.logic";

/**
 * Sèl kote ki gen dwa rele plopProvider.initiatePayment() pou yon rechaj
 * wallet — jamè dirèkteman nan yon paj/kòmponan (menm règ ak
 * initiate-collect-payment.functions.ts). Lojik reyèl la nan
 * initiate-wallet-topup.logic.ts, pou l ka teste san TanStack Start
 * server-function runtime la.
 */
export const initiateWalletTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InitiateWalletTopupInputSchema.parse(data))
  .handler(async ({ data, context }) => runInitiateWalletTopup(context.supabase, data));
