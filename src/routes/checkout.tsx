import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useCart } from "@/hooks/useCart";
import { formatHTG } from "@/lib/format";
import { useEffect, useState } from "react";
import { Minus, Plus, Trash2, MapPin, Banknote } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { noIndexMeta } from "@/lib/seo";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { sendNewOrderPush } from "@/lib/send-order-push.functions";
import { sendCollectPaymentAdminErrorPush } from "@/lib/send-collect-payment-admin-error-push.functions";
import { inputCls } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { initiateCollectPayment } from "@/lib/initiate-collect-payment.functions";
import { usePaymentProviderAvailability } from "@/hooks/usePaymentProviderAvailability";
import { useDeliveryFee } from "@/hooks/useDeliveryFee";
import {
  getDefaultProvider,
  getProviderSetting,
  isProviderEnabled,
  type PaymentProviderSetting,
} from "@/lib/payment-provider-availability";

// Local, safe placeholder shown only for the brief window before
// payment_provider_settings has loaded — never a fallback decision in
// itself (the backend enforces the real gate independently in
// initiate-collect-payment.logic.ts regardless of what renders here).
// Mirrors the migration's own seed values so there's no visible flash
// once the real query resolves.
const PLACEHOLDER_PROVIDER_SETTINGS: PaymentProviderSetting[] = [
  {
    provider: "kach",
    visible: true,
    enabled: true,
    defaultProvider: true,
    maintenanceMessage: null,
  },
  {
    provider: "moncash",
    visible: true,
    enabled: true,
    defaultProvider: false,
    maintenanceMessage: null,
  },
  {
    provider: "natcash",
    visible: true,
    enabled: true,
    defaultProvider: false,
    maintenanceMessage: null,
  },
  {
    provider: "moncash_auto",
    visible: true,
    enabled: false,
    defaultProvider: false,
    maintenanceMessage: "MonCash Otomatik ap retounen byento.",
  },
  {
    provider: "natcash_auto",
    visible: true,
    enabled: false,
    defaultProvider: false,
    maintenanceMessage: "NatCash Otomatik ap retounen byento.",
  },
  {
    provider: "stripe",
    visible: true,
    enabled: false,
    defaultProvider: false,
    maintenanceMessage: "Peman ak kat kredi ap disponib byento.",
  },
];

export const Route = createFileRoute("/checkout")({
  head: () => noIndexMeta("Panye — NK Deliveri"),
  component: Checkout,
});

const METHODS = [
  {
    id: "moncash_auto",
    label: "MonCash Otomatik",
    sub: "Peman otomatik, konfimasyon imedya",
    logo: "/moncash-logo-hero.png",
  },
  {
    id: "natcash_auto",
    label: "NatCash Otomatik",
    sub: "Peman otomatik, konfimasyon imedya",
    logo: "/natcash-logo-new.png",
  },
  {
    id: "stripe",
    label: "Kat Kredi",
    sub: "Peman ak kat, konfimasyon imedya",
    logo: "/stripe-card-logo.svg",
  },
  {
    id: "moncash",
    label: "MonCash Manyèl",
    sub: "Peman manyèl ak prèv",
    logo: "/moncash-logo-hero.png",
  },
  { id: "natcash", label: "NatCash", sub: "Peman manyèl ak prèv", logo: "/natcash-logo-new.png" },
  { id: "kach", label: "Kach nan livrezon", sub: "Peye lè manje a rive", logo: null },
] as const;

type CheckoutMethod = (typeof METHODS)[number]["id"];

