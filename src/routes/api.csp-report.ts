import { createFileRoute } from "@tanstack/react-router";
import { apiMethods } from "@/lib/api-methods";

/**
 * Public HTTP endpoint browsers POST Content-Security-Policy violation
 * reports to — https://www.nkdeliveri.com/api/csp-report. Same reasoning
 * as every other raw route under src/routes/api.*: a plain fetch target,
 * not a createServerFn (browsers send these unauthenticated, framework-
 * agnostic POSTs on their own; there is no useServerFn client involved).
 *
 * Wired into the CSP itself via both reporting mechanisms browsers
 * currently ship (see buildCsp()/REPORTING_ENDPOINTS in src/server.ts):
 * the legacy `report-uri` directive (broad support, no extra header) and
 * the newer `report-to` + `Reporting-Endpoints` header pair (the
 * standards-track replacement). Browsers use whichever they support and
 * silently ignore the other — sending both is the current best practice
 * during the multi-year transition between the two.
 *
 * Deliberately minimal: no database write of the reports themselves, only
 * an allowlist of fields off each one before logging (never the full
 * request body verbatim, same discipline as sanitizeWebhookPayload() in
 * stripe-collect-webhook-handler.server.ts). This is a public,
 * unauthenticated, browser-generated POST target by design (report-uri/
 * report-to never carry a session) — the costs to control are storage (we
 * don't write report content), log volume, and Sentry event quota.
 *
 * Per-IP rate limiting added 2026-08-27 (audit remediation, API-002): the
 * body-size cap alone didn't stop a flood of small, cheap requests from
 * inflating Sentry's event count — see check_rate_limit_secure's own
 * call below.
 */

const MAX_BODY_BYTES = 20_000; // generous for a CSP report batch; anything past this is not a real report

type NormalizedViolation = {
  documentUri?: string;
  blockedUri?: string;
  violatedDirective?: string;
  effectiveDirective?: string;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
};

/** Strips query string/fragment before logging — a blocked/document URI is
 *  attacker- or user-navigation-controlled and could carry a token in its
 *  query string; only the path is ever useful for triage anyway. */
function stripQuery(url: unknown): string | undefined {
  if (typeof url !== "string" || url.length === 0) return undefined;
  try {
    const u = new URL(url, "https://nkdeliveri.com");
    return u.origin + u.pathname;
  } catch {
    return undefined;
  }
}

/** Legacy `report-uri` shape: { "csp-report": { "document-uri": ..., ... } } */
function normalizeLegacyReport(raw: Record<string, unknown>): NormalizedViolation | null {
  const report = raw["csp-report"];
  if (!report || typeof report !== "object") return null;
  const r = report as Record<string, unknown>;
  return {
    documentUri: stripQuery(r["document-uri"]),
    blockedUri: stripQuery(r["blocked-uri"]),
    violatedDirective:
      typeof r["violated-directive"] === "string" ? r["violated-directive"] : undefined,
    effectiveDirective:
      typeof r["effective-directive"] === "string" ? r["effective-directive"] : undefined,
    sourceFile: stripQuery(r["source-file"]),
    lineNumber: typeof r["line-number"] === "number" ? r["line-number"] : undefined,
    columnNumber: typeof r["column-number"] === "number" ? r["column-number"] : undefined,
  };
}

/** Reporting API shape: an array of { type: "csp-violation", url, body: {...} } */
function normalizeReportingApiEntry(entry: unknown): NormalizedViolation | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (e.type !== "csp-violation" || !e.body || typeof e.body !== "object") return null;
  const b = e.body as Record<string, unknown>;
  return {
    documentUri: stripQuery(e.url),
    blockedUri: stripQuery(b.blockedURL),
    violatedDirective: typeof b.effectiveDirective === "string" ? b.effectiveDirective : undefined,
    effectiveDirective: typeof b.effectiveDirective === "string" ? b.effectiveDirective : undefined,
    sourceFile: stripQuery(b.sourceFile),
    lineNumber: typeof b.lineNumber === "number" ? b.lineNumber : undefined,
    columnNumber: typeof b.columnNumber === "number" ? b.columnNumber : undefined,
  };
}

function parseViolations(bodyText: string): NormalizedViolation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map(normalizeReportingApiEntry)
      .filter((v): v is NormalizedViolation => v !== null);
  }
  if (parsed && typeof parsed === "object") {
    const legacy = normalizeLegacyReport(parsed as Record<string, unknown>);
    return legacy ? [legacy] : [];
  }
  return [];
}

/**
 * Best-effort client IP for rate-limiting only — never for anything
 * authorization-sensitive. Vercel sets x-forwarded-for/x-real-ip; a bare
 * "unknown" bucket is still fine here (worst case, every client with no
 * usable header shares one rate-limit bucket, which only makes the limit
 * MORE conservative, never a bypass).
 */
function clientIpForRateLimit(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export const Route = createFileRoute("/api/csp-report")({
  server: {
    handlers: apiMethods({
      POST: async ({ request }) => {
        const rawBody = await request.text();
        if (rawBody.length > MAX_BODY_BYTES) {
          return new Response(null, { status: 413 });
        }

        // Audit remediation (2026-08-27, API-002): this endpoint has no
        // session (browsers send these beacons unauthenticated by design,
        // see the module comment), so nothing about it could distinguish
        // "one browser's real CSP violations" from "an attacker replaying
        // the same POST body" — the only identity available at all is the
        // source IP. Reuses check_rate_limit_secure's existing
        // service-role/_actor_override path (already used by
        // finalizeRegistrationDocuments for the same "no user session yet"
        // reason) rather than inventing a second rate-limiting mechanism.
        // Generous window (30/min/IP): a page with several genuinely
        // broken resources can legitimately fire a handful of reports in
        // one load; this caps sustained abuse, not a normal burst.
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const ip = clientIpForRateLimit(request);
          const { data: allowed, error } = await supabaseAdmin.rpc("check_rate_limit_secure", {
            _action: "csp_report",
            _max_hits: 30,
            _window_seconds: 60,
            _actor_override: ip,
          });
          if (error) throw error;
          if (!allowed) return new Response(null, { status: 429 });
        } catch (err) {
          // Fail OPEN, not closed: a rate-limit-check outage must never
          // turn into "no CSP violations are ever reported again" — the
          // whole point of this endpoint is visibility into a real
          // security-relevant signal (a violated Content-Security-Policy).
          console.warn(
            "[csp-report] rate-limit check failed, proceeding without it",
            err instanceof Error ? err.message : String(err),
          );
        }

        const violations = parseViolations(rawBody);
        if (violations.length > 0) {
          const { captureExceptionServer } = await import("@/lib/sentry.server");
          for (const v of violations) {
            console.warn("[csp-report]", JSON.stringify(v));
            captureExceptionServer(
              new Error(
                `CSP violation: ${v.violatedDirective ?? "unknown directive"} blocked ${v.blockedUri ?? "unknown resource"} on ${v.documentUri ?? "unknown page"}`,
              ),
            );
          }
        }

        // 204: browsers never read the response body/status for these
        // beacons beyond "did it 4xx/5xx" — nothing to return.
        return new Response(null, { status: 204 });
      },
    }),
  },
});
