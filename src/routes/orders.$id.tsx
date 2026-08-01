import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { formatHTG } from "@/lib/format";
import { CheckCircle2, Clock, AlertCircle } from "lucide-react";
import type { MapMarker } from "@/components/maps/LeafletMap";
import { useOrderDelivery, ACTIVE_DELIVERY_STATUSES } from "@/hooks/useLiveOrders";
import { useRealtimeTableSync } from "@/hooks/useRealtimeTableSync";
import { useRoute } from "@/hooks/useRoute";
import { noIndexMeta } from "@/lib/seo";
import { DeliveryTrackingSection } from "@/components/order/delivery-tracking-section";
import { PaymentProofSection } from "@/components/order/payment-proof-section";
import { OrderReviewSection } from "@/components/order/order-review-section";
import { RefundSection } from "@/components/order/refund-section";
import { CancelOrderSection } from "@/components/order/cancel-order-section";
import { DisputeSection } from "@/components/order/dispute-section";
import { CashConfirmationSection } from "@/components/order/cash-confirmation-section";
import { CustomerLocationToggle } from "@/components/order/customer-location-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { ORDER_STATUS_LABEL } from "@/lib/order-status";
import { MessageCircle, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/orders/$id")({
  head: () => noIndexMeta("Kòmand — NK Deliveri"),
  // Leaflet touches `window` at module scope and this page is gated behind
  // a session check anyway (no SEO to lose), so it's rendered client-only —
  // same rationale as the _authenticated layout.
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth", search: { next: "/orders" } });
  },
  component: OrderDetail,
});

const PAY_STATUS_LABEL: Record<string, string> = {
  pending: "An atant",
  awaiting_proof: "Ap tann prèv peman",
  under_review: "Ap verifye",
  paid: "Peye",
  failed: "Echwe",
  refunded: "Ranbouse",
};

function OrderDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();

  const order = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, subtotal, delivery_fee, service_fee, total, currency, delivery_address, contact_phone, delivery_notes, created_at, restaurant_id, restaurants(name, slug), order_items(product_name, quantity, unit_price, line_total), payments(id, method, status, transaction_ref, sender_phone, review_notes, reviewed_at, receiver_type, receiver_number, receiver_account_name, cash_confirmation_status, customer_confirmed_at, payment_transactions(id, status, external_reference))",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Must run unconditionally, before the loading/not-found early returns
  // below — calling it after them would change the hook order between
  // renders and violate the Rules of Hooks (React would throw or silently
  // drop hooks, breaking this exact component on the transition from
  // "loading" to "loaded", which is also where the map should appear).
  // Payments aren't keyed by order_id in the realtime filter directly
  // (the filter runs against the changed row, i.e. the payments table
  // itself) — order_id IS a real column on payments, so this scopes
  // correctly to just this order's payment(s).
  useRealtimeTableSync("payments", `order_id=eq.${id}`, [["order", id]]);

  const delivery = useOrderDelivery(order.data?.id);
  const driverPoint =
    delivery?.driver_lat != null && delivery?.driver_lng != null
      ? { lat: Number(delivery.driver_lat), lng: Number(delivery.driver_lng) }
      : undefined;
  const headingToPickup = delivery?.status === "assigned" || delivery?.status === "en_route_pickup";
  const nextStopPoint = headingToPickup
    ? delivery?.order?.restaurants?.lat != null && delivery?.order?.restaurants?.lng != null
      ? { lat: Number(delivery.order.restaurants.lat), lng: Number(delivery.order.restaurants.lng) }
      : undefined
    : delivery?.order?.delivery_lat != null && delivery?.order?.delivery_lng != null
      ? { lat: Number(delivery.order.delivery_lat), lng: Number(delivery.order.delivery_lng) }
      : undefined;
  // Also unconditional and before the early returns below, for the same
  // Rules-of-Hooks reason as `delivery` above.
  const trackingRoute = useRoute(driverPoint, nextStopPoint);

  if (order.isLoading) {
    return (
      <div className="min-h-screen bg-cream">
        <SiteHeader />
        <div className="mx-auto max-w-[720px] space-y-4 px-5 py-8">
          <Skeleton className="h-8 w-48 rounded-lg" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </div>
    );
  }
  if (!order.data) {
    return (
      <div className="min-h-screen bg-cream">
        <SiteHeader />
        <div className="mx-auto max-w-[720px] px-5 py-12 text-center text-ink-soft">
          Kòmand la pa jwenn.
          <div className="mt-3">
            <Link to="/orders" className="font-bold text-brand-deep">
              ← Kòmand mwen
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const o = order.data;
  const payment = o.payments?.[0];
  const trackingMarkers: MapMarker[] = (() => {
    if (!delivery) return [];
    const arr: MapMarker[] = [];
    if (delivery.driver_lat != null && delivery.driver_lng != null) {
      arr.push({
        id: "drv",
        lat: Number(delivery.driver_lat),
        lng: Number(delivery.driver_lng),
        type: "driver",
        label: "Livrè",
      });
    }
    if (delivery.order?.restaurants?.lat != null && delivery.order?.restaurants?.lng != null) {
      arr.push({
        id: "rst",
        lat: Number(delivery.order.restaurants.lat),
        lng: Number(delivery.order.restaurants.lng),
        type: "restaurant",
        label: delivery.order.restaurants.name ?? "Restoran",
      });
    }
    // Prefer the customer's live shared position over their registered
    // delivery address when they've opted in — more accurate for the
    // driver, and the whole point of Phase 1 of the GPS-sharing feature.
    if (delivery.customer_location) {
      arr.push({
        id: "dst",
        lat: Number(delivery.customer_location.lat),
        lng: Number(delivery.customer_location.lng),
        type: "client",
        label: "Pozisyon ou (an tan reyèl)",
      });
    } else if (delivery.order?.delivery_lat != null && delivery.order?.delivery_lng != null) {
      arr.push({
        id: "dst",
        lat: Number(delivery.order.delivery_lat),
        lng: Number(delivery.order.delivery_lng),
        type: "client",
        label: "Adrès ou",
      });
    }
    return arr;
  })();
  // A payment_transactions row only ever exists for the automatic
  // collect flow (create_collect_payment_secure) — its presence is what
  // tells this page apart from the manual proof-upload flow, since both
  // share the same payments.method='moncash' rail.
  const collectTransaction = payment?.payment_transactions?.[0];
  const isCollect = Boolean(collectTransaction);
  const isManual = (payment?.method === "moncash" || payment?.method === "natcash") && !isCollect;
  const needsProof =
    isManual &&
    (payment?.status === "awaiting_proof" ||
      payment?.status === "pending" ||
      payment?.status === "failed");

  const payLabel = payment
    ? `${payment.method === "moncash" ? "MonCash" : "NatCash"} · ${payment.receiver_number ?? "(pa konfigire)"}${payment.receiver_account_name ? " (" + payment.receiver_account_name + ")" : ""}`
    : "";
  const payRoutingNote =
    payment?.receiver_type === "merchant"
      ? "Peman an ale dirèkteman sou kont restoran an."
      : "NK Deliveri ap resevwa peman an epi remèt restoran an apre komisyon.";

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-[720px] space-y-4 px-5 py-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-soft">Kòmand</div>
            <h1 className="font-display text-2xl font-extrabold">{o.order_number}</h1>
          </div>
          <Link to="/orders" className="text-sm font-bold text-brand-deep hover:underline">
            ← Tout kòmand
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-4 shadow-brand-xs ring-1 ring-brand-soft/40">
            <div className="text-xs uppercase tracking-wider text-ink-soft">Estati kòmand</div>
            <div className="mt-1 font-display text-lg font-extrabold text-brand-deep">
              {ORDER_STATUS_LABEL[o.status] || o.status}
            </div>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-brand-xs ring-1 ring-brand-soft/40">
            <div className="text-xs uppercase tracking-wider text-ink-soft">Estati peman</div>
            <div className="mt-1 flex items-center gap-2 font-display text-lg font-extrabold">
              {payment?.status === "paid" && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              {payment?.status === "under_review" && <Clock className="h-5 w-5 text-amber-600" />}
              {payment?.status === "awaiting_proof" && (
                <AlertCircle className="h-5 w-5 text-orange-600" />
              )}
              {payment ? PAY_STATUS_LABEL[payment.status] || payment.status : "—"}
            </div>
            <div className="mt-0.5 text-xs text-ink-soft capitalize">
              {payment?.method}
              {isCollect && " · Otomatik"}
            </div>
            {needsProof && (
              <a
                href="#payment-proof"
                className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:underline"
              >
                ↓ Voye prèv peman an
              </a>
            )}
            {isCollect && collectTransaction?.status === "pending" && (
              <p className="mt-2 text-xs text-ink-soft">
                N ap tann konfimasyon MonCash — paj sa a ap mete ajou otomatikman.
              </p>
            )}
            {isCollect && collectTransaction?.status === "failed" && (
              <p className="mt-2 text-xs text-red-700">
                Peman otomatik la pa t reyisi. Tanpri eseye ankò oswa kontakte sipò.
              </p>
            )}
          </div>
        </div>

        {delivery && trackingMarkers.length > 0 && (
          <DeliveryTrackingSection
            delivery={delivery}
            markers={trackingMarkers}
            route={trackingRoute}
            headingToPickup={headingToPickup}
          />
        )}

        {delivery && (ACTIVE_DELIVERY_STATUSES as readonly string[]).includes(delivery.status) && (
          <CustomerLocationToggle deliveryId={delivery.id} />
        )}

        {o.status !== "pending" && (
          <Link
            to="/dashboard/customer/chat"
            search={{ order: o.id }}
            className="flex items-center justify-between gap-3 rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40 transition hover:ring-brand"
          >
            <div className="flex items-center gap-2 font-display text-base font-bold">
              <MessageCircle className="h-4 w-4 text-brand-deep" /> Chat livrezon
            </div>
            <ChevronRight className="h-4 w-4 text-ink-soft" aria-hidden="true" />
          </Link>
        )}

        <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
          <div className="mb-3 font-display text-base font-bold">Detay</div>
          {o.order_items?.map((it, i) => (
            <div
              key={i}
              className="flex justify-between border-b border-dashed border-brand-soft py-2 text-sm"
            >
              <span>
                {it.quantity}× {it.product_name}
              </span>
              <span>{formatHTG(it.line_total)}</span>
            </div>
          ))}
          <div className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between text-ink-soft">
              <span>Sou-total</span>
              <span>{formatHTG(o.subtotal)}</span>
            </div>
            <div className="flex justify-between text-ink-soft">
              <span>Frè livrezon</span>
              <span>{formatHTG(o.delivery_fee)}</span>
            </div>
            <div className="mt-2 flex justify-between border-t-2 border-brand-soft pt-2 font-display text-lg font-extrabold">
              <span>Total</span>
              <span>{formatHTG(o.total)}</span>
            </div>
          </div>
          <div className="mt-3 text-xs text-ink-soft">
            <div>
              <b>Livrezon:</b> {o.delivery_address}
            </div>
            <div>
              <b>Telefòn:</b> {o.contact_phone}
            </div>
            {o.delivery_notes && (
              <div>
                <b>Nòt:</b> {o.delivery_notes}
              </div>
            )}
          </div>
        </div>

        {isManual && payment && (
          <PaymentProofSection
            orderId={o.id}
            paymentId={payment.id}
            total={o.total}
            payLabel={payLabel}
            payRoutingNote={payRoutingNote}
            needsProof={needsProof}
            reviewNotes={payment.review_notes}
          />
        )}

        <CancelOrderSection orderId={o.id} orderStatus={o.status} />

        <RefundSection orderId={o.id} orderStatus={o.status} paymentStatus={payment?.status} />

        <CashConfirmationSection orderId={o.id} orderStatus={o.status} payment={payment} />

        <DisputeSection orderId={o.id} orderStatus={o.status} />

        {o.status === "delivered" && (
          <OrderReviewSection
            orderId={o.id}
            customerId={user?.id}
            restaurantId={o.restaurant_id}
            driverId={delivery?.driver_id ?? null}
          />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
