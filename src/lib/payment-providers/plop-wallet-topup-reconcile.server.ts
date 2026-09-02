/**
 * Rekonsilyasyon rechaj wallet — FILÈ SEKIRITE, pa mekanis prensipal la.
 * Depi 20260902000000, konfimasyon prensipal la se poll kliyan-side la
 * (poll-wallet-topup.logic.ts), menm jan ak peman kòmand yo.
 *
 * KORIJE APRE ENSIDAN 50 HTG (wè migrasyon 20260902000000 pou chèn kòz
 * rasin konplè a) — 3 chanjman ki chak te yon kòz:
 *
 *   1) Nou RE-GADE entansyon 'expired' yo tou, pa sèlman 'pending'.
 *      Anvan, yon fwa yon entansyon te make 'expired' (sa ki te rive
 *      otomatikman apre 30 minit!), okenn chemen pa t ka janm kredite l
 *      ankò — yon peman reyèl te disparèt san bri. Kounye a yon
 *      ekspirasyon ki pa t kòrèk gerizon pou kont li nan pwochen pas la.
 *
 *   2) Nou PA rele ekspirasyon an nan menm pas la ankò. Anvan, cron an
 *      (ki kouri YON SÈL FWA CHAK JOU) t ap make ekspire tout bagay ki
 *      gen plis pase 30 MINIT — dèyè yon sèl tantativ. Kounye a
 *      ekspirasyon an gen pwòp fenèt 24è+ li (RPC la menm refize
 *      nenpòt bagay pi kout), donk yon peman menm jou a pa ka janm
 *      antere.
 *
 *   3) Lè PLOP di klèman yon peman ECHWE, nou make l 'failed' ak yon
 *      rezon — olye kite l 'pending' jiskaske yon minite ekspirasyon
 *      san eksplikasyon vin pran l.
 */
import type { Json } from "@/integrations/supabase/types";
import { plopProvider } from "./plop-provider.server";

const MIN_AGE_MS = 10 * 60_000;
/** Konbyen tan nou kontinye re-gade yon entansyon ki pa 'succeeded' — apre sa PLOP pa gen anyen itil pou nou ankò. */
const RECHECK_WINDOW_MS = 7 * 24 * 60 * 60_000;

export type WalletTopupReconcileResult = {
  externalReference: string;
  outcome: "confirmed" | "recovered" | "failed" | "still_pending" | "rpc_error";
};

export type WalletTopupReconcileSummary = {
  candidates: number;
  results: WalletTopupReconcileResult[];
};

export async function reconcilePendingWalletTopups(): Promise<WalletTopupReconcileSummary> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: pending, error } = await supabaseAdmin
    .from("payment_intents")
    .select("external_reference, created_at, status")
    .eq("provider", "plop_api")
    // 'expired' enkli espre — wè nòt 1 anwo a.
    .in("status", ["pending", "expired"])
    .lt("created_at", new Date(Date.now() - MIN_AGE_MS).toISOString())
    .gt("created_at", new Date(Date.now() - RECHECK_WINDOW_MS).toISOString());
  if (error) throw new Error(error.message);

  const results: WalletTopupReconcileResult[] = [];

  for (const row of pending ?? []) {
    const reference = row.external_reference;
    const wasExpired = row.status === "expired";
    const status = await plopProvider.checkStatus(reference);

    if (status.status === "success") {
      try {
        // complete_wallet_topup_secure sèlman aji sou 'pending'. Pou yon
        // ranje ki te ekspire pa erè, nou dwe pase pa chemen
        // rekiperasyon an — ki gen pwòp gad idanpotans ledger li.
        const { error: rpcError } = wasExpired
          ? await supabaseAdmin.rpc("admin_recover_wallet_topup_secure", {
              _external_reference: reference,
              _provider_transaction_id: status.providerReference,
              _raw_payload: (status.raw ?? null) as Json,
              _notes: "Rekiperasyon otomatik — entansyon te ekspire pa erè, PLOP konfime peman an",
            })
          : await supabaseAdmin.rpc("complete_wallet_topup_secure", {
              _external_reference: reference,
              _decision: "succeeded",
              _provider_transaction_id: status.providerReference,
              _raw_payload: (status.raw ?? null) as Json,
            });
        if (rpcError) throw new Error(rpcError.message);
        results.push({
          externalReference: reference,
          outcome: wasExpired ? "recovered" : "confirmed",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[wallet-topup-reconcile] RPC FAILED AFTER PLOP CONFIRMED — ${reference} is paid on PLOP's side but the credit RPC failed: ${message}`,
        );
        results.push({ externalReference: reference, outcome: "rpc_error" });
      }
      continue;
    }

    if (status.status === "failed" && !wasExpired) {
      // PLOP di klèman li echwe — di kliyan an poukisa, olye kite l
      // pandan jiskaske yon ekspirasyon san eksplikasyon pran l.
      const { error: failError } = await supabaseAdmin.rpc("complete_wallet_topup_secure", {
        _external_reference: reference,
        _decision: "failed",
        _error: status.error,
        _raw_payload: (status.raw ?? null) as Json,
      });
      if (failError) {
        console.error("[wallet-topup-reconcile] fail RPC failed", failError.message);
        results.push({ externalReference: reference, outcome: "rpc_error" });
      } else {
        results.push({ externalReference: reference, outcome: "failed" });
      }
      continue;
    }

    results.push({ externalReference: reference, outcome: "still_pending" });
  }

  // Ekspirasyon: fenèt pwòp li a (24è+ — RPC la refize pi kout), epi
  // SÈLMAN apre nou fin mande PLOP pou chak kandida anwo a. Yon peman
  // menm jou a pa ka janm rive isit la.
  const { error: expireError } = await supabaseAdmin.rpc("expire_stale_wallet_topups_secure", {
    _older_than_minutes: 1440,
  });
  if (expireError) console.error("[wallet-topup-reconcile] expire RPC failed", expireError.message);

  return { candidates: pending?.length ?? 0, results };
}
