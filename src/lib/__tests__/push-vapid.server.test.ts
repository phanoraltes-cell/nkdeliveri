/**
 * Tès pou konfigirasyon VAPID — ekri apre bug "undefined is not valid
 * JSON" ki te parèt dirèkteman devan itilizatè a lè li klike "Voye yon
 * tès notifikasyon".
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getVapidConfig } from "../push-vapid.server";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env.VAPID_SUBJECT;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_JWK;
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("getVapidConfig", () => {
  it("pa janm voye yon eksepsyon lè anyen pa konfigire — li di sa ki manke", () => {
    const result = getVapidConfig();
    expect(result.configured).toBe(false);
    if (!result.configured) {
      expect(result.missing).toEqual(["VAPID_SUBJECT", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_JWK"]);
      // Se mesaj sa a ki dwe rive nan ekran an, PA `"undefined" is not valid JSON`.
      expect(result.error).toContain("VAPID_PRIVATE_JWK");
      expect(result.error).not.toContain("is not valid JSON");
    }
  });

  it('ekstrè chan "d" la lè kle a bay kòm yon JWK konplè', () => {
    process.env.VAPID_SUBJECT = "mailto:a@b.com";
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_JWK = JSON.stringify({
      kty: "EC",
      crv: "P-256",
      x: "X",
      y: "Y",
      d: "SECRET_D",
    });

    const result = getVapidConfig();
    expect(result.configured).toBe(true);
    // Lib la konstwi JWK la li menm ak `d: vapid.privateKey` — si nou
    // pase objè a nèt, importKey echwe. Se chèn nan li bezwen.
    if (result.configured) expect(result.vapid.privateKey).toBe("SECRET_D");
  });

  it("aksepte kle a bay dirèkteman kòm yon chèn base64url", () => {
    process.env.VAPID_SUBJECT = "mailto:a@b.com";
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_JWK = "RAW_D_VALUE";

    const result = getVapidConfig();
    expect(result.configured).toBe(true);
    if (result.configured) expect(result.vapid.privateKey).toBe("RAW_D_VALUE");
  });

  it("siyale yon JWK ki malfòme san voye eksepsyon", () => {
    process.env.VAPID_SUBJECT = "mailto:a@b.com";
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_JWK = "{ pa yon json";

    const result = getVapidConfig();
    expect(result.configured).toBe(false);
    if (!result.configured) expect(result.error).toContain("malfòme");
  });

  it("siyale yon JWK valid ki pa gen chan d la", () => {
    process.env.VAPID_SUBJECT = "mailto:a@b.com";
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_JWK = JSON.stringify({ kty: "EC", crv: "P-256" });

    const result = getVapidConfig();
    expect(result.configured).toBe(false);
    if (!result.configured) expect(result.error).toContain('"d"');
  });
});
