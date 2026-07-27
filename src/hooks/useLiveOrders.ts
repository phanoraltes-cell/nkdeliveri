import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CustomerLocation = {
  lat: number;
  lng: number;
  accuracy: number | null;
  updated_at: string;
};

export type ActiveDelivery = {
  id: string;
  order_id: string;
  driver_id: string | null;
  status: string;
  driver_lat: number | null;
  driver_lng: number | null;
  location_updated_at: string | null;
  customer_location: CustomerLocation | null;
  order?: {
    order_number: string;
    delivery_lat: number | null;
    delivery_lng: number | null;
    delivery_address: string | null;
    delivery_notes?: string | null;
    contact_phone: string | null;
    status: string;
    restaurants?: {
      name: string;
      lat: number | null;
      lng: number | null;
      address?: string | null;
      phone?: string | null;
    } | null;
    order_items?:
      { id: string; product_name: string; quantity: number; notes: string | null }[] | null;
  } | null;
  driver?: { first_name: string | null; last_name: string | null } | null;
};

export const ACTIVE_DELIVERY_STATUSES = [
  "assigned",
  "picked_up",
  "en_route_pickup",
  "en_route_dropoff",
] as const;

type Scope = { driverId?: string; customerId?: string; admin?: boolean };

// customer_delivery_locations is a 1:1 child (its PK is the FK to
// deliveries.id) but PostgREST's embed shape for that direction isn't
// worth depending on precisely — normalized defensively below either way.
function normalizeCustomerLocation(
  raw: CustomerLocation | CustomerLocation[] | null | undefined,
): CustomerLocation | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

const DELIVERY_SELECT =
  "id, order_id, driver_id, status, driver_lat, driver_lng, location_updated_at, drivers(first_name, last_name), customer_delivery_locations(lat, lng, accuracy, updated_at), orders(order_number, delivery_lat, delivery_lng, delivery_address, delivery_notes, contact_phone, status, customer_id, restaurants(name, lat, lng, address, phone), order_items(id, product_name, quantity, notes))";

async function fetchActiveDeliveries(scope: Scope): Promise<ActiveDelivery[]> {
  let q = supabase
    .from("deliveries")
    .select(DELIVERY_SELECT)
    .in("status", ACTIVE_DELIVERY_STATUSES);
  if (scope.driverId) q = q.eq("driver_id", scope.driverId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? [])
    .filter((d) => (scope.customerId ? d.orders?.customer_id === scope.customerId : true))
    .map((d) => ({
      id: d.id,
      order_id: d.order_id,
      driver_id: d.driver_id,
      status: d.status,
      driver_lat: d.driver_lat,
      driver_lng: d.driver_lng,
      location_updated_at: d.location_updated_at,
      customer_location: normalizeCustomerLocation(d.customer_delivery_locations),
      driver: d.drivers,
      order: d.orders,
    })) as ActiveDelivery[];
}

/**
 * Active deliveries for a driver/customer/admin scope, backed by TanStack
 * Query with Supabase Realtime driving cache invalidation (instead of a
 * manual refetch-on-event loop) — the map/list re-renders whenever any
 * delivery row changes, with no page reload.
 */
export function useLiveOrders(scope: Scope): ActiveDelivery[] {
  const qc = useQueryClient();
  const queryKey = ["live-orders", scope.driverId, scope.customerId, scope.admin] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchActiveDeliveries(scope),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const channel = supabase
      .channel("live-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "deliveries" }, () => {
        qc.invalidateQueries({ queryKey });
      })
      // Separate table from `deliveries` (see the schema comment in the
      // migration for why customer GPS isn't just columns on that row) —
      // needs its own subscription so a shared position update actually
      // shows up live instead of waiting for an unrelated deliveries change.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customer_delivery_locations" },
        () => qc.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.driverId, scope.customerId, scope.admin]);

  return query.data ?? [];
}

async function fetchOrderDelivery(orderId: string): Promise<ActiveDelivery | null> {
  const { data, error } = await supabase
    .from("deliveries")
    .select(DELIVERY_SELECT)
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    order_id: data.order_id,
    driver_id: data.driver_id,
    status: data.status,
    driver_lat: data.driver_lat,
    driver_lng: data.driver_lng,
    location_updated_at: data.location_updated_at,
    customer_location: normalizeCustomerLocation(data.customer_delivery_locations),
    driver: data.drivers,
    order: data.orders,
  };
}

/** Live delivery tracking for a single order (customer order-tracking page). */
export function useOrderDelivery(orderId: string | undefined): ActiveDelivery | null {
  const qc = useQueryClient();
  const queryKey = ["order-delivery", orderId] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchOrderDelivery(orderId!),
    enabled: !!orderId,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!orderId) return;
    const channel = supabase
      .channel(`order-delivery-${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deliveries", filter: `order_id=eq.${orderId}` },
        () => qc.invalidateQueries({ queryKey }),
      )
      // customer_delivery_locations has no order_id column to filter by
      // server-side (only delivery_id, not known ahead of the fetch above)
      // -- unfiltered is fine here, this channel only ever invalidates this
      // one order's query key regardless of which row changed.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customer_delivery_locations" },
        () => qc.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  return query.data ?? null;
}
