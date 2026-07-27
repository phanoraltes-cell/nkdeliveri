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
