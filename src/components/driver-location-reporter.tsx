import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MapPin, MapPinOff } from "lucide-react";
import { toast } from "sonner";

/**
 * When enabled, reports the driver's current GPS position to every active
 * delivery row assigned to them (~ every 12s). Also updates the driver's
 * current_lat/current_lng on the drivers table.
 */
export function DriverLocationReporter({ driverId }: { driverId: string }) {
  const [on, setOn] = useState(false);
  const [last, setLast] = useState<{ lat: number; lng: number; ts: number } | null>(null);
  const watchId = useRef<number | null>(null);
  const throttle = useRef<number>(0);

  const push = async (lat: number, lng: number, heading?: number | null) => {
    const now = Date.now();
    if (now - throttle.current < 8000) return;
    throttle.current = now;
    setLast({ lat, lng, ts: now });

    await supabase
      .from("drivers")
      .update({ current_lat: lat, current_lng: lng })
      .eq("id", driverId);

    await supabase
      .from("deliveries")
      .update({
        driver_lat: lat,
        driver_lng: lng,
        driver_heading: heading ?? null,
        location_updated_at: new Date().toISOString(),
      })
      .eq("driver_id", driverId)
      .in("status", ["assigned", "picked_up", "en_route_pickup", "en_route_dropoff"]);
  };

  const start = () => {
    if (!navigator.geolocation) {
      toast.error("GPS pa disponib nan navigatè sa a");
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => push(pos.coords.latitude, pos.coords.longitude, pos.coords.heading),
      (err) => {
        console.error(err);
        toast.error("Pèmisyon GPS refize");
        setOn(false);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    setOn(true);
  };

  const stop = () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setOn(false);
  };

  useEffect(() => () => stop(), []);

  return (
    <div className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-sm font-bold text-ink">Pozisyon an tan reyèl</div>
          <div className="text-xs text-ink-soft">
            {on
              ? "Kliyan ak admin ap wè pozisyon w sou kat la."
              : "Aktive pou pataje pozisyon w pandan livrezon aktif yo."}
          </div>
          {last && on && (
            <div className="mt-1 text-[11px] text-ink-soft">
              Dènye: {last.lat.toFixed(5)}, {last.lng.toFixed(5)}
            </div>
          )}
        </div>
        <button
          onClick={() => (on ? stop() : start())}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-sm transition ${
            on ? "bg-emerald-600 hover:bg-emerald-700" : "bg-brand hover:bg-brand-deep"
          }`}
        >
          {on ? <MapPin className="h-3.5 w-3.5" /> : <MapPinOff className="h-3.5 w-3.5" />}
          {on ? "Aktif" : "Aktive"}
        </button>
      </div>
    </div>
  );
}