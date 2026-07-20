import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { sendPaymentReviewPush } from "@/lib/send-push.functions";
import { toast } from "sonner";
import { useState } from "react";
import {
  PendingPaymentsSection,
  fetchPendingPayments,
} from "@/components/dashboard/admin/pending-payments-section";
import { PayoutHistory, fetchPayoutHistory } from "@/components/dashboard/admin/payout-history";

export const Route = createFileRoute("/_authenticated/dashboard/admin/payments")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AdminPayments,
});

function AdminPayments() {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [filter, setFilter] = useState<"all" | "moncash" | "natcash">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "failed">("all");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState<string>(monthAgo);
  const [toDate, setToDate] = useState<string>(today);
  const sendPush = useServerFn(sendPaymentReviewPush);

  const list = useQuery({
    queryKey: ["admin-manual-payments"],
    queryFn: fetchPendingPayments,
  });

  const history = useQuery({
    queryKey: ["admin-payout-history"],
    enabled: tab === "history",
    queryFn: fetchPayoutHistory,
  });

  const decide = useMutation({
    mutationFn: async ({
      id,
      decision,
      note,
    }: {
      id: string;
      decision: "paid" | "failed";
      note?: string;
    }) => {
      const { error } = await supabase.rpc("review_manual_payment_secure", {
        _payment_id: id,
        _decision: decision,
        _note: note || null,
      });
      if (error) throw error;
      // Fire-and-log web push to customer + merchant
      try {
        await sendPush({ data: { paymentId: id } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: (_d, v) => {
      toast.success(v.decision === "paid" ? "Peman apwouve, kòmand konfime" : "Peman rejte");
      qc.invalidateQueries({ queryKey: ["admin-manual-payments"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Peman manyèl</h1>
          <p className="mt-1 text-ink-soft">Valide prèv MonCash ak NatCash.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-brand-soft/60">
        <button
          onClick={() => setTab("pending")}
          className={`px-4 py-2 text-sm font-bold ${tab === "pending" ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"}`}
        >
          An atant {list.data?.length ? `(${list.data.length})` : ""}
        </button>
        <button
          onClick={() => setTab("history")}
          className={`px-4 py-2 text-sm font-bold ${tab === "history" ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"}`}
        >
          Payout history
        </button>
      </div>

      {tab === "pending" && (
        <PendingPaymentsSection
          payments={list.data}
          isLoading={list.isLoading}
          notes={notes}
          onNoteChange={(id, value) => setNotes((s) => ({ ...s, [id]: value }))}
          onDecide={(id, decision, note) => decide.mutate({ id, decision, note })}
          isDeciding={decide.isPending}
        />
      )}

      {tab === "history" && (
        <PayoutHistory
          data={history.data}
          loading={history.isLoading}
          filter={filter}
          setFilter={setFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          fromDate={fromDate}
          toDate={toDate}
          setFromDate={setFromDate}
          setToDate={setToDate}
        />
      )}
    </div>
  );
}
