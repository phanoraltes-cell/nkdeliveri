import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { formatHTG } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

// Role guard lives on the parent layout (dashboard.admin.tsx).
export const Route = createFileRoute("/_authenticated/dashboard/admin/delivery-failed")({
  component: AdminDeliveryFailed,
});

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

const REASON_LABEL: Record<string, string> = {
  customer_unavailable: "Kliyan pa reponn",
  address_not_found: "Pa jwenn adrès la",
  zone_inaccessible: "Zòn nan pa aksesib",
  other: "Lòt rezon",
};

function elapsedLabel(failedAt: string, now: number): { text: string; over2h: boolean } {
  const ms = now - new Date(failedAt).getTime();
  const over2h = ms >= TWO_HOURS_MS;
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return { text: `${h}è ${m}min`, over2h };
}

// NKD-016: admin resolves a 'delivery_failed' order manually — no scheduled
// job exists in this project to do it automatically (owner's decision,
// docs/NKD-016_FAILED_DELIVERY_REPORT.md). Reuses update_order_status_secure
// (already admin-unconditional for any transition) rather than a new RPC —
// nothing here needs validation beyond "is this caller an admin", which
// that function already does.
function AdminDeliveryFailed() {
  const qc = useQueryClient();
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const orders = useQuery({
    queryKey: ["admin-delivery-failed-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, total, delivery_address, contact_phone, delivery_failed_at, restaurants(name), deliveries(failure_reason, failure_comment, driver_id, drivers(first_name, last_name, phone))",
        )
        .eq("status", "delivery_failed")
        .order("delivery_failed_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });

  const resolve = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: "delivered" | "cancelled" }) => {
      const { error } = await supabase.rpc("update_order_status_secure", {
        _order_id: orderId,
        _new_status: status,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.status === "delivered" ? "Kòmand make livre" : "Kòmand anile");
      qc.invalidateQueries({ queryKey: ["admin-delivery-failed-orders"] });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  function confirmCancel(orderId: string, orderNumber: string, over2h: boolean) {
    requestConfirm(
      over2h
        ? `Anile kòmand ${orderNumber}? Pa gen ranbousman — manje a pa disponib ankò.`
        : `Sa poko fè 2 èdtan depi livrezon an echwe — anile kòmand ${orderNumber} kanmenm? Pa gen ranbousman.`,
      () => resolve.mutate({ orderId, status: "cancelled" }),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Livrezon echwe</h1>
          <p className="mt-1 text-ink-soft">
            Kòmand kote livrezon pa reyisi — manje a nan biwo a, kliyan gen 2 èdtan pou vin
            chèche l.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      {orders.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      )}
      {!orders.isLoading && (orders.data?.length ?? 0) === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen okenn livrezon echwe kounye a.
        </div>
      )}

      <div className="space-y-3">
        {orders.data?.map((o) => {
          const delivery = o.deliveries;
          const driver = delivery?.drivers;
          const { text, over2h } = o.delivery_failed_at
            ? elapsedLabel(o.delivery_failed_at, now)
            : { text: "—", over2h: false };
          return (
            <div
              key={o.id}
              className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-lg font-extrabold">{o.order_number}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                        over2h ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {over2h ? `Pase 2è (${text})` : `${text} depi echèk la`}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-ink-soft">
                    {o.restaurants?.name} · {o.delivery_address}
                    {o.contact_phone && (
                      <>
                        {" · "}
                        <a href={`tel:${o.contact_phone}`} className="font-bold text-brand-deep">
                          {o.contact_phone}
                        </a>
                      </>
                    )}
                  </div>
                  {delivery?.failure_reason && (
                    <div className="mt-1 text-xs text-ink-soft">
                      Rezon : {REASON_LABEL[delivery.failure_reason] ?? delivery.failure_reason}
                      {delivery.failure_comment && ` — ${delivery.failure_comment}`}
                      {driver && ` · Livrè: ${driver.first_name ?? ""} ${driver.last_name ?? ""}`}
                    </div>
                  )}
                  <span className="mt-1 inline-block font-display font-extrabold text-brand-deep">
                    {formatHTG(Number(o.total))}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <Button
                    size="sm"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ orderId: o.id, status: "delivered" })}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Kliyan vin chèche l
                  </Button>
                  <button
                    disabled={resolve.isPending}
                    onClick={() => confirmCancel(o.id, o.order_number, over2h)}
                    className="inline-flex items-center justify-center gap-1 rounded-full border-2 border-red-300 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Anile — pa gen ranbousman
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {ConfirmDialog}
    </div>
  );
}
