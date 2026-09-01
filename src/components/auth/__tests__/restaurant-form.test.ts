/**
 * Unit tests for `buildRestaurantHoursMetadata` — the pure piece of the
 * restaurant signup form's opening_hours fix
 * (docs/archive/audits/DRIVER_RESTAURANT_REGISTRATION_REMEDIATION_REPORT.md, Root Cause
 * R1). This project's Vitest setup has no DOM/RTL, so the pure logic is
 * exported from its own file and tested directly instead — same pattern
 * as createPollController in useCollectPaymentPoll.ts.
 */
import { describe, expect, it } from "vitest";
import { buildRestaurantHoursMetadata } from "../restaurant-form.logic";

describe("restaurant-form.tsx: buildRestaurantHoursMetadata", () => {
  it("Cas A — horaires renseignés: produces a JSON-encoded restaurant_hours string, exact value round-trips", () => {
    const hours = {
      mon: { open: "09:00", close: "18:00", closed: false },
      sun: { open: "", close: "", closed: true },
    };
    const result = buildRestaurantHoursMetadata(hours);

    expect(result).toHaveProperty("restaurant_hours");
    expect(typeof result.restaurant_hours).toBe("string");
    expect(JSON.parse(result.restaurant_hours!)).toEqual(hours);
  });

  it("Cas B — horaires non renseignés (jamais touché): omits the key entirely, same as pre-fix behavior", () => {
    const result = buildRestaurantHoursMetadata({});
    expect(result).toEqual({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("only the touched days are included — matches HoursPicker's own write behavior (never backfills untouched days)", () => {
    const hours = { wed: { open: "10:00", close: "20:00", closed: false } };
    const result = buildRestaurantHoursMetadata(hours);
    const decoded = JSON.parse(result.restaurant_hours!);
    expect(Object.keys(decoded)).toEqual(["wed"]);
  });
});
