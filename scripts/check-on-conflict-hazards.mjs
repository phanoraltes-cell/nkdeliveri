import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * HAZARD — `ON CONFLICT (col)` against a PARTIAL unique index.
 *
 * Postgres cannot infer a partial unique index from `ON CONFLICT (col)`
 * unless the statement repeats the index predicate. Without it, every such
 * INSERT fails at runtime with SQLSTATE 42P10 ("there is no unique or
 * exclusion constraint matching the ON CONFLICT specification").
 *
 * This shipped undetected once and broke EVERY wallet money path (topup
 * credit, order payment debit, refund credit) — nothing caught it because
 * those paths had never actually executed in production yet. See
 * 20260902020000_fix_wallet_idempotency_on_conflict.sql for the incident.
 *
 * Final-state aware: an index created partial and later recreated full
 * (exactly that fix) is correctly no longer reported.
 */
function stripSchema(name) {
  return name.replace(/"/g, "").split(".").pop();
}

function stripNoise(text) {
  return text.replace(/--[^\n]*/g, " ");
}

export function findOnConflictHazards(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // "table.col" -> true when the CURRENT (last-written) unique index is partial.
  const partialByColumn = new Map();
  const createRe =
    /CREATE\s+UNIQUE\s+INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?\s+[\w."]+\s+ON\s+([\w."]+)\s*\(([^)]*)\)([^;]*);/gi;

  for (const file of files) {
    const text = stripNoise(readFileSync(join(dir, file), "utf8"));
    let m;
    while ((m = createRe.exec(text))) {
      const table = stripSchema(m[1].trim());
      const cols = m[2]
        .split(",")
        .map((c) => c.trim().split(/\s+/)[0])
        .filter(Boolean);
      if (cols.length !== 1) continue; // single-column inference only
      const key = table + "." + cols[0].replace(/"/g, "");
      partialByColumn.set(key, /\bWHERE\b/i.test(m[3] ?? ""));
    }
  }

  const found = [];
  const insertRe =
    /INSERT\s+INTO\s+([\w."]+)[\s\S]{0,4000}?ON\s+CONFLICT\s*\(\s*([\w"]+)\s*\)\s*(WHERE)?/gi;

  for (const file of files) {
    const text = stripNoise(readFileSync(join(dir, file), "utf8"));
    let m;
    while ((m = insertRe.exec(text))) {
      const table = stripSchema(m[1].trim());
      const col = m[2].replace(/"/g, "").trim();
      if (m[3]) continue; // predicate repeated — correct usage
      if (partialByColumn.get(table + "." + col) === true) {
        found.push({ file, table, col });
      }
    }
  }
  return found;
}

export function reportOnConflictHazards() {
  const hazards = findOnConflictHazards();
  if (hazards.length === 0) return 0;

  console.error(
    "check-migration-hazards: " + hazards.length + " ON CONFLICT / partial-index hazard(s):\n",
  );
  for (const h of hazards) {
    console.error("  " + h.file);
    console.error(
      "    INSERT INTO " +
        h.table +
        " ... ON CONFLICT (" +
        h.col +
        ") — but " +
        h.table +
        "." +
        h.col +
        "'s unique index is PARTIAL.",
    );
    console.error(
      "    Fails at runtime with SQLSTATE 42P10. Fix: repeat the index predicate\n" +
        "    (e.g. ON CONFLICT (" +
        h.col +
        ") WHERE " +
        h.col +
        " IS NOT NULL) or make the index non-partial.\n",
    );
  }
  return hazards.length;
}
