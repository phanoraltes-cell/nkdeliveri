import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { formatHTG } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";
import { Check, X, ChevronRight } from "lucide-react";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";

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
  const [filter, setFilter] = useState<"all" | "pending">("all");

  const { data: restaurant } = useMyRestaurant(user?.id);

  const orders = useQuery({
    queryKey: ["restaurant-orders", restaurant?.id, filter],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select(
          "id, order_number, status, total, subtotal, delivery_fee, delivery_address, contact_phone, delivery_notes, created_at, order_items(id, product_name, quantity, unit_price), payments(status, method)",
        )
        .eq("restaurant_id", restaurant!.id)
        .order("created_at", { ascending: false });
      if (filter === "pending") q = q.eq("status", "pending");
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const changeStatus = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const { error } = await supabase.rpc("update_order_status_secure", {
        _order_id: orderId,
        _new_status: status as Database["public"]["Enums"]["order_status"],
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Estati kòmand mizajou");
      qc.invalidateQueries({ queryKey: ["restaurant-orders"] });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  const pendingCount = orders.data?.filter((o) => o.status === "pending").length ?? 0;

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

      <div className="flex gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full px-4 py-2.5 text-sm font-bold ${filter === "all" ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
        >
          Tout
        </button>
        <button
          onClick={() => setFilter("pending")}
          className={`rounded-full px-4 py-2.5 text-sm font-bold ${filter === "pending" ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
        >
          An atant {pendingCount > 0 ? `(${pendingCount})` : ""}
        </button>
      </div>

      {orders.isLoading && <div className="text-ink-soft">Chajman…</div>}
      {!orders.isLoading && (orders.data?.length ?? 0) === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen kòmand pou filtè sa a.
        </div>
      )}

      <div className="space-y-3">
        {orders.data?.map((o) => (
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
              <div className="text-right font-display text-xl font-extrabold text-brand-deep">
                {formatHTG(Number(o.total))}
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
                      confirm(`Refize kòmand ${o.order_number}?`) &&
                      changeStatus.mutate({ orderId: o.id, status: "cancelled" })
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
                      confirm(`Anile kòmand ${o.order_number}?`) &&
                      changeStatus.mutate({ orderId: o.id, status: "cancelled" })
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
    </div>
  );
}
