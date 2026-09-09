import { describe, it, expect } from "vitest";
import { PRIVATE_PATH_PREFIXES, isPrivatePath } from "../private-paths";

/**
 * Lis chemen prive a sèvi nan de kote (robots.txt ak antèt X-Robots-Tag).
 * Tès sa yo kenbe de bagay: chemen prive yo reyèlman detekte, EPI paj
 * piblik yo pa pran nan filè a pa aksidan — yon `/restaurants` ki ta
 * matche ta retire tout katalòg la nan Google san pèsonn pa remake.
 */

describe("isPrivatePath — sa ki dwe bloke", () => {
  it("chak prefiks li menm", () => {
    for (const prefix of PRIVATE_PATH_PREFIXES) {
      expect(isPrivatePath(prefix)).toBe(true);
    }
  });

  it("tout sa ki anba yon prefiks", () => {
    expect(isPrivatePath("/dashboard/admin/system-status")).toBe(true);
    expect(isPrivatePath("/dashboard/customer/wallet")).toBe(true);
    expect(isPrivatePath("/api/admin/ai")).toBe(true);
    expect(isPrivatePath("/orders/123")).toBe(true);
    expect(isPrivatePath("/auth/register")).toBe(true);
  });
});

describe("isPrivatePath — sa ki DWE rete piblik", () => {
  it("paj piblik yo pa pran nan filè a", () => {
    for (const path of [
      "/",
      "/restaurants",
      "/restaurants/nk-food-16defb9f",
      "/about",
      "/contact",
      "/faq",
      "/terms",
      "/privacy",
      "/sitemap.xml",
      "/robots.txt",
    ]) {
      expect(isPrivatePath(path)).toBe(false);
    }
  });

  it("yon prefiks pa matche yon mo ki jis KÒMANSE menm jan", () => {
    // Sa a se pyèj la: yon tès `startsWith("/order")` ta bloke
    // `/ordinateur`. Nou mande yon limit `/` egzat.
    expect(isPrivatePath("/orderings")).toBe(false);
    expect(isPrivatePath("/authentic-food")).toBe(false);
    expect(isPrivatePath("/administration-publique")).toBe(false);
  });
});
