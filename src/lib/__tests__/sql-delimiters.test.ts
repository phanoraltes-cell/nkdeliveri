import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSqlDelimiterProblems } from "../../../scripts/check-sql-delimiters.mjs";

/**
 * Tès sa a soti nan yon vrè pàn, epi li merite yon nòt sou kijan li rive.
 *
 * Migrasyon 20260915000000 te livre ak `AS $` olye `AS $$` sou de fonksyon.
 * Altes te kouri l epi Postgres te jete:
 *
 *   ERROR: 42601: syntax error at or near "$"   LINE 540: AS $
 *
 * Kòz la se yon detay JavaScript: nan yon CHÈN ranplasman
 * `String.replace(regex, chèn)`, `$$` vle di yon sèl `$` literal. Yon
 * script ki t ap asanble migrasyon an te manje chak `$$` san yon mo.
 *
 * Epi `npm run verify` te pase — paske okenn tès nan pwojè a pa pale ak yon
 * Postgres, epi check-migration-hazards gade patwon semantik, pa sentaks.
 * Yon migrasyon ki pa menm ka analize te travèse tout kontwòl yo.
 *
 * Chak tès isit la pwouve DE bagay: envaryan an kenbe sou 190 migrasyon
 * reyèl yo, EPI tchèk la detekte vre yon vyolasyon.
 */

function check(sql: string): ReturnType<typeof findSqlDelimiterProblems> {
  const dir = mkdtempSync(join(tmpdir(), "nkd-sqld-"));
  writeFileSync(join(dir, "20260101000000_tes.sql"), sql);
  return findSqlDelimiterProblems(dir);
}

const GOOD = `
CREATE OR REPLACE FUNCTION public.f()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RETURN;
END;
$$;
`;

describe("delimitè dola nan migrasyon yo", () => {
  it("tout migrasyon reyèl yo balanse", () => {
    expect(findSqlDelimiterProblems()).toEqual([]);
  });

  it("yon fonksyon byen fòme pa bay okenn pwoblèm", () => {
    expect(check(GOOD)).toEqual([]);
  });

  // Yon delimitè kase bay DE siyal ki konplete youn lòt: kantite `$$` la vin
  // enpè, EPI yon `$` rete pou kont li. Nou pa mande yon sèl mesaj — de a
  // vre, epi mande yon sèl ta fè tès la kase pou yon rezon ki pa gen rapò.
  it("detekte `AS $` — pàn 42601 la egzakteman", () => {
    const problems = check(GOOD.replace("AS $$", "AS $"));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => /pou kont li/.test(p.problem))).toBe(true);
    expect(problems.some((p) => /enpè/.test(p.problem))).toBe(true);
  });

  it("detekte yon delimitè fèmti ki manke yon dola", () => {
    const problems = check(GOOD.replace("\n$$;", "\n$;"));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => /pou kont li/.test(p.problem))).toBe(true);
  });

  it("detekte yon tag ki pa fèmen (`$function$`)", () => {
    const problems = check(`
CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $function$
BEGIN RETURN; END;
$$;
`);
    expect(problems.length).toBeGreaterThan(0);
  });

  it("aksepte yon tag ki byen fèmen", () => {
    expect(
      check(`
CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $function$
BEGIN RETURN; END;
$function$;
`),
    ).toEqual([]);
  });

  it("pa konte yon `$` ki nan yon chèn — ankraj regex, fouy jsonb", () => {
    // Se la premye vèsyon tchèk la te bay 6 fo pozitif sou migrasyon ki
    // byen fòme. Yon tchèk ki kriye nan vid vin yon tchèk moun inyore.
    expect(
      check(`
ALTER TABLE public.t ADD CONSTRAINT t_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE public.u ADD CONSTRAINT u_ep_check CHECK (endpoint ~ '^https://fcm\\.googleapis\\.com/');
${GOOD}
`),
    ).toEqual([]);
  });

  it("pa konte yon `$` ki nan yon kòmantè", () => {
    expect(check(`-- yon eksplikasyon ki pale de AS $ ak de $$\n${GOOD}`)).toEqual([]);
  });
});
