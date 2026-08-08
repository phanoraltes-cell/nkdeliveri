#!/usr/bin/env bash
# Dumps the Supabase Postgres database (schema + data) to a timestamped
# file under backups/ (gitignored — these are local artifacts, never
# committed). Wraps the Supabase CLI's own `db dump` — see
# docs/BACKUP_RESTORE.md for the full backup/restore procedure and
# docs/BACKUP_SYSTEM_AUDIT_REPORT.md for why this script looks the way it
# does (root-cause audit of the previous version, 2026-08-05).
#
# Root causes fixed here, not present in the previous version of this file:
#   1. The installed Supabase CLI has NO single-call combined schema+data
#      dump mode — `--data-only=false` (the old flag) silently produced a
#      schema-only dump every time (`supabase db dump --dry-run` proves the
#      underlying `pg_dump` invocation is always `--schema-only` unless
#      `--data-only` is explicitly passed). Fixed by running TWO passes
#      (schema, then data) and concatenating them in dependency-safe order.
#   2. `supabase db dump -f <file>` creates/truncates <file> before running
#      the actual dump — if the dump then fails, the empty file it already
#      created was never cleaned up by the old script. Fixed by dumping to
#      a temp file first and only ever moving/writing the *final* output
#      file once every verification below has passed; a trap removes any
#      leftover output on any failure path.
#   3. Nothing verified the dump's own content — a schema-only or
#      0-byte "backup" looked identical to a real one until someone
#      manually opened it. Fixed by counting CREATE TABLE / CREATE
#      FUNCTION / CREATE TRIGGER / CREATE POLICY / data rows and comparing
#      against configurable minimum thresholds; any shortfall deletes the
#      output and exits non-zero with an explicit reason — this script now
#      cannot produce a file that *looks* like a valid backup without
#      actually being one.
#
# Usage:
#   ./scripts/backup-database.sh              # schema + data (default)
#   ./scripts/backup-database.sh --schema-only # schema only, no rows
#
# Threshold overrides (optional env vars, defaults are conservative — see
# docs/BACKUP_SYSTEM_AUDIT_REPORT.md for how these defaults were chosen):
#   BACKUP_MIN_SIZE_BYTES   (default 200000)
#   BACKUP_MIN_TABLES       (default 35)
#   BACKUP_MIN_FUNCTIONS    (default 90)
#   BACKUP_MIN_TRIGGERS     (default 15)
#   BACKUP_MIN_POLICIES     (default 50)
#
# Requires: Supabase CLI (`npx supabase --version`), and the project linked
# via `npx supabase link --project-ref <ref>` (one-time setup).
#
# Exit codes: 0 = valid backup written. Non-zero = no usable file was left
# behind (see message on stderr for the exact reason) — never a partial or
# unverified file.

set -euo pipefail

MODE="${1:-full}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="backups"
mkdir -p "$OUT_DIR"

MIN_SIZE_BYTES="${BACKUP_MIN_SIZE_BYTES:-200000}"
MIN_TABLES="${BACKUP_MIN_TABLES:-35}"
MIN_FUNCTIONS="${BACKUP_MIN_FUNCTIONS:-90}"
MIN_TRIGGERS="${BACKUP_MIN_TRIGGERS:-15}"
MIN_POLICIES="${BACKUP_MIN_POLICIES:-50}"

#   - `mktemp` defaults to the system temp dir (bash's own `/tmp`, whatever
#     that resolves to). In this project's Git Bash/MSYS environment, that
#     resolution has been observed to disagree with how the SAME path
#     string resolves when passed as a `-f` argument to `supabase db dump`
#     — a native (non-MSYS) Windows binary launched via node.exe — landing
#     the real dump in one location while bash keeps looking at an empty
#     placeholder file in another (docs/BACKUP_EMPTY_DUMP_ROOT_CAUSE_REPORT.md).
#     `-p "$OUT_DIR"` sidesteps this entirely: a relative path under the
#     project's own backups/ dir resolves identically for bash and for any
#     native subprocess, no `/tmp` translation involved either way.
SCHEMA_TMP="$(mktemp -p "$OUT_DIR")"
DATA_TMP="$(mktemp -p "$OUT_DIR")"
OUT_FILE=""
REPORT_FILE=""
SUCCESS=0

