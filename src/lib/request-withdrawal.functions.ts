import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RequestWithdrawalInputSchema, runRequestWithdrawal } from "@/lib/request-withdrawal.logic";

/**
 * Server-function wrapper for a restaurant/driver's self-service
 * withdrawal request (Tach 3B). The actual logic lives in
 * request-withdrawal.logic.ts — this file only wires it to
 * createServerFn, mirroring poll-collect-payment.functions.ts's own
 * split.
 */
export const requestWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => RequestWithdrawalInputSchema.parse(data))
  .handler(async ({ data, context }) => runRequestWithdrawal(context.supabase, data));
