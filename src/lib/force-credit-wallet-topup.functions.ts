import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  externalReference: z.string().uuid(),
  justification: z.string().min(10),
  providerTransactionId: z.string().optional(),
});

/**
 * Kredi MANYÈL "verifye pa yon moun" pou yon rechaj ke API PLOP la pa ka
 * konfime (wè migrasyon 20260902010000 pou poukisa chemen sa a egziste
 * apa de recover-wallet-topup.functions.ts).
 *
 * Kontrèman ak rekiperasyon otomatik la, fonksyon sa a PA mande PLOP —
 * se admin nan ki pran responsablite a, ak yon jistifikasyon ekri
 * obligatwa, epi tras odit la make l klèman kòm yon desizyon imen
 * ('wallet_topup.force_credited'), pa yon konfimasyon founisè.
 */
export const forceCreditWalletTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: intent, error } = await context.supabase.rpc(
      "admin_force_credit_wallet_topup_secure",
      {
        _external_reference: data.externalReference,
        _justification: data.justification,
        _provider_transaction_id: data.providerTransactionId,
      },
    );
    if (error) throw new Error(error.message);
    return { outcome: "credited" as const, intent };
  });
