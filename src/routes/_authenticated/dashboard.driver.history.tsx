import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Package, CheckCircle2 } from "lucide-react";
import { sendOrderDeliveredPush } from "@/lib/send-order-push.functions";

export const Route = createFileRoute("/_authenticated/dashboard/driver/history")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "driver" && role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: DriverHistory,
});

const STATUS_LABEL: Record<string, string> = {
  assigned: "Asiyen",
  en_route_pickup: "Nan wout pou pran l",
  picked_up: "Pran nan men restoran",
  en_route_dropoff: "Nan wout pou livre",
  delivered: "Livre",
  cancelled: "Anile",
};

function DriverHistory() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: driver } = useQuery({
    queryKey: ["me-driver", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("drivers").select("id").eq("user_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const sendDeliveredPush = useServerFn(sendOrderDeliveredPush);

  const active = useQuery({
    queryKey: ["me-active-deliveries", driver?.id],
    enabled: !!driver?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deliveries")
        .select(
          "id, order_id, status, assigned_at, picked_up_at, delivered_at, fee, orders(order_number, total, delivery_address, restaurants(name))"
        )
        .eq("driver_id", driver!.id)
        .in("status", ["assigned", "en_route_pickup", "picked_up", "en_route_dropoff"])
        .order("assigned_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const history = useQuery({
    queryKey: ["me-delivery-history", driver?.id],
    enabled: !!driver?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deliveries")
        .select(
          "id, order_id, status, assigned_at, picked_up_at, delivered_at, fee, orders(order_number, total, delivery_address, restaurants(name))"
        )
        .eq("driver_id", driver!.id)
        .eq("status", "delivered")
        .order("delivered_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const advance = useMutation({
    mutationFn: async ({ id, status }: { id: string; orderId: string; status: "picked_up" | "delivered" }) => {
      const { error } = await supabase.from("deliveries").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      toast.success("Estati livrezon mizajou");
      qc.invalidateQueries({ queryKey: ["me-active-deliveries"] });
      qc.invalidateQueries({ queryKey: ["me-delivery-history"] });
      if (vars.status === "delivered") {
        sendDeliveredPush({ data: { orderId: vars.orderId } }).catch((e) =>
          console.warn("[push] delivered notify failed", e),
        );
      }
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Livrezon mwen yo</h1>
          <p className="mt-1 text-ink-soft">Aktyèl ak istwa livrezon ou fè yo.</p>
        </div>
        <Link to="/dashboard/driver" className="text-sm font-bold text-brand-deep hover:underline">← Dashboard</Link>
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          Aktyèl {active.data?.length ? `(${active.data.length})` : ""}
        </h2>
        {active.isLoading && <div className="text-ink-soft">Chajman…</div>}
        {!active.isLoading && (active.data?.length ?? 0) === 0 && (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
            Ou pa gen okenn livrezon an kou pou kounye a.
          </div>
        )}
        <div className="space-y-3">
          {active.data?.map((d) => (
            <div key={d.id} className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-display text-lg font-extrabold">{d.orders?.order_number}</div>
                  <div className="text-xs text-ink-soft">
                    {d.orders?.restaurants?.name} · {d.orders?.delivery_address}
                  </div>
                  <span className="mt-1 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-deep">
                    {STATUS_LABEL[d.status] || d.status}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="font-display font-extrabold text-brand-deep">{formatHTG(Number(d.orders?.total ?? 0))}</span>
                  {(d.status === "assigned" || d.status === "en_route_pickup") && (
                    <button
                      disabled={advance.isPending}
                      onClick={() => advance.mutate({ id: d.id, orderId: d.order_id, status: "picked_up" })}
                      className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-2.5 text-xs font-bold text-white hover:bg-brand-deep disabled:opacity-50"
                    >
                      <Package className="h-3.5 w-3.5" /> Pikap fèt
                    </button>
                  )}
                  {(d.status === "picked_up" || d.status === "en_route_dropoff") && (
                    <button
                      disabled={advance.isPending}
                      onClick={() => advance.mutate({ id: d.id, orderId: d.order_id, status: "delivered" })}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Livre
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">Istwa</h2>
        {history.isLoading && <div className="text-ink-soft">Chajman…</div>}
        {!history.isLoading && (history.data?.length ?? 0) === 0 && (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
            Ou poko livre okenn kòmand.
          </div>
        )}
        <div className="rounded-2xl border border-brand-soft/60 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-soft/30 text-left text-xs uppercase text-ink-soft">
                <tr>
                  <th className="px-3 py-2">Dat</th>
                  <th className="px-3 py-2">Kòmand</th>
                  <th className="px-3 py-2">Restoran</th>
                  <th className="px-3 py-2 text-right">Frè livrezon</th>
                </tr>
              </thead>
              <tbody>
                {history.data?.map((d) => (
                  <tr key={d.id} className="border-t border-brand-soft/30">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft">
                      {d.delivered_at ? new Date(d.delivered_at).toLocaleString("fr-HT") : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-bold">{d.orders?.order_number}</td>
                    <td className="whitespace-nowrap px-3 py-2">{d.orders?.restaurants?.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-bold text-brand-deep">{formatHTG(Number(d.fee))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
