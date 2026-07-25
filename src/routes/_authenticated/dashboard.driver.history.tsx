import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Package, CheckCircle2 } from "lucide-react";
import { sendOrderDeliveredPush } from "@/lib/send-order-push.functions";
import { DELIVERY_STATUS_LABEL as STATUS_LABEL } from "@/lib/delivery-status";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { inputClsCompact } from "@/lib/utils";

// Role guard lives on the parent layout (dashboard.driver.tsx) — this used
// to repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/driver/history")({
  component: DriverHistory,
});

function DriverHistory() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: driver } = useQuery({
    queryKey: ["me-driver", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
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
          "id, order_id, status, assigned_at, picked_up_at, delivered_at, fee, orders(order_number, total, delivery_address, delivery_notes, contact_phone, restaurants(name, address, phone), order_items(id, quantity))",
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
          "id, order_id, status, assigned_at, picked_up_at, delivered_at, fee, orders(order_number, total, delivery_address, restaurants(name), payments(method, cash_confirmation_status, driver_confirmed_at))",
        )
        .eq("driver_id", driver!.id)
        .eq("status", "delivered")
        .order("delivered_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const [reportingOrderId, setReportingOrderId] = useState<string | null>(null);
  const [reportDescription, setReportDescription] = useState("");

  // Phase 4 of the admin evolution plan: cash orders need the driver's
  // side of the double confirmation too — reuses the same 2 RPCs the
  // customer's order-tracking page calls (confirm_cash_payment_secure
  // auto-detects the caller is the driver here, dispute_cash_payment_secure
  // reuses the existing dispute system). Never touches
  // trg_generate_commission_on_delivery — the commission already credited
  // when "Livre" was tapped above, this only reconciles the cash itself.
  const confirmCash = useMutation({
    mutationFn: async (orderId: string) => {
      const { error } = await supabase.rpc("confirm_cash_payment_secure", { _order_id: orderId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Konfimasyon anrejistre");
      qc.invalidateQueries({ queryKey: ["me-delivery-history"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const disputeCash = useMutation({
    mutationFn: async (orderId: string) => {
      if (reportDescription.trim().length < 5) {
        throw new Error("Tanpri eksplike pwoblèm nan pi plis");
      }
      const { error } = await supabase.rpc("dispute_cash_payment_secure", {
        _order_id: orderId,
        _description: reportDescription.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pwoblèm siyale");
      setReportingOrderId(null);
      setReportDescription("");
      qc.invalidateQueries({ queryKey: ["me-delivery-history"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const advance = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      orderId: string;
      status: "picked_up" | "delivered";
    }) => {
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
        <Link to="/dashboard/driver" className="text-sm font-bold text-brand-deep hover:underline">
          ← Dashboard
        </Link>
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          Aktyèl {active.data?.length ? `(${active.data.length})` : ""}
        </h2>
        {active.isLoading && <Skeleton className="h-24 w-full rounded-2xl" />}
        {!active.isLoading && (active.data?.length ?? 0) === 0 && (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
            Ou pa gen okenn livrezon an kou pou kounye a.
          </div>
        )}
        <div className="space-y-3">
          {active.data?.map((d) => {
            const itemCount = d.orders?.order_items?.reduce((s, it) => s + it.quantity, 0) ?? 0;
            return (
              <div
                key={d.id}
                className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-display text-lg font-extrabold">
                      {d.orders?.order_number}
                    </div>
                    <div className="text-xs text-ink-soft">
                      {d.orders?.restaurants?.name} · {d.orders?.delivery_address}
                      {d.orders?.restaurants?.phone && (
                        <>
                          {" · "}
                          <a
                            href={`tel:${d.orders.restaurants.phone}`}
                            className="font-bold text-brand-deep"
                          >
                            {d.orders.restaurants.phone}
                          </a>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-ink-soft">
                      {itemCount} atik
                      {d.orders?.contact_phone && (
                        <>
                          {" · "}
                          <a
                            href={`tel:${d.orders.contact_phone}`}
                            className="font-bold text-brand-deep"
                          >
                            {d.orders.contact_phone}
                          </a>
                        </>
                      )}
                    </div>
                    {d.orders?.delivery_notes && (
                      <div className="text-xs italic text-ink-soft">
                        Nòt: {d.orders.delivery_notes}
                      </div>
                    )}
                    <span className="mt-1 inline-block rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-deep">
                      {STATUS_LABEL[d.status] || d.status}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="font-display font-extrabold text-brand-deep">
                      {formatHTG(Number(d.orders?.total ?? 0))}
                    </span>
                    {(d.status === "assigned" || d.status === "en_route_pickup") && (
                      <Button
                        size="sm"
                        disabled={advance.isPending}
                        onClick={() =>
                          advance.mutate({ id: d.id, orderId: d.order_id, status: "picked_up" })
                        }
                      >
                        <Package className="h-3.5 w-3.5" /> Pikap fèt
                      </Button>
                    )}
                    {(d.status === "picked_up" || d.status === "en_route_dropoff") && (
                      <button
                        disabled={advance.isPending}
                        onClick={() =>
                          advance.mutate({ id: d.id, orderId: d.order_id, status: "delivered" })
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Livre
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">Istwa</h2>
        {history.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
        )}
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
                  <th className="px-3 py-2">Peman kach</th>
                </tr>
              </thead>
              <tbody>
                {history.data?.map((d) => {
                  const payment = d.orders?.payments?.[0];
                  const isCash = payment?.method === "kach";
                  return (
                    <tr key={d.id} className="border-t border-brand-soft/30">
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft">
                        {d.delivered_at ? new Date(d.delivered_at).toLocaleString("fr-HT") : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-bold">
                        {d.orders?.order_number}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{d.orders?.restaurants?.name}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold text-brand-deep">
                        {formatHTG(Number(d.fee))}
                      </td>
                      <td className="px-3 py-2">
                        {!isCash ? (
                          <span className="text-xs text-ink-soft">—</span>
                        ) : payment.cash_confirmation_status === "validated" ? (
                          <StatusBadge tone="good">Konfime</StatusBadge>
                        ) : payment.cash_confirmation_status === "disputed" ? (
                          <StatusBadge tone="bad">An litij</StatusBadge>
                        ) : payment.driver_confirmed_at ? (
                          <span className="text-xs text-emerald-700">
                            ✓ Ou konfime, ap tann kliyan an
                          </span>
                        ) : reportingOrderId === d.order_id ? (
                          <div className="min-w-[220px] space-y-2">
                            <textarea
                              value={reportDescription}
                              onChange={(e) => setReportDescription(e.target.value)}
                              placeholder="Eksplike pwoblèm nan…"
                              aria-label="Eksplike pwoblèm nan…"
                              rows={2}
                              className={inputClsCompact()}
                            />
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setReportingOrderId(null)}
                              >
                                Anile
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={
                                  disputeCash.isPending || reportDescription.trim().length < 5
                                }
                                onClick={() => disputeCash.mutate(d.order_id)}
                              >
                                {disputeCash.isPending ? "Ap voye…" : "Konfime pwoblèm"}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              disabled={confirmCash.isPending}
                              onClick={() => confirmCash.mutate(d.order_id)}
                            >
                              ✓ Mwen resevwa l
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setReportingOrderId(d.order_id)}
                            >
                              Sa a pa kòrèk
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
