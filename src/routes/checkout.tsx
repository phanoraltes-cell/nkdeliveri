import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCart } from "@/hooks/useCart";
import { formatHTG } from "@/lib/format";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Tag, X, Truck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { noIndexMeta } from "@/lib/seo";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { sendNewOrderPush } from "@/lib/send-order-push.functions";
import { sendCollectPaymentAdminErrorPush } from "@/lib/send-collect-payment-admin-error-push.functions";
import { inputCls } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { initiateCollectPayment } from "@/lib/initiate-collect-payment.functions";
import { usePaymentProviderAvailability } from "@/hooks/usePaymentProviderAvailability";
import { useDeliveryFee } from "@/hooks/useDeliveryFee";
import { getOrCreateIdempotencyKey, clearIdempotencyKey } from "@/lib/checkout-idempotency";
import { useIsRestaurantOpen } from "@/hooks/useIsRestaurantOpen";
import { isNetworkError, translateSupabaseError, NETWORK_GIVE_UP_MESSAGE } from "@/lib/rpc-errors";
import {
  getDefaultProvider,
  getProviderSetting,
  type PaymentProviderSetting,
} from "@/lib/payment-provider-availability";
import { CheckoutHeader } from "@/components/checkout/checkout-header";
import { OrderItemsStrip } from "@/components/checkout/order-items-strip";
import {
  OTHER_METHODS,
  PaymentMethodsSection,
  type CheckoutMethod,
} from "@/components/checkout/payment-methods-section";
import {
  decideWalletSubmit,
  isWalletActive,
  resolveWalletDisplayState,
} from "@/lib/wallet-payment-display";

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
  // Tach 1 — wallet la gen yon ranje kounye a (migrasyon 20260904000000) pou
  // yon admin ka etenn peman otomatik ak wallet si gen yon pwoblèm.
  {
    provider: "wallet",
    visible: true,
    enabled: true,
    defaultProvider: false,
    maintenanceMessage: null,
  },
];

export const Route = createFileRoute("/checkout")({
  head: () => noIndexMeta("Peman — NK Deliveri"),
  component: Checkout,
});

/**
 * Tan livrezon estime: tan prepare restoran an (`avg_prep_time`, done
 * reyèl) plis yon fenèt woutaj. Nou montre yon FOUCHÈT, pa yon chif egzat —
 * nou pa gen okenn estimasyon woutaj reyèl, epi pwomèt "35 min" nèt se
 * pwomèt yon bagay nou pa ka garanti.
 */
const DELIVERY_MIN_EXTRA = 20;
const DELIVERY_MAX_EXTRA = 35;

// NKD-012 — Senaryo A: connection drops after create_order_secure's
// request is sent but before the response arrives. A network failure
// (isNetworkError) is retried automatically, with the *same* idempotency
// key (NKD-011) — the RPC itself either creates the order or, if a
// previous attempt already did, returns that same order_id instead of a
// duplicate. A real business rejection (insufficient stock, etc.) always
// carries a Postgres code and is thrown immediately, never retried.
const NETWORK_RETRY_ATTEMPTS = 2;
const NETWORK_RETRY_DELAY_MS = 1000;

async function createOrderWithRetry(
  payload: Database["public"]["Functions"]["create_order_secure"]["Args"],
): Promise<{ orderId: string } | { networkFailure: true }> {
  for (let attempt = 0; attempt <= NETWORK_RETRY_ATTEMPTS; attempt++) {
    const { data, error } = await supabase.rpc("create_order_secure", payload);
    if (!error) return { orderId: data as string };
    if (!isNetworkError(error)) throw error;
    if (attempt === NETWORK_RETRY_ATTEMPTS) return { networkFailure: true };
    await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS * (attempt + 1)));
  }
  return { networkFailure: true };
}

