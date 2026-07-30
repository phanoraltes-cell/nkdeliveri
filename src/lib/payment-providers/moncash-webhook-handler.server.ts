/**
 * Orchestrates an inbound MonCash webhook delivery end to end: signature
 * verification, idempotency, updating the payout/wallet, notifications,
 * and logging. Called only by src/routes/api.webhooks.moncash.ts (via a
 * dynamic import, so this — and the service-role client it uses — never
 * reaches the client bundle; see that route file's own comment for why a
 * static import isn't safe here).
 *
 * See docs/MONCASH_WEBHOOK_SECURITY.md for the full security report on
 * this flow.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Json } from "@/integrations/supabase/types";
import { moncashProvider } from "./moncash-provider.server";
import type { PaymentWebhookEvent } from "./types";

export type WebhookHandlerResult = {
  httpStatus: number;
  body: { ok: boolean; outcome: string; error?: string };
};

/**
 * MonCash's webhook payload shape (and whether it even carries a stable
 * per-delivery event id) is unconfirmed — see moncash-provider.server.ts.
 * When no explicit id field is present, derive a deterministic one from
 * the payload itself: two deliveries with byte-identical bodies collapse
 * to the same idempotency key (correct — that IS a duplicate delivery),
 * while any real difference (including a legitimate retry with updated
 * status) gets its own key rather than being silently dropped.
 */
function deriveEventId(event: PaymentWebhookEvent, rawBody: string): string {
  const explicit =
    event.raw && typeof event.raw === "object" ? (event.raw as Record<string, unknown>) : {};
  const explicitId = explicit.event_id ?? explicit.id ?? explicit.delivery_id;
  if (typeof explicitId === "string" && explicitId.length > 0) return explicitId;
  return createHash("sha256").update(rawBody).digest("hex");
}

export async function handleMonCashWebhook(
  rawBody: string,
  headers: Record<string, string>,
): Promise<WebhookHandlerResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const verified = await moncashProvider.verifyWebhook(rawBody, headers);
  if (!verified.valid) {
    // A rejected signature is itself a security-relevant event worth a
    // durable record, distinct from a successfully-processed one — logged
    // with a fresh random id (there is no trustworthy event id to key on
    // for a payload that failed verification).
    await supabaseAdmin.from("moncash_webhook_events").insert({
      event_id: `rejected:${randomUUID()}`,
      status: "rejected",
      payload: safeParse(rawBody) as Json,
      error: verified.error,
      processed_at: new Date().toISOString(),
    });
    console.warn("[moncash-webhook] rejected: signature invalid or unparseable payload");
    return { httpStatus: 401, body: { ok: false, outcome: "rejected", error: verified.error } };
  }

  const event = verified.event;
  const eventId = deriveEventId(event, rawBody);

  // Idempotency: INSERT with a UNIQUE(event_id) constraint is the actual
  // guarantee (atomic at the database level, safe under concurrent
  // duplicate deliveries) — the row only exists after this succeeds.
  const { error: insertError } = await supabaseAdmin.from("moncash_webhook_events").insert({
    event_id: eventId,
    transaction_reference: event.ourReference,
    status: "processing",
    payload: event.raw as Json,
  });
  if (insertError) {
    // Postgres unique_violation — this exact delivery was already
    // recorded. Acknowledge with 200 so MonCash doesn't keep retrying a
    // delivery we've already handled (or are already handling).
    if (insertError.code === "23505") {
      return { httpStatus: 200, body: { ok: true, outcome: "duplicate" } };
    }
    console.error("[moncash-webhook] failed to record delivery", insertError.message);
    return { httpStatus: 500, body: { ok: false, outcome: "error", error: "Internal error" } };
  }

  try {
    const outcome = await applyEvent(supabaseAdmin, event);
    await pushOutcomeNotification(supabaseAdmin, event, outcome);
    await supabaseAdmin
      .from("moncash_webhook_events")
      .update({ status: "processed", outcome, processed_at: new Date().toISOString() })
      .eq("event_id", eventId);
    return { httpStatus: 200, body: { ok: true, outcome } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("moncash_webhook_events")
      .update({ status: "failed", error: message, processed_at: new Date().toISOString() })
      .eq("event_id", eventId);
    console.error("[moncash-webhook] processing failed", message);
    // 500, not 200: this is our own transient failure (DB error, RPC
    // exception), not a permanent rejection — the idempotency row is
    // already 'failed', not 'processed', so a legitimate MonCash retry is
    // safe to reprocess (the UNIQUE constraint only blocks re-insertion
    // of the *same* event_id, not our own update above).
    return { httpStatus: 500, body: { ok: false, outcome: "error", error: message } };
  }
}

