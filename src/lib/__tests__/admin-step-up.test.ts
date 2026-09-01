/**
 * Unit tests for the pure logic in admin-step-up.ts
 * (docs/archive/audits/ADMIN_ACCESS_SECURITY_REMEDIATION_REPORT.md). The actual security
 * decision (private.admin_step_up_status/require_admin_step_up[_strict]())
 * lives in SQL and is verified there via BEGIN/ROLLBACK transactional
 * tests against the real schema (auth.mfa_factors/auth.sessions) — this
 * file only covers the client-side error-classification helper, same
 * "extract the pure logic" pattern as auth-errors.test.ts.
 */
import { describe, expect, it } from "vitest";
import { isStepUpError } from "../admin-step-up";

describe("isStepUpError", () => {
  it("recognizes the standard-tier rejection raised by private.require_admin_step_up()", () => {
    const err = new Error(
      "STEP_UP_REQUIRED: Verifikasyon sekirite adisyonèl obligatwa pou aksyon sa a.",
    );
    expect(isStepUpError(err)).toBe(true);
  });

  it("recognizes the strict-tier rejection raised by private.require_admin_step_up_strict()", () => {
    const err = new Error("STEP_UP_REQUIRED_MFA: Verifikasyon MFA fre obligatwa pou aksyon sa a.");
    expect(isStepUpError(err)).toBe(true);
  });

  it("does not misfire on an unrelated 'Forbidden' role-check error", () => {
    expect(isStepUpError(new Error("Forbidden"))).toBe(false);
  });

  it("does not misfire on a normal validation error", () => {
    expect(isStepUpError(new Error("Montan envalid"))).toBe(false);
  });

  it("does not match a message that merely contains the phrase mid-string (prefix-only match)", () => {
    expect(isStepUpError(new Error("Erè: STEP_UP_REQUIRED pa nan kòmansman an"))).toBe(false);
  });

  it("handles non-Error inputs (string, null, undefined, plain object) without throwing", () => {
    expect(isStepUpError("STEP_UP_REQUIRED: raw string")).toBe(true);
    expect(isStepUpError(null)).toBe(false);
    expect(isStepUpError(undefined)).toBe(false);
    expect(isStepUpError({})).toBe(false);
  });
});
