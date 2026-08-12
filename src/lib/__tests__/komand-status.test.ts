/**
 * Unit tests for komand-status.ts's lookup tables. The actual "Komand
 * Health" classification logic lives in SQL (get_orders_admin, migration
 * 20260812100000_komand_admin_module.sql §4) and is verified there via
 * BEGIN/ROLLBACK transactional tests against the real schema — this file
 * only guards the frontend-side label/tone dictionaries the list page and
 * detail dialog render from, same "extract the pure logic" pattern as
 * admin-step-up.test.ts/auth-errors.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  KOMAND_HEALTH_LABEL,
  KOMAND_HEALTH_TONE,
  KOMAND_HEALTH_FILTERS,
  KOMAND_ASSISTANCE_LABEL,
  KOMAND_ASSISTANCE_TONE,
} from "../komand-status";

describe("KOMAND_HEALTH_FILTERS", () => {
  it("has a label for every filter value (a missing entry would render the raw SQL key to admins)", () => {
    for (const key of KOMAND_HEALTH_FILTERS) {
      expect(KOMAND_HEALTH_LABEL[key], `missing label for "${key}"`).toBeTruthy();
    }
  });

  it("has a tone for every filter value (a missing entry falls back silently to 'neutral' at render time, which this test catches instead)", () => {
    for (const key of KOMAND_HEALTH_FILTERS) {
      expect(KOMAND_HEALTH_TONE[key], `missing tone for "${key}"`).toBeTruthy();
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(KOMAND_HEALTH_FILTERS).size).toBe(KOMAND_HEALTH_FILTERS.length);
  });

  it("puts assistance_required first — the most urgent bucket admins should see first in the filter dropdown", () => {
    expect(KOMAND_HEALTH_FILTERS[0]).toBe("assistance_required");
  });
});

describe("KOMAND_HEALTH_LABEL / KOMAND_HEALTH_TONE key parity", () => {
  it("every label key has a matching tone key and vice versa (no orphans either direction)", () => {
    expect(Object.keys(KOMAND_HEALTH_LABEL).sort()).toEqual(Object.keys(KOMAND_HEALTH_TONE).sort());
  });
});

describe("KOMAND_ASSISTANCE_LABEL / KOMAND_ASSISTANCE_TONE", () => {
  const expectedStatuses = ["none", "required", "in_progress", "resolved"];

  it("covers exactly the 4 statuses komand_assistance.status's CHECK constraint allows", () => {
    expect(Object.keys(KOMAND_ASSISTANCE_LABEL).sort()).toEqual([...expectedStatuses].sort());
    expect(Object.keys(KOMAND_ASSISTANCE_TONE).sort()).toEqual([...expectedStatuses].sort());
  });

  it("'required' reads as the most urgent tone ('bad'), 'resolved' as calm ('good')", () => {
    expect(KOMAND_ASSISTANCE_TONE.required).toBe("bad");
    expect(KOMAND_ASSISTANCE_TONE.resolved).toBe("good");
  });
});
