/**
 * Lightweight, good-enough device/browser/OS summary for the "Sessions
 * actives" UI — deliberately not a full UA-parsing library dependency for
 * what's ultimately just a hint shown next to a revoke button, not a
 * security decision (the actual security boundary is the session row
 * itself, never what this happens to say about it).
 */
export function parseUserAgent(ua: string | null): { device: string; browser: string; os: string } {
  if (!ua) return { device: "Aparèy enkoni", browser: "—", os: "—" };

  const os = /iphone|ipad|ipod/i.test(ua)
    ? "iOS"
    : /android/i.test(ua)
      ? "Android"
      : /mac os x/i.test(ua)
        ? "macOS"
        : /windows/i.test(ua)
          ? "Windows"
          : /linux/i.test(ua)
            ? "Linux"
            : "—";

  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /chrome\//i.test(ua) && !/chromium/i.test(ua)
      ? "Chrome"
      : /crios\//i.test(ua)
        ? "Chrome"
        : /fxios\//i.test(ua)
          ? "Firefox"
          : /firefox\//i.test(ua)
            ? "Firefox"
            : /version\/.*safari\//i.test(ua)
              ? "Safari"
              : "Navigatè";

  const isMobile = /mobi|iphone|ipod|android/i.test(ua);
  const isTablet = /ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobi/i.test(ua));
  const device = isTablet ? "Tablèt" : isMobile ? "Telefòn" : "Òdinatè";

  return { device, browser, os };
}
