/**
 * Unit tests for `stampOwner` — the helper that used to call
 * `.schema("storage").from("objects").update(...)` directly, confirmed
 * (docs/DRIVER_RESTAURANT_REGISTRATION_AUDIT.md § 5) to have zero effect
 * in production (both real sampled objects had owner=NULL). Now goes
 * through the `stamp_storage_object_owner_secure` RPC instead
 * (20260809140000_fix_storage_document_owner.sql) — these tests prove the
 * new call shape, and that a failure is still caught+logged rather than
 * thrown (upload success must never be undone by a best-effort follow-up
 * step failing).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stampOwner } from "../register-documents.functions";

function fakeAdmin(rpcImpl: (...args: unknown[]) => Promise<{ error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) } as unknown as SupabaseClient;
}

describe("register-documents.functions.ts: stampOwner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the stamp_storage_object_owner_secure RPC with bucket/path/owner", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    const admin = { rpc } as unknown as SupabaseClient;

    await stampOwner(admin, "driver-documents", "user-1/id-123-doc.png", "user-1");

    expect(rpc).toHaveBeenCalledWith("stamp_storage_object_owner_secure", {
      _bucket: "driver-documents",
      _path: "user-1/id-123-doc.png",
      _owner: "user-1",
    });
  });

  it("does not throw when the RPC returns an error — logs it, never undoes the already-successful upload", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = fakeAdmin(async () => ({ error: { message: "permission denied" } }));

    await expect(
      stampOwner(admin, "restaurant-assets", "user-2/logo-1-x.png", "user-2"),
    ).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it("does not throw or log when the RPC succeeds", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const admin = fakeAdmin(async () => ({ error: null }));

    await stampOwner(admin, "driver-documents", "user-3/id-1-x.png", "user-3");
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
