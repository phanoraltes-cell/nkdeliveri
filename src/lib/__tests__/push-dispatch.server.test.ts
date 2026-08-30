/**
 * Unit tests for pushToUsers' NKD-006 SSRF fix — the server-side re-check
 * (isAllowedPushEndpoint), the `redirect: "manual"` fetch option, and the
 * resulting handling of a redirect response. Every test mocks
 * supabaseAdmin, @block65/webcrypto-web-push, and fetch — never a real
 * network call, same convention as
 * payment-providers/__tests__/moncash-client.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SubRow = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };

let subsRows: SubRow[] = [];
const deleteInMock = vi.fn(async (_col: string, _endpoints: string[]) => ({ error: null }));

const fromMock = vi.fn((table: string) => {
  if (table === "push_subscriptions") {
    return {
      select: () => ({
        eq: () => ({
          in: async () => ({ data: subsRows, error: null }),
        }),
      }),
      delete: () => ({
        in: (col: string, endpoints: string[]) => deleteInMock(col, endpoints),
      }),
    };
  }
  if (table === "notification_preferences") {
    return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
  }
  // TACH 2 — pushToUsers now logs every attempt to notification_log (best
  // effort, via sms-dispatch.server's logNotification) — a no-op insert
  // mock so that new behavior doesn't add noise to these SSRF-focused
  // tests, which don't care about the log itself.
  if (table === "notification_log") {
    return { insert: async () => ({ error: null }) };
  }
  throw new Error(`unexpected table in test mock: ${table}`);
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: fromMock },
}));

const buildPushPayloadMock = vi.fn(async (..._args: unknown[]) => ({
  method: "POST",
  headers: { "content-type": "application/octet-stream" },
  body: "encrypted-payload",
}));
vi.mock("@block65/webcrypto-web-push", () => ({
  buildPushPayload: (...args: unknown[]) => buildPushPayloadMock(...args),
}));

function setVapidEnv() {
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_JWK = JSON.stringify({ kty: "EC", crv: "P-256" });
}

async function importPushToUsers() {
  const mod = await import("../push-dispatch.server");
  return mod.pushToUsers;
}

describe("pushToUsers — NKD-006 SSRF fix", () => {
  beforeEach(() => {
    vi.resetModules();
    setVapidEnv();
    subsRows = [];
    deleteInMock.mockClear();
    fromMock.mockClear();
    buildPushPayloadMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("never calls fetch for an endpoint outside the allowlist, and queues it for deletion", async () => {
    subsRows = [{ id: "1", user_id: "u1", endpoint: "https://evil.com/x", p256dh: "p", auth: "a" }];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const pushToUsers = await importPushToUsers();
    const result = await pushToUsers(["u1"], {
      title: "T",
      body: "B",
      url: "/notifications",
      tag: "t",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(deleteInMock).toHaveBeenCalledWith("endpoint", ["https://evil.com/x"]);
  });

  it("BEFORE-state proof: a cloud-metadata-style endpoint never reaches fetch either", async () => {
    subsRows = [
      {
        id: "1",
        user_id: "u1",
        endpoint: "http://169.254.169.254/latest/meta-data/",
        p256dh: "p",
        auth: "a",
      },
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const pushToUsers = await importPushToUsers();
    await pushToUsers(["u1"], { title: "T", body: "B", url: "/notifications", tag: "t" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends successfully to an allowed endpoint, with redirect: manual and a signal set", async () => {
    subsRows = [
      {
        id: "1",
        user_id: "u1",
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
        p256dh: "p",
        auth: "a",
      },
    ];
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(null, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pushToUsers = await importPushToUsers();
    const result = await pushToUsers(["u1"], {
      title: "T",
      body: "B",
      url: "/notifications",
      tag: "t",
    });

    expect(result.sent).toBe(1);
    expect(deleteInMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("https://fcm.googleapis.com/fcm/send/abc123");
    expect(calledInit?.redirect).toBe("manual");
    expect(calledInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats a redirect response as a failure, not a success — does not follow it and does not count it as sent", async () => {
    subsRows = [
      {
        id: "1",
        user_id: "u1",
        endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
        p256dh: "p",
        auth: "a",
      },
    ];
    // What `fetch` returns for `redirect: "manual"` when the server
    // actually issues a 3xx — an opaque-redirect filtered response.
    // `Response.type` is a getter-only property on the real class (can't
    // be set via Object.assign/spread), so this is a plain object with
    // just the fields pushToUsers actually reads.
    const fetchMock = vi.fn(
      async () => ({ status: 0, ok: false, type: "opaqueredirect" }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);

    const pushToUsers = await importPushToUsers();
    const result = await pushToUsers(["u1"], {
      title: "T",
      body: "B",
      url: "/notifications",
      tag: "t",
    });

    expect(result.sent).toBe(0);
    // A redirect isn't "gone" (404/410) either — the endpoint might work
    // again later without a redirect, so it's not queued for deletion.
    expect(deleteInMock).not.toHaveBeenCalled();
    // Exactly one fetch call — "manual" means the runtime itself never
    // issues a second request to the Location target, and neither does
    // this code.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still removes a genuinely dead (410 Gone) endpoint, unrelated to the SSRF fix", async () => {
    subsRows = [
      {
        id: "1",
        user_id: "u1",
        endpoint: "https://fcm.googleapis.com/fcm/send/gone",
        p256dh: "p",
        auth: "a",
      },
    ];
    const fetchMock = vi.fn(async () => new Response(null, { status: 410 }));
    vi.stubGlobal("fetch", fetchMock);

    const pushToUsers = await importPushToUsers();
    const result = await pushToUsers(["u1"], {
      title: "T",
      body: "B",
      url: "/notifications",
      tag: "t",
    });

    expect(result.sent).toBe(0);
    expect(deleteInMock).toHaveBeenCalledWith("endpoint", [
      "https://fcm.googleapis.com/fcm/send/gone",
    ]);
  });
});
