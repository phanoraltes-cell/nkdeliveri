import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push";

export function PushToggle() {
  const [supported, setSupported] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) {
      setSupported(false);
      return;
    }
    (async () => {
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      const sub = await reg?.pushManager.getSubscription();
      setEnabled(!!sub && Notification.permission === "granted");
    })();
  }, []);

  if (!supported) {
    return (
      <div className="rounded-2xl border border-brand-soft/60 bg-cream px-4 py-3 text-sm text-ink-soft">
        Navigatè sa a pa sipòte notifikasyon push.
      </div>
    );
  }

  async function toggle() {
    setBusy(true);
    try {
      if (enabled) {
        await unsubscribeFromPush();
        setEnabled(false);
        toast.success("Notifikasyon push dezaktive");
      } else {
        const res = await subscribeToPush();
        if (res.ok) {
          setEnabled(true);
          toast.success("Notifikasyon push aktive");
        } else {
          toast.error(res.error);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
        enabled
          ? "bg-emerald-600 text-white hover:bg-emerald-700"
          : "bg-brand-soft text-brand-deep hover:bg-brand hover:text-white"
      } disabled:opacity-60`}
    >
      {enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
      {enabled ? "Push aktive" : "Aktive notifikasyon push"}
    </button>
  );
}
