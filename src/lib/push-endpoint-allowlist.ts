// NKD-006 SSRF fix (docs/NKD_FAZ2_SECURITY_AUDIT.md §4). Single source of
// truth, on the TypeScript side, for which push-service hosts
// push-dispatch.server.ts is allowed to POST a push payload to.
//
// This list is mirrored — by necessity, a Postgres CHECK constraint can't
// import a TS constant — in the CHECK added by
// supabase/migrations/20260814150000_nkd006_push_endpoint_allowlist.sql. If
// this list ever changes, that migration's regex must be updated to match,
// and vice versa; both files carry a comment pointing at the other.
//
// Determined by reading what this app's own push code actually uses
// (src/lib/push.ts, src/sw.ts): the standard browser PushManager API, no
// native FCM/APNs/WNS SDK. The three hosts below are exactly the push
// services the browsers this app's service worker supports route through
// today — nothing added "just in case", since every extra host is
// additional attack surface:
//   - fcm.googleapis.com                  Chrome, Edge, Opera, Samsung
//                                          Internet, other Chromium-based
//                                          browsers (desktop + Android)
//   - updates.push.services.mozilla.com   Firefox desktop + Android
//   - web.push.apple.com                  Safari macOS 13+ / iOS 16.4+
//                                          (Web Push, GA since 2023)
// Legacy Edge (EdgeHTML/WNS, notify.windows.com) is deliberately excluded —
// Microsoft retired EdgeHTML in January 2020, well before this app existed,
// and nothing in sw.ts/push.ts targets it.
export const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
] as const;

// Standard SSRF hardening, kept even though every host above is a fixed
// public hostname (not something an attacker controls the DNS for): this
// guards the case where a row reached the dispatch code some other way than
// a normal user upsert (service_role write, manual data fix, a future bug
// upstream of this check) and somehow isn't one of the 3 hosts above but
// still isn't caught by the allowlist compare for some other reason —
// belt-and-suspenders, not the primary defense.
const PRIVATE_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./, // 127.0.0.0/8
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // 169.254.0.0/16 — link-local, includes cloud metadata endpoints
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/, // IPv6 loopback
];

function isIpLiteral(hostname: string): boolean {
  // A real push endpoint host is always a DNS name, never an IP address.
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

/**
 * True only for an `https://` URL whose host is *exactly* one of
 * ALLOWED_PUSH_HOSTS — no subdomain/suffix trick
 * (`fcm.googleapis.com.evil.com` fails), no IP literal, no
 * loopback/private/link-local address. Call this immediately before
 * fetching a stored `push_subscriptions.endpoint`, even though the DB
 * CHECK constraint should already guarantee it for every row that exists —
 * see the migration's own header comment for why both layers exist.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  if (isIpLiteral(hostname)) return false;
  if (PRIVATE_HOSTNAME_PATTERNS.some((re) => re.test(hostname))) return false;
  return (ALLOWED_PUSH_HOSTS as readonly string[]).includes(hostname);
}
