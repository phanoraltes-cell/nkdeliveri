/**
 * NKD-011/012: getOrCreateIdempotencyKey must return the SAME key across
 * repeated calls — this is exactly what makes checkout.tsx's automatic
 * network-retry safe (the retried request carries the identical key
 * create_order_secure already saw, so a duplicate response never produces
 * a duplicate order) — and clearIdempotencyKey must force a genuinely new
 * one afterward, only once an order actually succeeds.
 *
 * This project's vitest environment is "node" (vitest.config.ts) — no real
 * window/localStorage — so `window`/`localStorage` are stubbed here with a
 * minimal in-memory fake, same `vi.stubGlobal` convention as
 * push-dispatch.server.test.ts, rather than pulling in a DOM environment
 * dependency for one small module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrCreateIdempotencyKey, clearIdempotencyKey } from "../checkout-idempotency";

function fakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

describe("checkout idempotency key (NKD-011/012): a retry reuses the same key", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("localStorage", fakeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the same key across repeated calls — a network retry gets the identical key, not a fresh one", () => {
    const first = getOrCreateIdempotencyKey();
    const second = getOrCreateIdempotencyKey();
    const third = getOrCreateIdempotencyKey();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("clearIdempotencyKey forces a genuinely new key on the next call — only a completed order should trigger this", () => {
    const first = getOrCreateIdempotencyKey();
    clearIdempotencyKey();
    const second = getOrCreateIdempotencyKey();
    expect(second).not.toBe(first);
  });

  it("a business-error retry (no clear call) keeps reusing the same key", () => {
    const first = getOrCreateIdempotencyKey();
    // Simulates checkout.tsx's catch branch for a business error: no
    // clearIdempotencyKey() call happens there on purpose (NKD-011 — the
    // failed attempt never committed server-side, so the same key is safe
    // and correct to reuse on the customer's next try).
    const retryAfterBusinessError = getOrCreateIdempotencyKey();
    expect(retryAfterBusinessError).toBe(first);
  });
});
