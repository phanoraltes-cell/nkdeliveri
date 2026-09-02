#!/usr/bin/env node
// Guards against the exact class of bug this project hit in production once
// already (documented in several migrations, e.g.
// 20260709070000_fix_menu_overload_and_commission_admin.sql): running
// `CREATE OR REPLACE FUNCTION` with a *different argument list* than the
// live version doesn't replace it — Postgres creates a second overload,
// silently, with no error. The project's convention since then is to
// `DROP FUNCTION` the old signature before `CREATE OR REPLACE` whenever a
// signature changes.
//
// This script replays every migration in supabase/migrations/ in order and
// simulates Postgres's own function-overload bookkeeping: for each
// function name, it tracks the set of argument-type signatures that would
// currently exist. A CREATE (OR REPLACE) whose signature isn't already in
// that set, while other signatures for the same name still are, means a
// new overload would silently appear — exactly the hazard. Best-effort
// (regex-based, not a real SQL parser) — false negatives are possible on
// unusual formatting, false positives should not be, since it only ever
// flags a signature that doesn't match anything already known for that name.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { reportOnConflictHazards } from "./check-on-conflict-hazards.mjs";

const MIGRATIONS_DIR = "supabase/migrations";

function stripSchema(name) {
  return name.replace(/^public\./i, "").toLowerCase();
}

/** Finds the matching closing paren for the one at `openIndex`, skipping over quoted strings. */
function findMatchingParen(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      // Skip a quoted string, honoring '' as an escaped quote.
      i++;
      while (i < text.length && !(text[i] === "'" && text[i + 1] !== "'")) {
        if (text[i] === "'" && text[i + 1] === "'") i++;
        i++;
      }
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function normalizeArgTypes(argListRaw, hasParamNames) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of argListRaw) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);

  return parts
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const withoutDefault = seg.split(/\s+(?:DEFAULT|=)\s+/i)[0].trim();
      const tokens = withoutDefault.split(/\s+/);
      // CREATE/DROP FUNCTION argument lists use different grammars: a
      // CREATE declares `[argname] argtype[, ...]` (this project's own
      // convention names every param, e.g. `_restaurant_id uuid`), while a
      // DROP/REVOKE/GRANT reference is just `argtype[, ...]` with no name
      // at all — Postgres identifies the overload by type alone. Dropping
      // the first token unconditionally (as if it were always a param
      // name) silently ate the actual type off every DROP FUNCTION target.
      const type = (hasParamNames ? tokens.slice(1) : tokens).join(" ").toLowerCase();
      return stripSchema(type);
    })
    .join(",");
}

/**
 * Strips `--` line comments and `$$...$$` dollar-quoted function bodies
 * before any regex matching. Neither can ever legitimately contain a
 * CREATE/DROP FUNCTION signature we care about, but both routinely contain
 * commas, parens and quotes (example JSON in comments, RAISE EXCEPTION
 * strings, nested calls in the body) that would otherwise desync the
 * paren-depth/comma-splitting logic below.
 */
function stripNoise(text) {
  return text.replace(/--[^\n]*/g, "").replace(/\$\$[\s\S]*?\$\$/g, "$$$$");
}

function extractStatements(fileTextRaw, fileName) {
  const fileText = stripNoise(fileTextRaw);
  const statements = [];

  const createRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z_][\w.]*)\s*\(/gi;
  for (const m of fileText.matchAll(createRe)) {
    const openIndex = m.index + m[0].length - 1;
    const closeIndex = findMatchingParen(fileText, openIndex);
    if (closeIndex === -1) continue;
    const argList = fileText.slice(openIndex + 1, closeIndex);
    statements.push({
      type: "create",
      name: stripSchema(m[1]),
      sig: normalizeArgTypes(argList, true),
      file: fileName,
      index: m.index,
    });
  }

  const dropParenRe = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_][\w.]*)\s*\(/gi;
  for (const m of fileText.matchAll(dropParenRe)) {
    const openIndex = m.index + m[0].length - 1;
    const closeIndex = findMatchingParen(fileText, openIndex);
    if (closeIndex === -1) continue;
    const argList = fileText.slice(openIndex + 1, closeIndex);
    statements.push({
      type: "drop",
      name: stripSchema(m[1]),
      sig: normalizeArgTypes(argList, false),
      file: fileName,
      index: m.index,
    });
  }

  // Bare `DROP FUNCTION [IF EXISTS] name;` (no arg list — only legal when
  // the function isn't overloaded) clears every known signature for that name.
  const dropBareRe = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_][\w.]*)\s*;/gi;
  for (const m of fileText.matchAll(dropBareRe)) {
    statements.push({
      type: "drop-all",
      name: stripSchema(m[1]),
      file: fileName,
      index: m.index,
    });
  }

  statements.sort((a, b) => a.index - b.index);
  return statements;
}

function main() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const overloads = new Map(); // name -> Set<signature>
  const hazards = [];

  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const stmt of extractStatements(text, file)) {
      const known = overloads.get(stmt.name) ?? new Set();
      if (stmt.type === "drop") {
        known.delete(stmt.sig);
      } else if (stmt.type === "drop-all") {
        known.clear();
      } else {
        if (known.size > 0 && !known.has(stmt.sig)) {
          hazards.push({
            name: stmt.name,
            file: stmt.file,
            newSignature: stmt.sig || "(no args)",
            existingSignatures: [...known].map((s) => s || "(no args)"),
          });
        }
        known.add(stmt.sig);
      }
      overloads.set(stmt.name, known);
    }
  }

  // A hazard recorded mid-history is only a real problem if it was *never*
  // cleaned up — i.e. at least one of the conflicting old signatures is
  // still registered for that name once every migration has run. If a
  // later migration in the same history properly DROPs the old signature
  // (even several files later, not necessarily the very next one), the
  // overload no longer exists in the final database state and this isn't
  // something a new PR needs to fix.
  const unresolved = hazards.filter((h) => {
    const finalSigs = overloads.get(h.name) ?? new Set();
    return h.existingSignatures.some((sig) => finalSigs.has(sig === "(no args)" ? "" : sig));
  });

  // Dezyèm klas danje, endepandan de overload yo: ON CONFLICT sou yon
  // endèks inik PASYÈL (SQLSTATE 42P10 nan runtime). Wè
  // check-on-conflict-hazards.mjs pou ensidan ki fè l ajoute a.
  if (reportOnConflictHazards() > 0) process.exit(1);
  if (unresolved.length === 0) {
    console.log(
      `check-migration-hazards: ${files.length} migrations scanned, ${hazards.length} historical overload(s) all later cleaned up, no unresolved hazards.`,
    );
    process.exit(0);
  }

  console.error(
    `check-migration-hazards: ${unresolved.length} unresolved overload hazard(s) found:\n`,
  );
  for (const h of unresolved) {
    console.error(`  ${h.file}`);
    console.error(`    CREATE OR REPLACE FUNCTION ${h.name}(${h.newSignature})`);
    console.error(`    ...but an existing signature for "${h.name}" was never dropped:`);
    for (const sig of h.existingSignatures) console.error(`      - ${h.name}(${sig})`);
    console.error(
      `    Fix: add \`DROP FUNCTION IF EXISTS ${h.name}(<old signature>);\` before the CREATE OR REPLACE.\n`,
    );
  }
  process.exit(1);
}

main();
