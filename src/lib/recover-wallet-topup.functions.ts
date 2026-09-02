import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({ externalReference: z.string().uuid() });

/**
 * Rekiperasyon admin pou yon rechaj wallet ki peye sou bò PLOP men ki pa
 * janm rive nan balans kliyan an (ensidan 50 HTG — wè migrasyon
 * 20260902000000 pou chèn kòz rasin nan).
 *
 * ONÈTE SE GAD LA: nou PA janm kredite sou pawòl yon admin. Nou mande
 * PLOP tout bon (checkStatus) epi nou sèlman rele
 * admin_recover_wallet_topup_secure si PLOP DI li peye. Si PLOP di
 * lòt bagay, nou retounen sa PLOP di a san nou pa touche okenn balans —
 * menm modèl ak initiate-provider-payout.functions.ts.
 *
 * Doub-kredi enposib: RPC la sèvi ak ledger la (idempotency_key
 * 'topup:<intent_id>', endèks inik) kòm gad, pa yon verifikasyon lojik.
 */
export const recoverWalletTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { plopProvider } = await import("@/lib/payment-providers/plop-provider.server");
    if (!plopProvider.isConfigured()) {
      return { outcome: "provider_unavailable" as const, error: "PLOP pa konfigire" };
    }

    const status = await plopProvider.checkStatus(data.externalReference);
    if (status.status !== "success") {
      return {
        outcome: "not_paid" as const,
        providerStatus: status.status,
        error:
          status.status === "unknown"
            ? `PLOP pa ka konfime referans sa a: ${status.error}`
            : "PLOP pa endike okenn peman reyisi pou referans sa a",
      };
    }

    // Rele ak sesyon admin an li menm — RPC la verifye wòl + step-up
    // STRICT anndan l, menm konvansyon ak tout lòt RPC admin yo.
    const { data: intent, error } = await supabase.rpc("admin_recover_wallet_topup_secure", {
      _external_reference: data.externalReference,
      _provider_transaction_id: status.providerReference,
      _raw_payload: (status.raw ?? null) as Json,
      _notes: "Rekiperasyon admin apre konfimasyon PLOP",
    });
    if (error) throw new Error(error.message);

    return { outcome: "recovered" as const, intent };
  });
