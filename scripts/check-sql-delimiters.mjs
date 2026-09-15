import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * DELIMITÈ DOLA KI PA BALANSE NAN YON MIGRASYON.
 *
 * ---------------------------------------------------------------------------
 * POUKISA TCHÈK SA A EGZISTE
 *
 * Migrasyon 20260915000000 te livre ak `AS $` olye `AS $$` sou de fonksyon.
 * Postgres te jete:
 *
 *   ERROR: 42601: syntax error at or near "$"  LINE 540: AS $
 *
 * Kòz la: yon script Node ki te asanble migrasyon an te sèvi ak
 * `String.replace(regex, chèn)`. Nan yon CHÈN ranplasman JavaScript, `$$`
 * vle di yon sèl `$` literal. Donk chak `$$` nan SQL la te vin `$` — an
 * silans, san okenn erè.
 *
 * Sa te pase de fwa: premye fwa mwen te repare delimitè FÈMTI yo epi mwen
 * te konte 4 `AS $$` pou 6 fonksyon san mwen pa swiv chif la. Delimitè
 * OUVÈTI yo te rete kase jiskaske Altes kouri fichye a.
 *
 * `npm run verify` pa t ka wè l: okenn tès pa pale ak Postgres, epi
 * check-migration-hazards gade patwon semantik, pa sentaks.
 *
 * ---------------------------------------------------------------------------
 * REGLA
 *
 * Yon migrasyon ka sèvi ak `$$` oswa yon tag (`$function$`, `$body$`).
 * Chak tag dwe parèt yon kantite PÈ fwa. Yon `$` ki pou kont li — pa nan
 * yon pè `$tag$` — se yon erè sentaks ki pral tonbe sou baz la.
 *
 * Kòmantè `--` retire anvan: yon `$` nan yon eksplikasyon pa konte.
 */

/**
 * Retire kòmantè `--` EPI kontni chèn ki gen apostwòf.
 *
 * De a nesesè. Yon `$` nan yon chèn se yon karaktè òdinè, pa yon delimitè:
 *
 *   CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
 *   endpoint ~ '^https://fcm\\.googleapis\\.com/'
 *   v_value->>'open'
 *
 * Premye vèsyon tchèk sa a te konte yo, epi li te bay 6 fo pozitif sou
 * migrasyon ki byen fòme. Yon tchèk ki kriye nan vid vin yon tchèk moun
 * inyore.
 *
 * Apostwòf doub (`''`) andedan yon chèn mache poukont li: bascul la fèmen
 * epi li relouvri touswit.
 */
function stripNoise(text) {
  let out = "";
  let inString = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inString) {
      if (c === "'") inString = false;
      out += c === "\n" ? "\n" : " "; // kenbe nimewo liy yo
      i++;
      continue;
    }

    if (c === "'") {
      inString = true;
      out += " ";
      i++;
      continue;
    }

    if (c === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

function migrationFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * @returns {{file: string, problem: string}[]}
 */
export function findSqlDelimiterProblems(dir = MIGRATIONS_DIR) {
  const problems = [];

  for (const name of migrationFiles(dir)) {
    const code = stripNoise(readFileSync(join(dir, name), "utf8"));

    // Tout delimitè dola: `$$` oswa `$tag$`.
    const tags = new Map();
    const re = /\$([A-Za-z_][A-Za-z_0-9]*)?\$/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      const tag = m[1] ?? "";
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }

    for (const [tag, count] of tags) {
      if (count % 2 !== 0) {
        problems.push({
          file: name,
          problem: `delimitè \`$${tag}$\` parèt ${count} fwa — yon kantite enpè, donk youn pa fèmen.`,
        });
      }
    }

    // Yon `$` ki rete apre nou retire tout pè yo se yon delimitè kase —
    // egzakteman `AS $` la.
    const leftovers = code.replace(re, "").match(/\$/g);
    if (leftovers) {
      const lines = code.split(/\r?\n/);
      const badLines = lines
        .map((l, i) => ({ l, n: i + 1 }))
        .filter(({ l }) => /\$/.test(l.replace(/\$([A-Za-z_][A-Za-z_0-9]*)?\$/g, "")))
        .map(({ n, l }) => `${n}: ${l.trim()}`);
      problems.push({
        file: name,
        problem:
          `${leftovers.length} \`$\` pou kont li (pa nan yon pè) — ` +
          `pwobableman yon \`$$\` ki vin \`$\`. Liy: ${badLines.join(" | ")}`,
      });
    }
  }

  return problems;
}

export function reportSqlDelimiterProblems() {
  const problems = findSqlDelimiterProblems();
  if (problems.length === 0) {
    console.log("check-sql-delimiters: tout delimitè dola balanse.");
    return 0;
  }
  console.error("check-sql-delimiters: DELIMITÈ KASE");
  for (const p of problems) console.error(`  - ${p.file}: ${p.problem}`);
  return problems.length;
}