function safeParse(rawBody: string): object {
  try {
    return JSON.parse(rawBody);
  } catch {
    return { raw: rawBody };
  }
}

type ClientServerModule = typeof import("@/integrations/supabase/client.server");
type SupabaseAdmin = ClientServerModule["supabaseAdmin"];

async function applyEvent(
  supabaseAdmin: SupabaseAdmin,
  event: PaymentWebhookEvent,
): Promise<"confirmed" | "failed" | "ignored"> {
  if (!event.ourReference) {
    // No way to match this back to a payout — nothing to do but record it
    // (already done above) for manual investigation.
    return "ignored";
  }

  if (event.status === "success") {
    const { error } = await supabaseAdmin.rpc("complete_pending_payout_secure", {
      _transaction_reference: event.ourReference,
      _provider_code: "moncash_api",
      _provider_transaction_id: event.providerReference,
    });
    if (error) throw new Error(error.message);
    return "confirmed";
  }

  if (event.status === "failed") {
    const { error } = await supabaseAdmin.rpc("fail_pending_payout_secure", {
      _transaction_reference: event.ourReference,
      _provider_code: "moncash_api",
      _reason: "MonCash rapòte tranzaksyon an echwe",
    });
    if (error) throw new Error(error.message);
    return "failed";
  }

  // status === "pending" -- nothing to update yet, wait for a later
  // delivery (or checkStatus polling) to reach a final state.
  return "ignored";
}

async function pushOutcomeNotification(
  supabaseAdmin: SupabaseAdmin,
  event: PaymentWebhookEvent,
  outcome: "confirmed" | "failed" | "ignored",
): Promise<void> {
  if (outcome === "ignored" || !event.ourReference) return;
  const { pushToUsers } = await import("@/lib/push-dispatch.server");

  const { data: payout } = await supabaseAdmin
    .from("payouts")
    .select("id, amount, paid_by, provider_code, restaurants(owner_id), drivers(user_id)")
    .eq("transaction_reference", event.ourReference)
    .eq("provider_code", "moncash_api")
    .maybeSingle();
  if (!payout) return;

  const beneficiaryId =
    (payout as { restaurants?: { owner_id?: string } | null }).restaurants?.owner_id ??
    (payout as { drivers?: { user_id?: string } | null }).drivers?.user_id ??
    null;

  // Mirrors the in-app notifications complete_pending_payout_secure /
  // fail_pending_payout_secure already send via private.notify_secure
  // (20260730120000_moncash_provider_notifications.sql) — both the
  // beneficiary and the initiating admin get told either way, since
  // create_pending_payout_secure now tells the beneficiary a payment was
  // sent in the first place.
  if (outcome === "confirmed") {
    if (beneficiaryId) {
      await pushToUsers([beneficiaryId], {
        title: "Ou resevwa yon peman",
        body: `Ou resevwa yon peman ${payout.amount} HTG. Tanpri konfime resepsyon an.`,
        url: "/dashboard",
        tag: `payout-${payout.id}`,
        data: { payoutId: payout.id },
      });
    }
    await pushToUsers([payout.paid_by], {
      title: "Peman pwovidè reyisi",
      body: `Peman ${payout.amount} HTG atravè MonCash konfime pa pwovidè a.`,
      url: "/dashboard/admin/moncash",
      tag: `payout-${payout.id}`,
      data: { payoutId: payout.id },
    });
    return;
  }

  // failed
  if (beneficiaryId) {
    await pushToUsers([beneficiaryId], {
      title: "Tantativ peman echwe",
      body: `Tantativ peman ${payout.amount} HTG nou te anonse a pa reyisi.`,
      url: "/dashboard",
      tag: `payout-${payout.id}`,
      data: { payoutId: payout.id },
    });
  }
  await pushToUsers([payout.paid_by], {
    title: "Peman pwovidè echwe",
    body: `Yon tantativ peman ${payout.amount} HTG atravè MonCash echwe. Lajan an retounen nan balans disponib la.`,
    url: "/dashboard/admin/moncash",
    tag: `payout-${payout.id}`,
    data: { payoutId: payout.id },
  });
}
