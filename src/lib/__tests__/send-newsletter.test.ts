/**
 * Unit tests for `sendOne` — the per-recipient Resend call extracted from
 * `sendNewsletterBroadcast`'s handler for exactly this: `createServerFn`
 * handlers aren't practically unit-testable in this project's Node-only
 * Vitest setup, so the pure fetch/parse logic is pulled out (same pattern
 * as `createPollController` in useCollectPaymentPoll.ts). See
 * docs/archive/audits/NEWSLETTER_EMAIL_REMEDIATION_AUDIT.md § 4 Pwen A / § 5 Phase 1 —
 * before this, every failure reason (HTTP error, network error) was
 * thrown away at a bare `else failed++`; these tests prove `sendOne` now
 * captures a usable reason for every outcome and never throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendOne } from "../send-newsletter.functions";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("send-newsletter.functions.ts: sendOne", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("happy path: returns success with the HTTP status and a measured duration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { id: "abc123" })),
    );

    const result = await sendOne("a@example.com", "re_test_key", "Sijè", "<p>Kò a</p>");

    expect(result).toMatchObject({
      email: "a@example.com",
      success: true,
      httpStatus: 200,
      error: null,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sends the expected Resend payload (from/to/subject/html + bearer auth)", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.resend.com/emails");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer re_test_key");
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({
        from: "NK Deliveri <newsletter@nkdeliveri.com>",
        to: ["a@example.com"],
        subject: "Sijè",
        html: "<p>Kò a</p>",
      });
      return jsonResponse(200, { id: "abc123" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendOne("a@example.com", "re_test_key", "Sijè", "<p>Kò a</p>");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP error with a JSON body: captures Resend's own `message`, never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(429, { name: "rate_limit_exceeded", message: "Too many requests" }),
      ),
    );

    const result = await sendOne("a@example.com", "re_test_key", "Sijè", "<p>Kò</p>");

    expect(result).toEqual({
      email: "a@example.com",
      success: false,
      httpStatus: 429,
      error: "Too many requests",
      durationMs: expect.any(Number),
    });
  });

  it("HTTP error with a non-JSON body: preserves the raw text instead of dropping it — the exact bug already fixed once in plop-client.server.ts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>502 Bad Gateway</html>", {
            status: 502,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );

    const result = await sendOne("a@example.com", "re_test_key", "Sijè", "<p>Kò</p>");

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(502);
    expect(result.error).toBe("<html>502 Bad Gateway</html>");
  });

  it("HTTP error with a completely empty body: falls back to a synthetic HTTP-status message instead of an empty string", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );

    const result = await sendOne("a@example.com", "re_test_key", "Sijè", "<p>Kò</p>");

    expect(result.success).toBe(false);
    expect(result.httpStatus).toBe(401);
    expect(result.error).toBe("HTTP 401");
  });

  it("network failure (fetch rejects): captured as a result, not a thrown exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const result = await sendOne("a@example.com", "re_test_key", "Sijè", "<p>Kò</p>");

    expect(result).toEqual({
      email: "a@example.com",
      success: false,
      httpStatus: null,
      error: "fetch failed",
      durationMs: expect.any(Number),
    });
  });

  it("a very long error body is truncated so one bad recipient can't blow up the log row", async () => {
    const hugeMessage = "x".repeat(2000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(400, { message: hugeMessage })),
    );

    const result = await sendOne("a@example.com", "re_test_key", "Sijè", "<p>Kò</p>");

    expect(result.error?.length).toBe(500);
  });
});
