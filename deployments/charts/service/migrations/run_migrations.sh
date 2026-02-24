#!/usr/bin/env bash
# Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
#
# NVIDIA CORPORATION and its licensors retain all intellectual property
# and proprietary rights in and to this software, related documentation
# and any modifications thereto. Any use, reproduction, disclosure or
# distribution of this software and related documentation without an express
# license agreement from NVIDIA CORPORATION is strictly prohibited.

# Usage: ./run_migrations.sh <target_schema>
#
# target_schema: The versioned schema name the app will use.
#                Convention: public_v{MAJOR}_{MINOR}_{PATCH} (e.g., public_v6_2_0)
#
# The script uses a contract-then-expand pattern:
#   1. Contracts (finalizes) any in-progress migration from the previous release
#   2. Applies all migrations, completing each except the last
#   3. Leaves the last migration in expand state for rollback safety
#
# The script is idempotent: safe to run multiple times against any database state.
# Migrations that have already been applied or aren't applicable are skipped.
# The target versioned schema is guaranteed to exist when the script completes.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

urlencode() {
    local string="$1" encoded="" i c
    for (( i = 0; i < ${#string}; i++ )); do
        c="${string:i:1}"
        case "$c" in
            [a-zA-Z0-9._~-]) encoded+="$c" ;;
            *) encoded+=$(printf '%%%02X' "'$c") ;;
        esac
    done
    printf '%s' "$encoded"
}

# Resolve postgres password: env var first, then Vault-rendered config file
DB_PASSWORD="${OSMO_POSTGRES_PASSWORD:-}"
if [ -z "$DB_PASSWORD" ] && [ -f "${OSMO_CONFIG_FILE:-}" ]; then
    DB_PASSWORD=$(grep -oP 'postgres_password:\s*\K\S+' "$OSMO_CONFIG_FILE" || true)
fi
if [ -z "$DB_PASSWORD" ]; then
    echo "ERROR: No postgres password. Set OSMO_POSTGRES_PASSWORD or OSMO_CONFIG_FILE."
    exit 1
fi

DB_HOST="${OSMO_POSTGRES_HOST:-localhost}"
DB_PORT="${OSMO_POSTGRES_PORT:-5432}"
DB_NAME="${OSMO_POSTGRES_DATABASE_NAME:-osmo_db}"
DB_USER="${OSMO_POSTGRES_USER:-postgres}"

ENCODED_USER=$(urlencode "$DB_USER")
ENCODED_PASSWORD=$(urlencode "$DB_PASSWORD")
export PGROLL_URL="postgres://${ENCODED_USER}:${ENCODED_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=require"

run_psql() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>&1
}

TARGET_SCHEMA="${1:?Usage: $0 <target_schema> (e.g., public_v6_2_0)}"

echo "pgroll migration runner"
echo "Target DB: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "Target schema: ${TARGET_SCHEMA}"

# --- Step 1: Initialize pgroll ---
echo ""
echo "Step 1: Initializing pgroll..."
pgroll init --postgres-url "$PGROLL_URL" 2>&1 || true

# --- Step 2: Create baseline if needed ---
# pgroll baseline has an interactive /dev/tty prompt that can't be automated.
# Instead, insert directly into pgroll's migration tracking table.
echo ""
echo "Step 2: Checking migration history..."
STATUS=$(pgroll status --postgres-url "$PGROLL_URL" 2>&1)
if echo "$STATUS" | grep -q '"status": "No migrations"'; then
    echo "  Creating baseline..."
    run_psql "INSERT INTO pgroll.migrations (schema, name, migration, resulting_schema, done, parent) VALUES ('public', '000_baseline', '{}', '\"public_000_baseline\"', true, NULL) ON CONFLICT DO NOTHING;"
fi

# --- Step 3: Contract previous migration ---
# Finalize the PREVIOUS release's migration. Safe because all pods are on
# the current version before a new upgrade begins. No-op if nothing is in progress.
echo ""
echo "Step 3: Contracting previous migration..."
OUTPUT=$(pgroll complete --postgres-url "$PGROLL_URL" 2>&1)
if [ $? -eq 0 ]; then
    echo "  Completed previous migration"
else
    echo "  No migration to complete"
fi

# --- Step 4: Apply migrations ---
# pgroll only allows one in-progress migration at a time.
# All migrations except the last use --complete (fully applied).
# The last migration stays in expand state for rollback safety between deploys.
echo ""
echo "Step 4: Applying migrations..."
MIGRATION_FILES=("$SCRIPT_DIR"/0*.json)
LAST_INDEX=$(( ${#MIGRATION_FILES[@]} - 1 ))

for i in "${!MIGRATION_FILES[@]}"; do
    migration_file="${MIGRATION_FILES[$i]}"
    name="$(basename "$migration_file")"

    if [ "$i" -eq "$LAST_INDEX" ]; then
        echo "  [$name] (expand only — last migration)"
        OUTPUT=$(pgroll start "$migration_file" --postgres-url "$PGROLL_URL" 2>&1)
    else
        echo "  [$name] (start + complete)"
        OUTPUT=$(pgroll start "$migration_file" --postgres-url "$PGROLL_URL" --complete 2>&1)
    fi

    if [ $? -eq 0 ]; then
        echo "    Applied"
    else
        echo "    Skipped: $(echo "$OUTPUT" | head -1)"
    fi
done

# --- Step 5: Ensure target versioned schema exists ---
# If pgroll created it via a structured migration, it already exists.
# If migrations were skipped (DB already at target state), we create the
# schema manually with views pointing to the physical tables in public.
echo ""
echo "Step 5: Ensuring versioned schema exists..."
SCHEMA_EXISTS=$(run_psql "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = '${TARGET_SCHEMA}');" 2>/dev/null)

if [ "$SCHEMA_EXISTS" = "t" ]; then
    echo "  Schema ${TARGET_SCHEMA} already exists"
else
    echo "  Creating ${TARGET_SCHEMA} with views..."
    run_psql "CREATE SCHEMA ${TARGET_SCHEMA};"
    run_psql "DO \$\$ DECLARE tbl RECORD; BEGIN FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('CREATE OR REPLACE VIEW ${TARGET_SCHEMA}.%I AS SELECT * FROM public.%I', tbl.tablename, tbl.tablename); END LOOP; END \$\$;"
    echo "  Created"
fi

echo ""
echo "Final status:"
pgroll status --postgres-url "$PGROLL_URL"
echo ""
echo "Set OSMO_SCHEMA_VERSION=${TARGET_SCHEMA} in your deployment"
