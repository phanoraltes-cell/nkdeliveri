/**
 * Rekonsilyasyon rechaj wallet — menm patwon egzat ak
 * plop-reconcile.server.ts (payment_transactions), aplike sou
 * payment_intents pou rechaj wallet olye kòmand. Rele nan menm cron
 * jounalye a (api.cron.plop-reconcile.ts) — pa gen nouvo Vercel Cron
 * antre kreye (limit Hobby plan deja rive, wè MONCASH_CRON_SECRET_
 * CONFIGURATION_REPORT.md).
 *
 * Pa gen "stale flag + push admin" isit la (kontrèman ak collect
 * payments) — yon rechaj wallet ki rete pandan lontan senpleman ekspire
 * apre 30 minit (expire_stale_wallet_topups_secure, deja rele apa) olye
 * mande yon revizyon manyèl admin: pa gen okenn kòmand/lòt sistèm k ap
 * tann sou li, se sèlman kliyan an ki bezwen eseye ankò.
 */
import type { Json } from "@/integrations/supabase/types";
import { plopProvider } from "./plop-provider.server";

const MIN_AGE_MS = 10 * 60_000;

export type WalletTopupReconcileResult = {
  externalReference: string;
  outcome: "confirmed" | "still_pending" | "rpc_error";
};

export type WalletTopupReconcileSummary = {
  candidates: number;
  results: WalletTopupReconcileResult[];
};

export async function reconcilePendingWalletTopups(): Promise<WalletTopupReconcileSummary> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: pending, error } = await supabaseAdmin
    .from("payment_intents")
    .select("external_reference, created_at")
    .eq("provider", "plop_api")
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - MIN_AGE_MS).toISOString());
  if (error) throw new Error(error.message);

  const results: WalletTopupReconcileResult[] = [];

  for (const row of pending ?? []) {
    const reference = row.external_reference;
    const status = await plopProvider.checkStatus(reference);

    if (status.status === "success") {
      try {
        const { error: rpcError } = await supabaseAdmin.rpc("complete_wallet_topup_secure", {
          _external_reference: reference,
          _decision: "succeeded",
          _provider_transaction_id: status.providerReference,
          _raw_payload: (status.raw ?? null) as Json,
        });
        if (rpcError) throw new Error(rpcError.message);
        results.push({ externalReference: reference, outcome: "confirmed" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[wallet-topup-reconcile] RPC FAILED AFTER PLOP CONFIRMED — ${reference} is paid on PLOP's side but complete_wallet_topup_secure failed: ${message}`,
        );
        results.push({ externalReference: reference, outcome: "rpc_error" });
      }
      continue;
    }

    results.push({ externalReference: reference, outcome: "still_pending" });
  }

  // Èkspirasyon separe (pa gen rapò ak PLOP, senpleman laj) — apre
  // rekonsilyasyon pou pa ekspire yon peman ki te fenk konfime pandan
  // menm pas la.
  const { error: expireError } = await supabaseAdmin.rpc("expire_stale_wallet_topups_secure", {
    _older_than_minutes: 30,
  });
  if (expireError) console.error("[wallet-topup-reconcile] expire RPC failed", expireError.message);

  return { candidates: pending?.length ?? 0, results };
}
