#!/usr/bin/env bash
# Dumps the Supabase Postgres database (schema + data) to a timestamped
# file under backups/ (gitignored — these are local artifacts, never
# committed). Wraps the Supabase CLI's own `db dump`, which handles the
# connection details for a linked project — see docs/BACKUP_RESTORE.md for
# the full backup/restore procedure and what to do with the resulting file
# (upload it somewhere durable; this script only produces it locally).
#
# Usage:
#   ./scripts/backup-database.sh              # schema + data (default)
#   ./scripts/backup-database.sh --schema-only # schema only, no rows
#
# Requires: Supabase CLI (`npx supabase --version`), and the project linked
# via `npx supabase link --project-ref <ref>` (one-time setup) or a
# SUPABASE_DB_URL env var pointing at the target database directly.

set -euo pipefail

MODE="${1:-full}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="backups"
mkdir -p "$OUT_DIR"

if [ "$MODE" = "--schema-only" ]; then
  OUT_FILE="$OUT_DIR/schema_${TIMESTAMP}.sql"
  echo "Dumping schema only -> $OUT_FILE"
  npx supabase db dump --schema public,private -f "$OUT_FILE"
else
  OUT_FILE="$OUT_DIR/full_${TIMESTAMP}.sql"
  echo "Dumping schema + data -> $OUT_FILE"
  npx supabase db dump --schema public,private --data-only=false -f "$OUT_FILE"
fi

echo "Backup written: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"
echo "Reminder: this file stays local and gitignored — copy it to durable storage (see docs/BACKUP_RESTORE.md)."
