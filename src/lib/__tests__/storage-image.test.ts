import { describe, expect, it } from "vitest";
import { storageImageUrl } from "../storage-image";

/**
 * Sa ki enpòtan nan tès sa yo se sa fonksyon an REFIZE touche.
 *
 * Yon transfòmasyon ki aplike twò laj kase bagay an silans: yon bikèt prive
 * ta bay 400, yon fichye estatik ta bay 404, yon lyen ekstèn ta kase nèt.
 * Epi `ImageWithFallback` rele l sou CHAK imaj nan aplikasyon an — donk yon
 * fo pozitif isit la se yon imaj kase yon kote nan sit la.
 */

const PUBLIC =
  "https://dcsnmvbtsmdbwrwbutph.supabase.co/storage/v1/object/public/restaurant-assets/abc/cover.jpeg";

describe("storageImageUrl — sa li transfòme", () => {
  it("reekri yon objè piblik Storage ak dimansyon yo", () => {
    const out = storageImageUrl(PUBLIC, { width: 280, height: 160 });
    expect(out).toContain("/storage/v1/render/image/public/");
    expect(out).not.toContain("/storage/v1/object/public/");
    expect(out).toContain("width=280");
    expect(out).toContain("height=160");
    expect(out).toContain("resize=cover");
    expect(out).toContain("quality=75");
  });

  it("aplike `dpr` lè yon apelan mande plis netete", () => {
    expect(storageImageUrl(PUBLIC, { width: 280, height: 160, dpr: 2 })).toContain("width=560");
  });

  it("bay yon nonm antye — yon `width=280.5` se yon 400", () => {
    const out = storageImageUrl(PUBLIC, { width: 187, dpr: 1.5 });
    expect(out).toContain("width=281");
    expect(out).not.toMatch(/width=\d+\.\d/);
  });

  it("kenbe keri ki te deja la", () => {
    const out = storageImageUrl(`${PUBLIC}?t=123`, { width: 280 });
    expect(out).toContain("t=123");
    expect(out).toContain("width=280");
  });
});

describe("storageImageUrl — sa li PA touche", () => {
  it("yon fichye estatik nan depo a", () => {
    // /kategori/*.webp se Vercel ki sèvi yo; endpoint Supabase la pa wè yo.
    const src = "/kategori/haiti-1-soup-joumou.webp";
    expect(storageImageUrl(src, { width: 220, height: 220 })).toBe(src);
  });

  it("yon bikèt PRIVE — `driver-documents` an patikilye", () => {
    // De rezon: endpoint piblik la pa aplike, EPI redwi yon pyès idantite
    // yon admin dwe li ta yon fòt.
    const signed =
      "https://dcsnmvbtsmdbwrwbutph.supabase.co/storage/v1/object/sign/driver-documents/x/id.jpg?token=eyJ";
    expect(storageImageUrl(signed, { width: 280 })).toBe(signed);

    const authed =
      "https://dcsnmvbtsmdbwrwbutph.supabase.co/storage/v1/object/authenticated/driver-documents/x/id.jpg";
    expect(storageImageUrl(authed, { width: 280 })).toBe(authed);
  });

  it("yon lyen ekstèn", () => {
    const src = "https://example.com/photo.jpg";
    expect(storageImageUrl(src, { width: 280 })).toBe(src);
  });

  it("lè pa gen dimansyon — anyen pou kalkile", () => {
    expect(storageImageUrl(PUBLIC, {})).toBe(PUBLIC);
    expect(storageImageUrl(PUBLIC)).toBe(PUBLIC);
  });

  it("null ak undefined pase san chanjman", () => {
    expect(storageImageUrl(null, { width: 280 })).toBeNull();
    expect(storageImageUrl(undefined, { width: 280 })).toBeUndefined();
    expect(storageImageUrl("", { width: 280 })).toBe("");
  });
});
