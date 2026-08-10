// Single source of truth for fixture business data — imported by BOTH
// the browser-side mock harness (e2e/support/mock-supabase.ts) and the
// Node-side SSR mock server (e2e/mocks/ssr-bootstrap-server.ts), so a
// restaurant/order/etc. looks identical whichever process answers the
// request. Column names match exactly what the app's queries/RPCs select
// (verified against the real schema throughout prior sessions on this
// project — see docs/DATABASE.md for the authoritative schema reference).

import { CUSTOMER_USER_ID, DRIVER_USER_ID, RESTAURANT_OWNER_USER_ID } from "./users";

export const RESTAURANT_ID = "50000000-0000-4000-8000-000000000001";
export const RESTAURANT_SLUG = "e2e-test-restaurant";
export const PRODUCT_ID = "50000000-0000-4000-8000-000000000002";
export const MENU_CATEGORY_ID = "50000000-0000-4000-8000-000000000003";
export const DRIVER_ID = "50000000-0000-4000-8000-000000000004";
export const ORDER_ID = "60000000-0000-4000-8000-000000000001";
export const PAYMENT_ID = "60000000-0000-4000-8000-000000000002";
export const DELIVERY_ID = "60000000-0000-4000-8000-000000000003";
export const DISPUTE_ID = "60000000-0000-4000-8000-000000000004";
export const AD_ID = "60000000-0000-4000-8000-000000000005";

export const restaurant = {
  id: RESTAURANT_ID,
  slug: RESTAURANT_SLUG,
  name: "Restoran Tès E2E",
  status: "approved",
  owner_id: RESTAURANT_OWNER_USER_ID,
  phone: "+509 1000 0000",
  logo_url: null,
  cover_url: null,
  cuisine: "Kreyòl",
  delivery_fee: 150,
  min_order: 0,
  avg_prep_time: 30,
  lat: 18.5392,
  lng: -72.3364,
  rating: 4.5,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const menuCategory = {
  id: MENU_CATEGORY_ID,
  restaurant_id: RESTAURANT_ID,
  name: "Plat Prensipal",
  sort_order: 1,
};

export const product = {
  id: PRODUCT_ID,
  restaurant_id: RESTAURANT_ID,
  menu_category_id: MENU_CATEGORY_ID,
  name: "Diri ak Pwa",
  description: "Yon plat tès pou E2E",
  price: 500,
  image_url: null,
  available: true,
};

export const driver = {
  id: DRIVER_ID,
  user_id: DRIVER_USER_ID,
  first_name: "Livrè",
  last_name: "Tès",
  phone: "+509 2000 0000",
  status: "online",
  current_lat: 18.54,
  current_lng: -72.335,
  moncash_number: "+509 2000 0000",
  moncash_account_name: "Livrè Tès",
  natcash_number: null,
  natcash_account_name: null,
  commission_rate: 100,
  payout_frequency: "daily",
};

/** Base order fixture — `status`/`payment` overridden per-spec via spread for flows that need a different lifecycle stage (e.g. `{...order, status: "delivered"}` for the review-section spec). */
export const order = {
  id: ORDER_ID,
  order_number: "NK-E2E01",
  customer_id: CUSTOMER_USER_ID,
  restaurant_id: RESTAURANT_ID,
  status: "pending",
  subtotal: 500,
  delivery_fee: 150,
  service_fee: 0,
  total: 650,
  currency: "HTG",
  delivery_address: "123 Ri Tès, Pòtoprens",
  contact_phone: "+509 3000 0000",
  delivery_notes: "",
  status_history: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  wants_location_sharing: false,
  restaurants: {
    name: restaurant.name,
    slug: restaurant.slug,
    lat: restaurant.lat,
    lng: restaurant.lng,
  },
  order_items: [
    {
      product_name: product.name,
      quantity: 1,
      unit_price: product.price,
      line_total: product.price,
    },
  ],
};

export const payment = {
  id: PAYMENT_ID,
  order_id: ORDER_ID,
  method: "kach",
  status: "pending",
  amount: order.total,
  currency: "HTG",
  cash_confirmation_status: "pending",
  customer_confirmed_at: null,
  driver_confirmed_at: null,
  receiver_type: "admin",
  receiver_number: null,
  receiver_account_name: null,
  payment_transactions: [],
};

export const delivery = {
  id: DELIVERY_ID,
  order_id: ORDER_ID,
  driver_id: DRIVER_ID,
  status: "assigned",
  fee: 100,
  driver_lat: driver.current_lat,
  driver_lng: driver.current_lng,
  driver_heading: 0,
  assigned_at: "2026-01-01T00:05:00Z",
  picked_up_at: null,
  delivered_at: null,
};

export const dispute = {
  id: DISPUTE_ID,
  order_id: ORDER_ID,
  status: "open",
  assigned_to: null,
  admin_notes: null,
  resolution: null,
  created_at: "2026-01-01T00:10:00Z",
  orders: { order_number: order.order_number },
};

export const wallet = {
  restaurant: {
    restaurant_id: RESTAURANT_ID,
    available_balance: 4500,
    pending_balance: 0,
    paid_balance: 12000,
    lifetime_earnings: 16500,
  },
  driver: {
    driver_id: DRIVER_ID,
    available_balance: 900,
    pending_balance: 0,
    paid_balance: 3000,
    lifetime_earnings: 3900,
  },
};

export const sponsoredPlacement = {
  id: AD_ID,
  placement: "home_banner",
  title: "Anons Tès E2E",
  image_url: null,
  link_url: null,
  restaurant_id: RESTAURANT_ID,
  is_active: true,
  priority: 0,
  start_date: "2026-01-01",
  end_date: "2026-12-31",
};

export const notification = {
  id: "60000000-0000-4000-8000-000000000006",
  type: "order_status_changed",
  category: "order",
  title: "Kòmand ou a konfime",
  body: `Kòmand ${order.order_number} konfime.`,
  data: { order_id: ORDER_ID },
  read_at: null,
  hidden_at: null,
  created_at: "2026-01-01T00:02:00Z",
};

// Mirrors the real production seed
// (supabase/migrations/20260803120000_payment_provider_settings.sql +
// 20260805120000_natcash_automatik_integration.sql) — Cash is the default
// and enabled; MonCash Otomatik and NatCash Otomatik both start disabled.
// Any checkout-touching spec needs this mocked, or every method
// (including Cash) renders disabled — payment-provider-availability.ts
// treats an empty settings response as "nothing is enabled", never as
// "fall back to some default", by design (the backend must never assume
// availability).
export const paymentProviderSettings = [
  {
    provider: "kach",
    visible: true,
    enabled: true,
    default_provider: true,
    maintenance_message: null,
  },
  {
    provider: "moncash",
    visible: true,
    enabled: true,
    default_provider: false,
    maintenance_message: null,
  },
  {
    provider: "natcash",
    visible: true,
    enabled: true,
    default_provider: false,
    maintenance_message: null,
  },
  {
    provider: "moncash_auto",
    visible: true,
    enabled: false,
    default_provider: false,
    maintenance_message: "MonCash Otomatik ap retounen byento.",
  },
  {
    provider: "natcash_auto",
    visible: true,
    enabled: false,
    default_provider: false,
    maintenance_message: "NatCash Otomatik ap retounen byento.",
  },
];
