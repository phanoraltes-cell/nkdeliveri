#!/usr/bin/env bash
# Restores a backup dump into a TEMPORARY database and verifies it landed
# intact — never touches production. This is the automated version of the
# manual restore-test procedure described in docs/runbooks/BACKUP_RESTORE.md — see
# docs/archive/audits/BACKUP_SYSTEM_AUDIT_REPORT.md for why this exists (Phase 6 of the
# 2026-08-05 backup-system remediation).
#
# Usage:
#   TEST_DB_URL="postgres://postgres:<password>@<temp-host>:5432/postgres" \
#     ./scripts/test-restore-backup.sh backups/full_20260101T000000Z.sql
#
# TEST_DB_URL MUST point at a throwaway/temporary Postgres instance — never
# the real project database. This script actively refuses to run if
# TEST_DB_URL's host matches the production host found in .env.local's
# SUPABASE_URL, as a safety net against the single most damaging mistake
# this script could make (the same principle restore-database.sh already
# follows for a real restore).
#
# What "temporary" can mean in practice (pick whichever you have available
# — none of these are provided by this script itself):
#   - A local Postgres via Docker (`docker run --rm -e POSTGRES_PASSWORD=...
#     -p 5433:5432 postgres:17`), then TEST_DB_URL=postgres://postgres:...@127.0.0.1:5433/postgres
#   - `supabase start` (local dev stack) if Docker is available.
#   - A disposable cloud Postgres instance created solely for this test and
#     destroyed afterward.
#
# Requires: `psql` on PATH, reachable at TEST_DB_URL. This script does NOT
# spin up a database for you — Docker is not available in every
# environment this repo is worked in (see docs/archive/audits/BACKUP_SYSTEM_AUDIT_REPORT.md
# § "environnement d'exécution"), so provisioning the target is left
# explicit rather than silently assumed.
#
# Exit codes: 0 = restore succeeded AND every verification below passed.
# Non-zero = restore failed, or succeeded but something is missing — see
# the printed report for exactly what.

set -euo pipefail

DUMP_FILE="${1:-}"
KEEP_DB="${2:-}"

MIN_TABLES="${BACKUP_MIN_TABLES:-35}"
MIN_FUNCTIONS="${BACKUP_MIN_FUNCTIONS:-90}"
MIN_TRIGGERS="${BACKUP_MIN_TRIGGERS:-15}"
MIN_POLICIES="${BACKUP_MIN_POLICIES:-50}"

fail() {
  echo "[test-restore] ERROR: $1" >&2
  exit 1
}

if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage: TEST_DB_URL=postgres://... $0 <dump-file.sql> [--keep-db]" >&2
  echo "  <dump-file.sql> must exist (e.g. backups/full_20260101T000000Z.sql)" >&2
  exit 1
fi

if [ -z "${TEST_DB_URL:-}" ]; then
  fail "TEST_DB_URL is not set — refusing to guess a target. Set it to a TEMPORARY database, never production."
fi

TARGET_HOST="$(echo "$TEST_DB_URL" | sed -E 's#.*@([^:/]+).*#\1#')"

