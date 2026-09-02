/**
 * PLOP implementation of `PaymentProvider` (`./types.ts`) — the actual
 * fournisseur behind both the "MonCash Otomatik" (`payment_provider_settings
 * .provider = 'moncash_auto'`) and "NatCash Otomatik" (`= 'natcash_auto'`)
 * checkout methods (docs/archive/plop/PLOP_NATCASH_INTEGRATION_PLAN.md) — internal code
 * unchanged, only the customer-facing labels evolved over time ("MonCash
 * Automatik" → "Payment Global" → the current separate "MonCash Otomatik"/
 * "NatCash Otomatik" buttons), replacing the
 * dormant Digicel-direct integration in `moncash-provider.server.ts`
 * (kept, untouched, legacy — see docs/archive/plop/PLOP_REMEDIATION_REPORT.md § 2 for
 * why this is a new file rather than a rewrite of that one).
 *
 * `code: "moncash_api"` is preserved on purpose — the internal
 * `provider_code` stays stable for `payment_transactions.provider` and
 * every existing RPC (docs/archive/plop/PLOP_PHASE1_ARCHITECTURE.md § 1); only the
 * *implementation* behind that code changes. Admin-facing display uses
 * `payment-provider-display.ts` to show "PLOP", never this internal code
 * directly.
 *
 * Built strictly against docs/archive/plop/PLOP_PHASE0_AUDIT.md — nothing here
 * invents an endpoint, parameter, or behavior PLOP does not document.
 *
 * PROMPT MODIFIKASYON (WALLET, DEKÈSMAN, PIBLISITE), Tach 3 — `direction:
 * "disburse"` (PLOP's Withdrawal API) is now implemented for real, on
 * Altes's explicit go-ahead ("Konekte API retrè PLOP la"). Registered
 * under BOTH `moncash_api` and `natcash_api` in index.server.ts's
 * registry (PLOP's own `method` field picks the actual rail per call,
 * same as Collect) — see plop-client.server.ts's own header note for
 * what's confirmed-by-audit vs inferred in the Withdrawal response shape.
 *
 * `.server.ts` is load-bearing: the build fails if a route file or
 * component imports this module (or plop-client.server.ts) directly.
 */
import type { PaymentProvider } from "./types";
import { isPlopConfigured } from "./plop-config.server";
import {
  PlopApiError,
  createPayment,
  verifyPayment,
  isValidPaymentMethod,
  executeWithdrawal,
  verifyWithdrawal,
  type PlopWithdrawalErrorCode,
} from "./plop-client.server";

const NOT_CONFIGURED = "PLOP pa konfigire toujou";

