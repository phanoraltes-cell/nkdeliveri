import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  InitiateCollectPaymentInputSchema,
  runInitiateCollectPayment,
} from "@/lib/initiate-collect-payment.logic";

/**
 * The *only* place allowed to call the collect provider's
 * initiatePayment() (plopProvider, docs/PLOP_PHASE3_WIRING_REPORT.md)
 * for a customer checkout — never from checkout.tsx directly (see
 * payment-providers/types.ts). Mirrors initiate-provider-payout
 * .functions.ts's own shape on the disbursement side: call the real
 * provider first, only record the outcome afterward, so
 * create_collect_payment_secure always reflects a genuine provider
 * result, never a frontend guess. "Aucune confirmation frontend" is
 * satisfied structurally — nothing here, or anywhere reachable from the
 * client, can ever mark a payment 'paid'; only
 * complete_collect_payment_secure (service_role-only, called exclusively
 * by the webhook handler) can.
 *
 * The actual logic lives in initiate-collect-payment.logic.ts — this
 * file only wires it to createServerFn, so a unit test can import the
 * logic directly without dragging in TanStack Start's server-function
 * runtime (see that file's own comment for why that matters).
 */
export const initiateCollectPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InitiateCollectPaymentInputSchema.parse(data))
  .handler(async ({ data, context }) => runInitiateCollectPayment(context.supabase, data));