# Safety net: refuse to run against the real project host, mirroring
# restore-database.sh's own confirmation step but as a hard, automatic
# guard here (this script is meant to run unattended, so an interactive
# --confirm flag isn't enough protection on its own). Checked BEFORE the
# psql-availability check below — an unsafe target must be rejected
# immediately regardless of what tooling happens to be installed.
if [ -f .env.local ]; then
  PROD_HOST="$(grep -E '^SUPABASE_URL=' .env.local | sed -E 's/^SUPABASE_URL="?https?:\/\/([^"\/]+).*/\1/' | sed -E 's/^([^.]+)\..*/db.\1.supabase.co/')"
  if [ -n "$PROD_HOST" ] && [ "$TARGET_HOST" = "$PROD_HOST" ]; then
    fail "TEST_DB_URL targets $TARGET_HOST, which matches the production host in .env.local. Refusing to run — this script must only ever target a temporary/throwaway database."
  fi
fi

if ! command -v psql >/dev/null 2>&1; then
  fail "psql is not available on PATH in this environment. This procedure cannot run without it — see docs/archive/audits/BACKUP_SYSTEM_AUDIT_REPORT.md § environnement d'exécution for the known limitation in the sandboxed session this repo was worked in, and run this script from a machine/CI job where psql (and, if provisioning a fresh instance, Docker) is available instead."
fi

echo "[test-restore] Target (temporary) host: $TARGET_HOST"
echo "[test-restore] Restoring $DUMP_FILE ..."

if ! psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f "$DUMP_FILE" >/tmp/test-restore-psql.log 2>&1; then
  echo "[test-restore] psql output:" >&2
  cat /tmp/test-restore-psql.log >&2
  fail "Restore failed — the dump is NOT cleanly restorable. See psql output above."
fi
echo "[test-restore] Restore completed without a SQL error."

query() {
  psql "$TEST_DB_URL" -X -A -t -c "$1" | tr -d '[:space:]'
}

TABLES=$(query "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public','private') AND table_type='BASE TABLE';")
FUNCTIONS=$(query "SELECT count(*) FROM information_schema.routines WHERE routine_schema IN ('public','private');")
TRIGGERS=$(query "SELECT count(*) FROM information_schema.triggers WHERE trigger_schema IN ('public','private');")
POLICIES=$(query "SELECT count(*) FROM pg_policies WHERE schemaname IN ('public','private');")

echo "[test-restore] Restored counts: tables=$TABLES functions=$FUNCTIONS triggers=$TRIGGERS policies=$POLICIES"

PASS=1
if [ "$TABLES" -lt "$MIN_TABLES" ]; then echo "[test-restore] FAIL: tables $TABLES < $MIN_TABLES" >&2; PASS=0; fi
if [ "$FUNCTIONS" -lt "$MIN_FUNCTIONS" ]; then echo "[test-restore] FAIL: functions $FUNCTIONS < $MIN_FUNCTIONS" >&2; PASS=0; fi
if [ "$TRIGGERS" -lt "$MIN_TRIGGERS" ]; then echo "[test-restore] FAIL: triggers $TRIGGERS < $MIN_TRIGGERS" >&2; PASS=0; fi
if [ "$POLICIES" -lt "$MIN_POLICIES" ]; then echo "[test-restore] FAIL: policies $POLICIES < $MIN_POLICIES" >&2; PASS=0; fi

REPORT_FILE="${DUMP_FILE%.sql}.restore-test.md"
cat > "$REPORT_FILE" <<EOF
# Rapport de test de restauration

**Dump testé** : \`$DUMP_FILE\`
**Hôte cible (temporaire)** : $TARGET_HOST
**Restauration SQL** : $([ -s /tmp/test-restore-psql.log ] && echo "réussie, sans erreur" || echo "réussie")

| Élément | Restauré | Seuil minimum | Résultat |
|---|---|---|---|
| Tables | $TABLES | $MIN_TABLES | $([ "$TABLES" -ge "$MIN_TABLES" ] && echo ✅ || echo 🔴) |
| Fonctions | $FUNCTIONS | $MIN_FUNCTIONS | $([ "$FUNCTIONS" -ge "$MIN_FUNCTIONS" ] && echo ✅ || echo 🔴) |
| Triggers | $TRIGGERS | $MIN_TRIGGERS | $([ "$TRIGGERS" -ge "$MIN_TRIGGERS" ] && echo ✅ || echo 🔴) |
| Policies | $POLICIES | $MIN_POLICIES | $([ "$POLICIES" -ge "$MIN_POLICIES" ] && echo ✅ || echo 🔴) |

**Verdict** : $([ "$PASS" -eq 1 ] && echo "🟢 Dump réellement restaurable" || echo "🔴 Restauration incomplète — voir ci-dessus")
EOF
echo "[test-restore] Report: $REPORT_FILE"

if [ "$KEEP_DB" != "--keep-db" ]; then
  echo "[test-restore] Dropping restored objects is left to you (this script never runs DROP DATABASE — pass --keep-db to silence this note, or tear down the temporary instance yourself)."
fi

if [ "$PASS" -ne 1 ]; then
  exit 1
fi
echo "[test-restore] OK — dump is verified restorable."
