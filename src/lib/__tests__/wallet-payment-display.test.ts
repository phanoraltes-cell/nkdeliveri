import { describe, it, expect } from "vitest";
import {
  decideWalletSubmit,
  isWalletActive,
  resolveWalletDisplayState,
  type WalletDisplayInput,
} from "../wallet-payment-display";

/**
 * TACH 1 — tès sou lojik afichaj wallet otomatik la.
 *
 * Sa yo se TÈS REYÈL sou kòd ki egzekite an pwodiksyon, pa yon deskripsyon
 * konpòtman. Men yo pa ka teste desizyon peman an li menm: sa a viv nan
 * `private.create_order_secure` (SQL), epi li verifye pa
 * scripts/sql/verify-money-authorization.sql plis tès manyèl yo nan
 * rapò fen travay la. Fwontyè a esprè: si yon tès isit la ta ka fè yon moun
 * kwè balans lan verifye kliyan-side, li ta yon tès ki bay manti.
 */

const base: WalletDisplayInput = {
  signedIn: true,
  walletsLoading: false,
  totalReady: true,
  totalUnavailable: false,
  walletEnabled: true,
  walletId: "11111111-1111-4111-8111-111111111111",
  balance: 4500,
  selfOrderBlocked: false,
  total: 1200,
};

describe("resolveWalletDisplayState — twa ka espesifikasyon an", () => {
  it("Ka 1: balans ase → 'sufficient' ak balans lan", () => {
    expect(resolveWalletDisplayState(base)).toEqual({ kind: "sufficient", balance: 4500 });
  });

  it("Ka 1: balans EGAL ak total la konte kòm ase (>=, pa >)", () => {
    expect(resolveWalletDisplayState({ ...base, balance: 1200, total: 1200 })).toEqual({
      kind: "sufficient",
      balance: 1200,
    });
  });

  it("Ka 2: balans pa ase → 'insufficient' ak montan ki manke a", () => {
    expect(resolveWalletDisplayState({ ...base, balance: 1200, total: 4500 })).toEqual({
      kind: "insufficient",
      balance: 1200,
      missing: 3300,
    });
  });

  it("Ka 3: pa gen wallet ditou (wallet_id NULL) → 'hidden'", () => {
    expect(resolveWalletDisplayState({ ...base, walletId: null, balance: 0 })).toEqual({
      kind: "hidden",
    });
  });

  it("Ka 3: wallet egziste men balans zewo → 'hidden'", () => {
    expect(resolveWalletDisplayState({ ...base, balance: 0 })).toEqual({ kind: "hidden" });
  });

  it("Ka 3: admin etenn wallet (payment_provider_settings) → 'hidden' menm ak lajan", () => {
    expect(resolveWalletDisplayState({ ...base, walletEnabled: false })).toEqual({
      kind: "hidden",
    });
  });

  it("Ka 3: wallet restoran bloke pou self-ordering → 'hidden'", () => {
    expect(resolveWalletDisplayState({ ...base, selfOrderBlocked: true })).toEqual({
      kind: "hidden",
    });
  });

  it("vizitè ki pa konekte → 'hidden', pa 'loading'", () => {
    expect(resolveWalletDisplayState({ ...base, signedIn: false, walletsLoading: true })).toEqual({
      kind: "hidden",
    });
  });

  it("'loading' pandan wallet yo ap chaje", () => {
    expect(resolveWalletDisplayState({ ...base, walletsLoading: true })).toEqual({
      kind: "loading",
    });
  });

  it("total ki pa ka kalkile ditou → 'hidden', PA yon eskelèt k ap kliyanse pou tout tan", () => {
    // Frè livrezon an pa li (pann rezo/konfigirasyon). Pa gen anyen k ap
    // vini, donk yon eta "loading" ta yon manti — epi pa gen okenn
    // desizyon wallet ki gen sans san yon total.
    expect(
      resolveWalletDisplayState({ ...base, totalUnavailable: true, totalReady: false }),
    ).toEqual({ kind: "hidden" });
  });

  it("'loading' toutotan total la pa final — pa yon 'insufficient' ki fo", () => {
    // Frè livrezon an poko chaje: total la ta 0 epi nou t ap di "ase" pou
    // yon segonn, apre sa "pa ase". Se egzakteman sote sa a nou anpeche.
    expect(
      resolveWalletDisplayState({ ...base, totalReady: false, balance: 100, total: 4500 }),
    ).toEqual({ kind: "loading" });
  });
});

