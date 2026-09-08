import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AMOUNT_UNAVAILABLE,
  isValidAmount,
  isValidNonNegativeAmount,
  requireAmount,
  sumAmounts,
  toAmount,
  toAmountOr,
} from "../money";
import { formatHTG } from "../format";

/**
 * Tès sou gad santral montan lajan an.
 *
 * Chak tès isit la korespond a yon defo reyèl nou jwenn nan kòd la (wè
 * kòmantè yo nan src/lib/money.ts), pa a yon ka teyorik. Sitou de pyèj ki
 * te pi difisil pou wè: `??` ki pa kenbe NaN, ak `Number(null)` ki bay 0.
 */

beforeEach(() => {
  // `reportInvalidAmount` ekri nan konsòl la eksprè; nou pa vle bri nan
  // sòti tès la, men nou vle konnen li rele.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("toAmount", () => {
  it("kite yon nonb fini pase", () => {
    expect(toAmount(1500)).toBe(1500);
    expect(toAmount(0)).toBe(0);
    expect(toAmount(-25.5)).toBe(-25.5);
  });

  it("aksepte string PostgREST yo (kolòn numeric)", () => {
    expect(toAmount("1500.00")).toBe(1500);
    expect(toAmount("  250 ")).toBe(250);
  });

  it("rejte NaN — se bug orijinal la (Number(undefined))", () => {
    expect(toAmount(NaN)).toBeNull();
    expect(toAmount(Number(undefined))).toBeNull();
  });

  it("rejte Infinity (yon divizyon pa zewo ki chape)", () => {
    expect(toAmount(Infinity)).toBeNull();
    expect(toAmount(-Infinity)).toBeNull();
  });

  it("rejte null ak undefined olye li fè yo tounen 0", () => {
    // `Number(null)` bay 0 — yon montan ki manke ta parèt kòm yon montan
    // reyèl zewo. Se sa ki t ap ekri "Montan resevwa: 0 HTG" sou yon resi.
    expect(Number(null)).toBe(0);
    expect(toAmount(null)).toBeNull();
    expect(toAmount(undefined)).toBeNull();
  });

  it("rejte booleyen, tab ak objè ki bay chif ki envante", () => {
    // Number(true) === 1 ak Number([]) === 0: de montan ki soti nan anyen.
    expect(Number(true)).toBe(1);
    expect(Number([])).toBe(0);
    expect(toAmount(true)).toBeNull();
    expect(toAmount([])).toBeNull();
    expect(toAmount([250])).toBeNull();
    expect(toAmount({})).toBeNull();
  });

  it("rejte string vid ak tèks ki pa nonb", () => {
    expect(toAmount("")).toBeNull();
    expect(toAmount("   ")).toBeNull();
    expect(toAmount("abc")).toBeNull();
  });
});

describe("isValidAmount", () => {
  it("se sèlman yon number fini", () => {
    expect(isValidAmount(100)).toBe(true);
    expect(isValidAmount(0)).toBe(true);
    expect(isValidAmount("100")).toBe(false);
    expect(isValidAmount(NaN)).toBe(false);
    expect(isValidAmount(null)).toBe(false);
  });
});

describe("toAmountOr", () => {
  it("bay valè ranplasman an sèlman pou yon montan ki pa valab", () => {
    expect(toAmountOr(250, 0)).toBe(250);
    expect(toAmountOr(0, 99)).toBe(0);
    expect(toAmountOr(undefined, 0)).toBe(0);
    expect(toAmountOr(NaN, 0)).toBe(0);
  });
});

