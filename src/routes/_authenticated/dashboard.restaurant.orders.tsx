import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatHTG } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";
import { Check, X, ChevronRight, LayoutGrid, List, Printer, Eraser } from "lucide-react";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";
import { useHiddenHistory } from "@/hooks/useHiddenHistory";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { OrderKanbanBoard } from "@/components/dashboard/restaurant/order-kanban-board";
import { printKitchenTicket } from "@/lib/kitchen-ticket";
import { sendOrderStatusPush } from "@/lib/send-order-status-push.functions";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import {
  ORDER_STATUS_LABEL as STATUS_LABEL,
  TERMINAL_ORDER_STATUSES,
  getOrderWaitUrgency,
  formatOrderWaitTime,
  classifyUnconfirmedPayment,
} from "@/lib/order-status";
import { Chip } from "@/components/ui/chip";
import { paymentMethodLabel } from "@/lib/payment-provider-availability";

const PAGE_SIZE = 30;

// Role guard lives on the parent layout (dashboard.restaurant.tsx, same
// owner+staff+admin set) — this used to repeat the same check locally,
// which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/restaurant/orders")({
  component: RestaurantOrders,
});

// Forward moves a restaurant owner may trigger from the current status.
const NEXT_STATUS: Record<string, { to: string; label: string }[]> = {
  pending: [{ to: "confirmed", label: "Konfime" }],
  confirmed: [{ to: "preparing", label: "Kòmanse prepare" }],
  preparing: [{ to: "ready", label: "Mak kòm prè" }],
};

