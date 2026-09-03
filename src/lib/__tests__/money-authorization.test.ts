/**
 * TACH 4 — tès refi wòl (role denial), otomatize.
 *
 * Pwoblèm nan: ni Vitest (Supabase mock) ni Playwright (mock rezo
 * konplè) pa pale ak yon vrè Postgres, donk okenn nan yo pa ka pwouve
 * RLS/GRANT reyèl. Pwonp orijinal la mande "vrè tès, pa yon deklarasyon
 * manyèl". Repons onèt la gen 2 kouch:
 *
 *   1. Tès sa yo — yo verifye sa migrasyon yo DEKLARE, epi yo kouri nan
 *      CI sou chak chanjman.
 *   2. scripts/verify-money-authorization.sql — Altes kouri l sou vrè
 *      baz done a pou konfime sa ki REYÈLMAN deplwaye.
 *
 * Chak tès isit la pwouve 2 bagay: envaryan an kenbe sou kòd reyèl la,
 * EPI verifikasyon an detekte vrè yon vyolasyon (yon tès ki pa ka echwe
 * pa pwouve anyen).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findMoneyAuthViolations } from "../../../scripts/check-money-authorization.mjs";

const MONEY_TABLES = [
  "wallets",
  "wallet_transactions",
  "payouts",
  "payout_commissions",
  "payment_intents",
  "commission_ledger",
  "payments",
  "withdrawal_rules",
];

/** Yon baz "pwòp": RLS aktive sou tout tab lajan, okenn lòt bagay. */
function cleanBaseline(): string {
  return MONEY_TABLES.map((t) => `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`).join("\n");
}

function withMigration(sql: string): string {
  const dir = mkdtempSync(join(tmpdir(), "money-auth-"));
  writeFileSync(join(dir, "20990101000000_test.sql"), sql);
  return dir;
}

describe("otorizasyon lajan — kòd reyèl la", () => {
  it("pa gen okenn vyolasyon nan migrasyon yo jodi a", () => {
    expect(findMoneyAuthViolations()).toEqual([]);
  });
});

describe("otorizasyon lajan — chak verifikasyon detekte yon vrè vyolasyon", () => {
  it("A — siyale yon nouvo fonksyon ki vin rele pa `anon`", () => {
    const dir = withMigration(
      cleanBaseline() +
        "\nGRANT EXECUTE ON FUNCTION public.request_withdrawal_secure(uuid) TO anon;",
    );
    const violations = findMoneyAuthViolations(dir);
    expect(violations.map((v) => v.check)).toContain("A");
    expect(violations.find((v) => v.check === "A")?.detail).toContain("request_withdrawal_secure");
  });

  it("A — pa plenyen pou fonksyon lekti piblik ki nan lis la", () => {
    const dir = withMigration(
      cleanBaseline() +
        "\nGRANT EXECUTE ON FUNCTION public.is_restaurant_open(uuid, timestamptz) TO anon, authenticated;",
    );
    expect(findMoneyAuthViolations(dir).filter((v) => v.check === "A")).toEqual([]);
  });

  it("B — siyale yon RPC service_role ki vin rele pa `authenticated`", () => {
    const dir = withMigration(
      cleanBaseline() +
        "\nGRANT EXECUTE ON FUNCTION public.complete_wallet_topup_secure(text, text) TO authenticated;",
    );
    const violations = findMoneyAuthViolations(dir);
    expect(violations.map((v) => v.check)).toContain("B");
  });

  it("B — yon REVOKE pita retire vyolasyon an (eta final ki konte)", () => {
    const dir = withMigration(
      cleanBaseline() +
        "\nGRANT EXECUTE ON FUNCTION public.complete_wallet_topup_secure(text, text) TO authenticated;" +
        "\nREVOKE ALL ON FUNCTION public.complete_wallet_topup_secure(text, text) FROM authenticated;",
    );
    expect(findMoneyAuthViolations(dir).filter((v) => v.check === "B")).toEqual([]);
  });

  it("C — siyale yon tab lajan san RLS", () => {
    const partial = MONEY_TABLES.filter((t) => t !== "wallets")
      .map((t) => `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`)
      .join("\n");
    const violations = findMoneyAuthViolations(withMigration(partial));
    expect(violations.filter((v) => v.check === "C")).toHaveLength(1);
    expect(violations.find((v) => v.check === "C")?.detail).toContain("wallets");
  });

  it("D — siyale yon règleman EKRITI dirèk pou `authenticated` sou yon tab lajan", () => {
    const dir = withMigration(
      cleanBaseline() +
        '\nCREATE POLICY "wallets direct write" ON public.wallets FOR UPDATE TO authenticated USING (true);',
    );
    const violations = findMoneyAuthViolations(dir);
    expect(violations.map((v) => v.check)).toContain("D");
  });

  it("D — yon DROP POLICY pita retire vyolasyon an", () => {
    const dir = withMigration(
      cleanBaseline() +
        '\nCREATE POLICY "wallets direct write" ON public.wallets FOR UPDATE TO authenticated USING (true);' +
        '\nDROP POLICY IF EXISTS "wallets direct write" ON public.wallets;',
    );
    expect(findMoneyAuthViolations(dir).filter((v) => v.check === "D")).toEqual([]);
  });

  it("D — yon règleman LEKTI pou `authenticated` pa yon vyolasyon", () => {
    const dir = withMigration(
      cleanBaseline() +
        '\nCREATE POLICY "wallets read" ON public.wallets FOR SELECT TO authenticated USING (true);',
    );
    expect(findMoneyAuthViolations(dir).filter((v) => v.check === "D")).toEqual([]);
  });
});