# Runs on ANY exit (normal or error) — the one place responsible for never
# leaving a half-written or unverified file behind. Temp files are always
# removed; the *final* output (and its report) is only kept if SUCCESS was
# explicitly set to 1 after every check below passed.
cleanup() {
  local exit_code=$?
  rm -f "$SCHEMA_TMP" "$DATA_TMP"
  if [ "$SUCCESS" -ne 1 ]; then
    if [ -n "$OUT_FILE" ] && [ -f "$OUT_FILE" ]; then
      echo "[backup] FAILED — removing incomplete/unverified output: $OUT_FILE" >&2
      rm -f "$OUT_FILE"
    fi
    if [ -n "$REPORT_FILE" ] && [ -f "$REPORT_FILE" ]; then
      rm -f "$REPORT_FILE"
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT

fail() {
  echo "[backup] ERROR: $1" >&2
  exit 1
}

count_matches() {
  # $1 = extended-regex pattern, $2 = file. grep exits 1 on zero matches —
  # `|| true` keeps that from tripping `set -e`, `-c` still prints 0.
  grep -cE "$1" "$2" 2>/dev/null || true
}

START_EPOCH=$(date +%s)
START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ "$MODE" = "--schema-only" ]; then
  OUT_FILE="$OUT_DIR/schema_${TIMESTAMP}.sql"
  echo "[backup] Dumping schema only -> $OUT_FILE"
  if ! npx supabase db dump --linked --schema public,private -f "$SCHEMA_TMP"; then
    fail "supabase db dump (schema) failed — see the error printed above. No file was kept."
  fi
  mv "$SCHEMA_TMP" "$OUT_FILE"
else
  OUT_FILE="$OUT_DIR/full_${TIMESTAMP}.sql"

  echo "[backup] Dumping schema (pass 1/2) ..."
  if ! npx supabase db dump --linked --schema public,private -f "$SCHEMA_TMP"; then
    fail "supabase db dump (schema pass) failed — see the error printed above. No file was kept."
  fi

  echo "[backup] Dumping data (pass 2/2) ..."
  if ! npx supabase db dump --linked --schema public,private --data-only -f "$DATA_TMP"; then
    fail "supabase db dump (data pass) failed — see the error printed above. No file was kept."
  fi

  {
    echo "-- NK Deliveri combined backup (schema + data)"
    echo "-- Generated $START_ISO by scripts/backup-database.sh"
    echo "-- Schema pass + data pass, concatenated in dependency-safe order"
    echo "-- (see docs/BACKUP_SYSTEM_AUDIT_REPORT.md for why this is two passes, not one)"
    echo ""
    cat "$SCHEMA_TMP"
    echo ""
    echo "-- ==== DATA (schema public,private; --data-only --column-inserts) ===="
    cat "$DATA_TMP"
  } > "$OUT_FILE"
fi

END_EPOCH=$(date +%s)
DURATION_SECONDS=$((END_EPOCH - START_EPOCH))

# ---------------------------------------------------------------------------
# Phase 3 — content verification. Every one of these must be present, or
# the backup is deleted (by the trap above) and the script exits non-zero.
# ---------------------------------------------------------------------------
TABLES=$(count_matches "^CREATE TABLE" "$OUT_FILE")
FUNCTIONS=$(count_matches "^CREATE( OR REPLACE)? FUNCTION" "$OUT_FILE")
TRIGGERS=$(count_matches "^CREATE( OR REPLACE)? TRIGGER" "$OUT_FILE")
POLICIES=$(count_matches "^CREATE POLICY" "$OUT_FILE")
SIZE_BYTES=$(stat -c%s "$OUT_FILE" 2>/dev/null || stat -f%z "$OUT_FILE")

DATA_ROWS=0
if [ "$MODE" != "--schema-only" ]; then
  # Counted from the DATA section specifically (after the marker), not the
  # whole file — the schema section's function *bodies* can themselves
  # contain the literal text "INSERT INTO" (e.g. create_order_secure's own
  # PL/pgSQL source), which must never be mistaken for exported data rows.
  DATA_SECTION="$(awk '/^-- ==== DATA /{found=1} found' "$OUT_FILE")"
  DATA_ROWS=$(printf '%s\n' "$DATA_SECTION" | grep -cE "^INSERT INTO" 2>/dev/null || true)
fi