function Checkout() {
  const { items, setQty, setItemNotes, subtotal, count, clear } = useCart();
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
  // them). `wallet` pa yon "default" valab isit la: li gen pwòp liy pa l
  // epi se sèvè a ki chwazi l (Tach 1), donk nou tonbe sou 'kach'.
  useEffect(() => {
    if (methodTouchedByUser || !providerAvailability.data) return;
    const fallback = getDefaultProvider(providerAvailability.data);
    const isOtherMethod = OTHER_METHODS.some((m) => m.id === fallback);
    setMethod(isOtherMethod ? (fallback as CheckoutMethod) : "kach");
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
  // Gad doub-klik la. `submitting` (eta React) pa ase pou kont li: de
  // evènman klik ki rive nan MENM tick la wè toude ansyen valè `false` la
  // paske React pa fin re-rann ant yo. Yon ref chanje SINKWÒN, donk
  // dezyèm klik la sòti imedyatman. Bouton an `disabled` tou — de kouch,
  // paske se yon kòmand ak lajan dèyè l.
  const submittingRef = useRef(false);
  const nav = useNavigate();
  const sendNewOrderPushFn = useServerFn(sendNewOrderPush);
  const sendCollectPaymentAdminErrorPushFn = useServerFn(sendCollectPaymentAdminErrorPush);

  const cartRestaurantId = items[0]?.restaurantId;

  const platformPayout = useQuery({
    queryKey: ["platform-payout-public"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_platform_payout_public");
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Tach 1C/3C — chak wallet kliyan an ka peye ak li: pwòp wallet kliyan
  // li a, plis (Tach 3C) nenpòt wallet restoran li posede oswa wallet
  // livrè li a, si genyen. Sèvè a (create_order_secure) DESIDE epi
  // reverifye balans AK dwa posesyon an endepandan — sa a se sèlman pou
  // afichaj (Tach 1, twa ka yo).
  const payableWallets = useQuery({
    queryKey: ["my-payable-wallets", user?.id, cartRestaurantId],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_payable_wallets_secure", {
        _restaurant_id: cartRestaurantId,
      });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30 * 1000,
  });

  // Tach 3C — ki wallet pou itilize (defo: premye youn ki pa bloke pou
  // self-ordering, souvan sèl wallet kliyan an).
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  useEffect(() => {
    if (selectedWalletId || !payableWallets.data?.length) return;
    // Nou prefere yon wallet ki EGZISTE tout bon epi ki gen lajan ladan l.
    // Ranje "wallet kliyan" an toujou la menm lè kliyan an pa janm rechaje
    // (wallet_id NULL, balans 0 — wè get_my_payable_wallets_secure); si nou
    // te chwazi l tou senpleman paske li premye, yon restoratè ki gen
    // lajan nan wallet restoran li pa t ap janm wè opsyon wallet la.
    const withFunds = payableWallets.data.find(
      (w) => !w.self_order_blocked && w.wallet_id && Number(w.available_balance) > 0,
    );
    const firstUsable = withFunds ?? payableWallets.data.find((w) => !w.self_order_blocked);
    setSelectedWalletId(firstUsable?.wallet_id ?? payableWallets.data[0].wallet_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payableWallets.data]);

  // Tach 1 — SÈL bagay kliyan an ka di sou wallet la: "mwen vle yon lòt
  // metòd". Tout rès la (montan, si wallet la debite, si kòmand la konte
  // kòm peye) se sèvè a ki deside — wè migrasyon 20260904000000.
  const [walletOptOut, setWalletOptOut] = useState(false);

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
  // time (public.platform_delivery_zones' default zone).
  const platformFee = useDeliveryFee();
  // Si frè a pa li, nou PA fè semblan li se 0: total la ta fo, epi moun nan
  // ta konfime yon montan ki pa sa sèvè a pral chaje. Nou bloke bouton an
  // epi nou di poukisa (wè `feeUnavailable` pi ba).
  const feeUnavailable = !platformFee.isLoading && !Number.isFinite(platformFee.data);
  const deliveryFee = items.length > 0 ? (platformFee.data ?? 0) : 0;
  const serviceFee = 0;

  // Tach 2 §3 — tan estime. `avg_prep_time` se yon done reyèl restoran an.
  const restaurantInfo = useQuery({
    queryKey: ["checkout-restaurant-info", cartRestaurantId],
    enabled: !!cartRestaurantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, avg_prep_time")
        .eq("id", cartRestaurantId!)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Minimal client-side safety net (see useIsRestaurantOpen's own comment)
  // — `create_order_secure` still re-verifies server-side regardless.
  const isOpenQuery = useIsRestaurantOpen(cartRestaurantId);
  const restaurantClosed = isOpenQuery.data === false;

  // Tach 3 — pwomosyon restoran OTOMATIK. Menm fonksyon
  // (compute_restaurant_promotion_discount) ke create_order_secure rele
  // pou verite final la — apesi a pa ka janm "gaye" de kalkil sèvè a.
  const itemsPayload = items.map((it) => ({ product_id: it.productId, quantity: it.qty }));
  const promotionQueryEnabled = !!cartRestaurantId && items.length > 0;
  const restaurantPromotion = useQuery({
    queryKey: ["active-restaurant-promotion", cartRestaurantId, itemsPayload],
    enabled: promotionQueryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("compute_restaurant_promotion_discount", {
        _restaurant_id: cartRestaurantId!,
        _items: itemsPayload,
      });
      if (error) throw error;
      return Array.isArray(data) ? (data[0] ?? null) : null;
    },
  });
  const promotionDiscount = Number(restaurantPromotion.data?.discount_amount ?? 0);
  const subtotalAfterPromotion = subtotal - promotionDiscount;

  // Tach 2 §2 — ki plat ki gen badj. `compute_restaurant_promotion_discount`
  // bay sèlman yon montan total, pa yon lis plat, donk nou li pwomosyon an
  // li menm (`scope`/`dish_ids`) pou nou pa envante yon badj sou yon plat
  // ki pa nan pwomosyon an.
  const promotionId = restaurantPromotion.data?.promotion_id ?? null;
  const promotionDetail = useQuery({
    queryKey: ["checkout-promotion-detail", promotionId],
    enabled: !!promotionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("promotions")
        .select("id, scope, dish_ids")
        .eq("id", promotionId!)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 1000,
  });

  const productIdsKey = items
    .map((it) => it.productId)
    .sort()
    .join(",");
  const cartProducts = useQuery({
    queryKey: ["checkout-cart-products", productIdsKey],
    enabled: productIdsKey.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, stock_quantity")
        .in("id", productIdsKey.split(","));
      if (error) throw error;
      return data;
    },
    staleTime: 30 * 1000,
  });

  const itemBadges = useMemo(() => {
    const stockByProductId = new Map<string, number>();
    for (const p of cartProducts.data ?? []) {
      if (p.stock_quantity !== null) stockByProductId.set(p.id, p.stock_quantity);
    }
    const detail = promotionDetail.data;
    const promoDishIds = new Set<string>(
      !detail
        ? []
        : detail.scope === "menu"
          ? items.map((it) => it.productId)
          : (detail.dish_ids ?? []),
    );
    return { promoDishIds, stockByProductId };
  }, [cartProducts.data, promotionDetail.data, items]);

  // Tach 2 — kòd pwomo. `atSubtotal` gade valè (apre pwomosyon restoran an)
  // la te genyen lè kòd la aplike: yon pousantaj rabè depann de sa, donk si
  // panye a chanje apre, apesi a ka vin fo. Effect anba a efase apesi a
  // otomatikman nan ka sa a — SÈVÈ a refè tout kalkil la kanmenm.
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    discountAmount: number;
    atSubtotal: number;
  } | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);

  useEffect(() => {
    if (appliedPromo && appliedPromo.atSubtotal !== subtotalAfterPromotion) {
      setAppliedPromo(null);
      toast.info("Panye a chanje — tanpri re-aplike kòd pwomo a.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotalAfterPromotion]);

  async function applyPromoCode() {
    const code = promoCodeInput.trim();
    if (!code) return;
    setCheckingPromo(true);
    try {
      const { data, error } = await supabase.rpc("validate_promo_code_secure", {
        _code: code,
        _subtotal: subtotalAfterPromotion,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.valid) {
        toast.error(result?.message || "Kòd pwomo sa a envalid.");
        return;
      }
      setAppliedPromo({
        code: code.toUpperCase(),
        discountAmount: Number(result.discount_amount),
        atSubtotal: subtotalAfterPromotion,
      });
      toast.success(result.message || "Kòd pwomo aplike!");
    } catch (e) {
      toast.error(translateSupabaseError(e));
    } finally {
      setCheckingPromo(false);
    }
  }

  function removePromoCode() {
    setAppliedPromo(null);
    setPromoCodeInput("");
  }

  const discountAmount = appliedPromo?.discountAmount ?? 0;
  const total = subtotalAfterPromotion - discountAmount + deliveryFee + serviceFee;

  // =========================================================================
  // TACH 1 — twa ka afichaj yo.
  //
  // ATANSYON: sa ki anba a se AFICHAJ. Sèvè a re-deside tout bagay ak pwòp
  // total pa l (create_order_secure). Si de yo pa dakò — pa egzanp frè
  // livrezon an fèk chanje — se sèvè a ki genyen, epi nou jwenn yon refi
  // pwòp ("balans pa ase") olye yon kòmand ki peye ak yon lòt metòd an
  // silans.
  // =========================================================================
  const walletSetting = getProviderSetting(providerSettings, "wallet");
  // Menm COALESCE ak SQL la: yon ranje ki manke = aktive. Sa evite yon
  // dekalaj kote kòd la deplwaye anvan migrasyon an aplike epi wallet la
  // disparèt nèt pou tout moun.
  const walletEnabled = walletSetting?.enabled ?? true;

  const wallets = useMemo(() => payableWallets.data ?? [], [payableWallets.data]);
  const selectedWallet = wallets.find((w) => w.wallet_id === selectedWalletId) ?? null;
  const walletBalance = Number(selectedWallet?.available_balance ?? 0);

  // Total la pa final toutotan frè livrezon an oswa pwomosyon an poko rive.
  // Deside sou yon total pwovizwa ta fè liy wallet la sote ant "ase" ak
  // "pa ase" devan je moun nan.
  const totalReady =
    !platformFee.isLoading &&
    !feeUnavailable &&
    (!promotionQueryEnabled || !restaurantPromotion.isLoading);

  const walletState = resolveWalletDisplayState({
    signedIn: !!user,
    walletsLoading: payableWallets.isLoading,
    totalReady,
    totalUnavailable: feeUnavailable,
    walletEnabled,
    walletId: selectedWallet?.wallet_id ?? null,
    balance: walletBalance,
    selfOrderBlocked: selectedWallet?.self_order_blocked ?? false,
    total,
  });

  const walletActive = isWalletActive(walletState, walletOptOut);

  // "MonCash Otomatik"/"NatCash Otomatik" move money through the same rail
  // as their manual counterpart — create_order_secure only knows the rail
  // (payment_method enum), never *how* it gets confirmed.
  const orderMethod =
    method === "moncash_auto" ? "moncash" : method === "natcash_auto" ? "natcash" : method;

  const payNumber =
    orderMethod === "moncash"
      ? (platformPayout.data?.moncash_number ?? null)
      : orderMethod === "natcash"
        ? (platformPayout.data?.natcash_number ?? null)
        : null;
  const payName =
    orderMethod === "moncash"
      ? (platformPayout.data?.moncash_account_name ?? null)
      : orderMethod === "natcash"
        ? (platformPayout.data?.natcash_account_name ?? null)
        : null;

  const prepTime = restaurantInfo.data?.avg_prep_time ?? null;
  const etaLabel =
    prepTime === null
      ? null
      : `${prepTime + DELIVERY_MIN_EXTRA}–${prepTime + DELIVERY_MAX_EXTRA} min`;

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
    if (restaurantClosed) {
      toast.error("Restoran an fèmen kounye a. Tanpri eseye pita.");
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const rId = items[0].restaurantId;
      const idempotencyKey = getOrCreateIdempotencyKey();
      // TACH 1 — sa nou voye bay sèvè a. Lojik la nan
      // src/lib/wallet-payment-display.ts (teste inè pa inè), pa isit la.
      const walletSubmit = decideWalletSubmit({
        state: walletState,
        walletOptOut,
        fallbackMethod: orderMethod,
        selectedWalletId,
      });
      const orderResult = await createOrderWithRetry({
        _restaurant_id: rId,
        _items: items.map((it) => ({
          product_id: it.productId,
          quantity: it.qty,
          notes: it.notes?.trim() || undefined,
        })),
        _delivery_address: address,
        _contact_phone: phone,
        _delivery_notes: notes || "",
        _method: walletSubmit.method,
        _allow_wallet: walletSubmit.allowWallet,
        _wallet_id: walletSubmit.walletId,
        _wants_location_sharing: wantsLocationSharing,
        _idempotency_key: idempotencyKey,
        // Sèvè a refè TOUT kalkil rabè a ankò tou sèl — sa a se sèlman ki
        // kòd kliyan an te antre, jamè yon montan.
        _promo_code: appliedPromo?.code,
      });
      if ("networkFailure" in orderResult) {
        // Deliberately not a hard error state — the order may well have
        // been created server-side (that's exactly Senaryo A). Same
        // idempotency key stays saved for the next manual retry.
        toast.error(NETWORK_GIVE_UP_MESSAGE, {
          action: { label: "Wè kòmand mwen yo", onClick: () => nav({ to: "/orders" }) },
        });
        return;
      }
      const orderId = orderResult.orderId;
      // The order now definitively exists — this attempt is done, whatever
      // happens in the payment-initiation steps below.
      clearIdempotencyKey();

      // Best-effort — a failed push send must never block order creation.
      sendNewOrderPushFn({ data: { orderId } }).catch((e) =>
        console.warn("[push] new-order notify failed", e),
      );

      // TACH 1 — SE SÈVÈ A KI TE DESIDE, donk se li menm nou mande kisa ki
      // te pase, pa eta lokal nou an. Yon rekèt ki te di "kach" ka byen
      // sòti kòm yon kòmand peye ak wallet. Si nou te fè konfyans ak
      // `walletActive` isit la, nou ta ka di yon moun "voye prèv peman w"
      // pou yon kòmand ki DEJA peye — oswa pi mal, kòmanse yon koleksyon
      // MonCash sou li epi fè l peye de fwa.
      //
      // Nou sote rekèt la lè `walletActive`: nan ka sa a nou te voye
      // `_method: 'wallet'` epi RPC la reyisi, donk peman an se wallet, san
      // dout posib — pa gen anyen pou n mande.
      const paymentLookup = walletActive
        ? null
        : await supabase.from("payments").select("id, method").eq("order_id", orderId).single();
      const paymentRow = paymentLookup?.data ?? null;
      const paidByWallet = walletActive || paymentRow?.method === "wallet";

      if (
        !paidByWallet &&
        (method === "moncash_auto" || method === "natcash_auto" || method === "stripe")
      ) {
        // The order already exists at this point — a failure from here on
        // is a payment-initiation problem, never a reason to let the
        // customer land back on this form with the cart still full (a
        // resubmit would create a duplicate order). Once the order exists,
        // it — not the cart — is the source of truth.
        if (!paymentRow) {
          clear();
          toast.error("Kòmand kreye, men nou pa jwenn peman an. Kontakte sipò.");
          nav({ to: "/orders/$id", params: { id: orderId } });
          return;
        }

        const result = await initiateCollect({ data: { paymentId: paymentRow.id } });
        if (result.outcome === "failed") {
          // Best-effort admin push — create_collect_payment_secure already
          // recorded this in-app; this is the push sibling. A failure here
          // must never alter the customer-facing outcome below.
          sendCollectPaymentAdminErrorPushFn({ data: { paymentId: paymentRow.id } }).catch((e) =>
            console.warn("[push] collect-payment-admin-error notify failed", e),
          );
          clear();
          toast.error(
            result.error ||
              "Kòmand kreye, men peman otomatik la pa reyisi kòmanse. Ou ka eseye ankò nan paj kòmand la.",
          );
          nav({ to: "/orders/$id", params: { id: orderId } });
          return;
        }
        if (result.outcome === "already_confirmed") {
          clear();
          toast.success("Peman an konfime! N ap trete kòmand ou an.");
          nav({ to: "/orders/$id", params: { id: orderId } });
          return;
        }
        clear();
        window.location.href = result.redirectUrl;
        return;
      }

      clear();
      toast.success(
        paidByWallet
          ? "Kòmand peye ak wallet ou — konfime imedyatman!"
          : orderMethod === "moncash" || orderMethod === "natcash"
            ? "Kòmand kreye! Kounye a voye prèv peman w lan pou nou konfime li."
            : "Kòmand kreye ak siksè",
      );
      nav({ to: "/orders/$id", params: { id: orderId } });
    } catch (e) {
      // NKD-012: create_order_secure's own RAISE EXCEPTION (business
      // errors) always carries a Postgres code and reaches here unchanged;
      // a genuine network failure was already retried inside
      // createOrderWithRetry. isNetworkError stays as a safety net for a
      // failure elsewhere in this try block.
      if (isNetworkError(e)) {
        toast.error(NETWORK_GIVE_UP_MESSAGE, {
          action: { label: "Wè kòmand mwen yo", onClick: () => nav({ to: "/orders" }) },
        });
      } else {
        toast.error(translateSupabaseError(e));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const confirmDisabled = submitting || !totalReady || restaurantClosed;

  return (
    <div className="min-h-screen bg-cream">
      <CheckoutHeader />

      {/* pb: laj ba kole anba a (bouton 3rem + espasman) plis zòn san
          danje iOS la, pou dènye seksyon an pa janm kache dèyè l. */}
      <main className="mx-auto max-w-[720px] px-4 pt-5 pb-[calc(6.5rem+var(--sab))]">
        {count === 0 ? (
          <div className="rounded-3xl bg-white p-8 text-center shadow-brand-md ring-1 ring-brand-soft/40">
            <p className="text-ink-soft">Panye w vid pou kounye a.</p>
            <Link
              to="/"
              className="mt-3 inline-flex h-11 items-center rounded-xl bg-brand px-5 font-bold text-white transition hover:bg-brand-deep"
            >
              Kòmanse kòmande
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {restaurantClosed && (
              <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
                Nou fèmen kounye a. Tanpri eseye pita.
              </div>
            )}
            {feeUnavailable && (
              <div
                role="alert"
                className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800"
              >
                Nou pa ka kalkile frè livrezon an kounye a, donk nou pa ka montre w total la. Tanpri
                rechaje paj la nan yon ti moman — nou p ap kite w konfime yon montan nou pa sèten de
                li.
              </div>
            )}

            {/* ---------- §2 Rezime plat yo ---------- */}
            <OrderItemsStrip
              items={items}
              setQty={setQty}
              setItemNotes={setItemNotes}
              badges={itemBadges}
              promotionTitle={
                promotionDiscount > 0 ? (restaurantPromotion.data?.title ?? null) : null
              }
            />

            {/* ---------- §3 Livrezon ---------- */}
            <section aria-labelledby="checkout-delivery-title" className="min-w-0">
              <h2
                id="checkout-delivery-title"
                className="mb-3 font-display text-base font-bold text-ink"
              >
                Livrezon
              </h2>

              {/* Yon sèl opsyon livrezon egziste jodi a (yon frè platfòm
                  inik, `platform_delivery_zones`). Nou montre l kòm sa l ye
                  — yon opsyon chwazi — olye nou envante de nivo sèvis ki pa
                  egziste nan baz done a. */}
              <div className="flex items-center gap-3 rounded-2xl border-2 border-brand bg-brand-soft/40 p-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white"
                >
                  <Truck className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block text-sm text-ink">Livrezon estanda</b>
                  {/* `text-ink`, PA `text-ink-soft`: sou fon `bg-brand-soft/40`
                      la (#feead6) ink-soft bay yon kontras 3.96:1, anba
                      minimòm WCAG AA 4.5:1 (axe konfime l). */}
                  <small className="block text-xs text-ink">
                    {restaurantInfo.isLoading
                      ? "N ap kalkile tan an…"
                      : etaLabel
                        ? `Rive nan ${etaLabel} apeprè`
                        : "Tan an depann de restoran an"}
                  </small>
                </div>
                <b className="shrink-0 text-sm tabular-nums text-ink">
                  {platformFee.isLoading ? "…" : feeUnavailable ? "—" : formatHTG(deliveryFee)}
                </b>
              </div>

              <div className="mt-3 rounded-2xl border border-brand-soft bg-white p-4">
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
                        <MapPin className="h-3 w-3" aria-hidden="true" />{" "}
                        {a.label || a.address_line}
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
            </section>

            {/* ---------- §4 Metòd peman (wallet an premye) ---------- */}
            <PaymentMethodsSection
              providerSettings={providerSettings}
              method={method}
              onSelectMethod={selectMethod}
              walletState={walletState}
              walletOptOut={walletOptOut}
              onWalletOptOut={setWalletOptOut}
              wallets={wallets}
              selectedWalletId={selectedWalletId}
              onSelectWallet={setSelectedWalletId}
              payNumber={payNumber}
              payName={payName}
            />

            {/* ---------- §5 Kòd pwomo ---------- */}
            <section aria-labelledby="checkout-promo-title" className="min-w-0">
              <h2
                id="checkout-promo-title"
                className="mb-2 flex items-center gap-1.5 font-display text-base font-bold text-ink"
              >
                <Tag className="h-4 w-4 text-brand-deep" aria-hidden="true" /> Kòd pwomo
              </h2>
              {appliedPromo ? (
                <div className="flex items-center justify-between rounded-xl border-2 border-status-good bg-status-good-soft px-3 py-2 text-sm font-bold text-status-good">
                  <span>
                    {appliedPromo.code} · -{formatHTG(appliedPromo.discountAmount)}
                  </span>
                  <button
                    type="button"
                    onClick={removePromoCode}
                    aria-label="Retire kòd pwomo a"
                    className="text-status-good hover:opacity-70"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    id="checkout-promo"
                    value={promoCodeInput}
                    onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void applyPromoCode();
                      }
                    }}
                    placeholder="Antre yon kòd…"
                    aria-label="Kòd pwomo"
                    className={inputCls() + " flex-1"}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    isLoading={checkingPromo}
                    disabled={!promoCodeInput.trim()}
                    onClick={applyPromoCode}
                  >
                    Aplike
                  </Button>
                </div>
              )}
            </section>

            {/* ---------- §6 Rezime pri ---------- */}
            <section
              aria-labelledby="checkout-summary-title"
              className="rounded-2xl border border-brand-soft bg-white p-4"
            >
              <h2
                id="checkout-summary-title"
                className="mb-2 font-display text-base font-bold text-ink"
              >
                Rezime pri
              </h2>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between text-ink-soft">
                  <dt>Sou-total</dt>
                  <dd className="tabular-nums">{formatHTG(subtotal)}</dd>
                </div>
                {promotionDiscount > 0 && restaurantPromotion.data && (
                  <div className="flex justify-between font-semibold text-status-good">
                    <dt>🎉 {restaurantPromotion.data.title}</dt>
                    <dd className="tabular-nums">-{formatHTG(promotionDiscount)}</dd>
                  </div>
                )}
                {discountAmount > 0 && (
                  <div className="flex justify-between font-semibold text-status-good">
                    <dt>Rabè ({appliedPromo?.code})</dt>
                    <dd className="tabular-nums">-{formatHTG(discountAmount)}</dd>
                  </div>
                )}
                <div className="flex justify-between text-ink-soft">
                  <dt>Frè livrezon</dt>
                  <dd className="tabular-nums">
                    {platformFee.isLoading ? "…" : feeUnavailable ? "—" : formatHTG(deliveryFee)}
                  </dd>
                </div>
                <div className="mt-2 flex justify-between border-t-2 border-brand-soft pt-3 font-display text-lg font-extrabold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{totalReady ? formatHTG(total) : "—"}</dd>
                </div>
              </dl>
              {walletActive && (
                <p className="mt-2 text-xs font-semibold text-status-good">
                  Total la ap retire nan wallet ou lè w konfime.
                </p>
              )}
            </section>
          </div>
        )}
      </main>

      {/* ---------- §7 Ba kole anba a ---------- */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-brand-soft bg-white/95 pb-[var(--sab)] backdrop-blur">
          <div className="mx-auto flex max-w-[720px] items-center gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-xs text-ink-soft">Total</div>
              <div className="font-display text-lg font-extrabold tabular-nums text-ink">
                {totalReady ? formatHTG(total) : "—"}
              </div>
            </div>
            <Button
              className="ml-auto h-12 w-full max-w-[260px] font-display font-extrabold"
              onClick={submit}
              isLoading={submitting}
              disabled={confirmDisabled}
            >
              {restaurantClosed
                ? "Restoran an fèmen"
                : feeUnavailable
                  ? "Total la endisponib"
                  : walletActive
                    ? "Peye ak wallet"
                    : "Konfime kòmand la"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
