import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { subscribeToPush } from "@/lib/push";

const DISMISS_KEY = "nk-install-dismissed-at";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const PUSH_ASKED_KEY = "nk-push-asked-at";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  // `navigator.standalone` is a non-standard Safari-only flag (missing from
  // the DOM lib types) for "launched from the home screen icon" — the only
  // way iOS signals PWA installation, since it never fires appinstalled.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function isIOS() {
  const ua = window.navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as "Macintosh" but has touch support, unlike a real Mac.
  const iPadOS13 = ua.includes("Macintosh") && "ontouchend" in document;
  return iOSDevice || iPadOS13;
}

function recentlyDismissed() {
  const raw = localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  return Date.now() - Number(raw) < DISMISS_COOLDOWN_MS;
}

/**
 * Asks for notification permission (and subscribes if granted) exactly once
 * per device — right after a real install (Android/desktop `appinstalled`)
 * or, for iOS which never fires that event, the first time the app is
 * opened already in standalone mode. Silently gives up (no repeat nagging)
 * if the browser already decided the permission or push isn't supported;
 * the manual toggle in Profile stays as the reliable fallback everywhere a
 * browser blocks a permission request that isn't tied to a fresh click.
 */
async function maybeRequestPushPermission() {
  if (localStorage.getItem(PUSH_ASKED_KEY)) return;
  localStorage.setItem(PUSH_ASKED_KEY, String(Date.now()));
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  await subscribeToPush().catch(() => undefined);
}

/**
 * Cross-platform "install this app" banner. Android/desktop Chrome/Edge get
 * a native install prompt via beforeinstallprompt; iOS Safari never fires
 * that event at all, so it gets manual Share → Add to Home Screen steps.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Already installed and running standalone (mainly iOS, which never
    // fires `appinstalled`) — this is the one moment to ask for push.
    if (isStandalone()) {
      void maybeRequestPushPermission();
      return;
    }
    if (recentlyDismissed()) return;
    setDismissed(false);

    if (isIOS()) {
      setShowIOSHelp(true);
      return;
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    function onInstalled() {
      setDeferredPrompt(null);
      dismiss();
      // Give the install animation/toast a moment to settle before stacking
      // a second native permission prompt on top of it.
      setTimeout(() => void maybeRequestPushPermission(), 1500);
    }
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted" || outcome === "dismissed") dismiss();
  }

  if (dismissed || (!deferredPrompt && !showIOSHelp)) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 pb-[max(1rem,var(--sab))] pl-[max(1rem,var(--sal))] pr-[max(1rem,var(--sar))] sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-sm sm:pl-0 sm:pr-0">
      <div className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)] ring-1 ring-brand-soft/60">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep">
          {showIOSHelp ? <Share className="h-5 w-5" /> : <Download className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-extrabold text-ink">Enstale NK Deliveri</div>
          {showIOSHelp ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              Peze <Share className="inline h-3.5 w-3.5 align-text-bottom" /> anba a, epi chwazi{" "}
              <span className="inline-flex items-center gap-0.5 font-semibold text-ink">
                <SquarePlus className="h-3.5 w-3.5" /> Ajoute sou Ekran Akèy
              </span>
              .
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              Ajoute app la sou ekran akèy ou pou aksè pi rapid ak notifikasyon.
            </p>
          )}
          {!showIOSHelp && (
            <button
              onClick={install}
              className="mt-2.5 inline-flex h-10 items-center rounded-full bg-brand px-4 text-xs font-bold text-white transition hover:bg-brand-deep"
            >
              Enstale
            </button>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Fèmen"
          className="shrink-0 rounded-full p-1 text-ink-soft transition hover:bg-brand-soft/40 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
