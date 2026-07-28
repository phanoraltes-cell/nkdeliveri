import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
import { NotificationPermissionDialog } from "@/components/notification-permission-dialog";
import { NotificationPermissionDeniedHelp } from "@/components/notification-permission-denied-help";
import { recordPermissionPromptDismissal } from "@/lib/notification-permission";

export function PushToggle() {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) {
      setSupported(false);
      return;
    }
    setPermission(Notification.permission);
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

  // Browsers never re-show their own permission popup once denied — the
  // only path back is the user changing it in their own browser settings
  // (see NotificationPermissionDeniedHelp), never something this app can
  // trigger for them.
  if (permission === "denied") {
    return <NotificationPermissionDeniedHelp />;
  }

  async function activate() {
    setBusy(true);
    try {
      const res = await subscribeToPush();
      setPermission(Notification.permission);
      if (res.ok) {
        setEnabled(true);
        toast.success("Notifikasyon push aktive");
      } else {
        toast.error(res.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    try {
      const res = await unsubscribeFromPush();
      if (res.ok) {
        setEnabled(false);
        toast.success("Notifikasyon push dezaktive");
      } else {
        toast.error(res.error);
      }
    } finally {
      setBusy(false);
    }
  }

  function onToggleClick() {
    if (enabled) {
      deactivate();
      return;
    }
    // Never call Notification.requestPermission() directly from a click —
    // explain why first (Phase 2 of the request); subscribeToPush() (which
    // does call it) only runs after the user confirms in the dialog.
    setExplainOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={onToggleClick}
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

      <NotificationPermissionDialog
        open={explainOpen}
        onOpenChange={setExplainOpen}
        onDecline={() => {
          setExplainOpen(false);
          recordPermissionPromptDismissal();
        }}
        onAccept={() => {
          setExplainOpen(false);
          activate();
        }}
      />
    </>
  );
}