describe("isWalletActive", () => {
  it("aktif nan Ka 1 san opt-out", () => {
    expect(isWalletActive({ kind: "sufficient", balance: 4500 }, false)).toBe(true);
  });

  it("pa aktif lè moun nan klike 'Peye ak yon lòt metòd'", () => {
    expect(isWalletActive({ kind: "sufficient", balance: 4500 }, true)).toBe(false);
  });

  it("pa janm aktif nan Ka 2 ni Ka 3", () => {
    expect(isWalletActive({ kind: "insufficient", balance: 1, missing: 2 }, false)).toBe(false);
    expect(isWalletActive({ kind: "hidden" }, false)).toBe(false);
    expect(isWalletActive({ kind: "loading" }, false)).toBe(false);
  });
});

describe("decideWalletSubmit — sa nou voye bay create_order_secure", () => {
  const walletId = "22222222-2222-4222-8222-222222222222";

  it("Ka 1: voye _method='wallet' EKSPRÈ, pou yon refi pwòp si sèvè a pa dakò", () => {
    expect(
      decideWalletSubmit({
        state: { kind: "sufficient", balance: 4500 },
        walletOptOut: false,
        fallbackMethod: "kach",
        selectedWalletId: walletId,
      }),
    ).toEqual({ method: "wallet", allowWallet: true, walletId });
  });

  it("opt-out: voye metòd kliyan an chwazi a EPI allowWallet=false", () => {
    expect(
      decideWalletSubmit({
        state: { kind: "sufficient", balance: 4500 },
        walletOptOut: true,
        fallbackMethod: "moncash",
        selectedWalletId: walletId,
      }),
    ).toEqual({ method: "moncash", allowWallet: false, walletId: undefined });
  });

  it("Ka 2: metòd kliyan an, men allowWallet rete true — se sèvè a ki deside", () => {
    // Si total sèvè a pi ba pase pa nou an, wallet la ka byen kouvri l:
    // nou pa vle bloke sa depi bò kliyan an.
    expect(
      decideWalletSubmit({
        state: { kind: "insufficient", balance: 1200, missing: 3300 },
        walletOptOut: false,
        fallbackMethod: "kach",
        selectedWalletId: walletId,
      }),
    ).toEqual({ method: "kach", allowWallet: true, walletId });
  });

  it("Ka 3: pa janm voye yon _wallet_id lè liy wallet la pa vizib", () => {
    // San sa, yon wallet restoran/livrè ta ka debite otomatikman pou yon
    // kòmand pèsonèl san moun nan pa t janm wè l sou ekran an.
    expect(
      decideWalletSubmit({
        state: { kind: "hidden" },
        walletOptOut: false,
        fallbackMethod: "kach",
        selectedWalletId: walletId,
      }),
    ).toEqual({ method: "kach", allowWallet: true, walletId: undefined });
  });

  it("wallet kliyan ki poko janm rechaje (wallet_id NULL) → undefined, sèvè a chwazi", () => {
    expect(
      decideWalletSubmit({
        state: { kind: "sufficient", balance: 500 },
        walletOptOut: false,
        fallbackMethod: "kach",
        selectedWalletId: null,
      }),
    ).toEqual({ method: "wallet", allowWallet: true, walletId: undefined });
  });

  it("pandan chajman an, nou pa voye 'wallet' — bouton an dezaktive kanmenm", () => {
    expect(
      decideWalletSubmit({
        state: { kind: "loading" },
        walletOptOut: false,
        fallbackMethod: "kach",
        selectedWalletId: walletId,
      }),
    ).toEqual({ method: "kach", allowWallet: true, walletId });
  });
});
