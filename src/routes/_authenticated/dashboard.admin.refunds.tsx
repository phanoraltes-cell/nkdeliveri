import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, PackageCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge";
import { sendRefundStatusPush } from "@/lib/send-refund-push.functions";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/dashboard/admin/refunds")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AdminRefunds,
});

const STATUS_LABEL: Record<string, string> = {
  requested: "An atant",
  approved: "Apwouve",
  rejected: "Rejte",
  completed: "Ranbouse",
};
const STATUS_TONE: Record<string, StatusTone> = {
  requested: "warn",
  approved: "good",
  rejected: "bad",
  completed: "neutral",
};

async function fetchRefunds() {
  const { data, error } = await supabase
    .from("refunds")
    .select(
      "id, amount, reason, status, admin_notes, created_at, reviewed_at, completed_at, orders(order_number), restaurants(name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data;
}

function AdminRefunds() {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"requested" | "all">("requested");

  const refunds = useQuery({ queryKey: ["admin-refunds"], queryFn: fetchRefunds });
  const sendPush = useServerFn(sendRefundStatusPush);

  const review = useMutation({
    mutationFn: async ({
      id,
      decision,
      adminNotes,
    }: {
      id: string;
      decision: "approved" | "rejected";
      adminNotes?: string;
    }) => {
      const { error } = await supabase.rpc("review_refund_secure", {
        _refund_id: id,
        _decision: decision,
        _admin_notes: adminNotes ?? "",
      });
      if (error) throw error;
      try {
        await sendPush({ data: { refundId: id } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: (_d, v) => {
      toast.success(v.decision === "approved" ? "Ranbousman apwouve" : "Ranbousman rejte");
      qc.invalidateQueries({ queryKey: ["admin-refunds"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("complete_refund_secure", { _refund_id: id });
      if (error) throw error;
      try {
        await sendPush({ data: { refundId: id } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: () => {
      toast.success("Ranbousman make trete");
      qc.invalidateQueries({ queryKey: ["admin-refunds"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const visible = (refunds.data ?? []).filter((r) => tab === "all" || r.status === "requested");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Ranbousman</h1>
          <p className="mt-1 text-ink-soft">Revize ak jere demann ranbousman kliyan yo.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-brand-soft/60">
        <button
          onClick={() => setTab("requested")}
          className={`px-4 py-2 text-sm font-bold ${tab === "requested" ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"}`}
        >
          An atant{" "}
          {refunds.data?.filter((r) => r.status === "requested").length
            ? `(${refunds.data.filter((r) => r.status === "requested").length})`
            : ""}
        </button>
        <button
          onClick={() => setTab("all")}
          className={`px-4 py-2 text-sm font-bold ${tab === "all" ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"}`}
        >
          Tout istorik
        </button>
      </div>

      {refunds.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      )}
      {!refunds.isLoading && visible.length === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen demann ranbousman pou kounye a.
        </div>
      )}

      <div className="space-y-4">
        {visible.map((r) => (
          <div
            key={r.id}
            className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-lg font-extrabold">
                  {r.orders?.order_number}
                  <span className="ml-2">
                    <StatusBadge tone={STATUS_TONE[r.status]}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </StatusBadge>
                  </span>
                </div>
                <div className="text-xs text-ink-soft">
                  {r.restaurants?.name} · {new Date(r.created_at).toLocaleString("fr-HT")}
                </div>
              </div>
              <div className="text-right font-display text-xl font-extrabold text-brand-deep">
                {formatHTG(Number(r.amount))}
              </div>
            </div>

            <div className="mt-2 text-sm">
              Rezon kliyan an: <b>{r.reason}</b>
            </div>
            {r.admin_notes && (
              <div className="mt-1 text-xs text-ink-soft">Nòt admin: {r.admin_notes}</div>
            )}

            {r.status === "requested" && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={notes[r.id] || ""}
                  onChange={(e) => setNotes((s) => ({ ...s, [r.id]: e.target.value }))}
                  placeholder="Nòt (opsyonèl)"
                  aria-label="Nòt (opsyonèl)"
                  className="min-w-0 flex-1 rounded-full border-2 border-brand-soft bg-white px-3 py-2.5 text-sm"
                />
                <button
                  disabled={review.isPending}
                  onClick={() =>
                    review.mutate({ id: r.id, decision: "approved", adminNotes: notes[r.id] })
                  }
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Apwouve
                </button>
                <button
                  disabled={review.isPending}
                  onClick={() =>
                    review.mutate({ id: r.id, decision: "rejected", adminNotes: notes[r.id] })
                  }
                  className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" /> Rejte
                </button>
              </div>
            )}

            {r.status === "approved" && (
              <div className="mt-3">
                <button
                  disabled={complete.isPending}
                  onClick={() => complete.mutate(r.id)}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-deep px-3 py-2.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                >
                  <PackageCheck className="h-3.5 w-3.5" />{" "}
                  {complete.isPending ? "Ap trete…" : "Make lajan an voye"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
