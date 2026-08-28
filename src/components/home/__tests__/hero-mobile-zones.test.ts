/**
 * Guard test for the mobile hero's face-exclusion contract
 * (BRIEF — HERO MOBIL PWA, 2026-08-28, Kondisyon 1). No DOM/RTL needed —
 * pure data, same pattern as restaurant-form.test.ts.
 */
import { describe, expect, it } from "vitest";
import { FACE_EXCLUSION_ZONE, HERO_MOBILE_ZONES } from "../hero-mobile-zones";

describe("hero-mobile-zones: FACE_EXCLUSION_ZONE overlap guard", () => {
  for (const [name, zone] of Object.entries(HERO_MOBILE_ZONES)) {
    it(`zone-${name} does not overlap FACE_EXCLUSION_ZONE`, () => {
      const noOverlap =
        zone.bottom <= FACE_EXCLUSION_ZONE.top || zone.top >= FACE_EXCLUSION_ZONE.bottom;
      expect(noOverlap).toBe(true);
    });
  }
});
