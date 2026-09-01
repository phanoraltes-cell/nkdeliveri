import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PollCollectPaymentInputSchema,
  runPollCollectPayment,
} from "@/lib/poll-collect-payment.logic";

/**
 * Server-function wrapper for the client-side adaptive poll
 * (useCollectPaymentPoll, orders.$id.tsx) — the primary PLOP Collect
 * confirmation mechanism (docs/archive/plop/PLOP_PHASE1_ARCHITECTURE.md § 3bis). The
 * actual logic lives in poll-collect-payment.logic.ts — this file only
 * wires it to createServerFn, mirroring
 * initiate-collect-payment.functions.ts's own split (see that file's
 * comment for why the logic is kept separate).
 */
export const pollCollectPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => PollCollectPaymentInputSchema.parse(data))
  .handler(async ({ data, context }) => runPollCollectPayment(context.supabase, data));
