import { useEffect } from "react";
import { MapPin, MapPinOff } from "lucide-react";
import { toast } from "sonner";
import { useDriverLocation } from "@/hooks/useDriverLocation";

/**
 * When enabled, reports the driver's current GPS position to every active
 * delivery row assigned to them (~ every 8s). Also updates the driver's
 * current_lat/current_lng on the drivers table.
 */
export function DriverLocationReporter({ driverId }: { driverId: string }) {
  const { active: on, last, error, start, stop } = useDriverLocation(driverId);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

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
          className={`inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold text-white shadow-sm transition ${
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
