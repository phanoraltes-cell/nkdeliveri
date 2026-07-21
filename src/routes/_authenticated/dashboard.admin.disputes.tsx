import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { DisputeThread } from "@/components/disputes/dispute-thread";
import { sendDisputeUpdatePush } from "@/lib/send-dispute-push.functions";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DISPUTE_STATUS_LABEL as STATUS_LABEL,
  DISPUTE_STATUS_TONE as STATUS_TONE,
} from "@/lib/dispute-status";

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/disputes")({
  component: AdminDisputes,
});

async function fetchDisputes() {
  const { data, error } = await supabase
    .from("disputes")
    .select("id, category, status, resolution, created_at, orders(order_number), restaurants(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data;
}

function AdminDisputes() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "all">("open");
  const sendPush = useServerFn(sendDisputeUpdatePush);

  const disputes = useQuery({ queryKey: ["admin-disputes"], queryFn: fetchDisputes });

  const resolve = useMutation({
    mutationFn: async ({ id, resolution }: { id: string; resolution: string }) => {
      const { error } = await supabase.rpc("resolve_dispute_secure", {
        _dispute_id: id,
        _resolution: resolution,
      });
      if (error) throw error;
      try {
        await sendPush({ data: { disputeId: id } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: () => {
      toast.success("Litij rezoud");
      qc.invalidateQueries({ queryKey: ["admin-disputes"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const visible = (disputes.data ?? []).filter((d) => tab === "all" || d.status === "open");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Litij</h1>
          <p className="mt-1 text-ink-soft">Achitre pwoblèm ant kliyan, restoran ak livrè.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-brand-soft/60">
        <button
          onClick={() => setTab("open")}
          className={`px-4 py-2 text-sm font-bold ${tab === "open" ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"}`}
        >
          Louvri{" "}
          {disputes.data?.filter((d) => d.status === "open").length
            ? `(${disputes.data.filter((d) => d.status === "open").length})`
            : ""}
        </button>
        <button
          onClick={() => setTab("all")}
          className={`px-4 py-2 text-sm font-bold ${tab === "all" ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"}`}
        >
          Tout istorik
        </button>
      </div>

      {disputes.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      )}
      {!disputes.isLoading && visible.length === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen litij pou kounye a.
        </div>
      )}

      <div className="space-y-3">
        {visible.map((d) => {
          const isOpen = openId === d.id;
          return (
            <div
              key={d.id}
              className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
            >
              <button
                onClick={() => setOpenId(isOpen ? null : d.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
              >
                <div>
                  <div className="font-display text-base font-extrabold">
                    {d.orders?.order_number}
                    <span className="ml-2">
                      <StatusBadge tone={STATUS_TONE[d.status]}>
                        {STATUS_LABEL[d.status] ?? d.status}
                      </StatusBadge>
                    </span>
                  </div>
                  <div className="text-xs text-ink-soft">
                    {d.restaurants?.name} · {d.category} ·{" "}
                    {new Date(d.created_at).toLocaleString("fr-HT")}
                  </div>
                </div>
                <span className="text-xs font-bold text-brand-deep">
                  {isOpen ? "Fèmen" : "Wè detay"}
                </span>
              </button>
              {isOpen && (
                <DisputeThread
                  disputeId={d.id}
                  status={d.status}
                  resolution={d.resolution}
                  canResolve
                  isResolving={resolve.isPending}
                  onResolve={(resolution) => resolve.mutate({ id: d.id, resolution })}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
