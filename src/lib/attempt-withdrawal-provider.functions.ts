import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { attemptWithdrawalProvider } from "@/lib/attempt-withdrawal-provider.logic";

const InputSchema = z.object({ payoutId: z.string().uuid() });

/**
 * Admin-triggered twin of request-withdrawal.functions.ts's automatic
 * attempt (Tach 3B) — for a 'requested' row that stayed manual (PLOP
 * wasn't active/configured at request time, or a first attempt failed)
 * and an admin now wants to retry it automatically instead of paying by
 * hand. Fetches the row through the caller's own session first (RLS:
 * admin can read any payout via private.payout_beneficiary_visible) so a
 * non-admin, non-owner caller can never reach a payout that isn't theirs
 * — attemptWithdrawalProvider itself adds no separate check, matching
 * every other *.logic.ts module in this project.
 */
export const attemptWithdrawalProviderFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: payout, error } = await supabase
      .from("payouts")
      .select("*")
      .eq("id", data.payoutId)
      .single();
    if (error) throw new Error(error.message);
    if (payout.status !== "requested") {
      throw new Error("Demann sa a pa nan atant tretman");
    }
    return attemptWithdrawalProvider(supabase, payout);
  });
