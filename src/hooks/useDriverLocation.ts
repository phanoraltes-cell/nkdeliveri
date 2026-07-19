import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DriverPosition = { lat: number; lng: number; heading: number | null; ts: number };

const PUSH_THROTTLE_MS = 8000;
const ACTIVE_DELIVERY_STATUSES = [
  "assigned",
  "picked_up",
  "en_route_pickup",
  "en_route_dropoff",
] as const;

/**
 * Watches this device's GPS via the Geolocation API and pushes it (~every
 * 8s) to drivers.current_lat/lng plus every one of the driver's active
 * deliveries, so admins/customers see it live through useLiveOrders'
 * Supabase Realtime subscription. Call start()/stop() from a UI toggle —
 * most browsers require a user gesture before granting location access.
 */
export function useDriverLocation(driverId: string) {
  const [active, setActive] = useState(false);
  const [last, setLast] = useState<DriverPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const throttleRef = useRef(0);
  // Guards against overlapping writes: the throttle above only limits how
  // often a push *starts*, not how long one takes. On a slow connection the
  // two awaited writes below can still be in flight when the next GPS tick
  // clears the 8s throttle window, firing a second push whose responses can
  // land out of order and let a stale position overwrite a newer one.
  const inFlightRef = useRef(false);

  const push = useCallback(
    async (lat: number, lng: number, heading: number | null) => {
      const now = Date.now();
      if (now - throttleRef.current < PUSH_THROTTLE_MS) return;
      if (inFlightRef.current) return;
      throttleRef.current = now;
      inFlightRef.current = true;
      // This reflects the device's own last GPS fix, not a confirmation that
      // it reached the server — the two writes below are what actually
      // persist it, and their errors are surfaced separately.
      setLast({ lat, lng, heading, ts: now });

      try {
        const { error: driverErr } = await supabase
          .from("drivers")
          .update({ current_lat: lat, current_lng: lng })
          .eq("id", driverId);
        if (driverErr) {
          console.error("[useDriverLocation] failed to update drivers.current_lat/lng", driverErr);
          setError("Pozisyon ou pa t sove. N ap eseye ankò.");
          return;
        }

        const { error: deliveryErr } = await supabase
          .from("deliveries")
          .update({
            driver_lat: lat,
            driver_lng: lng,
            driver_heading: heading,
            location_updated_at: new Date().toISOString(),
          })
          .eq("driver_id", driverId)
          .in("status", ACTIVE_DELIVERY_STATUSES);
        if (deliveryErr) {
          console.error(
            "[useDriverLocation] failed to update deliveries.driver_lat/lng",
            deliveryErr,
          );
          setError("Pozisyon ou pa t rive jwenn kliyan an. N ap eseye ankò.");
          return;
        }

        // Clear any previously surfaced write error now that a push succeeded.
        setError(null);
      } finally {
        inFlightRef.current = false;
      }
    },
    [driverId],
  );

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setError("GPS pa disponib nan navigatè sa a");
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => push(pos.coords.latitude, pos.coords.longitude, pos.coords.heading),
      () => {
        setError("Pèmisyon GPS refize");
        setActive(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    setError(null);
    setActive(true);
  }, [push]);

  const stop = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setActive(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { active, last, error, start, stop };
}
