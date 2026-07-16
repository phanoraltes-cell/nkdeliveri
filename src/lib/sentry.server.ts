// Server-side error monitoring (Nitro/Vercel Functions). No-ops entirely
// when SENTRY_DSN isn't set, so local dev and any environment without a
// configured Sentry project pay zero cost and send nothing.
import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentryServer() {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.1,
    // Never attach cookies, IP addresses or request bodies — order
    // addresses, phone numbers and payment references pass through server
    // functions constantly, and none of that belongs in a third-party
    // error tracker. Explicit even though it's the SDK default, since this
    // is a hard requirement, not an incidental setting.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
      }
      delete event.user;
      return event;
    },
  });
}

export function captureExceptionServer(error: unknown) {
  if (!initialized || !process.env.SENTRY_DSN) return;
  Sentry.captureException(error);
}
