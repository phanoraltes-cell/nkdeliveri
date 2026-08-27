import { timingSafeEqual } from "node:crypto";

/**
 * Shared CRON_SECRET check for every Vercel Cron target (api.cron.*.ts) —
 * extracted here (2026-08-27 audit remediation, SEC-002) because both
 * existing call sites used a plain `authHeader !== \`Bearer ${expected}\``
 * comparison, unlike every other secret-comparison in this codebase
 * (moncash-provider.server.ts's verifySignature already used
 * timingSafeEqual for webhook signatures). A plain `!==` short-circuits at
 * the first mismatched byte, which in principle leaks a few nanoseconds
 * of signal per correct leading character — timingSafeEqual runs in
 * constant time regardless of where the strings diverge. Length-checked
 * first: timingSafeEqual throws (not returns false) on a length mismatch,
 * and a wrong-length header must never throw out of a request handler.
 */
export function isValidCronRequest(
  request: Request,
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return { ok: false, status: 500, error: "CRON_SECRET pa konfigire" };
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const expectedHeader = `Bearer ${expected}`;
  const provided = Buffer.from(authHeader, "utf8");
  const target = Buffer.from(expectedHeader, "utf8");
  const isValid = provided.length === target.length && timingSafeEqual(provided, target);

  if (!isValid) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}
