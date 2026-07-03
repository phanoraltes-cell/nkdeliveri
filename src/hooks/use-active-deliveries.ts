import { useEffect, useState } from "react";
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
    restaurants?: { name: string; lat: number | null; lng: number | null } | null;
  } | null;
  driver?: { first_name: string | null; last_name: string | null } | null;
};

const ACTIVE_STATUSES = ["assigned", "picked_up", "in_transit"];

export function useActiveDeliveries(scope: {
  driverId?: string;
  customerId?: string;
  admin?: boolean;
}) {
  const [rows, setRows] = useState<ActiveDelivery[]>([]);

  const fetchAll = async () => {
    let q = supabase
      .from("deliveries")
      .select(
        "id, order_id, driver_id, status, driver_lat, driver_lng, location_updated_at, drivers(first_name, last_name), orders(order_number, delivery_lat, delivery_lng, delivery_address, customer_id, restaurants(name, lat, lng))"
      )
      .in("status", ACTIVE_STATUSES);
    if (scope.driverId) q = q.eq("driver_id", scope.driverId);
    const { data, error } = await q;
    if (error) {
      console.error("[useActiveDeliveries]", error);
      return;
    }
    const mapped = (data ?? [])
      .filter((d: any) =>
        scope.customerId ? d.orders?.customer_id === scope.customerId : true,
      )
      .map((d: any) => ({
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
    setRows(mapped);
  };

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel("active-deliveries")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deliveries" },
        () => fetchAll(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.driverId, scope.customerId, scope.admin]);

  return rows;
}

export function useDeliveryForOrder(orderId: string | undefined) {
  const [row, setRow] = useState<ActiveDelivery | null>(null);

  const fetchOne = async () => {
    if (!orderId) return;
    const { data, error } = await supabase
      .from("deliveries")
      .select(
        "id, order_id, driver_id, status, driver_lat, driver_lng, location_updated_at, drivers(first_name, last_name), orders(order_number, delivery_lat, delivery_lng, delivery_address, restaurants(name, lat, lng))"
      )
      .eq("order_id", orderId)
      .maybeSingle();
    if (error) {
      console.error("[useDeliveryForOrder]", error);
      return;
    }
    if (!data) return setRow(null);
    setRow({
      id: data.id,
      order_id: data.order_id,
      driver_id: data.driver_id,
      status: data.status,
      driver_lat: data.driver_lat,
      driver_lng: data.driver_lng,
      location_updated_at: data.location_updated_at,
      driver: (data as any).drivers,
      order: (data as any).orders,
    });
  };

  useEffect(() => {
    fetchOne();
    if (!orderId) return;
    const channel = supabase
      .channel(`delivery-order-${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deliveries", filter: `order_id=eq.${orderId}` },
        () => fetchOne(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  return row;
}