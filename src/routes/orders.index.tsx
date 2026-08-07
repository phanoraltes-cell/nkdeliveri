import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useHiddenHistory } from "@/hooks/useHiddenHistory";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, Eraser } from "lucide-react";
import { formatHTG } from "@/lib/format";
import { noIndexMeta } from "@/lib/seo";
import { ORDER_STATUS_LABEL as STATUS, TERMINAL_ORDER_STATUSES } from "@/lib/order-status";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge, type StatusTone } from "@/components/dashboard/status-badge";

// Refonte Frontend Premium, Phase 5 (P5) — same good/warn/bad/info tones
// OrderStatusTimeline already uses for these statuses (see
// order-status-timeline.tsx), reused here rather than re-derived so the
// two screens read as one consistent status language.
const ORDER_STATUS_TONE: Record<string, StatusTone> = {
  pending: "warn",
  confirmed: "info",
  preparing: "info",
  ready: "info",
  assigned: "info",
  picked_up: "info",
  delivered: "good",
  cancelled: "bad",
  refunded: "bad",
};

export const Route = createFileRoute("/orders/")({
  head: () => noIndexMeta("Kòmand mwen — NK Deliveri"),
  component: Orders,
});

const PAGE_SIZE = 20;

function Orders() {
  const { user, loading } = useAuth();
  const { hiddenIds, hide } = useHiddenHistory("order");
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["my-orders", user?.id, page],
    enabled: !!user,
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const { data, error, count } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, total, currency, created_at, restaurants(name), payments(status, method)",
          { count: "exact" },
        )
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data, totalCount: count ?? 0 };
    },
  });

  const visible = (data?.rows ?? []).filter((o) => !hiddenIds.has(o.id));
  const hasHideable = visible.some((o) => TERMINAL_ORDER_STATUSES.has(o.status));

  function hideOne(id: string) {
    requestConfirm(
      "Kache kòmand sa a nan istorik ou? Sa a pa efase done platfòm nan, e sa ka irevèsib pou vi pèsonèl ou.",
      () => hide.mutate([id], { onSuccess: () => toast.success("Kòmand kache") }),
    );
  }

  function hideAll() {
    const ids = visible.filter((o) => TERMINAL_ORDER_STATUSES.has(o.status)).map((o) => o.id);
    requestConfirm(
      "Netwaye tout istorik kòmand ou? Sa a pa efase done platfòm nan, e sa ka irevèsib pou vi pèsonèl ou.",
      () => hide.mutate(ids, { onSuccess: () => toast.success("Istorik netwaye") }),
    );
  }

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-[720px] px-5 py-12">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-display text-2xl font-extrabold">Kòmand mwen</h1>
          {hasHideable && (
            <button
              onClick={hideAll}
              className="inline-flex items-center gap-1.5 rounded-full border-2 border-brand-soft bg-white px-3 py-2 text-xs font-bold text-ink-soft hover:border-brand hover:text-brand-deep"
            >
              <Eraser className="h-3.5 w-3.5" /> Netwaye istorik mwen
            </button>
          )}
        </div>
        {loading || isLoading ? (
          <div className="rounded-[18px] bg-white p-8 text-center text-ink-soft">Chajman…</div>
        ) : !user ? (
          <div className="rounded-[18px] bg-white p-8 text-center text-ink-soft">
            <Link to="/auth" className="font-bold text-brand-deep">
              Konekte
            </Link>{" "}
            pou wè kòmand ou yo.
          </div>
        ) : visible.length === 0 && page === 1 ? (
          <div className="rounded-[18px] bg-white p-8 text-center text-ink-soft shadow-brand-sm">
            <p>Ou poko gen okenn kòmand.</p>
            <Link to="/" className="mt-3 inline-block font-bold text-brand-deep hover:underline">
              Kòmanse kòmande →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((o) => (
              <Link
                key={o.id}
                to="/orders/$id"
                params={{ id: o.id }}
                className="relative block rounded-2xl bg-white p-4 shadow-brand-xs hover:shadow-brand-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display text-base font-extrabold">{o.order_number}</div>
                    <div className="text-xs text-ink-soft">
                      {o.restaurants?.name} · {new Date(o.created_at).toLocaleString("fr-HT")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <div className="font-bold">{formatHTG(o.total)}</div>
                      <StatusBadge tone={ORDER_STATUS_TONE[o.status] ?? "neutral"} className="mt-1">
                        {STATUS[o.status] || o.status}
                      </StatusBadge>
                    </div>
                    {TERMINAL_ORDER_STATUSES.has(o.status) && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          hideOne(o.id);
                        }}
                        aria-label="Kache kòmand sa a"
                        title="Kache kòmand sa a"
                        className="shrink-0 rounded-full p-1.5 text-ink-soft hover:bg-brand-soft/40 hover:text-brand-deep"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
        {!!user && !isLoading && (
          <PaginationControls
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={data?.totalCount ?? 0}
            onPageChange={setPage}
            className="mt-5"
          />
        )}
      </main>
      <SiteFooter />
      {ConfirmDialog}
    </div>
  );
}
