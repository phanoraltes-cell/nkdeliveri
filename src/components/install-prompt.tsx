import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";

const DISMISS_KEY = "nk-install-dismissed-at";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
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
 * Cross-platform "install this app" banner. Android/desktop Chrome/Edge get
 * a native install prompt via beforeinstallprompt; iOS Safari never fires
 * that event at all, so it gets manual Share → Add to Home Screen steps.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;
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
    <div className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-sm sm:px-0">
      <div className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)] ring-1 ring-brand-soft/60">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep">
          {showIOSHelp ? <Share className="h-5 w-5" /> : <Download className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-sm font-extrabold text-ink">Enstale NK Delivery</div>
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
              className="mt-2.5 rounded-full bg-brand px-4 py-1.5 text-xs font-bold text-white transition hover:bg-brand-deep"
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
