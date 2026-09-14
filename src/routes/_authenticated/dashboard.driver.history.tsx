import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Package, CheckCircle2, X, Eraser, AlertTriangle } from "lucide-react";
import { sendOrderDeliveredPush } from "@/lib/send-order-push.functions";
import { sendOrderStatusPush } from "@/lib/send-order-status-push.functions";
import { DELIVERY_STATUS_LABEL as STATUS_LABEL } from "@/lib/delivery-status";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { inputClsCompact } from "@/lib/utils";
import { useHiddenHistory } from "@/hooks/useHiddenHistory";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

// Role guard lives on the parent layout (dashboard.driver.tsx) — this used
// to repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/driver/history")({
  component: DriverHistory,
});

// NKD-016: must match the CHECK constraint on public.deliveries.failure_reason
// (supabase/migrations/20260817120000_nkd016_delivery_failed.sql) exactly.
const FAILURE_REASONS: { value: string; label: string }[] = [
  { value: "customer_unavailable", label: "Kliyan pa reponn" },
  { value: "address_not_found", label: "Pa jwenn adrès la" },
  { value: "zone_inaccessible", label: "Zòn nan pa aksesib" },
  { value: "other", label: "Lòt rezon" },
];

function DriverHistory() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const { hiddenIds, hide } = useHiddenHistory("order");
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

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
  const sendStatusPush = useServerFn(sendOrderStatusPush);

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

  const visibleHistory = (history.data ?? []).filter((d) => !hiddenIds.has(d.order_id));

  function hideOne(orderNumber: string, orderId: string) {
    requestConfirm(
      `Kache livrezon ${orderNumber} nan istorik ou? Sa a pa efase done platfòm nan, e sa ka irevèsib pou vi pèsonèl ou.`,
      () => hide.mutate([orderId], { onSuccess: () => toast.success("Livrezon kache") }),
    );
  }

  function hideAllVisible() {
    const ids = visibleHistory.map((d) => d.order_id);
    requestConfirm(
      "Netwaye tout istwa livrezon ou? Sa a pa efase done platfòm nan, e sa ka irevèsib pou vi pèsonèl ou.",
      () => hide.mutate(ids, { onSuccess: () => toast.success("Istwa netwaye") }),
    );
  }

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

  const [failingDeliveryId, setFailingDeliveryId] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState("");
  const [failureComment, setFailureComment] = useState("");

  function closeFailureForm() {
    setFailingDeliveryId(null);
    setFailureReason("");
    setFailureComment("");
  }

  // NKD-016: driver's "Can't deliver" button. Only valid from 'picked_up' —
  // public.report_delivery_failed_secure enforces the same rule server-side
  // (the RPC is the authority, this is just the earliest useful check).
  const reportFailed = useMutation({
    mutationFn: async ({ orderId, id }: { orderId: string; id: string }) => {
      const { error } = await supabase.rpc("report_delivery_failed_secure", {
        _order_id: orderId,
        _reason: failureReason,
        // `undefined`, pa `null`. Jeneratè tip Supabase la deklare paramèt
        // opsyonèl yo kòm `_comment?: string` (san `| null`) depi
        // rejenerasyon 14 septanm nan — anvan li te di `string | null`.
        // Yon `undefined` disparèt nan JSON.stringify, donk kle a pa voye
        // ditou epi SQL la aplike defo l.
        //
        // Konpòtman an IDANTIK: `_comment text DEFAULT NULL`, epi anndan
        // fonksyon an `v_comment := NULLIF(btrim(_comment), '')` — donk
        // NULL, chèn vid ak kle ki absan bay menm rezilta.
        _comment: failureComment.trim() || undefined,
      });
      if (error) throw error;
      return { orderId, id };
    },
    onSuccess: ({ orderId }) => {
      toast.success("Rapò a voye — kòmand lan make kòm livrezon echwe");
      closeFailureForm();
      qc.invalidateQueries({ queryKey: ["me-active-deliveries"] });
      qc.invalidateQueries({ queryKey: ["me-delivery-history"] });
      sendStatusPush({ data: { orderId } }).catch((e) =>
        console.warn("[push] delivery-failed notify failed", e),
      );
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
                    {d.status === "picked_up" && failingDeliveryId !== d.id && (
                      <button
                        disabled={advance.isPending}
                        onClick={() => setFailingDeliveryId(d.id)}
                        className="inline-flex items-center gap-1 rounded-full border-2 border-red-300 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" /> Pa ka livre
                      </button>
                    )}
                  </div>
                </div>
                {failingDeliveryId === d.id && (
                  <div className="mt-3 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
                    <label className="block text-xs font-bold uppercase text-red-800">
                      Poukisa ou pa ka livre kòmand sa a?
                    </label>
                    <select
                      value={failureReason}
                      onChange={(e) => setFailureReason(e.target.value)}
                      className={inputClsCompact()}
                    >
                      <option value="">— Chwazi yon rezon —</option>
                      {FAILURE_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    {failureReason === "other" && (
                      <textarea
                        value={failureComment}
                        onChange={(e) => setFailureComment(e.target.value)}
                        placeholder="Eksplike rezon an…"
                        aria-label="Eksplike rezon an…"
                        rows={2}
                        className={inputClsCompact()}
                      />
                    )}
                    <p className="text-xs text-red-700">
                      Kòmand lan ap make kòm livrezon echwe, kliyan an ap notifye pou l vin chèche
                      manje a nan biwo a nan 2 èdtan.
                    </p>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={closeFailureForm}>
                        Anile
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={
                          reportFailed.isPending ||
                          !failureReason ||
                          (failureReason === "other" && failureComment.trim().length === 0)
                        }
                        onClick={() => reportFailed.mutate({ orderId: d.order_id, id: d.id })}
                      >
                        {reportFailed.isPending ? "Ap voye…" : "Konfime — pa ka livre"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Istwa</h2>
          {visibleHistory.length > 0 && (
            <button
              onClick={hideAllVisible}
              className="inline-flex items-center gap-1.5 rounded-full border-2 border-brand-soft bg-white px-3 py-2 text-xs font-bold text-ink-soft hover:border-brand hover:text-brand-deep"
            >
              <Eraser className="h-3.5 w-3.5" /> Netwaye istwa
            </button>
          )}
        </div>
        {history.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
        )}
        {!history.isLoading && visibleHistory.length === 0 && (
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
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map((d) => {
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
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => hideOne(d.orders?.order_number ?? "", d.order_id)}
                          aria-label="Kache livrezon sa a"
                          title="Kache livrezon sa a"
                          className="text-ink-soft hover:text-brand-deep"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      {ConfirmDialog}
    </div>
  );
}
