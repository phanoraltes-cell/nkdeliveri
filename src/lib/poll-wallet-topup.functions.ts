import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PollWalletTopupInputSchema, runPollWalletTopup } from "@/lib/poll-wallet-topup.logic";

/**
 * Server-function wrapper pou poll rechaj wallet la — menm split egzat
 * ak poll-collect-payment.functions.ts (lojik la nan .logic.ts pou l ka
 * teste san runtime createServerFn lan).
 */
export const pollWalletTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => PollWalletTopupInputSchema.parse(data))
  .handler(async ({ data, context }) => runPollWalletTopup(context.supabase, data));
