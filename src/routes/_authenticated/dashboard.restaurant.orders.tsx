import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatHTG } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";
import { Check, X, ChevronRight, LayoutGrid, List, Printer } from "lucide-react";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { OrderKanbanBoard } from "@/components/dashboard/restaurant/order-kanban-board";
import { printKitchenTicket } from "@/lib/kitchen-ticket";
import { sendOrderStatusPush } from "@/lib/send-order-status-push.functions";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

const PAGE_SIZE = 30;

export const Route = createFileRoute("/_authenticated/dashboard/restaurant/orders")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (
      role !== "restaurant_owner" &&
      role !== "restaurant_staff" &&
      role !== "admin" &&
      role !== "super_admin"
    ) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: RestaurantOrders,
});

const STATUS_LABEL: Record<string, string> = {
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
  const [view, setView] = useState<"kanban" | "list">("kanban");
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
          "id, order_number, status, total, delivery_address, delivery_notes, created_at, order_items(id, product_name, quantity, notes)",
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
          "id, order_number, status, total, subtotal, delivery_fee, delivery_address, contact_phone, delivery_notes, created_at, order_items(id, product_name, quantity, unit_price, notes), payments(status, method)",
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

  const rows = orders.data?.rows ?? [];
  const totalCount = orders.data?.totalCount ?? 0;
  const pendingCount = pendingBadge.data ?? 0;

  function updateFilter(f: "all" | "pending") {
    setFilter(f);
    setPage(1);
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

      <div className="flex items-center gap-1 rounded-full bg-brand-soft/40 p-1">
        <button
          onClick={() => setView("kanban")}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${view === "kanban" ? "bg-white text-brand-deep shadow-sm" : "text-ink-soft"}`}
        >
          <LayoutGrid className="h-3.5 w-3.5" /> Kanban
        </button>
        <button
          onClick={() => setView("list")}
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
          <div className="flex gap-2">
            <button
              onClick={() => updateFilter("all")}
              className={`rounded-full px-4 py-2.5 text-sm font-bold ${filter === "all" ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
            >
              Tout
            </button>
            <button
              onClick={() => updateFilter("pending")}
              className={`rounded-full px-4 py-2.5 text-sm font-bold ${filter === "pending" ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
            >
              An atant {pendingCount > 0 ? `(${pendingCount})` : ""}
            </button>
          </div>

          {orders.isLoading && <div className="text-ink-soft">Chajman…</div>}
          {!orders.isLoading && rows.length === 0 && (
            <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
              Pa gen kòmand pou filtè sa a.
            </div>
          )}

          <div className="space-y-3">
            {rows.map((o) => (
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
                    </div>
                    <div className="text-xs text-ink-soft">
                      {new Date(o.created_at).toLocaleString("fr-HT")} · {o.contact_phone}
                    </div>
                    <div className="mt-1 text-xs text-ink-soft">{o.delivery_address}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right font-display text-xl font-extrabold text-brand-deep">
                      {formatHTG(Number(o.total))}
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
                  </div>
                </div>

                <ul className="mt-3 divide-y divide-brand-soft/30 rounded-lg border border-brand-soft/40 bg-cream/50 text-sm">
                  {o.order_items?.map((it) => (
                    <li key={it.id} className="flex justify-between px-3 py-1.5">
                      <span>
                        {it.quantity}× {it.product_name}
                      </span>
                      <span className="font-bold">
                        {formatHTG(Number(it.unit_price) * it.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>

                {o.delivery_notes && (
                  <div className="mt-2 text-xs italic text-ink-soft">Nòt: {o.delivery_notes}</div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {o.status === "pending" && (
                    <>
                      <button
                        disabled={changeStatus.isPending}
                        onClick={() => changeStatus.mutate({ orderId: o.id, status: "confirmed" })}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" /> Konfime
                      </button>
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
                      className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-2.5 text-xs font-bold text-white hover:bg-brand-deep disabled:opacity-50"
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
            ))}
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
