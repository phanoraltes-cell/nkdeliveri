import { toast } from "sonner";

async function unregisterAppSw() {
  if (!("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    regs
      .filter((r) =>
        (r.active?.scriptURL ?? r.waiting?.scriptURL ?? r.installing?.scriptURL ?? "").endsWith(
          "/sw.js",
        ),
      )
      .map((r) => r.unregister()),
  );
}

export async function registerPWA() {
  if (typeof window === "undefined") return;
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  const url = new URL(window.location.href);
  const inIframe = window.self !== window.top;
  if (inIframe || url.searchParams.get("sw") === "off") {
    await unregisterAppSw();
    return;
  }

  const { Workbox } = await import("workbox-window");
  const wb = new Workbox("/sw.js");

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  const promptUpdate = () => {
    toast("Nouvo vèsyon disponib", {
      description: "Rafrechi paj la pou itilize dènye mizajou NK Deliveri.",
      duration: Infinity,
      action: {
        label: "Rafrechi",
        onClick: () => {
          wb.addEventListener("controlling", () => window.location.reload());
          wb.messageSkipWaiting();
        },
      },
    });
  };

  wb.addEventListener("waiting", promptUpdate);

  try {
    await wb.register();
  } catch (err) {
    console.warn("[pwa] registration failed", err);
  }
}