echo "[backup] Content check: tables=$TABLES functions=$FUNCTIONS triggers=$TRIGGERS policies=$POLICIES data_rows=$DATA_ROWS size=${SIZE_BYTES}B"

if [ "$TABLES" -eq 0 ]; then fail "0 CREATE TABLE found — schema dump did not run correctly."; fi
if [ "$FUNCTIONS" -eq 0 ]; then fail "0 CREATE FUNCTION found — schema dump did not run correctly."; fi
if [ "$TRIGGERS" -eq 0 ]; then fail "0 CREATE TRIGGER found — this is exactly the defect that made the 2026-07-31 backup unusable (docs/BACKUP_SYSTEM_AUDIT_REPORT.md). Refusing to keep this file."; fi
if [ "$POLICIES" -eq 0 ]; then fail "0 CREATE POLICY found — schema dump did not run correctly."; fi
if [ "$MODE" != "--schema-only" ] && [ "$DATA_ROWS" -eq 0 ]; then
  fail "0 data rows (INSERT) found in the data pass — this is exactly the defect that made every prior 'full' backup schema-only (docs/BACKUP_SYSTEM_AUDIT_REPORT.md). Refusing to keep this file. (If every table is genuinely empty, e.g. a brand-new environment, use --schema-only instead so this isn't mistaken for a failure.)"
fi

# ---------------------------------------------------------------------------
# Phase 4 — threshold validation, against configurable minimums.
# ---------------------------------------------------------------------------
if [ "$SIZE_BYTES" -lt "$MIN_SIZE_BYTES" ]; then
  fail "File size ${SIZE_BYTES}B is below the configured minimum ${MIN_SIZE_BYTES}B (BACKUP_MIN_SIZE_BYTES)."
fi
if [ "$TABLES" -lt "$MIN_TABLES" ]; then
  fail "Table count $TABLES is below the configured minimum $MIN_TABLES (BACKUP_MIN_TABLES) — expected at least this many from the current schema."
fi
if [ "$FUNCTIONS" -lt "$MIN_FUNCTIONS" ]; then
  fail "Function count $FUNCTIONS is below the configured minimum $MIN_FUNCTIONS (BACKUP_MIN_FUNCTIONS)."
fi
if [ "$TRIGGERS" -lt "$MIN_TRIGGERS" ]; then
  fail "Trigger count $TRIGGERS is below the configured minimum $MIN_TRIGGERS (BACKUP_MIN_TRIGGERS)."
fi
if [ "$POLICIES" -lt "$MIN_POLICIES" ]; then
  fail "Policy count $POLICIES is below the configured minimum $MIN_POLICIES (BACKUP_MIN_POLICIES)."
fi

# ---------------------------------------------------------------------------
# Phase 5 — integrity report (SHA-256, size, date, duration, counts).
# ---------------------------------------------------------------------------
SHA256="$(sha256sum "$OUT_FILE" | cut -d' ' -f1)"
REPORT_FILE="${OUT_FILE%.sql}.report.md"

cat > "$REPORT_FILE" <<EOF
# Rapport d'intégrité de sauvegarde

**Fichier** : \`$OUT_FILE\`
**Date (UTC)** : $START_ISO
**Durée** : ${DURATION_SECONDS}s
**Taille** : ${SIZE_BYTES} octets
**SHA-256** : \`$SHA256\`

## Contenu vérifié

| Élément | Nombre | Seuil minimum | Résultat |
|---|---|---|---|
| CREATE TABLE | $TABLES | $MIN_TABLES | ✅ |
| CREATE FUNCTION | $FUNCTIONS | $MIN_FUNCTIONS | ✅ |
| CREATE TRIGGER | $TRIGGERS | $MIN_TRIGGERS | ✅ |
| CREATE POLICY | $POLICIES | $MIN_POLICIES | ✅ |
| Lignes de données (INSERT) | $DATA_ROWS | (≥1 requis si mode complet) | ✅ |

Toutes les vérifications ont réussi — ce fichier a été conservé. Un échec sur n'importe laquelle de ces vérifications aurait supprimé le dump automatiquement (voir \`scripts/backup-database.sh\`).
EOF

SUCCESS=1
echo "[backup] OK — valid backup written: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"
echo "[backup] Integrity report: $REPORT_FILE"
echo "[backup] Reminder: this file stays local and gitignored — copy it to durable storage (see docs/BACKUP_RESTORE.md)."