/** Maps PLOP's own withdrawal error codes to the coarse `InitiatePaymentResult.code` a caller can act on without parsing text. */
function withdrawalErrorToCode(
  errorCode: PlopWithdrawalErrorCode | null,
): "rejected" | "invalid_wallet" {
  if (errorCode === "METHOD_NOT_CONFIGURED") return "invalid_wallet";
  return "rejected";
}

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
      // Tach 3 — the real Withdrawal API. `counterpartyNumber` is
      // required by every caller of this direction
      // (initiate-provider-payout.functions.ts already refuses to call
      // without it) — a missing one here is a caller-side bug, reported
      // as a rejection rather than crashing on a PLOP call with an empty
      // recipient.
      if (!input.counterpartyNumber) {
        return { status: "failed", error: "Nimewo benefisyè a manke", code: "rejected" };
      }
      const method = input.paymentMethod ?? "moncash";
      if (!isValidPaymentMethod(method)) {
        return {
          status: "failed",
          error: `Metòd retrè "${method}" pa yon valè PLOP rekonèt (moncash|kashpaw|natcash|all)`,
          code: "invalid_wallet",
        };
      }
      try {
        const result = await executeWithdrawal({
          amount: input.amount,
          method,
          recipient: input.counterpartyNumber,
          reference: input.reference,
        });
        if (result.status === "success") {
          return {
            status: "success",
            providerReference: result.providerTransactionId ?? input.reference,
            raw: result.raw,
          };
        }
        return {
          status: "failed",
          error:
            result.message ?? `Retrè PLOP echwe${result.errorCode ? ` (${result.errorCode})` : ""}`,
          code: withdrawalErrorToCode(result.errorCode),
          raw: result.raw,
        };
      } catch (err) {
        // A network/timeout/malformed-response failure — genuinely
        // unknown whether PLOP actually executed the transfer (the
        // withdrawal-token step is single-use, so this attempt itself
        // can never be safely retried, see plop-client.server.ts's own
        // comment). Reported as "pending", never "failed": a "failed"
        // result here would let the caller believe no money moved when
        // it might have — the reconciliation cron's verifyWithdrawal()
        // is what eventually resolves this honestly instead of guessing.
        const code = err instanceof PlopApiError && err.code === "timeout" ? "timeout" : "rejected";
        if (code === "timeout") {
          return { status: "pending", providerReference: input.reference, raw: describeError(err) };
        }
        return { status: "failed", error: describeError(err), code };
      }
    }
    // Validated *before* the try/catch below on purpose — an unrecognized
    // `paymentMethod` is a caller-side mistake, never a PLOP outcome. Doing
    // this check first means an invalid wallet never triggers the
    // reconciliation-on-error path (A1, below): there is nothing to
    // reconcile against for a request that was never actually sent.
    if (input.paymentMethod !== undefined && !isValidPaymentMethod(input.paymentMethod)) {
      return {
        status: "failed",
        error: `Metòd peman "${input.paymentMethod}" pa yon valè PLOP rekonèt (moncash|kashpaw|natcash|all)`,
        code: "invalid_wallet",
      };
    }

    try {
      const result = await createPayment(input.reference, input.amount, input.paymentMethod);
      return {
        status: "pending",
        providerReference: input.reference,
        raw: {
          redirectUrl: result.redirectUrl,
          providerTransactionId: result.providerTransactionId,
          paymentMethodRequested: result.paymentMethodRequested,
        },
      };
    } catch (err) {
      // Reconciliation-on-error (audit finding A1,
      // docs/archive/plop/PLOP_PHASE2_AUDIT.md § Anomalies): a network timeout here
      // can mean PLOP genuinely never saw the request, OR that it
      // processed it and only the *response* got lost — indistinguishable
      // from here. `verifyPayment` is a read-only, side-effect-free
      // lookup (unlike `createPayment`, its safety doesn't depend on any
      // documented idempotency guarantee for `refference_id` reuse —
      // docs/archive/plop/PLOP_PHASE0_AUDIT.md § 14.7 is about *creating* twice, not
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
            walletUsed: reconciled.walletUsed,
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
          // the way an immediate "failed" would be (docs/archive/plop/PLOP_PHASE2_AUDIT.md § A1).
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

  async checkStatus(providerReference, direction = "collect") {
    if (!isPlopConfigured()) return { status: "unknown", error: NOT_CONFIGURED };

    // Tach 3 — the withdrawal lookup is structurally different from the
    // collect one (different endpoint, different status vocabulary) —
    // routed here rather than merged into the block below, which stays
    // exactly as it was for Collect.
    if (direction === "disburse") {
      try {
        const result = await verifyWithdrawal(providerReference);
        if (result.status === "success") {
          return { status: "success", providerReference, raw: result.raw };
        }
        if (result.status === "failed") {
          return { status: "failed", error: "PLOP endike retrè a echwe", raw: result.raw };
        }
        if (result.status === "pending") {
          return { status: "pending", raw: result.raw };
        }
        // "refunded" or "unknown" — neither a plain success nor a plain
        // failure; reported as unknown so the reconciliation schedule
        // keeps checking rather than guessing (same posture as Collect's
        // own "unknown" branch below).
        return {
          status: "unknown",
          error: `PLOP retounen yon estati retrè enkoni: ${result.status}`,
        };
      } catch (err) {
        return { status: "unknown", error: describeError(err) };
      }
    }

    try {
      const result = await verifyPayment(providerReference);
      if (result.transStatus === "ok") {
        return {
          status: "success",
          providerReference: result.providerTransactionId ?? providerReference,
          walletUsed: result.walletUsed,
          raw: result.raw,
        };
      }
      if (result.transStatus === "no") {
        return { status: "pending", raw: result.raw };
      }
      // trans_status was neither "no" nor "ok" — PLOP documents no third
      // value. Reported honestly as unknown, never guessed as success or
      // failure (docs/archive/plop/PLOP_PHASE0_AUDIT.md § 14.6).
      //
      // Deliberately DIFFERENT from moncash-provider.server.ts's own
      // checkStatus(), which folds MonCash's equivalent ambiguous case
      // into status:"pending" (optimistic — "keep waiting"). PLOP's case
      // reports status:"unknown" instead (honest — "we can't tell"),
      // audited and confirmed as an intentional divergence, not an
      // oversight (docs/archive/plop/PLOP_PHASE2_AUDIT.md § Anomalie A2). Any caller
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
    // (docs/archive/plop/PLOP_PHASE0_AUDIT.md § 7) — the honest answer, not an
    // invented success, mirrors manual-provider.server.ts's/the legacy
    // moncash-provider.server.ts's own use of "not_cancellable".
    return { status: "not_cancellable" };
  },

  async verifyWebhook() {
    // No webhook mechanism documented anywhere in the PLOP API
    // (docs/archive/plop/PLOP_PHASE0_AUDIT.md § 9) — a permanent, honest refusal
    // rather than a fabricated signature scheme (same principle
    // docs/reference/PAYMENT_PROVIDER_DEVELOPER_GUIDE.md § 4 prescribes).
    // Finalization goes through polling instead: a client-side poll
    // (orders.$id.tsx, Phase 3) and the daily reconciliation cron
    // (plop-reconcile.server.ts) — never this method.
    return {
      valid: false,
      error: "PLOP pa gen okenn webhook dokimante — itilize rekonsilyasyon",
    };
  },
};
