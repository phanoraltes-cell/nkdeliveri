// Client-side (browser) error monitoring. No-ops entirely when
// VITE_SENTRY_DSN isn't set, so local dev and any environment without a
// configured Sentry project pay zero cost and send nothing.
//
// Deliberately NOT named `sentry.client.ts`: @tanstack/react-start's
// import-protection plugin hard-blocks any file matching `**/*.client.*`
// from being reachable in the server bundle, and this module is imported
// (behind a `typeof window` guard) from __root.tsx, which is also used
// during SSR. The guard here is what actually keeps it inert on the
// server; the filename just avoids tripping the bundler's own check.
import * as Sentry from "@sentry/react";

let initialized = false;

export function initSentryClient() {
  if (initialized) return;
  initialized = true;

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_COMMIT_SHA as string | undefined,
    tracesSampleRate: 0.1,
    // Never attach cookies or IP addresses — a delivery address or phone
    // number typed into a form is easy to end up in a breadcrumb/replay by
    // accident, so no session replay / no default PII, explicit even
    // though it's the SDK default.
    sendDefaultPii: false,
    beforeSend(event) {
      delete event.user;
      if (event.request) delete event.request.cookies;
      return event;
    },
  });
}

/**
 * Sentry koupe valè yon tag ki depase 200 karaktè. Yon `User-Agent` long
 * (kèk navigatè mobil) ta pèdi an silans, epi nou pa ta konnen. Nou koupe
 * tèt nou pou sa ki rive a se sa nou chwazi.
 */
const MAX_TAG_LENGTH = 200;

function tagValue(value: string): string {
  return value.length > MAX_TAG_LENGTH ? `${value.slice(0, MAX_TAG_LENGTH - 1)}…` : value;
}

export function captureExceptionClient(error: unknown) {
  if (!initialized || !(import.meta.env.VITE_SENTRY_DSN as string | undefined)) return;

  // `withScope` epi pa `setTag` global: tag yo mache ak ERÈ SA A sèlman.
  // Yon `setTag` global ta rete kole epi li ta bay chak erè ki vini apre a
  // chemen an kote PREMYE erè a te rive — egzakteman kalite move piste ki
  // fè yon moun chèche yon bug nan move paj la.
  Sentry.withScope((scope) => {
    if (typeof window !== "undefined") {
      // Chemen an SÈLMAN, san `search` ni `hash`. Yon URL konplè pote
      // bagay tankou `?next=/orders` oswa yon jeton nan yon lyen
      // reyinisyalizasyon — nou deja di `sendDefaultPii: false`, nou pa pral
      // fè l antre pa yon lòt pòt.
      scope.setTag("pathname", tagValue(window.location.pathname));
    }
    if (typeof navigator !== "undefined") {
      // Kle pou SEO a: sa pèmèt nou wè si se Googlebot ki ap frape yon paj
      // erè. Yon erè yon robo endeksè wè pa gen menm priyorite ak yon erè
      // yon kliyan wè.
      scope.setTag("user_agent", tagValue(navigator.userAgent));
    }
    Sentry.captureException(error);
  });
}
