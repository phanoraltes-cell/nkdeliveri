import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCollectPaymentPoll } from "@/hooks/useCollectPaymentPoll";
import { formatHTG } from "@/lib/format";
import { CheckCircle2, Clock, AlertCircle, AlertTriangle } from "lucide-react";
import type { MapMarker } from "@/components/maps/LeafletMap";
import { useOrderDelivery, ACTIVE_DELIVERY_STATUSES } from "@/hooks/useLiveOrders";
import { useRealtimeTableSync } from "@/hooks/useRealtimeTableSync";
import { useRoute } from "@/hooks/useRoute";
import { noIndexMeta } from "@/lib/seo";
import { DeliveryTrackingSection } from "@/components/order/delivery-tracking-section";
import { OrderStatusTimeline } from "@/components/order/order-status-timeline";
import { PaymentProofSection } from "@/components/order/payment-proof-section";
import { OrderReviewSection } from "@/components/order/order-review-section";
import { RefundSection } from "@/components/order/refund-section";
import { CancelOrderSection } from "@/components/order/cancel-order-section";
import { DisputeSection } from "@/components/order/dispute-section";
import { CashConfirmationSection } from "@/components/order/cash-confirmation-section";
import { CustomerLocationToggle } from "@/components/order/customer-location-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { TERMINAL_ORDER_STATUSES } from "@/lib/order-status";
import { DISPUTE_TERMINAL_STATUSES } from "@/lib/dispute-status";
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

function OrderDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const order = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, order_number, status, subtotal, delivery_fee, service_fee, discount_amount, promo_code, promotion_discount_amount, promotions(title), total, currency, delivery_address, contact_phone, delivery_notes, created_at, restaurant_id, restaurants(name, slug), order_items(product_name, quantity, unit_price, line_total), payments(id, method, status, transaction_ref, sender_phone, review_notes, reviewed_at, receiver_type, receiver_number, receiver_account_name, cash_confirmation_status, customer_confirmed_at, payment_transactions(id, status, external_reference, created_at))",
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

  // Also computed unconditionally, before the loading/not-found early
  // returns below, for the same Rules-of-Hooks reason —
  // useCollectPaymentPoll must run every render regardless of `enabled`.
  // A payment_transactions row only ever exists for the automatic collect
  // flow (create_collect_payment_secure) — see the fuller comment on
  // `collectTransaction` further down, where the same value is recomputed
  // for rendering (cheap optional chaining, not worth hoisting a shared
  // variable across the early-return boundary).
  const pendingCollectTransaction = order.data?.payments?.[0]?.payment_transactions?.find(
    (pt) => pt.status === "pending",
  );
  useCollectPaymentPoll({
    enabled: Boolean(pendingCollectTransaction),
    externalReference: pendingCollectTransaction?.external_reference,
    createdAt: pendingCollectTransaction?.created_at,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["order", id] }),
  });

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

  // Phase 2.1 remediation (docs/PHASE2_PUSH_DECISION_REPORT.md, anomaly 2):
  // mirrors DisputeSection's own query (identical queryKey and select) so
  // React Query dedupes the two into a single request — no new backend
  // call. Needed here, one level up, only so the page can surface an
  // active dispute even while the "Detay ak sipò" accordion (where
  // DisputeSection itself renders the full thread) is collapsed. Also
  // unconditional and before the early returns below, for the same
  // Rules-of-Hooks reason as `delivery`/`trackingRoute` above.
  const dispute = useQuery({
    queryKey: ["dispute", order.data?.id],
    enabled: !!order.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("disputes")
        .select("id, category, status, resolution, created_at")
        .eq("order_id", order.data!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (order.isLoading) {
    return (
      <div className="min-h-screen bg-cream">
        <SiteHeader />
        <div className="mx-auto max-w-[720px] space-y-4 px-5 py-8">
          <Skeleton className="h-8 w-48 rounded-lg" />
          {/* Approximates OrderStatusTimeline's shape (label row + step
              row) rather than the old two-card grid it replaced. */}
          <Skeleton className="h-28 rounded-2xl" />
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

        <OrderStatusTimeline status={o.status} />

        {/* Payment trust signal — small and quiet on purpose: it's
            reassurance, not an action, so it doesn't compete with the
            "what needs your attention" banners below. */}
        {payment?.status === "paid" && (
          <div className="flex items-center gap-1.5 text-xs font-semibold text-status-good">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Peman konfime
            {isCollect && " · Otomatik"}
          </div>
        )}
        {payment?.status === "refunded" && (
          <div className="text-xs font-semibold text-status-info">Peman ranbouse</div>
        )}

        {/* Contextual "what needs your attention now" banner — at most one
            renders at a time; an order with nothing pending shows none,
            per the Refonte spec's "one action at a time" rule. The
            needsProof case has no banner of its own here: PaymentProofSection
            below already carries its own clear call-to-action heading, so a
            second banner pointing at it would just be noise.
            Ordered by urgency: an active dispute first (Phase 2.1
            remediation, anomaly 2), then the payment-rail banners
            (including under_review — Phase 2.1 remediation, anomaly 1).
            These two families never actually compete for the same order:
            a dispute only becomes eligible once the order status moves
            past pending/confirmed/preparing (DisputeSection's own
            NOT_YET_ELIGIBLE_STATUSES), and every one of the payment-rail
            banners below only applies while the order is still "pending"
            (update_order_status_secure/the restaurant dashboard both block
            confirming a moncash/natcash order — manual or automatic —
            until its payment is "paid"). Documented here rather than
            re-guarded in code, to avoid adding logic this fix doesn't need. */}
        {!TERMINAL_ORDER_STATUSES.has(o.status) &&
          dispute.data &&
          !DISPUTE_TERMINAL_STATUSES.has(dispute.data.status) && (
            <a
              href="#dispute"
              className="flex items-center justify-between gap-3 rounded-2xl bg-status-warn-soft p-4 text-sm font-semibold text-status-warn"
            >
              <span className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
                Nou resevwa siyalman ou a — ekip sipò a ap swiv dosye a.
              </span>
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </a>
          )}
        {isManual && payment?.status === "under_review" && (
          <div className="flex items-center gap-3 rounded-2xl bg-status-info-soft p-4 text-sm font-semibold text-status-info">
            <Clock className="h-5 w-5 shrink-0" aria-hidden="true" />
            Nou resevwa prèv peman ou a — n ap verifye li. Pa gen lòt aksyon pou ou fè kounye a.
          </div>
        )}
        {isCollect && collectTransaction?.status === "pending" && (
          // Wallet-agnostic on purpose (post-incident audit remediation,
          // docs/PAYMENT_POST_INCIDENT_AUDIT.md "Bug confirmé n°4" /
          // docs/PAYMENT_POST_INCIDENT_REMEDIATION_REPORT.md): the
          // previous text hardcoded "MonCash", which the business gate
          // in initiate-collect-payment.logic.ts happens to make true
          // today but won't stay true once another PLOP wallet (e.g.
          // NatCash) is enabled here. Deliberately NOT routed through
          // payment-provider-display.ts's getProviderDisplayLabel()
          // either — that module maps provider_code "moncash_api" to
          // the internal gateway name "PLOP" for a *future admin*
          // surface (its own header comment is explicit this is never
          // meant for a customer-facing screen); showing "PLOP" here
          // would leak an internal vendor name customers were never
          // meant to see (checkout.tsx's own copy calls this "Payment
          // Global" precisely to avoid that). Naming no provider/wallet
          // at all is the smallest, safest fix that stays correct for
          // every wallet PLOP could ever route through.
          <div className="flex items-center gap-3 rounded-2xl bg-status-info-soft p-4 text-sm font-semibold text-status-info">
            <Clock className="h-5 w-5 shrink-0" aria-hidden="true" />N ap tann konfimasyon peman an
            — paj sa a ap mete ajou otomatikman.
          </div>
        )}
        {isCollect && collectTransaction?.status === "failed" && (
          <div className="flex items-center gap-3 rounded-2xl bg-status-bad-soft p-4 text-sm font-semibold text-status-bad">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
            Peman otomatik la pa t reyisi. Tanpri eseye ankò oswa kontakte sipò.
          </div>
        )}

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

        {/* The order's own primary action when one is pending, pulled out of
            the "Detay ak sipò" accordion below rather than duplicated with a
            separate banner — PaymentProofSection already carries its own
            clear call-to-action heading. */}
        {isManual && payment && needsProof && (
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

        {/* Also pulled out of the accordion, not just PaymentProofSection:
            cancelling only ever applies during the pending/confirmed window
            (CancelOrderSection's own guard), which is exactly when the
            accordion is collapsed by default — leaving it inside made the
            cancel button undiscoverable for the entire time it's actually
            offered. Caught by e2e/client/order-lifecycle-customer.spec.ts
            during the Phase 6 responsive pass, not by code review. Renders
            nothing outside its own eligible window, same as before. */}
        <CancelOrderSection orderId={o.id} orderStatus={o.status} />

        {/* Everything else — order contents, and whatever secondary action
            (already-submitted proof, refund, cash confirmation, dispute,
            review) applies to this order's current state.
            Collapsed by default while the order is still active (the
            timeline above is the focus); open by default once the order
            reaches a terminal state, where this section *is* what's left
            to do (leave a review, chase a refund, resolve a dispute) rather
            than secondary to anything else on the page. */}
        <details
          className="group overflow-hidden rounded-2xl bg-white shadow-brand-xs ring-1 ring-brand-soft/40"
          open={TERMINAL_ORDER_STATUSES.has(o.status)}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-white p-5 font-display text-base font-bold text-ink marker:content-none">
            Detay kòmand ak sipò
            <ChevronRight
              className="h-4 w-4 shrink-0 text-ink-soft transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
          </summary>
          <div className="space-y-4 bg-cream/50 p-5">
            <div>
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
                {o.promotion_discount_amount > 0 && (
                  <div className="flex justify-between font-semibold text-status-good">
                    <span>🎉 {o.promotions?.title ?? "Pwomosyon restoran"}</span>
                    <span>-{formatHTG(o.promotion_discount_amount)}</span>
                  </div>
                )}
                {o.discount_amount > 0 && (
                  <div className="flex justify-between font-semibold text-status-good">
                    <span>Rabè{o.promo_code ? ` (${o.promo_code})` : ""}</span>
                    <span>-{formatHTG(o.discount_amount)}</span>
                  </div>
                )}
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

            {isManual && payment && !needsProof && (
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

            <RefundSection orderId={o.id} orderStatus={o.status} paymentStatus={payment?.status} />

            <CashConfirmationSection orderId={o.id} orderStatus={o.status} payment={payment} />

            {/* Anchor for the active-dispute banner's "quick access" link
                above — wraps the call site only, DisputeSection itself is
                untouched. Modern browsers auto-expand an ancestor
                <details> when its content is the target of a fragment
                navigation, so this also opens the accordion. */}
            <div id="dispute" className="scroll-mt-20">
              <DisputeSection orderId={o.id} orderStatus={o.status} />
            </div>

            {o.status === "delivered" && (
              <OrderReviewSection
                orderId={o.id}
                customerId={user?.id}
                restaurantId={o.restaurant_id}
                driverId={delivery?.driver_id ?? null}
              />
            )}
          </div>
        </details>
      </main>
      <SiteFooter />
    </div>
  );
}
