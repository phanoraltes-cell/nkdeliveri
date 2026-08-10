// Canned RPC return shapes — separate from data.ts because RPC responses
// are frequently just an id/boolean/small object, not a full table row.

import { ORDER_ID } from "./data";

export const rpcResponses: Record<string, unknown> = {
  check_auth_rate_limit_secure: true,
  create_order_secure: ORDER_ID,
  claim_delivery_secure: { id: ORDER_ID },
  confirm_cash_payment_secure: { ok: true },
  dispute_cash_payment_secure: { ok: true },
  send_order_chat_message_secure: { ok: true },
  mark_order_chat_read_secure: { ok: true },
  push_customer_location_secure: { ok: true },
  stop_customer_location_sharing_secure: { ok: true },
  update_restaurant_payout_secure: { ok: true },
  update_driver_payout_secure: { ok: true },
  update_restaurant_status_secure: { ok: true },
  update_driver_status_secure: { ok: true },
  update_dispute_status_secure: { ok: true },
  resolve_dispute_secure: { ok: true },
  create_sponsored_placement_secure: { id: "60000000-0000-4000-8000-000000000099" },
  update_sponsored_placement_secure: { ok: true },
  delete_sponsored_placement_secure: { ok: true },
  initiate_payout_secure: { id: "70000000-0000-4000-8000-000000000001", status: "paid" },
  execute_commission_backfill_secure: {
    orders_scanned: 1,
    orders_migrated: 1,
    orders_already_migrated: 0,
    orders_skipped: 0,
    orders_failed: 0,
  },
};

/**
 * `update_order_status_secure` needs the response to reflect the
 * requested `_new_status` (the order-detail page re-renders based on the
 * returned row's status) — a function handler, not a static fixture. Kept
 * separate since it's the one RPC every role's Kanban/lifecycle spec
 * calls with a different target status.
 */
export function updateOrderStatusResponse(
  newStatus: string,
  orderOverrides: Record<string, unknown> = {},
) {
  return { id: ORDER_ID, status: newStatus, ...orderOverrides };
}
