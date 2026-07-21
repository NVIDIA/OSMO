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
# Migrations recorded as complete in pgroll's history are skipped. Versioned-schema
# views are refreshed after every run so they include columns from new migrations.

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
V6_0_DATA_MIGRATION="001_v6_0_0_data_prep"
V6_0_SCHEMA_MIGRATION="002_v6_0_0_schema"
V6_2_SCHEMA_MIGRATION="003_v6_2_0_schema"
V6_2_DATA_MIGRATION="004_v6_2_0_data"
V6_3_SCHEMA_MIGRATION="005_v6_3_0_schema"

run_psql() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>&1
}

create_baseline() {
    local baseline_name="$1"
    local baseline_directory output

    if ! baseline_directory=$(mktemp -d "${TMPDIR:-/tmp}/osmo-pgroll-baseline.XXXXXX"); then
        echo "ERROR: Failed to create a temporary baseline directory."
        return 1
    fi
    if output=$(pgroll baseline "$baseline_name" "$baseline_directory" --yes --json --postgres-url "$PGROLL_URL" 2>&1); then
        rm -rf "$baseline_directory"
        return 0
    fi

    rm -rf "$baseline_directory"
    echo "ERROR: Failed to create pgroll baseline $baseline_name: $(echo "$output" | head -1)"
    return 1
}

baseline_covers_migration() {
    local migration_name="$1"
    local baseline_rank migration_rank

    case "$BASELINE_MIGRATION" in
        000_baseline) baseline_rank=0 ;;
        "$V6_0_DATA_MIGRATION") baseline_rank=1 ;;
        "$V6_0_SCHEMA_MIGRATION") baseline_rank=2 ;;
        "$V6_2_SCHEMA_MIGRATION") baseline_rank=3 ;;
        "$V6_2_DATA_MIGRATION") baseline_rank=4 ;;
        "$V6_3_SCHEMA_MIGRATION") baseline_rank=5 ;;
        *)
            return 1
            ;;
    esac

    # Schema fingerprints never infer data migrations. Only an exact completed
    # history row or an explicit trusted baseline can cover migrations 001/004.
    case "$migration_name" in
        "$V6_0_DATA_MIGRATION") migration_rank=1 ;;
        "$V6_0_SCHEMA_MIGRATION") migration_rank=2 ;;
        "$V6_2_SCHEMA_MIGRATION") migration_rank=3 ;;
        "$V6_2_DATA_MIGRATION") migration_rank=4 ;;
        "$V6_3_SCHEMA_MIGRATION") migration_rank=5 ;;
        *) return 1 ;;
    esac

    (( baseline_rank >= migration_rank ))
}

echo "pgroll migration runner"
echo "Target DB: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "Target schema: ${TARGET_SCHEMA}"

# --- Step 1: Initialize pgroll ---
echo ""
echo "Step 1: Initializing pgroll..."
if ! OUTPUT=$(pgroll init --postgres-url "$PGROLL_URL" 2>&1); then
    echo "ERROR: Failed to initialize pgroll: $(echo "$OUTPUT" | head -1)"
    exit 1
fi

# --- Step 2: Read migration history ---
echo ""
echo "Step 2: Checking migration history..."
if ! STATUS=$(pgroll status --postgres-url "$PGROLL_URL" 2>&1); then
    echo "ERROR: Failed to read pgroll status: $(echo "$STATUS" | head -1)"
    exit 1
fi
NO_MIGRATION_HISTORY=false
if echo "$STATUS" | grep -q '"status": "No migrations"'; then
    NO_MIGRATION_HISTORY=true
fi

# --- Step 3: Complete any in-progress migration ---
echo ""
echo "Step 3: Completing any in-progress migration..."
if ! ACTIVE_MIGRATION=$(run_psql "SELECT EXISTS (SELECT 1 FROM pgroll.migrations WHERE schema = 'public' AND done = false);"); then
    echo "ERROR: Failed to check for an active migration: $(echo "$ACTIVE_MIGRATION" | head -1)"
    exit 1
fi
if [ "$ACTIVE_MIGRATION" = "t" ]; then
    if OUTPUT=$(pgroll complete --postgres-url "$PGROLL_URL" 2>&1); then
        echo "  Completed"
    else
        echo "ERROR: Failed to complete the active migration: $(echo "$OUTPUT" | head -1)"
        exit 1
    fi
