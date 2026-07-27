import { useEffect } from "react";
import { MapPin, MapPinOff } from "lucide-react";
import { toast } from "sonner";
import { useCustomerLocation } from "@/hooks/useCustomerLocation";

/**
 * Order-tracking page control: lets the customer opt in to sharing their
 * live position with the assigned driver/admin for this delivery only.
 * Never starts on its own — always requires this explicit click (the
 * browser's own permission model requires a fresh user gesture anyway, so
 * even a "yes" recorded at checkout could not silently resume this).
 */
export function CustomerLocationToggle({ deliveryId }: { deliveryId: string }) {
  const { active: on, last, error, start, stop } = useCustomerLocation(deliveryId);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  return (
    <div className="rounded-2xl bg-white p-5 shadow-brand-xs ring-1 ring-brand-soft/40">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-display text-sm font-bold text-ink">Pataje pozisyon mwen</div>
          <div className="text-xs text-ink-soft">
            {on
              ? "Livrè a ak admin yo ap wè pozisyon w pandan livrezon an."
              : "Ede livrè a jwenn ou pi vit — pataje pozisyon ou pandan livrezon sa a sèlman."}
          </div>
          {last && on && (
            <div className="mt-1 text-[11px] text-ink-soft">
              Dènye: {last.lat.toFixed(5)}, {last.lng.toFixed(5)}
            </div>
          )}
        </div>
        <button
          onClick={() => (on ? stop() : start())}
          className={`inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold text-white shadow-sm transition ${
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
