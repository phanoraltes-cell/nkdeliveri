/**
 * NKD-011 — one idempotency key per checkout *attempt*, not per request.
 * Persisted in localStorage (same mechanism useCart.ts already uses for the
 * cart itself) specifically so it survives a page refresh or a manual
 * retry after a lost connection (Senaryo A) — a plain React state variable
 * would not. Cleared only once create_order_secure actually succeeds
 * (clearIdempotencyKey, called from checkout.tsx right after the RPC
 * returns an order id) — a business-error rejection (insufficient stock,
 * etc.) deliberately does NOT get a fresh key: that attempt never
 * committed server-side (the whole transaction rolled back, see
 * 20260818100000_nkd011_order_idempotency.sql's own header comment), so
 * reusing the same key on the customer's next try is both safe and
 * correct — it's still the same order attempt, not a new one.
 */
const KEY = "nk-checkout-idempotency-key-v1";

export function getOrCreateIdempotencyKey(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = localStorage.getItem(KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem(KEY, fresh);
  return fresh;
}

export function clearIdempotencyKey(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
