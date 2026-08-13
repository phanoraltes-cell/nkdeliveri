/** Kreyòl label for each `orders.status` value — shared across every place an order's status is shown (order detail, customer/restaurant dashboards, order lists). */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "An atant peman",
  confirmed: "Konfime",
  preparing: "Ap prepare",
  ready: "Prè",
  assigned: "Livrè asiyen",
  picked_up: "An wout",
  delivered: "Livre",
  cancelled: "Anile",
  refunded: "Ranbouse",
};

/** Statuses the order-chat feature is open for (server-enforced identically in send_order_chat_message_secure) — read-only outside of these. */
export const CHAT_OPEN_STATUSES = new Set([
  "confirmed",
  "preparing",
  "ready",
  "assigned",
  "picked_up",
]);

/** Statuses the customer is still allowed to cancel from — before the restaurant starts preparing. */
export const CUSTOMER_CANCELLABLE_STATUSES = new Set(["pending", "confirmed"]);

/** Statuses eligible for personal history cleanup — server-enforced identically in the hidden_history_items validation trigger. */
export const TERMINAL_ORDER_STATUSES = new Set(["delivered", "cancelled", "refunded"]);

// P11 (F-03 remediation) — wait-time urgency, extracted from the Kanban
// board's card (order-kanban-board.tsx) so the "Lis" view — the mobile
// default since P11 — can show the exact same "waiting too long" signal
// instead of silently losing it. Threshold/format unchanged, just no
// longer duplicated between the two views.

/**
 * Only "pending" orders are flagged — that's the actionable queue staff
 * must clear fastest, same reasoning the Kanban board already used.
 * Threshold (10 min) matches the Refonte spec's Kanban wireframe.
 *
 * Return type is a discriminated union on `isUrgent` (rather than a plain
 * `{ isUrgent: boolean; minutesWaiting: number | null }`) so callers get
 * `minutesWaiting: number` for free inside an `if (isUrgent)`/`isUrgent &&`
 * check, without a manual non-null assertion at the call site.
 */
export function getOrderWaitUrgency(
  status: string,
  createdAt: string,
): { isUrgent: true; minutesWaiting: number } | { isUrgent: false; minutesWaiting: number | null } {
  if (status !== "pending") return { isUrgent: false, minutesWaiting: null };
  const minutesWaiting = Math.max(
    0,
    Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000),
  );
  if (minutesWaiting >= 10) return { isUrgent: true, minutesWaiting };
  return { isUrgent: false, minutesWaiting };
}

/** A raw minute count reads fine at realistic values but a stale/malformed `created_at` (or an order nobody ever touched) could show something like "315007 min ap tann" — collapses to hours/days once the number would stop being legible as minutes. */
export function formatOrderWaitTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} è`;
  return `${Math.floor(hours / 24)} jou`;
}

export type UnconfirmedOrderPayment = {
  status: string;
  method: string;
  payment_transactions?: { status: string }[] | null;
};

/**
 * A moncash/natcash payment not yet `paid` blocks restaurant order
 * confirmation for two completely different reasons that must never share
 * one message: MANUAL (client uploaded a proof, an admin has to verify it
 * — submit_payment_proof_secure) vs AUTOMATIC (PLOP/Collect, waiting on
 * the provider's own webhook — no proof, no admin involved at all).
 *
 * A `payment_transactions` row only ever exists for the automatic flow
 * (create_collect_payment_secure's own header comment,
 * 20260731130000_moncash_collect_payments.sql) — its presence/absence is
 * the reliable signal, the same one orders.$id.tsx already uses correctly
 * (`isCollect = Boolean(collectTransaction)`). Mirrors
 * private.update_order_status_secure's own classification
 * (20260813120000_fix_manual_vs_automatic_payment_classification.sql) so
 * the button's disabled/title state in dashboard.restaurant.orders.tsx
 * matches what the RPC will actually decide — not an approximation of it
 * that can drift, which is exactly the bug this replaced: the previous
 * version keyed off `payment.method` alone (the wallet name), which is
 * the same rail for both flows and proves nothing about which one a given
 * payment went through.
 */
export function classifyUnconfirmedPayment(
  payment: UnconfirmedOrderPayment | undefined,
): "manual" | "automatic" | null {
  if (!payment) return null;
  if (payment.method !== "moncash" && payment.method !== "natcash") return null;
  if (payment.status === "paid") return null;
  return (payment.payment_transactions?.length ?? 0) > 0 ? "automatic" : "manual";
}
