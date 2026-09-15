import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findFailedDeliveryCreditViolations } from "../../../scripts/check-failed-delivery-credit.mjs";

/**
 * « Yon kòmand ki pase pa `delivery_failed` epi apre pa `delivered` bay YON
 * SÈL kredi livrè, pa de. »
 *
 * ---------------------------------------------------------------------------
 * POUKISA TÈS SA A EGZISTE, EPI KISA LI PA YE
 *
 * Defo a te reyèl epi li te sou chemen ONÈT la, pa sou yon eksplwatasyon:
 *
 *   trg_generate_driver_commission_on_delivery_failure -> kredi #1
 *   trg_generate_commission_on_delivery                -> kredi #2
 *
 * De kle inik pasyèl diferan, donk okenn konflik pa t anpeche yo koegziste.
 * Epi bouton prensipal ekran admin lan
 * (dashboard.admin.delivery-failed.tsx:175) se egzakteman « make livre ».
 * Yon admin ki fè travay li peye livrè a de fwa pou menm kous la.
 *
 * Tès sa a PA pale ak yon vrè Postgres — okenn tès nan pwojè a pa fè sa. Li
 * verifye sa migrasyon yo DEKLARE. Menm posti ak
 * money-authorization.test.ts: yon dezyèm kouch (yon kòmand tès reyèl sou
 * baz la) rete travay Altes.
 *
 * Chak tès isit la pwouve DE bagay: envaryan an kenbe sou kòd reyèl la, EPI
 * tchèk la detekte vre yon vyolasyon. Yon tchèk ki pa ka echwe pa pwouve
 * anyen.
 */

/** Yon migrasyon ki respekte tout règ yo — pwen depa chak mitasyon. */
const CLEAN = `
CREATE OR REPLACE FUNCTION private.generate_driver_commission_on_delivery_failure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.wallets (driver_id, pending_balance)
  VALUES (v_driver_id, v_provisional)
  ON CONFLICT (driver_id) DO UPDATE SET
    pending_balance = wallets.pending_balance + v_provisional;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.reverse_provisional_on_delivered()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT * INTO v_entry FROM public.commission_ledger
  WHERE order_id = NEW.id AND entry_type = 'driver_commission_delivery_failed';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reverse_provisional_on_delivered
AFTER UPDATE ON public.orders
FOR EACH ROW WHEN (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered')
EXECUTE FUNCTION private.reverse_provisional_on_delivered();
`;

/** Ekri yon seri migrasyon nan yon dosye tanporè epi kouri tchèk la sou li. */
function check(...migrations: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "nkd-fdc-"));
  migrations.forEach((sql, i) => {
    writeFileSync(join(dir, `2026010100000${i}_tes.sql`), sql);
  });
  return findFailedDeliveryCreditViolations(dir);
}

describe("envaryan: yon sèl kredi livrè pa kòmand", () => {
  it("kenbe sou migrasyon reyèl yo", () => {
    expect(findFailedDeliveryCreditViolations()).toEqual([]);
  });

  it("baz pwòp la pa bay okenn vyolasyon — sinon rès tès yo pa vle di anyen", () => {
    expect(check(CLEAN)).toEqual([]);
  });
});

describe("tchèk la detekte vre yon vyolasyon", () => {
  it("kredi echèk la ki ale nan `available_balance`", () => {
    // Se defo orijinal la: depansab touswit, san prèv, san ranvèsman.
    const bad = CLEAN.replace(
      "pending_balance = wallets.pending_balance + v_provisional",
      "available_balance = wallets.available_balance + v_provisional",
    );
    const violations = check(bad);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/available_balance/);
  });

  it("trigger ranvèsman an ki manke nèt", () => {
    const bad = CLEAN.replace(/CREATE TRIGGER trg_reverse_provisional_on_delivered[\s\S]*?;/, "");
    const violations = check(bad);
    expect(violations.some((v) => /trg_reverse_provisional_on_delivered/.test(v))).toBe(true);
  });

  it("kondisyon trigger la ki twò etwat", () => {
    // `OLD.status = 'delivery_failed'` rate chemen an
    // delivery_failed -> cancelled -> delivered.
    const bad = CLEAN.replace(
      "OLD.status IS DISTINCT FROM 'delivered'",
      "OLD.status = 'delivery_failed'",
    );
    const violations = check(bad);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/twò etwat/);
  });

  it("fonksyon ranvèsman an ki pa vize bon antre a", () => {
    const bad = CLEAN.replace(
      "entry_type = 'driver_commission_delivery_failed'",
      "entry_type = 'order_commission'",
    );
    const violations = check(bad);
    expect(violations.some((v) => /p ap ranvèse anyen/.test(v))).toBe(true);
  });

  it("yon migrasyon PI RESAN ki retire trigger la", () => {
    const violations = check(
      CLEAN,
      "DROP TRIGGER IF EXISTS trg_reverse_provisional_on_delivered ON public.orders;",
    );
    expect(violations.some((v) => /retire pa yon migrasyon pi resan/.test(v))).toBe(true);
  });

  it("yon migrasyon pi resan ki retire EPI remete l pa yon vyolasyon", () => {
    const violations = check(
      CLEAN,
      `DROP TRIGGER IF EXISTS trg_reverse_provisional_on_delivered ON public.orders;
       CREATE TRIGGER trg_reverse_provisional_on_delivered
       AFTER UPDATE ON public.orders
       FOR EACH ROW WHEN (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered')
       EXECUTE FUNCTION private.reverse_provisional_on_delivered();`,
    );
    expect(violations).toEqual([]);
  });
});
