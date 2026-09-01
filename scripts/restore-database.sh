#!/usr/bin/env bash
# Restores a database dump produced by backup-database.sh. Deliberately
# requires an explicit --confirm flag and prints exactly which database URL
# it's about to overwrite before doing anything irreversible — restoring
# into the wrong environment is the single most damaging mistake this
# script could make. See docs/runbooks/BACKUP_RESTORE.md for the full procedure.
#
# Usage:
#   SUPABASE_DB_URL=postgres://... ./scripts/restore-database.sh backups/full_20260101T000000Z.sql --confirm

set -euo pipefail

DUMP_FILE="${1:-}"
CONFIRM_FLAG="${2:-}"

if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage: SUPABASE_DB_URL=postgres://... $0 <dump-file.sql> --confirm" >&2
  echo "  <dump-file.sql> must exist (e.g. backups/full_20260101T000000Z.sql)" >&2
  exit 1
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL is not set — refusing to guess a target database." >&2
  echo "Set it explicitly, e.g.: SUPABASE_DB_URL=postgres://... $0 $DUMP_FILE --confirm" >&2
  exit 1
fi

# Never echo the full URL (it carries the DB password) — only its host, so
# the operator can visually confirm which environment this targets without
# a secret ending up in shell history/CI logs.
TARGET_HOST="$(echo "$SUPABASE_DB_URL" | sed -E 's#.*@([^:/]+).*#\1#')"

if [ "$CONFIRM_FLAG" != "--confirm" ]; then
  echo "This will DROP and restore all data on: $TARGET_HOST"
  echo "Re-run with --confirm as the second argument once you're sure:"
  echo "  SUPABASE_DB_URL=... $0 $DUMP_FILE --confirm"
  exit 1
fi

echo "Restoring $DUMP_FILE into $TARGET_HOST ..."
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$DUMP_FILE"
echo "Restore complete. Verify the app against this database before routing production traffic to it."