else
    echo "  Nothing to complete"
fi

# --- Step 4: Baseline schemas created before migration tracking ---
echo ""
echo "Step 4: Checking bootstrap state..."
if ! BASELINE_MIGRATION=$(run_psql "SELECT COALESCE((SELECT name FROM pgroll.migrations WHERE schema = 'public' AND migration_type = 'baseline' ORDER BY created_at DESC LIMIT 1), '');"); then
    echo "ERROR: Failed to read pgroll baseline: $(echo "$BASELINE_MIGRATION" | head -1)"
    exit 1
fi
if ! V6_0_SCHEMA_CURRENT=$(run_psql "
    SELECT
        to_regclass('public.backends') IS NOT NULL
        AND to_regclass('public.pools') IS NOT NULL
        AND NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (table_name, column_name) IN (
                  ('backends', 'gpu_product_label'),
                  ('backends', 'affinity'),
                  ('backends', 'node_condition_prefix'),
                  ('backends', 'config_nccl_test'),
                  ('backends', 'support_nccl_test'),
                  ('backends', 'cache_config'),
                  ('pools', 'enable_nccl_test')))
        AS v6_0_schema_current;
"); then
    echo "ERROR: Failed to inspect the existing OSMO v6.0 schema: $(echo "$V6_0_SCHEMA_CURRENT" | head -1)"
    exit 1
