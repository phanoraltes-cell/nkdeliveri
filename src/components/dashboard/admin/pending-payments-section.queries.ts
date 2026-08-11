import { supabase } from "@/integrations/supabase/client";

/**
 * Data-fetch for the admin manual MonCash/NatCash payment review queue —
 * split out of pending-payments-section.tsx into its own file
 * (react-refresh/only-export-components cleanup, remediation 07) so that
 * component file only exports the component. No behavior change.
 */
export async function fetchPendingPayments() {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, method, status, amount, currency, created_at, transaction_ref, sender_phone, order_id, orders(order_number, total, customer_id, restaurants(name)), payment_proofs(id, file_url, transaction_ref, sender_phone, notes, created_at)",
    )
    .in("method", ["moncash", "natcash"])
    .in("status", ["awaiting_proof", "under_review"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export type PendingPayment = NonNullable<Awaited<ReturnType<typeof fetchPendingPayments>>>[number];
