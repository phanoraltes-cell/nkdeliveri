/**
 * Unit tests for translateAuthError()'s fallback handling
 * (docs/archive/audits/REGISTRATION_AUTH_REMEDIATION_REPORT.md, Phase 11) — the rule this
 * enforces is that a user must never see a raw `{}`, `[object Object]`,
 * `null`, `undefined`, or empty string as their error message, while every
 * already-translated case keeps working exactly as before.
 */
import { describe, expect, it } from "vitest";
import { translateAuthError, isEmailNotConfirmedError } from "../auth-errors";

const GENERIC_FALLBACK = "Nou pa kapab trete demann lan kounye a. Tanpri eseye ankò pita.";

/** Minimal stand-in for @supabase/auth-js's AuthRetryableFetchError shape. */
class FakeAuthRetryableFetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthRetryableFetchError";
    this.status = status;
  }
}

/** Minimal stand-in for @supabase/auth-js's AuthApiError shape. */
class FakeAuthApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

describe("translateAuthError: known errors keep their existing specific translation", () => {
  it("code-based match (invalid_credentials)", () => {
    const err = new FakeAuthApiError("Invalid login credentials", 400, "invalid_credentials");
    expect(translateAuthError(err)).toBe("Imèl la oswa modpas la pa kòrèk.");
  });

  it("code-based match (email_not_confirmed)", () => {
    const err = new FakeAuthApiError("Email not confirmed", 400, "email_not_confirmed");
    expect(translateAuthError(err)).toBe(
      "Ou poko konfime imèl ou. Verifye bwat imèl ou (ak spam), oswa mande yon nouvo imèl konfimasyon.",
    );
  });

  it("substring fallback match (no code, raw English text)", () => {
    const err = new Error("User already registered");
    expect(translateAuthError(err)).toBe(
      "Yon kont deja egziste ak imèl sa a. Eseye konekte oswa reyinisyalize modpas ou.",
    );
  });

  it("a genuinely exploitable but untranslated message is preserved, not replaced by the generic fallback", () => {
    const err = new Error("Password should contain at least one number");
    expect(translateAuthError(err)).toBe("Password should contain at least one number");
  });
});

describe("translateAuthError: infra/network 5xx errors never leak {} or raw JSON", () => {
  it("real root-cause shape: AuthRetryableFetchError with message '{}' (docs/archive/audits/REGISTRATION_DRIVER_RESTAURANT_AUDIT.md)", () => {
    const err = new FakeAuthRetryableFetchError("{}", 500);
    expect(translateAuthError(err)).toBe(GENERIC_FALLBACK);
  });

  it("HTTP 500 status alone (no recognizable name) still maps to a readable message", () => {
    const err = { status: 500, message: "{}" };
    expect(translateAuthError(err)).toBe(GENERIC_FALLBACK);
  });

  it("other retryable statuses (502, 503, Cloudflare 520-530) also fall back cleanly", () => {
    expect(translateAuthError({ status: 502, message: "{}" })).toBe(GENERIC_FALLBACK);
    expect(translateAuthError({ status: 503, message: "{}" })).toBe(GENERIC_FALLBACK);
    expect(translateAuthError({ status: 524, message: "{}" })).toBe(GENERIC_FALLBACK);
  });

  it("a genuine 4xx AuthApiError is NOT treated as a retryable infra error", () => {
    const err = new FakeAuthApiError("Some unmapped 4xx message", 422);
    expect(translateAuthError(err)).toBe("Some unmapped 4xx message");
  });
});

describe("translateAuthError: unexploitable messages always fall back to a generic, readable message", () => {
  it("plain empty object (not an Error instance)", () => {
    expect(translateAuthError({})).toBe(GENERIC_FALLBACK);
  });

  it("null", () => {
    expect(translateAuthError(null)).toBe(GENERIC_FALLBACK);
  });

  it("undefined", () => {
    expect(translateAuthError(undefined)).toBe(GENERIC_FALLBACK);
  });

  it("a bare non-Error object stringifies to '[object Object]'", () => {
    expect(translateAuthError({ foo: "bar" })).toBe(GENERIC_FALLBACK);
  });

  it("empty string", () => {
    expect(translateAuthError("")).toBe(GENERIC_FALLBACK);
  });

  it("whitespace-only message", () => {
    expect(translateAuthError(new Error("   "))).toBe(GENERIC_FALLBACK);
  });

  it("never returns the literal string '{}'  to the caller under any input", () => {
    const inputs: unknown[] = [
      new FakeAuthRetryableFetchError("{}", 500),
      {},
      null,
      undefined,
      { status: 500 },
      new Error("{}"),
    ];
    for (const input of inputs) {
      expect(translateAuthError(input)).not.toBe("{}");
    }
  });
});

describe("isEmailNotConfirmedError: unaffected by this change (non-regression)", () => {
  it("still detects the code-based case", () => {
    expect(isEmailNotConfirmedError(new FakeAuthApiError("x", 400, "email_not_confirmed"))).toBe(
      true,
    );
  });

  it("still returns false for an unrelated error", () => {
    expect(isEmailNotConfirmedError(new Error("Invalid login credentials"))).toBe(false);
  });
});