function Checkout() {
  const { items, setQty, setItemNotes, remove, subtotal, count } = useCart();
  const { clear } = useCart();
  const { user } = useAuth();
  // "kach" is the same safe fallback the migration seeds as the real
  // default — synced to the actual DB default below once it loads, but
  // never blocking the first paint on a network round-trip.
  const [method, setMethod] = useState<CheckoutMethod>("kach");
  const [methodTouchedByUser, setMethodTouchedByUser] = useState(false);
  const providerAvailability = usePaymentProviderAvailability();
  const providerSettings = providerAvailability.data ?? PLACEHOLDER_PROVIDER_SETTINGS;

  // Backend is the source of truth for the default selection too — once
  // the real settings load, adopt the real default, but only if the
  // customer hasn't already picked something themselves (a later
  // background refetch must never yank their selection out from under
  // them).
  useEffect(() => {
    if (methodTouchedByUser || !providerAvailability.data) return;
    setMethod(getDefaultProvider(providerAvailability.data));
  }, [providerAvailability.data, methodTouchedByUser]);

  function selectMethod(id: CheckoutMethod) {
    setMethodTouchedByUser(true);
    setMethod(id);
  }

  const initiateCollect = useServerFn(initiateCollectPayment);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [wantsLocationSharing, setWantsLocationSharing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const nav = useNavigate();
  const sendNewOrderPushFn = useServerFn(sendNewOrderPush);
  const sendCollectPaymentAdminErrorPushFn = useServerFn(sendCollectPaymentAdminErrorPush);

  const platformPayout = useQuery({
    queryKey: ["platform-payout-public"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_platform_payout_public");
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const savedAddresses = useQuery({
    queryKey: ["my-addresses", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("addresses")
        .select("id, label, address_line, city, is_default")
        .eq("user_id", user!.id)
        .order("is_default", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Pre-fill from the default saved address once (never overwrites what the
  // customer is actively typing on a later render).
  const [addressPrefilled, setAddressPrefilled] = useState(false);
  useEffect(() => {
    if (addressPrefilled || address || !savedAddresses.data?.length) return;
    const def = savedAddresses.data.find((a) => a.is_default) ?? savedAddresses.data[0];
    setAddress(`${def.address_line}, ${def.city}`);
    setAddressPrefilled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAddresses.data]);

  // NKD-015: platform-wide fee (admin-set, not restaurant-set), read from
  // the same source create_order_secure itself reads at order-creation
  // time (public.platform_delivery_zones' default zone) — see
  // useDeliveryFee's own comment for why this is shared across every
  // call site that needs to display it, not just re-queried here.
  const platformFee = useDeliveryFee();
  const deliveryFee = items.length > 0 ? (platformFee.data ?? 0) : 0;
  const serviceFee = 0;
  const total = subtotal + deliveryFee + serviceFee;

  // "MonCash Otomatik"/"NatCash Otomatik" (checkout ids `moncash_auto`/
  // `natcash_auto`, both backed by the same PLOP gateway —
  // docs/PLOP_NATCASH_INTEGRATION_PLAN.md) move money through the same
  // rail as their manual counterpart — create_order_secure only knows the
  // rail (payment_method enum: moncash/natcash/kach/stripe), never *how*
  // it gets confirmed. The distinction is a checkout-flow choice, not a
  // new backend method.
  const orderMethod =
    method === "moncash_auto" ? "moncash" : method === "natcash_auto" ? "natcash" : method;

  const payNumber =
    orderMethod === "moncash"
      ? platformPayout.data?.moncash_number
      : orderMethod === "natcash"
        ? platformPayout.data?.natcash_number
        : null;
  const payName =
    orderMethod === "moncash"
      ? platformPayout.data?.moncash_account_name
      : orderMethod === "natcash"
        ? platformPayout.data?.natcash_account_name
        : null;

  async function submit() {
    if (!user) {
      nav({ to: "/auth", search: { next: "/checkout" } });
      return;
    }
    if (!address.trim()) {
      toast.error("Antre adrès livrezon w");
      return;
    }
    if (!phone.trim()) {
      toast.error("Antre yon nimewo telefòn pou kontak");
      return;
    }
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      const rId = items[0].restaurantId;
      const { data: orderId, error: rpcErr } = await supabase.rpc("create_order_secure", {
        _restaurant_id: rId,
        _items: items.map((it) => ({
          product_id: it.productId,
          quantity: it.qty,
          notes: it.notes?.trim() || undefined,
        })),
        _delivery_address: address,
        _contact_phone: phone,
        _delivery_notes: notes || "",
        _method: orderMethod,
        _wants_location_sharing: wantsLocationSharing,
      });
      if (rpcErr) throw rpcErr;

      // Best-effort — a failed push send must never block order creation.
      sendNewOrderPushFn({ data: { orderId: orderId as string } }).catch((e) =>
        console.warn("[push] new-order notify failed", e),
      );

      if (method === "moncash_auto" || method === "natcash_auto" || method === "stripe") {
        // The order already exists at this point (create_order_secure
        // above succeeded) — a failure from here on is a payment-
        // initiation problem, never a reason to let the customer land
        // back on this same form with the cart still full. Doing so
        // would let a resubmit call create_order_secure a second time
        // for the same cart, creating a duplicate order. Once the order
        // exists, it — not the cart — is the source of truth, so every
        // path below clears the cart and sends the customer to it;
        // orders.$id.tsx already shows a clear "otomatik la pa t reyisi"
        // state for the failure case.
        const { data: paymentRow, error: payErr } = await supabase
          .from("payments")
          .select("id")
          .eq("order_id", orderId as string)
          .single();
        if (payErr || !paymentRow) {
          clear();
          toast.error("Kòmand kreye, men nou pa jwenn peman an. Kontakte sipò.");
          nav({ to: "/orders/$id", params: { id: orderId as string } });
          return;
        }

        const result = await initiateCollect({ data: { paymentId: paymentRow.id } });
        if (result.outcome === "failed") {
          // Best-effort admin push (post-incident audit remediation,
          // docs/PAYMENT_POST_INCIDENT_REMEDIATION_REPORT.md, Correction
          // 5) — create_collect_payment_secure already recorded this via
          // create_collect_payment_secure -> notify_secure (in-app bell,
          // always fired); this is the missing real push notification
          // sibling, [[project_notification_push_convention]]. A failure
          // here must never block or alter the customer-facing outcome
          // below, exactly like sendNewOrderPushFn above.
          sendCollectPaymentAdminErrorPushFn({ data: { paymentId: paymentRow.id } }).catch((e) =>
            console.warn("[push] collect-payment-admin-error notify failed", e),
          );
          clear();
          toast.error(
            result.error ||
              "Kòmand kreye, men peman otomatik la pa reyisi kòmanse. Ou ka eseye ankò nan paj kòmand la.",
          );
          nav({ to: "/orders/$id", params: { id: orderId as string } });
          return;
        }
        if (result.outcome === "already_confirmed") {
          // Rare reconciliation-on-error path (docs/PLOP_PHASE2_AUDIT.md §
          // A1) — the provider already confirmed this payment before this
          // call even returned. Nothing to redirect to; the order page's
          // own poll/Realtime picks up the "paid" status within moments.
          clear();
          toast.success("Peman an konfime! N ap trete kòmand ou an.");
          nav({ to: "/orders/$id", params: { id: orderId as string } });
          return;
        }
        clear();
        window.location.href = result.redirectUrl;
        return;
      }

      clear();
      toast.success(
        orderMethod === "moncash" || orderMethod === "natcash"
          ? "Kòmand kreye! Kounye a voye prèv peman w lan pou nou konfime li."
          : "Kòmand kreye ak siksè",
      );
      nav({ to: "/orders/$id", params: { id: orderId as string } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erè pandan kreyasyon kòmand la");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-[640px] px-5 py-10">
        <div className="rounded-3xl bg-white p-6 shadow-brand-md ring-1 ring-brand-soft/40">
          <h1 className="mb-5 font-display text-2xl font-extrabold">Panye w</h1>

          {count === 0 ? (
            <div className="py-10 text-center text-ink-soft">
              Panye w vid pou kounye a.{" "}
              <Link to="/" className="font-bold text-brand-deep">
                Kòmanse kòmande
              </Link>
            </div>
          ) : (
            <>
              {items.map((it) => (
                <div
                  key={it.productId}
                  className="flex items-center gap-3 border-b border-dashed border-brand-soft py-3"
                >
                  {it.imageUrl && (
                    <img
                      src={it.imageUrl}
                      width={56}
                      height={56}
                      loading="lazy"
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
                      alt={it.name}
                    />
                  )}
                  {/* min-w-0 lets this column shrink below its text's natural
                      width on narrow screens instead of pushing the qty/remove
                      controls out of view — same fix as the hero search bar. */}
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-sm">{it.name}</b>
                    <span className="text-xs text-ink-soft">
                      {formatHTG(it.price)} · {it.restaurantName}
                    </span>
                    <input
                      value={it.notes ?? ""}
                      onChange={(e) => setItemNotes(it.productId, e.target.value)}
                      placeholder="Nòt pou plat sa a (opsyonèl)…"
                      aria-label={`Nòt pou ${it.name}`}
                      className="mt-1 w-full min-w-0 rounded-lg border border-brand-soft bg-cream px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-soft focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => setQty(it.productId, it.qty - 1)}
                      aria-label={`Diminye kantite ${it.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand-deep transition hover:bg-brand hover:text-white"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-6 text-center text-sm font-bold">{it.qty}</span>
                    <button
                      onClick={() => setQty(it.productId, it.qty + 1)}
                      aria-label={`Ogmante kantite ${it.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-brand-deep transition hover:bg-brand hover:text-white"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => remove(it.productId)}
                      aria-label={`Retire ${it.name} nan panye`}
                      className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}

              <div className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between text-ink-soft">
                  <span>Sou-total</span>
                  <span>{formatHTG(subtotal)}</span>
                </div>
                <div className="flex justify-between text-ink-soft">
                  <span>Frè livrezon</span>
                  <span>{formatHTG(deliveryFee)}</span>
                </div>
                <div className="mt-2 flex justify-between border-t-2 border-brand-soft pt-3 font-display text-lg font-extrabold">
                  <span>Total</span>
                  <span>{formatHTG(total)}</span>
                </div>
              </div>

              {/* Two visually separated groups on the same page (per the
                  Refonte spec's checkout wireframe) rather than a
                  multi-step wizard — the click-count stays minimal, but
                  "where this goes" and "how you're paying" no longer read
                  as one undifferentiated block of fields. */}
              <div className="mt-6 border-t-2 border-dashed border-brand-soft pt-5">
                <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold text-ink">
                  <MapPin className="h-4 w-4 text-brand-deep" aria-hidden="true" /> Livrezon
                </h2>
                <label htmlFor="checkout-address" className="mb-2 block text-sm font-bold">
                  Adrès livrezon
                </label>
                {!!savedAddresses.data?.length && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {savedAddresses.data.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setAddress(`${a.address_line}, ${a.city}`)}
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-brand-soft bg-white px-2.5 text-xs font-semibold text-brand-deep hover:bg-brand-soft/40"
                      >
                        <MapPin className="h-3 w-3" /> {a.label || a.address_line}
                      </button>
                    ))}
                  </div>
                )}
                <input
                  id="checkout-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Kote pou nou livre a…"
                  className={inputCls()}
                />
                <label htmlFor="checkout-phone" className="mt-3 mb-2 block text-sm font-bold">
                  Telefòn kontak
                </label>
                <input
                  id="checkout-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+509 …"
                  className={inputCls()}
                />
                <label htmlFor="checkout-notes" className="mt-3 mb-2 block text-sm font-bold">
                  Nòt pou livrezon (opsyonèl)
                </label>
                <input
                  id="checkout-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enstriksyon espesyal…"
                  className={inputCls()}
                />
                <label className="mt-3 flex items-start gap-2 text-sm text-ink-soft">
                  <input
                    type="checkbox"
                    checked={wantsLocationSharing}
                    onChange={(e) => setWantsLocationSharing(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Mwen dakò pataje pozisyon mwen pandan livrezon an, pou ede livrè a jwenn mwen pi
                    vit. Ou ka aktive/dezaktive sa lè livrezon an kòmanse — sa a pa yon aktivasyon
                    otomatik.
                  </span>
                </label>
              </div>

              <div className="mt-5 border-t-2 border-dashed border-brand-soft pt-5">
                <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold text-ink">
                  <Banknote className="h-4 w-4 text-brand-deep" aria-hidden="true" /> Peman
                </h2>
                <label className="mb-2 block text-sm font-bold">Metòd peman</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {METHODS.map((m) => {
                    const isDisabled = !isProviderEnabled(providerSettings, m.id);
                    const maintenanceMessage = getProviderSetting(
                      providerSettings,
                      m.id,
                    )?.maintenanceMessage;
                    return (
                      <button
                        key={m.id}
                        onClick={() => selectMethod(m.id)}
                        disabled={isDisabled}
                        aria-disabled={isDisabled}
                        className={`flex items-center gap-2.5 rounded-2xl border-2 p-3 text-left text-sm font-bold transition ${
                          isDisabled
                            ? "cursor-not-allowed border-brand-soft/60 bg-cream opacity-60"
                            : method === m.id
                              ? "border-brand bg-brand-soft shadow-brand-xs"
                              : "border-brand-soft bg-white hover:-translate-y-0.5 hover:border-brand hover:shadow-brand-xs"
                        }`}
                      >
                        {m.logo && (
                          <img
                            src={m.logo}
                            alt=""
                            width={40}
                            height={28}
                            loading="lazy"
                            className="h-7 w-10 shrink-0 rounded-md border border-brand-soft/60 bg-white object-contain p-0.5"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            {m.label}
                            {isDisabled && (
                              <Badge variant="secondary" className="shrink-0 font-semibold">
                                Byento disponib
                              </Badge>
                            )}
                          </span>
                          <small className="mt-0.5 block text-xs font-normal text-ink-soft">
                            {isDisabled ? maintenanceMessage : m.sub}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {(method === "moncash_auto" || method === "natcash_auto" || method === "stripe") &&
                  (() => {
                    const info =
                      method === "moncash_auto"
                        ? {
                            logo: "/moncash-logo-hero.png",
                            label: "MonCash Otomatik",
                            via: "MonCash",
                          }
                        : method === "natcash_auto"
                          ? {
                              logo: "/natcash-logo-new.png",
                              label: "NatCash Otomatik",
                              via: "NatCash",
                            }
                          : {
                              logo: "/stripe-card-logo.svg",
                              label: "Kat Kredi",
                              via: "kat kredi ou",
                            };
                    return (
                      <div className="mt-3 flex items-center gap-3 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">
                        <img
                          src={info.logo}
                          alt=""
                          width={40}
                          height={28}
                          loading="lazy"
                          className="h-7 w-10 shrink-0 rounded-md border border-emerald-200 bg-white object-contain p-0.5"
                        />
                        <div>
                          <b>{info.label}</b> — apre w konfime kòmand la, n ap voye w sou paj peman{" "}
                          {info.via} la pou w peye dirèkteman. Kòmand la konfime otomatikman apre
                          peman an fin fèt — pa gen prèv pou telechaje.
                        </div>
                      </div>
                    );
                  })()}
                {(method === "moncash" || method === "natcash") && (
                  <div className="mt-3 flex items-center gap-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                    <img
                      src={
                        method === "moncash" ? "/moncash-logo-hero.png" : "/natcash-logo-new.png"
                      }
                      alt=""
                      width={40}
                      height={28}
                      loading="lazy"
                      className="h-7 w-10 shrink-0 rounded-md border border-amber-200 bg-white object-contain p-0.5"
                    />
                    <div>
                      Apre w konfime kòmand la, w ap voye lajan an sou nimewo{" "}
                      <b>
                        {method === "moncash" ? "MonCash " : "NatCash "}
                        {payNumber ?? "(pa konfigire)"}
                      </b>
                      {payName ? <> ({payName})</> : null} epi telechaje prèv peman an sou paj
                      kòmand la. Yon administratè ap verifye epi konfime kòmand la.
                    </div>
                  </div>
                )}
              </div>

              <Button
                className="mt-6 h-auto w-full py-4 font-display font-extrabold"
                onClick={submit}
                disabled={submitting || platformFee.isLoading}
              >
                {submitting ? "Ap kreye…" : `Konfime kòmand la · ${formatHTG(total)}`}
              </Button>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