fi
# Older deployments created the v6.2 schema through release SQL and application
# initialization before pgroll tracked every structural migration. Verify the
# application-compatible structure represented by migrations 002 and 003. The
# data-bearing migrations 001 and 004 are covered only by history or execution.
if ! V6_2_SCHEMA_CURRENT=$(run_psql "
    WITH expected_columns(
        table_name,
        column_name,
        udt_name,
        nullable_state,
        default_kind
    ) AS (
        VALUES
            ('group_templates', 'name', 'text', 'NO', 'none'),
            ('group_templates', 'group_template', 'jsonb', 'ANY', 'none'),
            ('users', 'id', 'text', 'NO', 'none'),
            ('users', 'created_at', 'timestamptz', 'NO', 'now'),
            ('users', 'created_by', 'text', 'YES', 'none'),
            ('user_roles', 'id', 'uuid', 'NO', 'uuid'),
            ('user_roles', 'user_id', 'text', 'NO', 'none'),
            ('user_roles', 'role_name', 'text', 'NO', 'none'),
            ('user_roles', 'assigned_by', 'text', 'NO', 'none'),
            ('user_roles', 'assigned_at', 'timestamptz', 'NO', 'now'),
            ('access_token_roles', 'user_name', 'text', 'NO', 'none'),
            ('access_token_roles', 'token_name', 'text', 'NO', 'none'),
            ('access_token_roles', 'user_role_id', 'uuid', 'NO', 'none'),
            ('access_token_roles', 'assigned_by', 'text', 'NO', 'none'),
            ('access_token_roles', 'assigned_at', 'timestamptz', 'NO', 'now'),
            ('role_external_mappings', 'role_name', 'text', 'NO', 'none'),
            ('role_external_mappings', 'external_role', 'text', 'NO', 'none'),
            ('access_token', 'last_seen_at', 'timestamptz', 'YES', 'none'),
            ('roles', 'sync_mode', 'text', 'NO', 'import'),
            ('pools', 'common_group_templates', '_text', 'YES', 'optional_text_array'),
            ('pools', 'parsed_group_templates', 'jsonb', 'YES', 'optional_json_array'),
            ('pools', 'topology_keys', 'jsonb', 'YES', 'optional_json_array'),
            ('groups', 'group_template_resource_types', 'jsonb',
             'YES', 'optional_json_array')
    ),
    expected_primary_keys(table_name, column_names) AS (
        VALUES
            ('group_templates', ARRAY['name']::TEXT[]),
            ('users', ARRAY['id']::TEXT[]),
            ('user_roles', ARRAY['id']::TEXT[])
    ),
    expected_foreign_keys(
        table_name,
        column_names,
        referenced_table_name,
        referenced_column_names
    ) AS (
        VALUES
            ('user_roles', ARRAY['user_id']::TEXT[], 'users', ARRAY['id']::TEXT[]),
            ('user_roles', ARRAY['role_name']::TEXT[], 'roles', ARRAY['name']::TEXT[]),
            ('access_token_roles', ARRAY['user_role_id']::TEXT[],
             'user_roles', ARRAY['id']::TEXT[]),
            ('role_external_mappings', ARRAY['role_name']::TEXT[],
             'roles', ARRAY['name']::TEXT[])
    ),
    expected_indexes(table_name, index_name, column_names) AS (
        VALUES
            ('user_roles', 'idx_user_roles_user', ARRAY['user_id']::TEXT[]),
            ('user_roles', 'idx_user_roles_role', ARRAY['role_name']::TEXT[]),
            ('access_token_roles', 'idx_access_token_roles_token',
             ARRAY['user_name', 'token_name']::TEXT[]),
            ('access_token_roles', 'idx_access_token_roles_user_role',
             ARRAY['user_role_id']::TEXT[]),
            ('role_external_mappings', 'idx_role_external_mappings_external_role',
             ARRAY['external_role']::TEXT[])
    )
    SELECT
        to_regclass('public.workflows') IS NOT NULL
        AND to_regclass('public.backends') IS NOT NULL
        AND to_regclass('public.pools') IS NOT NULL
        AND to_regclass('public.groups') IS NOT NULL
        AND to_regclass('public.access_token') IS NOT NULL
        AND to_regclass('public.roles') IS NOT NULL
        AND to_regclass('public.dataset_version') IS NOT NULL
        AND NOT EXISTS (
            SELECT 1
            FROM expected_columns expected_column
            WHERE NOT EXISTS (
                SELECT 1
                FROM information_schema.columns column_info
                WHERE column_info.table_schema = 'public'
                  AND column_info.table_name = expected_column.table_name
                  AND column_info.column_name = expected_column.column_name
                  AND column_info.udt_name = expected_column.udt_name
                  AND (expected_column.nullable_state = 'ANY'
                       OR column_info.is_nullable = expected_column.nullable_state)
                  AND CASE expected_column.default_kind
                      WHEN 'none' THEN column_info.column_default IS NULL
                      WHEN 'now' THEN column_info.column_default = 'now()'
                      WHEN 'uuid' THEN column_info.column_default = 'gen_random_uuid()'
                      WHEN 'import' THEN column_info.column_default = '''import''::text'
                      WHEN 'optional_text_array' THEN
                          column_info.column_default IS NULL
                          OR column_info.column_default = '''{}''::text[]'
                      WHEN 'optional_json_array' THEN
                          column_info.column_default IS NULL
                          OR column_info.column_default = '''[]''::jsonb'
                      ELSE false
                  END))
        AND NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (table_name, column_name) IN (
                  ('pools', 'action_permissions'),
                  ('access_token', 'access_type'),
                  ('access_token', 'roles'),
                  ('dataset_version', 'retention_policy')))
        AND NOT EXISTS (
            SELECT 1
            FROM expected_primary_keys expected_primary_key
            WHERE NOT EXISTS (
                SELECT 1
                FROM pg_constraint constraint_info
                WHERE constraint_info.contype = 'p'
                  AND constraint_info.convalidated
                  AND constraint_info.conrelid = to_regclass(
                      'public.' || expected_primary_key.table_name)
                  AND ARRAY(
                      SELECT attribute_info.attname::TEXT
                      FROM unnest(constraint_info.conkey) WITH ORDINALITY
                           AS key_info(attribute_number, key_order)
                      JOIN pg_attribute attribute_info
                        ON attribute_info.attrelid = constraint_info.conrelid
                       AND attribute_info.attnum = key_info.attribute_number
                      ORDER BY key_info.key_order) = expected_primary_key.column_names))
        AND NOT EXISTS (
            SELECT 1
            FROM expected_foreign_keys expected_foreign_key
            WHERE NOT EXISTS (
                SELECT 1
                FROM pg_constraint constraint_info
                WHERE constraint_info.contype = 'f'
                  AND constraint_info.convalidated
                  AND constraint_info.confdeltype = 'c'
                  AND constraint_info.conrelid = to_regclass(
                      'public.' || expected_foreign_key.table_name)
                  AND constraint_info.confrelid = to_regclass(
                      'public.' || expected_foreign_key.referenced_table_name)
                  AND ARRAY(
                      SELECT attribute_info.attname::TEXT
                      FROM unnest(constraint_info.conkey) WITH ORDINALITY
                           AS key_info(attribute_number, key_order)
                      JOIN pg_attribute attribute_info
                        ON attribute_info.attrelid = constraint_info.conrelid
                       AND attribute_info.attnum = key_info.attribute_number
                      ORDER BY key_info.key_order) = expected_foreign_key.column_names
                  AND ARRAY(
                      SELECT attribute_info.attname::TEXT
                      FROM unnest(constraint_info.confkey) WITH ORDINALITY
                           AS key_info(attribute_number, key_order)
                      JOIN pg_attribute attribute_info
                        ON attribute_info.attrelid = constraint_info.confrelid
                       AND attribute_info.attnum = key_info.attribute_number
                      ORDER BY key_info.key_order
                  ) = expected_foreign_key.referenced_column_names))
        AND NOT EXISTS (
            SELECT 1
            FROM expected_indexes expected_index
            WHERE NOT EXISTS (
                SELECT 1
                FROM pg_index index_definition
                JOIN pg_class index_info
                  ON index_info.oid = index_definition.indexrelid
                JOIN pg_class table_info
                  ON table_info.oid = index_definition.indrelid
                JOIN pg_namespace namespace_info
                  ON namespace_info.oid = table_info.relnamespace
                JOIN pg_am access_method
                  ON access_method.oid = index_info.relam
                WHERE namespace_info.nspname = 'public'
                  AND table_info.relname = expected_index.table_name
                  AND index_info.relname = expected_index.index_name
                  AND access_method.amname = 'btree'
                  AND index_definition.indisvalid
                  AND index_definition.indisready
                  AND NOT index_definition.indisunique
                  AND index_definition.indpred IS NULL
                  AND index_definition.indexprs IS NULL
                  AND ARRAY(
                      SELECT attribute_info.attname::TEXT
                      FROM unnest(index_definition.indkey) WITH ORDINALITY
                           AS key_info(attribute_number, key_order)
                      JOIN pg_attribute attribute_info
                        ON attribute_info.attrelid = index_definition.indrelid
                       AND attribute_info.attnum = key_info.attribute_number
                      ORDER BY key_info.key_order) = expected_index.column_names))
        AS v6_2_schema_current;
"); then
    echo "ERROR: Failed to inspect the existing OSMO v6.2 schema: $(echo "$V6_2_SCHEMA_CURRENT" | head -1)"
    exit 1
fi
if ! RELEASED_SCHEMA_CURRENT=$(run_psql "
    SELECT COUNT(*) = 2
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'resources'
      AND column_name IN ('last_updated', 'last_usage_updated')
      AND data_type = 'timestamp without time zone'
      AND is_nullable = 'YES'
      AND column_default IS NULL;
"); then
    echo "ERROR: Failed to inspect the released migration 005 schema: $(echo "$RELEASED_SCHEMA_CURRENT" | head -1)"
    exit 1
fi
# A recorded or explicitly baselined migration boundary is a promise that its
# schema exists. Fail closed instead of silently skipping a missing release
# migration.
if ! V6_3_SCHEMA_RECORDED=$(run_psql "SELECT EXISTS (SELECT 1 FROM pgroll.migrations WHERE schema = 'public' AND name = '${V6_3_SCHEMA_MIGRATION}' AND done = true);"); then
    echo "ERROR: Failed to check migration history for ${V6_3_SCHEMA_MIGRATION}: $(echo "$V6_3_SCHEMA_RECORDED" | head -1)"
    exit 1
fi
V6_3_SCHEMA_COVERED=false
if [ "$V6_3_SCHEMA_RECORDED" = "t" ] \
        || baseline_covers_migration "$V6_3_SCHEMA_MIGRATION"; then
    V6_3_SCHEMA_COVERED=true
fi
if [ "$V6_3_SCHEMA_COVERED" = "true" ] && [ "$RELEASED_SCHEMA_CURRENT" != "t" ]; then
    echo "ERROR: Migration ${V6_3_SCHEMA_MIGRATION} is covered by pgroll history, but its resources columns are missing."
    echo "NEXT: Restore resources.last_updated and resources.last_usage_updated before rerunning migrations."
    exit 1
fi

if [ "$NO_MIGRATION_HISTORY" = "true" ]; then
    if ! HAS_OSMO_SCHEMA=$(run_psql "SELECT to_regclass('public.workflows') IS NOT NULL;"); then
        echo "ERROR: Failed to inspect the public schema: $(echo "$HAS_OSMO_SCHEMA" | head -1)"
        exit 1
    fi
    if [ "$HAS_OSMO_SCHEMA" = "t" ]; then
        echo "  Existing OSMO schema has no history; creating initial baseline..."
        if ! create_baseline "000_baseline"; then
            exit 1
        fi
        BASELINE_MIGRATION="000_baseline"
    fi
fi

# --- Step 5: Apply all migrations ---
echo ""
echo "Step 5: Applying migrations..."
for migration_file in "$SCRIPT_DIR"/0*.json; do
    name="$(basename "$migration_file")"
    migration_name="${name%.*}"
    echo "  [$name]"

    if baseline_covers_migration "$migration_name"; then
        echo "    Covered by migration boundary $BASELINE_MIGRATION"
        continue
    fi

    if ! MIGRATION_APPLIED=$(run_psql "SELECT EXISTS (SELECT 1 FROM pgroll.migrations WHERE schema = 'public' AND name = '${migration_name}' AND done = true);"); then
        echo "ERROR: Failed to check migration history: $(echo "$MIGRATION_APPLIED" | head -1)"
        exit 1
    fi
    if [ "$MIGRATION_APPLIED" = "t" ]; then
        echo "    Already applied"
        continue
    fi

    SCHEMA_MIGRATION_CURRENT=false
    case "$migration_name" in
        "$V6_0_SCHEMA_MIGRATION")
            [ "$V6_0_SCHEMA_CURRENT" = "t" ] && SCHEMA_MIGRATION_CURRENT=true
            ;;
        "$V6_2_SCHEMA_MIGRATION")
            [ "$V6_0_SCHEMA_CURRENT" = "t" ] \
                && [ "$V6_2_SCHEMA_CURRENT" = "t" ] \
                && SCHEMA_MIGRATION_CURRENT=true
            ;;
        "$V6_3_SCHEMA_MIGRATION")
            [ "$RELEASED_SCHEMA_CURRENT" = "t" ] && SCHEMA_MIGRATION_CURRENT=true
            ;;
    esac
    if [ "$SCHEMA_MIGRATION_CURRENT" = "true" ]; then
        echo "    Already present in schema"
        continue
    fi

    if OUTPUT=$(pgroll start "$migration_file" --postgres-url "$PGROLL_URL" --complete 2>&1); then
        echo "    Applied"
    else
        echo "ERROR: Failed to apply $name: $(echo "$OUTPUT" | head -1)"
        exit 1
    fi
done

# --- Step 6: Create or refresh versioned-schema views ---
if [ "$TARGET_SCHEMA" != "public" ]; then
    echo ""
    echo "Step 6: Refreshing versioned schema ${TARGET_SCHEMA}..."
    if ! OUTPUT=$(run_psql "CREATE SCHEMA IF NOT EXISTS ${TARGET_SCHEMA};"); then
        echo "ERROR: Failed to create versioned schema: $(echo "$OUTPUT" | head -1)"
        exit 1
    fi
    if ! OUTPUT=$(run_psql "DO \$\$ DECLARE tbl RECORD; BEGIN FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('CREATE OR REPLACE VIEW ${TARGET_SCHEMA}.%I AS SELECT * FROM public.%I', tbl.tablename, tbl.tablename); END LOOP; END \$\$;"); then
        echo "ERROR: Failed to refresh versioned-schema views: $(echo "$OUTPUT" | head -1)"
        exit 1
    fi
    echo "  Refreshed"
fi

echo ""
echo "Final status:"
if ! pgroll status --postgres-url "$PGROLL_URL"; then
    echo "ERROR: Failed to read final pgroll status."
    exit 1
fi
echo ""
echo "Done."
