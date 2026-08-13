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
      "id, method, status, amount, currency, created_at, transaction_ref, sender_phone, order_id, orders(order_number, total, customer_id, restaurants(name)), payment_proofs(id, file_url, transaction_ref, sender_phone, notes, created_at), payment_transactions(status)",
    )
    .in("method", ["moncash", "natcash"])
    .in("status", ["awaiting_proof", "under_review"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  // A payment_transactions row only ever exists for the automatic
  // PLOP/Collect flow (create_collect_payment_secure) — filtered out here
  // rather than at the query level (PostgREST has no clean "no related
  // rows exist" filter on an embedded resource). This queue exists for
  // payments that genuinely need a human to review an uploaded proof; an
  // automatic payment momentarily sitting in awaiting_proof/under_review
  // while it waits on the provider's own webhook needs none of that, and
  // showing it here would read as "an admin must act" when nothing does.
  return (data ?? []).filter((p) => (p.payment_transactions?.length ?? 0) === 0);
}

export type PendingPayment = NonNullable<Awaited<ReturnType<typeof fetchPendingPayments>>>[number];
