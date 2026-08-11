import { useEffect } from "react";
import { useRoute } from "@/hooks/useRoute";
import { nextStopFor } from "@/components/dashboard/driver/delivery-route-info.logic";
import type { ActiveDelivery } from "@/hooks/useLiveOrders";

export type DeliveryRouteResult = {
  path: [number, number][] | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  isLoading: boolean;
};

type DeliveryRouteFetcherProps = {
  delivery: ActiveDelivery;
  onRoute: (deliveryId: string, result: DeliveryRouteResult) => void;
};

/**
 * Headless: computes one delivery's route to its next stop (reusing the
 * same nextStopFor logic the driver dashboard uses) and reports it up via
 * onRoute. Rendered once per active delivery by LiveMapSection — a loop
 * can't call useRoute directly (rules of hooks), so each delivery gets its
 * own mounted instance of this component instead.
 */
export function DeliveryRouteFetcher({ delivery, onRoute }: DeliveryRouteFetcherProps) {
  const { from, target } = nextStopFor(delivery);
  const route = useRoute(from, target);

  useEffect(() => {
    onRoute(delivery.id, {
      path: route.data?.path ?? null,
      distanceMeters: route.data?.distanceMeters ?? null,
      durationSeconds: route.data?.durationSeconds ?? null,
      isLoading: route.isLoading,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.data, route.isLoading, delivery.id]);

  return null;
}
