import { describe, it, expect } from "vitest";
import { GoogleSignInError, mapGoogleReason } from "../google-identity";

/**
 * Bouton « Kontinye ak Google » a te toujou tonbe sou ansyen chemen an, epi
 * pèsonn pa t ka di poukisa: chak echèk — kle ki manke, origin ki pa
 * otorize, moun ki fèmen fenèt la — te bay MENM `console.warn` la.
 *
 * Tès sa yo kenbe distenksyon an. Sa ki konte plis se `unregistered_origin`:
 * se sèl siyal ki di konfigirasyon Google Cloud la an kòz, pa kòd la.
 */

describe("mapGoogleReason", () => {
  it("origin ki pa nan Google Cloud Console", () => {
    expect(mapGoogleReason("unregistered_origin")).toBe("unregistered_origin");
    expect(mapGoogleReason("invalid_client")).toBe("unregistered_origin");
  });

  it("pa gen sesyon Google — se yon ka nòmal, pa yon pàn", () => {
    expect(mapGoogleReason("opt_out_or_no_session")).toBe("no_google_session");
    expect(mapGoogleReason("suppressed_by_user")).toBe("no_google_session");
  });

  it("moun nan fèmen One Tap la", () => {
    expect(mapGoogleReason("user_cancel")).toBe("dismissed_by_user");
    expect(mapGoogleReason("tap_outside")).toBe("dismissed_by_user");
  });

  it("yon rezon nou pa konnen pa vin yon lòt kategori pa erè", () => {
    expect(mapGoogleReason("yon_bagay_nouvo")).toBe("unknown");
    expect(mapGoogleReason(undefined)).toBe("unknown");
  });
});

describe("GoogleSignInError", () => {
  it("chak kategori pote yon aksyon konkrè, pa yon deskripsyon", () => {
    const origin = new GoogleSignInError("unregistered_origin", "unregistered_origin");
    expect(origin.hint).toContain("Authorized JavaScript origins");
    expect(origin.hint).toContain("nkdeliveri.com");

    const missing = new GoogleSignInError("not_configured");
    // Pyèj ki koute plis tan an: ajoute varyab la nan Vercel san rebuild.
    expect(missing.hint).toContain("redeplwaye");
    expect(missing.hint).toContain("VITE_GOOGLE_CLIENT_ID");
  });

  it("kenbe rezon brit Google bay la pou jounal la", () => {
    const err = new GoogleSignInError("no_google_session", "opt_out_or_no_session");
    expect(err.googleReason).toBe("opt_out_or_no_session");
    expect(err.message).toContain("opt_out_or_no_session");
  });
});
