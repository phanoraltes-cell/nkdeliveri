import { describe, expect, it } from "vitest";
import { sanitize, sanitizeToJson } from "../sanitize";

describe("sanitize", () => {
  it("keeps plain numbers, booleans, and business-safe strings untouched", () => {
    expect(sanitize(42)).toBe(42);
    expect(sanitize(true)).toBe(true);
    expect(sanitize(null)).toBe(null);
    expect(sanitize(undefined)).toBe(undefined);
    expect(sanitize("Restoran Bon Gou")).toBe("Restoran Bon Gou");
  });

  it("drops keys that name a sensitive field, regardless of their value", () => {
    const input = {
      email: "kliyan@example.com",
      phone: "50912345678",
      first_name: "Jan",
      last_name: "Batis",
      address: "Ri Kapwa #12",
      customer_id: "uuid-1234",
      reporter_id: "uuid-5678",
      owner_id: "uuid-9999",
      driver_id: "uuid-0001",
      contact: "anything",
      password: "secret",
      api_key: "sk-abc",
      orders_count: 42,
    };
    const out = sanitize(input) as Record<string, unknown>;
    expect(out).toEqual({ orders_count: 42 });
  });

  it("redacts an email or phone number found inside an otherwise-safe string value", () => {
    const out = sanitize({
      note: "Kontakte kliyan nan kliyan@example.com oswa 50912345678",
    }) as Record<string, unknown>;
    expect(out.note).not.toContain("kliyan@example.com");
    expect(out.note).not.toContain("50912345678");
    expect(out.note).toContain("[imèl retire]");
    expect(out.note).toContain("[telefòn retire]");
  });

  it("recurses through nested objects and arrays, applying the same rules everywhere", () => {
    const input = {
      top_restaurants: [
        { name: "Griyo King", orders: 12, owner_id: "uuid-1" },
        { name: "Soup Joumou Plus", orders: 8, owner_id: "uuid-2" },
      ],
      meta: { generated_by: { email: "admin@nkdeliveri.com", role: "admin" } },
    };
    const out = sanitize(input) as {
      top_restaurants: Record<string, unknown>[];
      meta: { generated_by: Record<string, unknown> };
    };
    expect(out.top_restaurants[0]).toEqual({ name: "Griyo King", orders: 12 });
    expect(out.top_restaurants[1]).toEqual({ name: "Soup Joumou Plus", orders: 8 });
    expect(out.meta.generated_by).toEqual({ role: "admin" });
  });

  it("caps recursion depth instead of following a pathologically deep/circular-shaped structure forever", () => {
    let deep: Record<string, unknown> = { value: "bottom" };
    for (let i = 0; i < 20; i++) deep = { nested: deep };
    // Should return without throwing/hanging — the exact depth cutoff shape
    // (null past MAX_DEPTH) isn't the contract callers rely on, only that
    // it terminates.
    expect(() => sanitize(deep)).not.toThrow();
  });

  it("never lets a function or other non-JSON value pass through", () => {
    expect(sanitize(() => "x")).toBe(null);
  });

  it("sanitizeToJson produces a JSON string with sensitive keys already removed", () => {
    const json = sanitizeToJson({ email: "a@b.com", orders_count: 5 });
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ orders_count: 5 });
  });
});
