import { supabase } from "@/integrations/supabase/client";

/**
 * Data-fetch for the admin dashboard's reviewed MonCash/NatCash payout
 * history — split out of payout-history.tsx into its own file
 * (react-refresh/only-export-components cleanup, remediation 07) so that
 * component file only exports the component. No behavior change.
 */
export async function fetchPayoutHistory() {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, method, status, amount, currency, created_at, reviewed_at, review_notes, transaction_ref, sender_phone, receiver_type, receiver_account_name, receiver_number, order_id, orders(order_number, total, subtotal, delivery_fee, status, created_at, customer_id, delivery_address, restaurants(name, phone), order_items(id, quantity, unit_price, product_name)), payment_proofs(id, file_url, transaction_ref, sender_phone, notes, created_at)",
    )
    .in("method", ["moncash", "natcash"])
    .in("status", ["paid", "failed"])
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw error;
  return data;
}

export type PayoutHistoryRow = NonNullable<Awaited<ReturnType<typeof fetchPayoutHistory>>>[number];
