#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

# pgroll database migration runner.
#
# Usage: ./run_migrations.sh [target_schema]
#
# target_schema: Optional versioned schema name for the app's search_path.
#                Convention: public_v{MAJOR}_{MINOR}_{PATCH} (e.g., public_v6_2_0)
#                Defaults to "public" (no versioned schema, migrations apply to public directly).
#
# The script is idempotent: safe to run multiple times against any database state.
# If the target versioned schema already exists, the script exits immediately (no-op).
# Migrations that have already been applied or aren't applicable are skipped.

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

# Resolve postgres password: env var first, then config file (e.g., Vault-rendered)
DB_PASSWORD="${OSMO_POSTGRES_PASSWORD:-}"
if [ -z "$DB_PASSWORD" ] && [ -n "${OSMO_CONFIG_FILE:-}" ] && [ -f "$OSMO_CONFIG_FILE" ]; then
    DB_PASSWORD=$(sed -n 's/^[[:space:]]*postgres_password:[[:space:]]*//p' "$OSMO_CONFIG_FILE" | head -1)
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

TARGET_SCHEMA="${1:-public}"

run_psql() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>&1
}

echo "pgroll migration runner"
echo "Target DB: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "Target schema: ${TARGET_SCHEMA}"

# --- Step 1: Early exit if versioned schema already exists ---
# If the target is a versioned schema (not "public") and it already exists,
# all migrations have been applied and views are in place. Nothing to do.
if [ "$TARGET_SCHEMA" != "public" ]; then
    SCHEMA_EXISTS=$(run_psql "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = '${TARGET_SCHEMA}');" 2>/dev/null)
    if [ "$SCHEMA_EXISTS" = "t" ]; then
        echo ""
        echo "Schema ${TARGET_SCHEMA} already exists. Nothing to do."
        exit 0
    fi
fi

# --- Step 2: Initialize pgroll ---
echo ""
echo "Step 2: Initializing pgroll..."
pgroll init --postgres-url "$PGROLL_URL" 2>&1 || true

# --- Step 3: Create baseline if needed ---
echo ""
echo "Step 3: Checking migration history..."
STATUS=$(pgroll status --postgres-url "$PGROLL_URL" 2>&1)
if echo "$STATUS" | grep -q '"status": "No migrations"'; then
    echo "  Creating baseline..."
    run_psql "INSERT INTO pgroll.migrations (schema, name, migration, resulting_schema, done, parent) VALUES ('public', '000_baseline', '{}', '\"public_000_baseline\"', true, NULL) ON CONFLICT DO NOTHING;"
fi

# --- Step 4: Complete any in-progress migration ---
echo ""
echo "Step 4: Completing any in-progress migration..."
OUTPUT=$(pgroll complete --postgres-url "$PGROLL_URL" 2>&1)
if [ $? -eq 0 ]; then
    echo "  Completed"
else
    echo "  Nothing to complete"
fi

# --- Step 5: Apply all migrations ---
echo ""
echo "Step 5: Applying migrations..."
for migration_file in "$SCRIPT_DIR"/0*.json; do
    name="$(basename "$migration_file")"
    echo "  [$name]"
    OUTPUT=$(pgroll start "$migration_file" --postgres-url "$PGROLL_URL" --complete 2>&1)
    if [ $? -eq 0 ]; then
        echo "    Applied"
    else
        echo "    Skipped: $(echo "$OUTPUT" | head -1)"
    fi
done

# --- Step 6: Create versioned schema with views ---
if [ "$TARGET_SCHEMA" != "public" ]; then
    echo ""
    echo "Step 6: Creating versioned schema ${TARGET_SCHEMA}..."
    run_psql "CREATE SCHEMA IF NOT EXISTS ${TARGET_SCHEMA};"
    run_psql "DO \$\$ DECLARE tbl RECORD; BEGIN FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('CREATE OR REPLACE VIEW ${TARGET_SCHEMA}.%I AS SELECT * FROM public.%I', tbl.tablename, tbl.tablename); END LOOP; END \$\$;"
    echo "  Created"
fi

echo ""
echo "Final status:"
pgroll status --postgres-url "$PGROLL_URL"
echo ""
echo "Done."
