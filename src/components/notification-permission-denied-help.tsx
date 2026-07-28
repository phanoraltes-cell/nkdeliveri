import { useState } from "react";
import { BellOff, RotateCcw } from "lucide-react";
import { detectBrowserGuide } from "@/lib/notification-permission";

/**
 * Shown instead of the toggle once Notification.permission === "denied" —
 * calling requestPermission() again at that point is a silent no-op in
 * every browser (the OS-level popup never re-appears once refused), so
 * "Réessayer" only re-checks the current permission state, it never tries
 * to bypass the browser's own restriction.
 */
export function NotificationPermissionDeniedHelp() {
  const [guide] = useState(detectBrowserGuide);

  return (
    <div
      role="status"
      className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-ink"
    >
      <div className="mb-2 flex items-center gap-2 font-bold">
        <BellOff className="h-4 w-4 text-amber-700" aria-hidden="true" /> Notifikasyon bloke sou
        navigatè w
      </div>
      <p className="mb-2 text-ink-soft">
        Ou te refize notifikasyon pou NK Deliveri nan {guide.name}. Pou reyaktive yo:
      </p>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-ink-soft">
        {guide.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-xs font-bold text-brand-deep shadow-sm hover:bg-brand-soft/40"
      >
        <RotateCcw className="h-3.5 w-3.5" /> Reyeseye apre w chanje paramèt yo
      </button>
    </div>
  );
}
