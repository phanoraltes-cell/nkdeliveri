/**
 * Unit tests for translateSupabaseError() (NKD-003, Faz 1 architecture
 * audit — docs/GLOBAL_AUDIT... / this session's remediation prompt). The
 * rule this enforces: a user must never see a raw Postgres error message
 * (which can name real tables/columns/constraints) — except the one
 * deliberate exception, a custom RPC `RAISE EXCEPTION` (SQLSTATE "P0001"),
 * which this project already curates per-RPC in SQL
 * (docs/archive/phases/PHASE_1_REMEDIATION_REPORT.md, F-02) and which must keep reaching
 * the user unchanged.
 */
import { describe, expect, it } from "vitest";
import { translateSupabaseError, isNetworkError } from "../rpc-errors";

const GENERIC_FALLBACK = "Nou pa kapab trete demann lan kounye a. Tanpri eseye ankò pita.";

/** Minimal stand-in for a PostgrestError — a plain object, not an Error instance. */
function fakePostgrestError(code: string, message: string) {
  return { code, message, details: null, hint: null };
}

describe("translateSupabaseError: custom RPC RAISE EXCEPTION (P0001) passes through unchanged", () => {
  it("a curated Kreyòl business message from a _secure RPC is preserved", () => {
    const err = fakePostgrestError("P0001", "Kòmand sa a pa disponib ankò.");
    expect(translateSupabaseError(err)).toBe("Kòmand sa a pa disponib ankò.");
  });

  it("still works when the error is thrown as a real Error instance with a code property", () => {
    const err = Object.assign(new Error("Ou pa gen dwa fè aksyon sa a."), { code: "P0001" });
    expect(translateSupabaseError(err)).toBe("Ou pa gen dwa fè aksyon sa a.");
  });

  it("an empty P0001 message does NOT pass through — falls back instead of showing blank text", () => {
    const err = fakePostgrestError("P0001", "");
    expect(translateSupabaseError(err)).toBe(GENERIC_FALLBACK);
  });
});

describe("translateSupabaseError: known raw Postgres codes map to a safe, generic category message", () => {
  it("23505 unique_violation never leaks the constraint name", () => {
    const err = fakePostgrestError(
      "23505",
      'duplicate key value violates unique constraint "addresses_pkey"',
    );
    const result = translateSupabaseError(err);
    expect(result).toBe("Done sa a deja egziste.");
    expect(result).not.toContain("constraint");
    expect(result).not.toContain("addresses_pkey");
  });

  it("23503 foreign_key_violation never leaks the table/column name", () => {
    const err = fakePostgrestError(
      "23503",
      'insert or update on table "order_items" violates foreign key constraint "order_items_order_id_fkey"',
    );
    const result = translateSupabaseError(err);
    expect(result).toBe("Aksyon sa a pa posib paske li lye ak yon lòt enfòmasyon.");
    expect(result).not.toContain("order_items");
  });

  it("23502 not_null_violation", () => {
    expect(
      translateSupabaseError(fakePostgrestError("23502", 'null value in column "phone"')),
    ).toBe("Gen yon enfòmasyon obligatwa ki manke.");
  });

  it("23514 check_violation", () => {
    expect(
      translateSupabaseError(fakePostgrestError("23514", "new row violates check constraint")),
    ).toBe("Valè a pa valid.");
  });

  it("42501 insufficient_privilege (RLS/permission denial)", () => {
    expect(
      translateSupabaseError(fakePostgrestError("42501", "permission denied for table payments")),
    ).toBe("Ou pa gen otorizasyon pou fè aksyon sa a.");
    expect(translateSupabaseError(fakePostgrestError("42501", "x"))).not.toContain("payments");
  });
});

describe("translateSupabaseError: unknown/absent codes always fall back to the generic message — never the raw text", () => {
  it("unmapped Postgres code falls back generic, not the raw message", () => {
    const err = fakePostgrestError("55P03", "lock not available");
    expect(translateSupabaseError(err)).toBe(GENERIC_FALLBACK);
  });

  it("plain network Error with no code — unlike translateAuthError, this does NOT preserve the raw message", () => {
    const err = new Error("Failed to fetch");
    expect(translateSupabaseError(err)).toBe(GENERIC_FALLBACK);
  });

  it("plain object with no code and no message", () => {
    expect(translateSupabaseError({})).toBe(GENERIC_FALLBACK);
  });

  it("null", () => {
    expect(translateSupabaseError(null)).toBe(GENERIC_FALLBACK);
  });

  it("undefined", () => {
    expect(translateSupabaseError(undefined)).toBe(GENERIC_FALLBACK);
  });

  it("a bare string throw", () => {
    expect(translateSupabaseError("something went wrong")).toBe(GENERIC_FALLBACK);
  });
});

describe("isNetworkError (NKD-012): distinguishes a real connectivity failure from a normal Postgres/business error", () => {
  it("a bare fetch TypeError with no Postgres code is a network error", () => {
    const err = new TypeError("Failed to fetch");
    expect(isNetworkError(err)).toBe(true);
  });

  it("a real Postgres error (has a code) is NOT a network error, even as an Error instance", () => {
    const err = Object.assign(new Error("Kòmand sa a pa disponib ankò."), { code: "P0001" });
    expect(isNetworkError(err)).toBe(false);
  });

  it("a known Postgres SQLSTATE (e.g. 23505) is NOT a network error", () => {
    const err = Object.assign(new Error("duplicate key"), { code: "23505" });
    expect(isNetworkError(err)).toBe(false);
  });

  it("a PostgrestError-shaped plain object (not an Error instance) is NOT a network error", () => {
    expect(isNetworkError(fakePostgrestError("23514", "check violation"))).toBe(false);
  });

  it("a plain string throw is NOT a network error (not an Error instance)", () => {
    expect(isNetworkError("something went wrong")).toBe(false);
  });

  it("null/undefined are NOT network errors", () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});

describe("translateSupabaseError: regression proof — what the old toast.error(e.message) pattern would have shown", () => {
  it("demonstrates the exact leak this function closes", () => {
    const raw = fakePostgrestError(
      "23505",
      'duplicate key value violates unique constraint "reviews_order_id_key"',
    );
    // The vulnerable pattern still present at 70+ call sites (NKD-003
    // migration backlog) — this is literally `e.message`.
    const oldPatternWouldShow = raw.message;
    expect(oldPatternWouldShow).toContain("reviews_order_id_key");

    // The fixed pattern.
    const fixed = translateSupabaseError(raw);
    expect(fixed).not.toContain("reviews_order_id_key");
    expect(fixed).toBe("Done sa a deja egziste.");
  });
});
