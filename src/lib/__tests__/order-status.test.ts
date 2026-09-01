/**
 * Unit tests for classifyUnconfirmedPayment — the pure logic behind the
 * manual-vs-automatic payment fix
 * (docs/archive/payments/PAYMENT_FLOW_CLASSIFICATION_REPORT.md, migration
 * 20260813120000_fix_manual_vs_automatic_payment_classification.sql). The
 * SQL-side gate (private.update_order_status_secure) is verified
 * separately via a real BEGIN/ROLLBACK transaction against production —
 * this file only covers the frontend mirror that decides the "Konfime"
 * button's disabled/title state in dashboard.restaurant.orders.tsx, same
 * "extract the pure logic" pattern as admin-step-up.test.ts/auth-errors.test.ts.
 */
import { describe, expect, it } from "vitest";
import { classifyUnconfirmedPayment } from "../order-status";

describe("classifyUnconfirmedPayment", () => {
  it("returns null when there is no payment at all", () => {
    expect(classifyUnconfirmedPayment(undefined)).toBeNull();
  });

  it("returns null for cash orders — this gate only ever concerns moncash/natcash", () => {
    expect(classifyUnconfirmedPayment({ method: "kach", status: "pending" })).toBeNull();
  });

  it("returns null for Stripe — Stripe was never gated by this check and this fix doesn't add one", () => {
    expect(classifyUnconfirmedPayment({ method: "stripe", status: "pending" })).toBeNull();
  });

  it("returns null once a moncash/natcash payment is paid, regardless of flow", () => {
    expect(classifyUnconfirmedPayment({ method: "moncash", status: "paid" })).toBeNull();
    expect(
      classifyUnconfirmedPayment({
        method: "natcash",
        status: "paid",
        payment_transactions: [{ status: "paid" }],
      }),
    ).toBeNull();
  });

  it("classifies as MANUAL when unpaid and no payment_transactions row exists (never touched the automatic flow)", () => {
    expect(classifyUnconfirmedPayment({ method: "moncash", status: "awaiting_proof" })).toBe(
      "manual",
    );
    expect(
      classifyUnconfirmedPayment({
        method: "natcash",
        status: "under_review",
        payment_transactions: [],
      }),
    ).toBe("manual");
  });

  it("classifies as AUTOMATIC when unpaid and a payment_transactions row exists — the bug this fixes: a wallet name alone must never imply 'manual'", () => {
    expect(
      classifyUnconfirmedPayment({
        method: "moncash",
        status: "awaiting_proof",
        payment_transactions: [{ status: "pending" }],
      }),
    ).toBe("automatic");
  });

  it("stays AUTOMATIC even when the provider transaction failed — must never fall back to the manual proof-review message", () => {
    expect(
      classifyUnconfirmedPayment({
        method: "moncash",
        status: "failed",
        payment_transactions: [{ status: "failed" }],
      }),
    ).toBe("automatic");
  });

  it("stays AUTOMATIC even if a manual proof was accidentally also uploaded — payment_transactions existence wins, never flips to manual", () => {
    expect(
      classifyUnconfirmedPayment({
        method: "moncash",
        status: "under_review",
        payment_transactions: [{ status: "pending" }],
      }),
    ).toBe("automatic");
  });
});
