import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, Send } from "lucide-react";
import { toast } from "sonner";
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
import { NotificationPermissionDialog } from "@/components/notification-permission-dialog";
import { NotificationPermissionDeniedHelp } from "@/components/notification-permission-denied-help";
import { recordPermissionPromptDismissal } from "@/lib/notification-permission";
import { sendTestPush } from "@/lib/send-test-push.functions";
import { Button } from "@/components/ui/button";

// TACH 2 (siyalman A) — "iOS Safari: push mache sèlman lè PWA a enstale
// sou ekran dakèy la" — `navigator.standalone` se mak Safari-sèlman ki
// endike sa (menm deteksyon ak install-prompt.tsx, ki responsab afichaj
// bouton "enstale" a; isit la se sèlman yon mesaj kout pou eksplike
// poukisa switch la ka rete san efè si sa poko fèt).
function isIosNotStandalone(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const nav = navigator as Navigator & { standalone?: boolean };
  return isIOS && nav.standalone !== true;
}

export function PushToggle() {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const sendTest = useServerFn(sendTestPush);

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
        {isIosNotStandalone()
          ? "Sou iPhone/iPad, notifikasyon push mache sèlman apre w enstale NK Deliveri sou ekran dakèy ou (Pataje → Ajoute sou ekran dakèy la)."
          : "Navigatè sa a pa sipòte notifikasyon push."}
      </div>
    );
  }

  async function sendSelfTest() {
    setTesting(true);
    try {
      const res = await sendTest();
      if (res.sent > 0) {
        toast.success("Notifikasyon tès voye — tann yon ti moman.");
      } else if ("notConfigured" in res && res.notConfigured) {
        // Kle VAPID yo pa konfigire sou sèvè a. Anvan sa, ka sa a t ap
        // parèt kòm `"undefined" is not valid JSON`, ki pa t di anyen.
        toast.error(res.error ?? "Notifikasyon push pa konfigire sou sèvè a.");
      } else if ("rateLimited" in res && res.rateLimited) {
        toast.error("Twòp tès nan yon ti tan — tann kèk minit.");
      } else {
        toast.error("Pa gen abònman aktif pou resevwa l — aktive notifikasyon anvan.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Echèk voye tès la");
    } finally {
      setTesting(false);
    }
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
      <div className="flex flex-wrap items-center gap-2">
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
        {enabled && (
          <Button variant="outline" size="sm" disabled={testing} onClick={sendSelfTest}>
            <Send className="h-3.5 w-3.5" /> Voye yon tès
          </Button>
        )}
      </div>

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
