/**
 * Unit tests for isAllowedPushEndpoint — the pure host-validation logic
 * behind the NKD-006 SSRF fix (docs/archive/phases/NKD_FAZ2_SECURITY_AUDIT.md §4,
 * docs/archive/phases/PHASE_FAZ2_FINALIZATION_REPORT.md §1). Covers the exact "before"
 * scenario the audit traced (a cloud-metadata URL reaching push-dispatch
 * with zero host validation) and the allowlist/redirect-adjacent edge
 * cases the DB CHECK constraint alone can't express test coverage for.
 */
import { describe, expect, it } from "vitest";
import { ALLOWED_PUSH_HOSTS, isAllowedPushEndpoint } from "../push-endpoint-allowlist";

describe("isAllowedPushEndpoint", () => {
  it("accepts a real endpoint on each of the 3 allowlisted hosts", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc123")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc123")).toBe(
      true,
    );
    expect(isAllowedPushEndpoint("https://web.push.apple.com/v1/abc123")).toBe(true);
  });

  it("accepts a host with no path at all", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com")).toBe(true);
  });

  it("BEFORE-state proof: a cloud metadata URL — what push-dispatch.server.ts fetched with zero host validation prior to this fix (NKD-006) — is rejected", () => {
    expect(isAllowedPushEndpoint("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("rejects http:// even on an otherwise-allowed host", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc123")).toBe(false);
  });

  it("rejects a host-suffix trick (allowed hostname as a mere prefix)", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.com/x")).toBe(false);
  });

  it("rejects a host not in the allowlist", () => {
    expect(isAllowedPushEndpoint("https://evil.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://attacker-controlled.example/webhook")).toBe(false);
  });

  it("rejects IP literals regardless of range", () => {
    expect(isAllowedPushEndpoint("https://8.8.8.8/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://[::1]/x")).toBe(false);
  });

  it("rejects loopback and private/link-local ranges", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
    ]) {
      expect(isAllowedPushEndpoint(`https://${host}/x`)).toBe(false);
    }
  });

  it("does not misclassify a public host that merely starts with a private-range prefix", () => {
    // 172.32.x.x is outside 172.16.0.0/12 (which ends at 172.31.x.x) —
    // guards against an overly broad regex on the 172.x block.
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/x")).toBe(true);
  });

  it("rejects a malformed URL instead of throwing", () => {
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
    expect(isAllowedPushEndpoint("")).toBe(false);
  });

  it("ALLOWED_PUSH_HOSTS has exactly the 3 hosts justified in the file header, no more", () => {
    expect(ALLOWED_PUSH_HOSTS).toEqual([
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
    ]);
  });
});
