/**
 * Konfimasyon IMEDYA pou yon rechaj wallet — egzakteman menm wòl ak
 * poll-collect-payment.logic.ts pou peman kòmand: mekanis PRENSIPAL la,
 * pa cron an.
 *
 * POUKISA LI EGZISTE: Tach 1C te konstwi rechaj wallet SAN okenn poll —
 * sèl chemen konfimasyon an se te cron jounalye a. Rezilta: yon kliyan
 * ki peye 50 HTG pa t wè lajan l pandan jiska 24è, epi (wè
 * 20260902000000) li te ka ekspire anvan menm yo mande PLOP si li te
 * peye. Modil sa a fèmen twou sa a: nan kèk segonn apre kliyan an tounen
 * soti nan PLOP, rechaj la konfime.
 *
 * Modèl sekirite (menm split ak poll-collect-payment.logic.ts): rechèch
 * la (etap 1) pase nan pwòp kliyan Supabase RLS-scoped moun nan — donk
 * yon moun pa ka janm poll yon entansyon ki pa pou li ("payment_intents
 * own read" RLS policy). Sèlman finalizasyon an (etap 3) bezwen
 * supabaseAdmin, paske complete_wallet_topup_secure se service_role
 * sèlman — menm RPC egzat cron an rele, pa yon dezyèm chemen kredi.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { z } from "zod";

export const PollWalletTopupInputSchema = z.object({ externalReference: z.string().uuid() });
export type PollWalletTopupInput = z.infer<typeof PollWalletTopupInputSchema>;

export type PollWalletTopupResult =
  { status: "pending" } | { status: "succeeded" | "failed" | "expired" } | { status: "not_found" };

/** Menm plafon ak poll-collect-payment (defans kont yon kliyan skripte ki kontounen pas kliyan-side la). */
const RATE_LIMIT_MAX_HITS = 40;
const RATE_LIMIT_WINDOW_SECONDS = 900;

export async function runPollWalletTopup(
  supabase: SupabaseClient<Database>,
  data: PollWalletTopupInput,
): Promise<PollWalletTopupResult> {
  const { data: allowed, error: rateLimitError } = await supabase.rpc("check_rate_limit_secure", {
    _action: "poll_wallet_topup",
    _max_hits: RATE_LIMIT_MAX_HITS,
    _window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (rateLimitError) throw new Error(rateLimitError.message);
  if (!allowed) return { status: "pending" };

  // Etap 1 — rechèch otorize, RLS-scoped sou pwòp entansyon moun nan.
  const { data: row, error } = await supabase
    .from("payment_intents")
    .select("status, external_reference")
    .eq("external_reference", data.externalReference)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return { status: "not_found" };
  if (row.status !== "pending") {
    return { status: row.status as "succeeded" | "failed" | "expired" };
  }

  // Etap 2 — mande PLOP dirèkteman. checkStatus pa janm voye yon
  // eksepsyon (tout echèk vin status:"unknown"); "unknown" ak "pending"
  // toude retounen kòm "pending" isit la — jamè yon echèk devine.
  const { plopProvider } = await import("@/lib/payment-providers/plop-provider.server");
  const status = await plopProvider.checkStatus(data.externalReference);
  if (status.status !== "success") return { status: "pending" };

  // Etap 3 — finalizasyon. RPC service_role sèlman, se poutèt sa
  // supabaseAdmin isit la e sèlman isit la.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: updated, error: rpcError } = await supabaseAdmin.rpc(
    "complete_wallet_topup_secure",
    {
      _external_reference: data.externalReference,
      _decision: "succeeded",
      _provider_transaction_id: status.providerReference,
      _raw_payload: (status.raw ?? null) as Json,
    },
  );
  if (rpcError) throw new Error(rpcError.message);

  return { status: updated.status as "succeeded" | "failed" | "expired" };
}
