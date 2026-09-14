/**
 * ESKE `src/integrations/supabase/types.ts` AJOU AK MIGRASYON YO?
 *
 * ---------------------------------------------------------------------------
 * POUKISA SCRIPT SA A EGZISTE
 *
 * Odit A1 la te chita sou `types.ts` pou konte tab ak fonksyon yo. Fichye a
 * te jenere 7 septanm; migrasyon `20260910000000_cuisines_normalization.sql`
 * te aplike apre. Rezilta: envantè odit la te di 61 tab pandan baz la te gen
 * 63 — `cuisines` ak `restaurant_cuisines` te envizib. Se pa yon detay: yon
 * odit ki pa wè de tab pa ka di anyen sou RLS yo, sou kle etranje yo, ni sou
 * kolòn yo.
 *
 * ---------------------------------------------------------------------------
 * POUKISA NOU PA KONPARE DAT
 *
 * Yon tchèk sou dat modifikasyon fichye a ta fo: `git checkout` remete mtime
 * yo, donk yon klòn fre ta bay yon fo alam oswa yon fo silans, o aza.
 *
 * Nou konpare KONTNI: chak tab ak chak tip ENUM migrasyon yo kreye epi yo pa
 * efase apre, dwe parèt nan `types.ts`. Sa se yon reyalite ki pa depann de
 * sistèm fichye a.
 *
 * ---------------------------------------------------------------------------
 * LI AVÈTI, LI PA FÈ VERIFY ECHWE
 *
 * Eksprè. Rejenerasyon an mande yon aksè baz done (`supabase gen types`)
 * pèsonn pa genyen nan chak anviwònman. Fè `npm run verify` tonbe ta bloke
 * tout travay sou yon bagay ki pa gen rapò ak chanjman w ap fè a. Yon
 * avètisman vizib rive nan objektif la: pèsonn pa ka di « mwen pa t konnen ».
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TYPES_PATH = "src/integrations/supabase/types.ts";
const MIGRATIONS_DIR = "supabase/migrations";

function readTypes() {
  try {
    return readFileSync(TYPES_PATH, "utf8");
  } catch {
    console.warn(`[types] ${TYPES_PATH} pa jwenn — tchèk la sote.`);
    return null;
  }
}

const types = readTypes();
if (types === null) process.exit(0);

let files;
try {
  files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lòd non yo = lòd kwonolojik (prefiks orodate)
} catch {
  console.warn(`[types] ${MIGRATIONS_DIR} pa jwenn — tchèk la sote.`);
  process.exit(0);
}

/** Tab ak ENUM ki vivan: kreye pa yon migrasyon epi pa efase pa yon pi resan. */
const tables = new Set();
const enums = new Set();

for (const f of files) {
  const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
  // Retire kòmantè yo pou yon `-- CREATE TABLE ...` nan yon eksplikasyon pa
  // konte kòm yon vrè kreyasyon.
  const code = sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");

  for (const m of code.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.(\w+)/gi)) {
    tables.add(m[1].toLowerCase());
  }
  for (const m of code.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.(\w+)/gi)) {
    tables.delete(m[1].toLowerCase());
  }
  // Yon rename se pa yon tab ki disparèt — se menm tab la ak yon lòt non.
  // San sa a, `restaurant_contract_versions` (vin `contract_versions`) ta
  // parèt kòm « ki manke » pou tout tan epi tchèk la ta vin bri moun inyore.
  for (const m of code.matchAll(
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.(\w+)\s+RENAME\s+TO\s+(\w+)/gi,
  )) {
    const from = m[1].toLowerCase();
    const to = m[2].toLowerCase();
    if (tables.delete(from)) tables.add(to);
  }
  for (const m of code.matchAll(/CREATE\s+TYPE\s+public\.(\w+)\s+AS\s+ENUM/gi)) {
    enums.add(m[1].toLowerCase());
  }
  for (const m of code.matchAll(/DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?public\.(\w+)/gi)) {
    enums.delete(m[1].toLowerCase());
  }
}

const lower = types.toLowerCase();
const missingTables = [...tables].filter((t) => !lower.includes(`${t}: {`)).sort();
const missingEnums = [...enums].filter((e) => !lower.includes(`${e}:`)).sort();

if (missingTables.length === 0 && missingEnums.length === 0) {
  console.log(
    `[types] ajou — ${tables.size} tab ak ${enums.size} enum migrasyon yo deklare tout prezan.`,
  );
  process.exit(0);
}

console.warn("");
console.warn("⚠ [types] `src/integrations/supabase/types.ts` PA AJOU.");
if (missingTables.length > 0) {
  console.warn(`  Tab migrasyon yo kreye men ki pa nan tip yo (${missingTables.length}):`);
  for (const t of missingTables) console.warn(`    - public.${t}`);
}
if (missingEnums.length > 0) {
  console.warn(`  Tip ENUM ki manke (${missingEnums.length}):`);
  for (const e of missingEnums) console.warn(`    - public.${e}`);
}
console.warn("");
console.warn("  DE KÒZ POSIB, epi yo pa mande menm aksyon:");
console.warn("");
console.warn("  1) TIP YO PERIME — migrasyon an aplike, `types.ts` pa rejenere.");
console.warn("     Se ka `cuisines` ak `restaurant_cuisines`. Pou repare:");
console.warn("       npx supabase login            # mande yon Personal Access Token");
console.warn(
  "       npx supabase gen types typescript --project-id <SUPABASE_PROJECT_ID> > src/integrations/supabase/types.ts",
);
console.warn("");
console.warn("  2) TAB LA PA EKSPOZE — okenn wòl API (`anon`/`authenticated`) pa gen");
console.warn("     dwa sou li, donk jeneratè a pa mete l. Sa NÒMAL pou yon tab admin");
console.warn("     ki pase sèlman pa yon fonksyon SECURITY DEFINER. Pa gen anyen pou");
console.warn("     repare. Verifye ak yon lekti REST: yon `42501` vle di tab la");
console.warn("     EGZISTE men li pwoteje; yon `PGRST205` vle di li PA EGZISTE — epi");
console.warn("     nan dezyèm ka a se migrasyon an ki pa aplike, pa tip yo.");
console.warn("");
console.warn("  Avètisman sèlman — `npm run verify` pa tonbe sou sa. Men nan ka 1,");
console.warn("  tout kòd ki touche tab sa yo ap san tip, epi tout odit ki chita sou");
console.warn("  tip yo ap fose — se konsa envantè odit A1 la te di 61 tab olye 63.");
console.warn("");
