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

export function captureExceptionClient(error: unknown) {
  if (!initialized || !(import.meta.env.VITE_SENTRY_DSN as string | undefined)) return;
  Sentry.captureException(error);
}