describe("requireAmount — echwe eksplisitman", () => {
  it("retounen montan an lè li valab", () => {
    expect(requireAmount(250, "tès")).toBe(250);
    expect(requireAmount("250", "tès")).toBe(250);
    expect(requireAmount(0, "tès")).toBe(0);
  });

  it("leve yon erè olye li kontinye ak zewo an silans", () => {
    // Règ la: yon frè ki disparèt an silans se lajan ki pèdi.
    expect(() => requireAmount(undefined, "demann retrè")).toThrow(/demann retrè/);
    expect(() => requireAmount(NaN, "kòd pwomo")).toThrow(/kòd pwomo/);
    expect(() => requireAmount(null, "tès")).toThrow();
    expect(() => requireAmount("abc", "tès")).toThrow();
    expect(() => requireAmount(Infinity, "tès")).toThrow();
  });
});

describe("isValidNonNegativeAmount", () => {
  it("aksepte zewo ak pozitif, rejte negatif ak envalid", () => {
    expect(isValidNonNegativeAmount(0)).toBe(true);
    expect(isValidNonNegativeAmount(1500)).toBe(true);
    expect(isValidNonNegativeAmount("1500")).toBe(true);
    expect(isValidNonNegativeAmount(-1)).toBe(false);
    expect(isValidNonNegativeAmount(NaN)).toBe(false);
    expect(isValidNonNegativeAmount(undefined)).toBe(false);
  });
});

describe("nonb trè gwo", () => {
  it("yon nonb fini ki gwo rete valab", () => {
    expect(toAmount(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(formatHTG(Number.MAX_SAFE_INTEGER)).toContain("HTG");
  });

  it("men yon nonb ki depase limit JavaScript la tounen Infinity → rejte", () => {
    // Kalkile, pa ekri kòm literal: `1e309` li menm se yon literal ki pèdi
    // presizyon, epi ESLint rejte l. Sa a se menm rezilta a — yon kalkil ki
    // depase limit `number` la bay Infinity, san okenn erè.
    const tooBig = 1e308 * 10;
    expect(Number.isFinite(tooBig)).toBe(false);
    expect(toAmount(tooBig)).toBeNull();
    expect(formatHTG(tooBig)).toBe(AMOUNT_UNAVAILABLE);
  });
});

describe("sumAmounts", () => {
  it("adisyone nòmalman", () => {
    expect(sumAmounts([100, 250, 50])).toBe(400);
    expect(sumAmounts([])).toBe(0);
    expect(sumAmounts(["100", "250.50"])).toBe(350.5);
  });

  it("yon sèl move ranje bay null — pa yon total ki fo", () => {
    // Se egzakteman ka revni jounen livrè a: `sum + Number(d.fee)` ak yon
    // sèl `fee` ki manke bay NaN pou TOUT jounen an.
    expect(sumAmounts([100, undefined, 50])).toBeNull();
    expect(sumAmounts([100, NaN])).toBeNull();
    expect(sumAmounts([100, null])).toBeNull();
  });
});

describe("formatHTG — gad santral la", () => {
  it("fòmate yon montan valab", () => {
    expect(formatHTG(1500)).toContain("HTG");
    expect(formatHTG(0)).toContain("0");
  });

  it("montre « — », JAMÈ « NaN HTG »", () => {
    // Se bug la ki te parèt sou paj peman an: "Total: NaN HTG" ak bouton
    // konfime a aktif.
    expect(formatHTG(NaN)).toBe(AMOUNT_UNAVAILABLE);
    expect(formatHTG(undefined)).toBe(AMOUNT_UNAVAILABLE);
    expect(formatHTG(null)).toBe(AMOUNT_UNAVAILABLE);
  });

  it("montre « — », JAMÈ « 0 HTG », pou yon montan ki manke", () => {
    // Distenksyon ki konte: 0 HTG se yon montan reyèl. Montre l lè nou pa
    // konnen ta di yon livrè li pa touche anyen.
    expect(formatHTG(undefined)).not.toContain("0");
    expect(formatHTG(0)).not.toBe(AMOUNT_UNAVAILABLE);
  });

  it("siyale pwoblèm nan olye li kache l", () => {
    formatHTG(NaN);
    expect(console.error).toHaveBeenCalled();
  });
});
