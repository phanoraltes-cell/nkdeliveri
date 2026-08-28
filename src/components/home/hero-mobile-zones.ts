/**
 * Anatomical zone map for the mobile hero courier photo
 * (public/bg-hero-v2.png/.webp), used to anchor UI elements (badge,
 * search bar) at fixed relative positions on the photo — see
 * "BRIEF — HERO MOBIL PWA, NK DELIVERI" (2026-08-28).
 *
 * Percentages are of the photo container's own aspect-ratio box height
 * (aspect-[1024/1365] in hero-section.tsx), NOT the viewport — that's
 * what makes an anchor hold at every phone height (iPhone SE through
 * Pixel 8) instead of drifting the way a single fixed object-position
 * value would when viewport height varies.
 *
 * Measured against the 1024×1536 source, cropped top-anchored to
 * 1024×1365: cap ~y190-260, face ~y350-560, chest "NK DELIVERI" logo
 * ~y780-880 (visually re-confirmed against the actual file, not just
 * inherited from an older comment). Converted to % of the 1365px crop
 * window with a safety margin on both sides of each band.
 *
 * FACE_EXCLUSION_ZONE exists as its own exported constant — not a
 * comment, not a number buried in a Tailwind class — specifically so
 * it's enforceable: hero-mobile-zones.test.ts fails if any zone in
 * HERO_MOBILE_ZONES is ever edited to overlap it.
 */

export interface ZoneBand {
  /** % from the top of the photo's aspect-ratio box. */
  top: number;
  /** % from the top of the photo's aspect-ratio box. */
  bottom: number;
}

// Zòn vizaj livrè a — okenn eleman UI pa antre la.
// Rezon: kòmantè hero-section.tsx (istorik) te evite overlay nèt pou
// anpeche yon eleman glise sou vizaj la nan yon chanjman kopi. Nou
// aksepte overlay a kounye a (badj + bare rechèch), donk pwoteksyon an
// dwe eksplisit epi testab, pa yon konvansyon nan tèt yon devlopè.
export const FACE_EXCLUSION_ZONE = { top: 24, bottom: 43 } as const;

// kepi.bottom: 23, not 25 — the brief's own example value (25) touches
// FACE_EXCLUSION_ZONE.top (24) with a 1-point overlap, which the test
// below correctly fails on (verified: reverting to 25 fails the guard
// test, exactly as it should). 23 leaves a full percentage point of
// clean gap instead of an exact boundary touch.
export const HERO_MOBILE_ZONES = {
  kepi: { top: 10, bottom: 23 },
  pwatrin: { top: 51, bottom: 70 },
} as const;

/**
 * Vertical center of a zone band, as a %. Every element anchored to a
 * zone uses `style={{ top: `${zoneCenterPercent(zone)}%` }}` combined
 * with `-translate-y-1/2`, so it's centered within its band regardless
 * of its own rendered height — never a hand-picked top/bottom offset.
 */
export function zoneCenterPercent(zone: ZoneBand): number {
  return (zone.top + zone.bottom) / 2;
}
