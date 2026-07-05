let loadPromise: Promise<any> | null = null;

declare global {
  interface Window {
    __nkGmapsInit?: () => void;
    gm_authFailure?: () => void;
    google: any;
  }
}

export function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loadPromise) return loadPromise;

  const key = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY;
  const channel = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID;
  if (!key) return Promise.reject(new Error("Kle API Google Maps la pa konfigire"));

  loadPromise = new Promise((resolve, reject) => {
    let settled = false;

    // Google calls this global specifically for key/billing/referrer
    // problems (invalid key, API not enabled, HTTP referrer restriction
    // blocking this domain). Without it, the script tag itself still loads
    // "successfully" (s.onerror never fires) and the map silently stays
    // blank with only a console warning — this is what makes an auth
    // failure indistinguishable from "still loading" to the user.
    window.gm_authFailure = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Google Maps refize kle API la (verifye restriksyon domèn/facturation)"));
    };

    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Google Maps pran twòp tan pou chaje"));
    }, 10000);

    window.__nkGmapsInit = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(window.google.maps);
    };

    const s = document.createElement("script");
    const params = new URLSearchParams({
      key,
      loading: "async",
      callback: "__nkGmapsInit",
      libraries: "marker",
    });
    if (channel) params.set("channel", channel);
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error("Script Google Maps la pa ka chaje (rezo oswa blokè piblisite?)"));
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}