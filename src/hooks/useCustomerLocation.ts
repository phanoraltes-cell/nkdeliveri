import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CustomerPosition = { lat: number; lng: number; accuracy: number | null; ts: number };

const PUSH_THROTTLE_MS = 8000;

/**
 * Customer-side counterpart to useDriverLocation.ts — same watchPosition +
 * 8s throttle + permission-vs-transient error handling, but writes go
 * through push_customer_location_secure (a SECURITY DEFINER RPC) instead
 * of a raw table .update(): unlike the driver's own delivery row, RLS
 * alone can't restrict a customer's write to just lat/lng/accuracy on a
 * shared table, so the RPC is the only point that can make that
 * column-level guarantee. Requires an active delivery (deliveryId) —
 * there is nothing to share a position *into* before a driver is
 * assigned, so callers should not render the toggle without one.
 */
export function useCustomerLocation(deliveryId: string | undefined) {
  const [active, setActive] = useState(false);
  const [last, setLast] = useState<CustomerPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const throttleRef = useRef(0);
  const inFlightRef = useRef(false);

  const push = useCallback(
    async (lat: number, lng: number, accuracy: number | null) => {
      if (!deliveryId) return;
      const now = Date.now();
      if (now - throttleRef.current < PUSH_THROTTLE_MS) return;
      if (inFlightRef.current) return;
      throttleRef.current = now;
      inFlightRef.current = true;
      setLast({ lat, lng, accuracy, ts: now });

      try {
        const { error: rpcErr } = await supabase.rpc("push_customer_location_secure", {
          _delivery_id: deliveryId,
          _lat: lat,
          _lng: lng,
          _accuracy: accuracy ?? undefined,
        });
        if (rpcErr) {
          console.error("[useCustomerLocation] push failed", rpcErr);
          setError("Pozisyon ou pa t sove. N ap eseye ankò.");
          return;
        }
        setError(null);
      } finally {
        inFlightRef.current = false;
      }
    },
    [deliveryId],
  );

  const clearWatch = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setActive(false);
  }, []);

  // Explicit "stop sharing" action — clears the browser watch AND revokes
  // the stored position. Distinct from the unmount cleanup below: merely
  // navigating away/closing the tab stops the local GPS watch (nothing to
  // watch without the page open) but must not silently un-share a
  // position the customer deliberately opted into — only an explicit
  // toggle-off, or the order actually finishing (handled server-side by
  // the delivery-status trigger), revokes it.
  const stop = useCallback(() => {
    clearWatch();
    if (deliveryId) {
      supabase.rpc("stop_customer_location_sharing_secure", { _delivery_id: deliveryId }).then(
        () => {},
        (e: unknown) => console.error("[useCustomerLocation] stop failed", e),
      );
    }
  }, [clearWatch, deliveryId]);

  const start = useCallback(() => {
    if (!deliveryId) return;
    if (!navigator.geolocation) {
      setError("GPS pa disponib nan navigatè sa a");
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        push(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setError("Pèmisyon GPS refize");
          stop();
          return;
        }
        setError("GPS pa reponn kounye a. N ap kontinye eseye…");
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    setError(null);
    setActive(true);
  }, [deliveryId, push, stop]);

  useEffect(() => () => clearWatch(), [clearWatch]);

  return { active, last, error, start, stop };
}
