/**
 * PLOP implementation of `PaymentProvider` (`./types.ts`) — the actual
 * fournisseur behind the "MonCash Automatik" checkout method
 * (`payment_provider_settings.provider = 'moncash_auto'`), replacing the
 * dormant Digicel-direct integration in `moncash-provider.server.ts`
 * (kept, untouched, legacy — see docs/PLOP_REMEDIATION_REPORT.md § 2 for
 * why this is a new file rather than a rewrite of that one).
 *
 * `code: "moncash_api"` is preserved on purpose — the internal
 * `provider_code` stays stable for `payment_transactions.provider` and
 * every existing RPC (docs/PLOP_PHASE1_ARCHITECTURE.md § 1); only the
 * *implementation* behind that code changes. Admin-facing display uses
 * `payment-provider-display.ts` to show "PLOP", never this internal code
 * directly.
 *
 * Built strictly against docs/PLOP_PHASE0_AUDIT.md — nothing here
 * invents an endpoint, parameter, or behavior PLOP does not document.
 *
 * `.server.ts` is load-bearing: the build fails if a route file or
 * component imports this module (or plop-client.server.ts) directly.
 */
import type { PaymentProvider } from "./types";
import { isPlopConfigured } from "./plop-config.server";
import { PlopApiError, createPayment, verifyPayment } from "./plop-client.server";

const NOT_CONFIGURED = "PLOP pa konfigire toujou";

// PLOP's Withdrawal API is a real, documented disbursement capability
// (docs/PLOP_PHASE0_AUDIT.md § 8) — but this replacement covers Collect
// only, by explicit mission scope. `direction: "disburse"` is refused
// here exactly like moncash-provider.server.ts refuses it today, for a
// different reason: not "PLOP can't do this" but "this integration
// doesn't implement it (yet, deliberately, out of scope)".
const DISBURSEMENT_NOT_SUPPORTED =
  "Entegrasyon PLOP sa a sèlman kouvri kolekte (peman kliyan) — API retrè PLOP la egziste men li pa branche isit la (deside eksplisitman ekate pou chantye sa a).";

function describeError(err: unknown): string {
  if (err instanceof PlopApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Erè PLOP san detay";
}

export const plopProvider: PaymentProvider = {
  code: "moncash_api",
  isConfigured: () => isPlopConfigured(),

  async initiatePayment(input) {
    if (!isPlopConfigured()) {
      return { status: "failed", error: NOT_CONFIGURED, code: "not_configured" };
    }
    if (input.direction === "disburse") {
      return { status: "failed", error: DISBURSEMENT_NOT_SUPPORTED, code: "unsupported" };
    }

    try {
      const result = await createPayment(input.reference, input.amount);
      return {
        status: "pending",
        providerReference: input.reference,
        raw: {
          redirectUrl: result.redirectUrl,
          providerTransactionId: result.providerTransactionId,
        },
      };
    } catch (err) {
      // Reconciliation-on-error (audit finding A1,
      // docs/PLOP_PHASE2_AUDIT.md § Anomalies): a network timeout here
      // can mean PLOP genuinely never saw the request, OR that it
      // processed it and only the *response* got lost — indistinguishable
      // from here. `verifyPayment` is a read-only, side-effect-free
      // lookup (unlike `createPayment`, its safety doesn't depend on any
      // documented idempotency guarantee for `refference_id` reuse —
      // docs/PLOP_PHASE0_AUDIT.md § 14.7 is about *creating* twice, not
      // about *checking*), so it's always safe to attempt one lookup
      // before declaring failure — same principle as
      // moncash-provider.server.ts's own createPayment failure path,
      // adapted to PLOP's verify-only (no dedicated "retrieve" call)
      // shape. If this lookup itself fails, the original error is
      // reported — a failed double-check must never mask or replace the
      // real failure.
      try {
        const reconciled = await verifyPayment(input.reference);
        if (reconciled.transStatus === "ok") {
          return {
            status: "success",
            providerReference: reconciled.providerTransactionId ?? input.reference,
            raw: reconciled.raw,
          };
        }
        if (reconciled.transStatus === "no") {
          // PLOP does have this reference on file after all — the create
          // call succeeded, only its response was lost. Reporting
          // "pending" (not "failed") lets the normal flow continue:
          // create_collect_payment_secure records status:'pending', so
          // the reconciliation cron picks it up later if the client-side
          // poll doesn't resolve it first — never silently un-trackable
          // the way an immediate "failed" would be (docs/PLOP_PHASE2_AUDIT.md § A1).
          return {
            status: "pending",
            providerReference: input.reference,
            raw: reconciled.raw,
          };
        }
        // trans_status "unknown" (or the lookup call itself doesn't
        // recognize this reference) — genuinely no better answer than
        // the original error. Fall through to reporting it below.
      } catch {
        // The reconciliation lookup itself failed — fall through to the
        // original error, never let a second failure mask the first.
      }
      const code = err instanceof PlopApiError && err.code === "timeout" ? "timeout" : "rejected";
      return { status: "failed", error: describeError(err), code };
    }
  },

  async checkStatus(providerReference) {
    if (!isPlopConfigured()) return { status: "unknown", error: NOT_CONFIGURED };
    try {
      const result = await verifyPayment(providerReference);
      if (result.transStatus === "ok") {
        return {
          status: "success",
          providerReference: result.providerTransactionId ?? providerReference,
          raw: result.raw,
        };
      }
      if (result.transStatus === "no") {
        return { status: "pending", raw: result.raw };
      }
      // trans_status was neither "no" nor "ok" — PLOP documents no third
      // value. Reported honestly as unknown, never guessed as success or
      // failure (docs/PLOP_PHASE0_AUDIT.md § 14.6).
      //
      // Deliberately DIFFERENT from moncash-provider.server.ts's own
      // checkStatus(), which folds MonCash's equivalent ambiguous case
      // into status:"pending" (optimistic — "keep waiting"). PLOP's case
      // reports status:"unknown" instead (honest — "we can't tell"),
      // audited and confirmed as an intentional divergence, not an
      // oversight (docs/PLOP_PHASE2_AUDIT.md § Anomalie A2). Any caller
      // that treats "pending" and "unknown" differently (the Phase 3
      // client-side poll included) must handle "unknown" the same way it
      // handles "pending" — keep waiting/retrying, never surface it as a
      // failure — since PaymentStatusResult's own doc comment is explicit
      // that "unknown" must never be treated as a real failure.
      return { status: "unknown", error: "PLOP retounen yon trans_status enkoni" };
    } catch (err) {
      return { status: "unknown", error: describeError(err) };
    }
  },

  async cancelPayment() {
    // No cancellation endpoint documented for a Collect payment
    // (docs/PLOP_PHASE0_AUDIT.md § 7) — the honest answer, not an
    // invented success, mirrors manual-provider.server.ts's/the legacy
    // moncash-provider.server.ts's own use of "not_cancellable".
    return { status: "not_cancellable" };
  },

  async verifyWebhook() {
    // No webhook mechanism documented anywhere in the PLOP API
    // (docs/PLOP_PHASE0_AUDIT.md § 9) — a permanent, honest refusal
    // rather than a fabricated signature scheme (same principle
    // docs/PAYMENT_PROVIDER_DEVELOPER_GUIDE.md § 4 prescribes).
    // Finalization goes through polling instead: a client-side poll
    // (orders.$id.tsx, Phase 3) and the daily reconciliation cron
    // (plop-reconcile.server.ts) — never this method.
    return {
      valid: false,
      error: "PLOP pa gen okenn webhook dokimante — itilize rekonsilyasyon",
    };
  },
};
