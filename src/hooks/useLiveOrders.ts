import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ActiveDelivery = {
  id: string;
  order_id: string;
  driver_id: string | null;
  status: string;
  driver_lat: number | null;
  driver_lng: number | null;
  location_updated_at: string | null;
  order?: {
    order_number: string;
    delivery_lat: number | null;
    delivery_lng: number | null;
    delivery_address: string | null;
    contact_phone: string | null;
    status: string;
    restaurants?: { name: string; lat: number | null; lng: number | null } | null;
  } | null;
  driver?: { first_name: string | null; last_name: string | null } | null;
};

const ACTIVE_STATUSES = ["assigned", "picked_up", "en_route_pickup", "en_route_dropoff"] as const;

type Scope = { driverId?: string; customerId?: string; admin?: boolean };

async function fetchActiveDeliveries(scope: Scope): Promise<ActiveDelivery[]> {
  let q = supabase
    .from("deliveries")
    .select(
      "id, order_id, driver_id, status, driver_lat, driver_lng, location_updated_at, drivers(first_name, last_name), orders(order_number, delivery_lat, delivery_lng, delivery_address, contact_phone, status, customer_id, restaurants(name, lat, lng))",
    )
    .in("status", ACTIVE_STATUSES);
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
    .select(
      "id, order_id, driver_id, status, driver_lat, driver_lng, location_updated_at, drivers(first_name, last_name), orders(order_number, delivery_lat, delivery_lng, delivery_address, contact_phone, status, restaurants(name, lat, lng))",
    )
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  return query.data ?? null;
}