function RestaurantOrders() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  const { hiddenIds, hide } = useHiddenHistory("order");
  // P11 (F-03 remediation) — default view now depends on the viewport at
  // first render: a 7-column drag-and-drop board isn't the friendliest
  // touch interaction, so mobile opens on the already-existing "Lis" view
  // instead. Desktop keeps the previous "kanban" default unchanged. This
  // is a *default* only, not a lock — the toggle below still lets anyone
  // switch either way regardless of screen size, and nothing here changes
  // after mount (no matchMedia listener) so a manual choice is never
  // overridden by a later resize/devtools toggle.
  //
  // 768px matches Tailwind's own `md` breakpoint, the same one
  // DashboardSidebar already uses to switch from the mobile chrome to the
  // desktop one — not a new, one-off threshold.
  // `_authenticated/route.tsx` sets `ssr: false` on this whole route
  // family (same reason orders.$id.tsx gives for Leaflet: no SEO to lose,
  // gated behind a session check anyway), so `window` is always available
  // by the time this component's initializer runs — the `typeof window`
  // guard is defensive, not load-bearing.
  const [view, setView] = useState<"kanban" | "list">(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "list" : "kanban",
  );
  const [filter, setFilter] = useState<"all" | "pending">("all");
  const [page, setPage] = useState(1);

  const { data: restaurant } = useMyRestaurant(user?.id);

  // The Kanban board is a live operational snapshot, not a history browser —
  // it shows the 100 most recent orders across every status. Full history
  // with proper pagination stays in the "Lis" view below.
  const kanbanOrders = useQuery({
    queryKey: ["restaurant-orders-kanban", restaurant?.id],
    enabled: !!restaurant?.id && view === "kanban",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          // payment_transactions(status) — same F-03/F-01 signal as the
          // "Lis" view's own query above: without it, a moncash/natcash
          // payment still in the AUTOMATIC PLOP/Collect flow was
          // indistinguishable here from one waiting on manual admin
          // proof-review, so the Kanban "Konfime" button had no guard at
          // all (docs/archive/audits/FULL_PLATFORM_AUDIT_2026-08-13.md, F-01).
          "id, order_number, status, total, delivery_address, delivery_notes, contact_phone, subtotal, delivery_fee, created_at, order_items(id, product_name, quantity, notes), payments(status, method, payment_transactions(status))",
        )
        .eq("restaurant_id", restaurant!.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  // "An atant" (pending) is the actionable queue staff work off of, live —
  // it must never be silently truncated by pagination, but it's also
  // naturally bounded (a restaurant only has so many orders awaiting
  // confirmation at once). "Tout" (all) includes the restaurant's entire
  // order history and grows without bound, so only that view is paginated.
  const orders = useQuery({
    queryKey: ["restaurant-orders", restaurant?.id, filter, filter === "all" ? page : 0],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select(
          // payment_transactions(status) — the only reliable signal that a
          // moncash/natcash payment went through the AUTOMATIC PLOP/Collect
          // flow rather than the manual proof-upload flow (a row only ever
          // exists for the automatic flow, see create_collect_payment_secure's
          // own header comment). Needed below to stop conflating "automatic
          // payment still in flight" with "manual payment waiting on an
          // admin" — same signal already used correctly on orders.$id.tsx.
          "id, order_number, status, total, subtotal, delivery_fee, delivery_address, contact_phone, delivery_notes, created_at, order_items(id, product_name, quantity, unit_price, notes), payments(status, method, payment_transactions(status))",
          filter === "all" ? { count: "exact" } : undefined,
        )
        .eq("restaurant_id", restaurant!.id)
        .order("created_at", { ascending: false });
      if (filter === "pending") {
        q = q.eq("status", "pending");
      } else {
        const from = (page - 1) * PAGE_SIZE;
        q = q.range(from, from + PAGE_SIZE - 1);
      }
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: data, totalCount: count ?? 0 };
    },
  });

  // Independent of the (possibly paginated) list above, so the badge stays
  // accurate for the whole restaurant regardless of which page/filter the
  // list itself is showing.
  const pendingBadge = useQuery({
    queryKey: ["restaurant-orders-pending-count", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("restaurant_id", restaurant!.id)
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const sendStatusPush = useServerFn(sendOrderStatusPush);

  const changeStatus = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const { error } = await supabase.rpc("update_order_status_secure", {
        _order_id: orderId,
        _new_status: status as Database["public"]["Enums"]["order_status"],
      });
      if (error) throw error;
      try {
        await sendStatusPush({ data: { orderId } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: () => {
      toast.success("Estati kòmand mizajou");
      qc.invalidateQueries({ queryKey: ["restaurant-orders"] });
      qc.invalidateQueries({ queryKey: ["restaurant-orders-kanban"] });
      qc.invalidateQueries({ queryKey: ["restaurant-orders-pending-count"] });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  // Hiding never applies to the Kanban (a live operational board, not a
  // history browser — see the comment above kanbanOrders) or to the
  // "An atant" filter (an order can never be both pending and hidden, the
  // trigger only allows hiding terminal statuses) — but filtering rows
  // here unconditionally is harmless either way and keeps this one line
  // instead of branching on `filter`.
  const rows = (orders.data?.rows ?? []).filter((o) => !hiddenIds.has(o.id));
  const totalCount = orders.data?.totalCount ?? 0;
  const pendingCount = pendingBadge.data ?? 0;
  const hasHideable = filter === "all" && rows.some((o) => TERMINAL_ORDER_STATUSES.has(o.status));

  function updateFilter(f: "all" | "pending") {
    setFilter(f);
    setPage(1);
  }

  function hideOne(orderNumber: string, id: string) {
    requestConfirm(
      `Kache kòmand ${orderNumber} nan istorik ou? Sa a pa efase done platfòm nan, e sa ka irevèsib pou vi pèsonèl ou.`,
      () => hide.mutate([id], { onSuccess: () => toast.success("Kòmand kache") }),
    );
  }

  function hideAllVisible() {
    const ids = rows.filter((o) => TERMINAL_ORDER_STATUSES.has(o.status)).map((o) => o.id);
    requestConfirm(
      "Netwaye istorik kòmand ki afiche la yo? Sa a pa efase done platfòm nan, e sa ka irevèsib pou vi pèsonèl ou.",
      () => hide.mutate(ids, { onSuccess: () => toast.success("Istorik netwaye") }),
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Kòmand</h1>
          <p className="mt-1 text-ink-soft">Jere kòmand k ap antre yo an tan reyèl.</p>
        </div>
        <Link
          to="/dashboard/restaurant"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      {/* P11 — role="group" + aria-pressed expose the active view to
          assistive tech (the audit's own F-03 remediation brief calls this
          out explicitly: a toggle's active state must not be conveyed by
          color/shadow alone). */}
      <div
        role="group"
        aria-label="Chwazi fason pou wè kòmand yo"
        className="flex items-center gap-1 rounded-full bg-brand-soft/40 p-1"
      >
        <button
          onClick={() => setView("kanban")}
          aria-pressed={view === "kanban"}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${view === "kanban" ? "bg-white text-brand-deep shadow-sm" : "text-ink-soft"}`}
        >
          <LayoutGrid className="h-3.5 w-3.5" /> Kanban
        </button>
        <button
          onClick={() => setView("list")}
          aria-pressed={view === "list"}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${view === "list" ? "bg-white text-brand-deep shadow-sm" : "text-ink-soft"}`}
        >
          <List className="h-3.5 w-3.5" /> Lis
        </button>
      </div>

      {view === "kanban" && (
        <>
          {kanbanOrders.isLoading && <div className="text-ink-soft">Chajman…</div>}
          {!kanbanOrders.isLoading && (kanbanOrders.data?.length ?? 0) === 0 && (
            <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
              Pa gen kòmand pou kounye a.
            </div>
          )}
          {(kanbanOrders.data?.length ?? 0) > 0 && (
            <OrderKanbanBoard
              orders={kanbanOrders.data!}
              restaurantName={restaurant?.name ?? ""}
              onChangeStatus={(orderId, status) => changeStatus.mutate({ orderId, status })}
              isChangingStatus={changeStatus.isPending}
            />
          )}
        </>
      )}

      {view === "list" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Chip selected={filter === "all"} onClick={() => updateFilter("all")}>
                Tout
              </Chip>
              <Chip selected={filter === "pending"} onClick={() => updateFilter("pending")}>
                An atant {pendingCount > 0 ? `(${pendingCount})` : ""}
              </Chip>
            </div>
            {hasHideable && (
              <button
                onClick={hideAllVisible}
                className="inline-flex items-center gap-1.5 rounded-full border-2 border-brand-soft bg-white px-3 py-2 text-xs font-bold text-ink-soft hover:border-brand hover:text-brand-deep"
              >
                <Eraser className="h-3.5 w-3.5" /> Netwaye istorik
              </button>
            )}
          </div>

          {orders.isLoading && <div className="text-ink-soft">Chajman…</div>}
          {!orders.isLoading && rows.length === 0 && (
            <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
              Pa gen kòmand pou filtè sa a.
            </div>
          )}

          <div className="space-y-3">
            {rows.map((o) => {
              // P11 (F-03 remediation) — same "waiting too long" signal the
              // Kanban board's cards already show for pending orders,
              // shared via lib/order-status.ts so the "Lis" view (the
              // mobile default since P11) doesn't lose that critical
              // information just because it's a different presentation.
              const urgency = getOrderWaitUrgency(o.status, o.created_at);
              return (
                <div
                  key={o.id}
                  className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-display text-lg font-extrabold">
                        {o.order_number}
                        <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-deep">
                          {STATUS_LABEL[o.status] || o.status}
                        </span>
                        {urgency.isUrgent && (
                          <span className="ml-2 rounded-full bg-status-bad-soft px-2 py-0.5 text-xs font-bold text-status-bad">
                            {formatOrderWaitTime(urgency.minutesWaiting)} ap tann
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-soft">
                        {new Date(o.created_at).toLocaleString("fr-HT")} ·{" "}
                        {o.contact_phone ? (
                          <a href={`tel:${o.contact_phone}`} className="font-bold text-brand-deep">
                            {o.contact_phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </div>
                      <div className="mt-1 text-xs text-ink-soft">{o.delivery_address}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="font-display text-xl font-extrabold text-brand-deep">
                          {formatHTG(Number(o.total))}
                        </div>
                        <div className="text-[11px] text-ink-soft">
                          Su-total {formatHTG(Number(o.subtotal))} + Livrezon{" "}
                          {formatHTG(Number(o.delivery_fee))}
                        </div>
                        {o.payments?.[0]?.method && (
                          <div className="text-[11px] font-bold text-ink-soft">
                            {paymentMethodLabel(o.payments[0].method)}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          printKitchenTicket(
                            { ...o, order_items: o.order_items ?? [] },
                            restaurant?.name ?? "",
                          )
                        }
                        className="text-ink-soft hover:text-brand-deep"
                        aria-label="Enprime bon kizin"
                        title="Enprime bon kizin"
                      >
                        <Printer className="h-4 w-4" />
                      </button>
                      {TERMINAL_ORDER_STATUSES.has(o.status) && (
                        <button
                          onClick={() => hideOne(o.order_number, o.id)}
                          className="text-ink-soft hover:text-brand-deep"
                          aria-label="Kache kòmand sa a"
                          title="Kache kòmand sa a"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <ul className="mt-3 divide-y divide-brand-soft/30 rounded-lg border border-brand-soft/40 bg-cream/50 text-sm">
                    {o.order_items?.map((it) => (
                      <li key={it.id} className="px-3 py-1.5">
                        <div className="flex justify-between">
                          <span>
                            {it.quantity}× {it.product_name}
                          </span>
                          <span className="font-bold">
                            {formatHTG(Number(it.unit_price) * it.quantity)}
                          </span>
                        </div>
                        {it.notes && (
                          <div className="mt-0.5 text-xs italic text-brand-deep">↳ {it.notes}</div>
                        )}
                      </li>
                    ))}
                  </ul>

                  {o.delivery_notes && (
                    <div className="mt-2 text-xs italic text-ink-soft">Nòt: {o.delivery_notes}</div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {o.status === "pending" && (
                      <>
                        {(() => {
                          const payment = o.payments?.[0];
                          const unconfirmedPayment = classifyUnconfirmedPayment(payment);
                          return (
                            <button
                              disabled={changeStatus.isPending || !!unconfirmedPayment}
                              title={
                                unconfirmedPayment === "manual"
                                  ? "Tann yon admin konfime prèv peman an anvan w konfime kòmand la"
                                  : unconfirmedPayment === "automatic"
                                    ? "Peman otomatik la an tretman — n ap tann konfimasyon sistèm peman an, pa gen okenn aksyon admin ki nesesè"
                                    : undefined
                              }
                              onClick={() =>
                                changeStatus.mutate({ orderId: o.id, status: "confirmed" })
                              }
                              className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <Check className="h-3.5 w-3.5" />
                              {unconfirmedPayment === "manual"
                                ? "Tann verifikasyon peman"
                                : unconfirmedPayment === "automatic"
                                  ? "Peman ap tretman"
                                  : "Konfime"}
                            </button>
                          );
                        })()}
                        <button
                          disabled={changeStatus.isPending}
                          onClick={() =>
                            requestConfirm(`Refize kòmand ${o.order_number}?`, () =>
                              changeStatus.mutate({ orderId: o.id, status: "cancelled" }),
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          <X className="h-3.5 w-3.5" /> Refize
                        </button>
                      </>
                    )}
                    {NEXT_STATUS[o.status]?.map((n) => (
                      <button
                        key={n.to}
                        disabled={changeStatus.isPending}
                        onClick={() => changeStatus.mutate({ orderId: o.id, status: n.to })}
                        className="inline-flex items-center gap-1 rounded-full bg-brand-deep px-3 py-2.5 text-xs font-bold text-white hover:bg-brand-deep-hover disabled:opacity-50"
                      >
                        {n.label} <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    ))}
                    {o.status !== "pending" &&
                      o.status !== "cancelled" &&
                      o.status !== "delivered" &&
                      o.status !== "refunded" && (
                        <button
                          disabled={changeStatus.isPending}
                          onClick={() =>
                            requestConfirm(`Anile kòmand ${o.order_number}?`, () =>
                              changeStatus.mutate({ orderId: o.id, status: "cancelled" }),
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-full border-2 border-red-200 px-3 py-2.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          Anile kòmand
                        </button>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
          {filter === "all" && (
            <PaginationControls
              page={page}
              pageSize={PAGE_SIZE}
              totalCount={totalCount}
              onPageChange={setPage}
            />
          )}
        </>
      )}
      {ConfirmDialog}
    </div>
  );
}
