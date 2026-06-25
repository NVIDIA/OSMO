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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MIGRATIONS_DIR="${REPO_ROOT}/deployments/charts/service/migrations"

POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:15-alpine}"
POSTGRES_DB="${POSTGRES_DB:-osmo_db}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-osmo_pass}"
PGROLL_VERSION="${PGROLL_VERSION:-v0.16.1}"
DOCKER_PLATFORM="${OSMO_MIGRATION_TEST_PLATFORM:-}"
DOCKER_PLATFORM_ARGS=()
if [[ -n "${DOCKER_PLATFORM}" ]]; then
    DOCKER_PLATFORM_ARGS=(--platform "${DOCKER_PLATFORM}")
fi

RUN_ID="osmo-dataset-config-cleanup-$$"
NETWORK_NAME="${RUN_ID}-net"
POSTGRES_NAME="${RUN_ID}-postgres"
WORK_DIR="$(mktemp -d)"

cleanup() {
    docker rm -f "${POSTGRES_NAME}" >/dev/null 2>&1 || true
    docker network rm "${NETWORK_NAME}" >/dev/null 2>&1 || true
    rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

require_tool() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "ERROR: missing required tool: $1" >&2
        exit 1
    fi
}

write_seed_files() {
    openssl req \
        -new \
        -x509 \
        -days 1 \
        -nodes \
        -subj "/CN=${POSTGRES_NAME}" \
        -keyout "${WORK_DIR}/server.key" \
        -out "${WORK_DIR}/server.crt" >/dev/null 2>&1

    cat > "${WORK_DIR}/002_seed_osmo_schema.sql" <<'EOF'
CREATE EXTENSION IF NOT EXISTS hstore SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credential_type') THEN
        CREATE TYPE credential_type AS ENUM ('GENERIC', 'REGISTRY', 'DATA');
    END IF;
END
$$;

CREATE TABLE configs (
    key TEXT,
    value TEXT,
    type TEXT,
    PRIMARY KEY (key, type)
);

CREATE TABLE roles (
    name TEXT,
    description TEXT,
    policies JSONB[],
    immutable BOOLEAN,
    PRIMARY KEY (name)
);

CREATE TABLE backends (
    name TEXT PRIMARY KEY,
    description TEXT,
    k8s_uid TEXT,
    k8s_namespace TEXT,
    dashboard_url TEXT,
    grafana_url TEXT,
    scheduler_settings TEXT,
    tests TEXT[] DEFAULT ARRAY[]::text[],
    last_heartbeat TIMESTAMP,
    created_date TIMESTAMP,
    router_address TEXT,
    version TEXT DEFAULT '',
    gpu_product_label TEXT,
    affinity TEXT,
    node_condition_prefix TEXT,
    config_nccl_test BOOLEAN,
    support_nccl_test BOOLEAN,
    cache_config TEXT,
    node_conditions JSONB DEFAULT '{"rules": {"Ready": "True"}, "prefix": "osmo.nvidia.com/"}'::jsonb
);

CREATE TABLE pools (
    name TEXT PRIMARY KEY,
    description TEXT,
    backend TEXT,
    download_type TEXT,
    default_platform TEXT,
    platforms JSONB,
    default_exec_timeout TEXT,
    default_queue_timeout TEXT,
    max_exec_timeout TEXT,
    max_queue_timeout TEXT,
    default_exit_actions JSONB,
    common_default_variables JSONB,
    common_resource_validations TEXT[],
    parsed_resource_validations JSONB,
    common_pod_template TEXT[],
    parsed_pod_template JSONB,
    enable_maintenance BOOLEAN,
    resources JSONB,
    action_permissions JSONB,
    enable_nccl_test BOOLEAN
);

CREATE TABLE groups (
    workflow_id TEXT,
    name TEXT,
    group_uuid TEXT PRIMARY KEY,
    spec JSONB,
    status TEXT,
    failure_message TEXT,
    processing_start_time TIMESTAMP,
    scheduling_start_time TIMESTAMP,
    initializing_start_time TIMESTAMP,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    remaining_upstream_groups HSTORE,
    downstream_groups HSTORE,
    outputs TEXT,
    cleaned_up BOOLEAN,
    scheduler_settings TEXT
);

CREATE TABLE dataset (
    name TEXT,
    id TEXT PRIMARY KEY,
    created_by TEXT,
    created_date TIMESTAMP,
    is_collection BOOLEAN,
    labels JSONB,
    hash_location TEXT,
    hash_location_size BIGINT,
    last_version INT,
    bucket TEXT,
    CONSTRAINT dataset_name_bucket_key UNIQUE(name, bucket)
);

CREATE TABLE dataset_version (
    dataset_id TEXT REFERENCES dataset(id),
    version_id TEXT,
    location TEXT,
    status TEXT,
    created_by TEXT,
    created_date TIMESTAMP,
    last_used TIMESTAMP,
    last_updated TIMESTAMP,
    size BIGINT,
    checksum TEXT,
    retention_policy TEXT,
    metadata JSONB,
    PRIMARY KEY (dataset_id, version_id)
);

CREATE TABLE profile (
    user_name TEXT NOT NULL,
    slack_notification BOOLEAN,
    email_notification BOOLEAN,
    bucket TEXT,
    pool TEXT,
    PRIMARY KEY (user_name)
);

CREATE TABLE ueks (
    uid TEXT,
    keys HSTORE,
    PRIMARY KEY (uid)
);

CREATE TABLE credential (
    user_name TEXT NOT NULL,
    cred_name TEXT NOT NULL,
    cred_type credential_type,
    profile TEXT,
    payload HSTORE NOT NULL,
    PRIMARY KEY (user_name, cred_name),
    CONSTRAINT unique_cred UNIQUE (user_name, profile)
);

CREATE TABLE access_token (
    user_name TEXT NOT NULL,
    token_name TEXT NOT NULL,
    access_token BYTEA,
    expires_at TIMESTAMP,
    description TEXT,
    access_type TEXT DEFAULT 'USER',
    roles TEXT[] DEFAULT '{}',
    PRIMARY KEY (token_name),
    CONSTRAINT unique_access_token UNIQUE (access_token)
);

CREATE TABLE config_history (
    config_type TEXT,
    revision INT,
    name TEXT,
    username TEXT,
    created_at TIMESTAMP,
    tags TEXT[],
    description TEXT,
    data JSONB,
    deleted_by TEXT,
    deleted_at TIMESTAMP,
    PRIMARY KEY (config_type, revision)
);

INSERT INTO roles (name, description, policies, immutable) VALUES
    ('admin', 'Admin role', ARRAY[]::jsonb[], TRUE);

INSERT INTO configs (key, value, type) VALUES
    ('buckets', '{"osmo":{"dataset_path":"s3://osmo/datasets"}}', 'DATASET'),
    ('default_bucket', 'osmo', 'DATASET'),
    ('legacy_bucket_policy', '{"mode":"read-write"}', 'DATASET'),
    ('service_base_url', 'https://osmo.example.test', 'SERVICE'),
    ('max_pod_restart_limit', '30m', 'SERVICE'),
    ('backend_images', '{"init":"nvcr.io/nvidia/osmo/init-container:6.4.0","client":"nvcr.io/nvidia/osmo/client:6.4.0"}', 'WORKFLOW'),
    ('workflow_data', '{"credential":null,"base_url":"s3://osmo/workflows"}', 'WORKFLOW'),
    ('max_num_tasks', '100', 'WORKFLOW');

INSERT INTO config_history
    (config_type, revision, name, username, created_at, tags, description, data)
VALUES
    ('dataset', 1, '', 'admin', NOW(), ARRAY['seed'], 'Legacy dataset config', '{"buckets":{}}'),
    ('DATASET', 2, '', 'admin', NOW(), ARRAY['seed'], 'Legacy dataset config update', '{"default_bucket":"osmo"}'),
    ('service', 1, '', 'admin', NOW(), ARRAY['seed'], 'Service config', '{"service_base_url":"https://osmo.example.test"}'),
    ('workflow', 1, '', 'admin', NOW(), ARRAY['seed'], 'Workflow config', '{"max_num_tasks":100}');
EOF
}

run_psql() {
    docker exec \
        -e PGPASSWORD="${POSTGRES_PASSWORD}" \
        "${POSTGRES_NAME}" \
        psql \
        --set ON_ERROR_STOP=1 \
        --host localhost \
        --username "${POSTGRES_USER}" \
        --dbname "${POSTGRES_DB}" \
        --tuples-only \
        --no-align \
        --command "$1"
}

wait_for_postgres() {
    echo "Waiting for Postgres to accept connections..."
    for _ in {1..60}; do
        if docker exec \
            -e PGPASSWORD="${POSTGRES_PASSWORD}" \
            "${POSTGRES_NAME}" \
            pg_isready \
            --host localhost \
            --username "${POSTGRES_USER}" \
            --dbname "${POSTGRES_DB}" >/dev/null 2>&1; then
            return
        fi
        sleep 1
    done

    echo "ERROR: Postgres did not become ready" >&2
    docker logs "${POSTGRES_NAME}" >&2 || true
    exit 1
}

enable_postgres_ssl() {
    docker exec --user root "${POSTGRES_NAME}" sh -c '
        set -e
        cp /certs/server.crt "$PGDATA/server.crt"
        cp /certs/server.key "$PGDATA/server.key"
        chown postgres:postgres "$PGDATA/server.crt" "$PGDATA/server.key"
        chmod 600 "$PGDATA/server.key"
    '
    run_psql "ALTER SYSTEM SET ssl = 'on';"
    run_psql "ALTER SYSTEM SET ssl_cert_file = 'server.crt';"
    run_psql "ALTER SYSTEM SET ssl_key_file = 'server.key';"
    docker restart "${POSTGRES_NAME}" >/dev/null
    wait_for_postgres
}

assert_count() {
    local label="$1"
    local sql="$2"
    local expected="$3"
    local actual
    actual="$(run_psql "$sql" | tr -d '[:space:]')"
    if [[ "${actual}" != "${expected}" ]]; then
        echo "ERROR: ${label}: expected ${expected}, got ${actual}" >&2
        exit 1
    fi
    echo "PASS: ${label} = ${actual}"
}

run_migrations() {
    docker run --rm \
        ${DOCKER_PLATFORM_ARGS[@]+"${DOCKER_PLATFORM_ARGS[@]}"} \
        --network "${NETWORK_NAME}" \
        --volume "${MIGRATIONS_DIR}:/pgroll:ro" \
        --env OSMO_POSTGRES_HOST="${POSTGRES_NAME}" \
        --env OSMO_POSTGRES_PORT=5432 \
        --env OSMO_POSTGRES_DATABASE_NAME="${POSTGRES_DB}" \
        --env OSMO_POSTGRES_USER="${POSTGRES_USER}" \
        --env OSMO_POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
        "${POSTGRES_IMAGE}" \
        sh -c "
            set -e
            if command -v apk >/dev/null 2>&1; then
                apk add --no-cache bash curl >/dev/null
            elif command -v apt-get >/dev/null 2>&1; then
                apt-get update >/dev/null
                apt-get install -y --no-install-recommends bash ca-certificates curl >/dev/null
                rm -rf /var/lib/apt/lists/*
            else
                echo 'ERROR: no supported package manager found' >&2
                exit 1
            fi
            case \"\$(uname -m)\" in
                x86_64) pgroll_arch=amd64 ;;
                aarch64|arm64) pgroll_arch=arm64 ;;
                *)
                    echo \"ERROR: unsupported pgroll architecture: \$(uname -m)\" >&2
                    exit 1
                    ;;
            esac
            curl -fsSL https://github.com/xataio/pgroll/releases/download/${PGROLL_VERSION}/pgroll.linux.\${pgroll_arch} -o /usr/local/bin/pgroll
            chmod +x /usr/local/bin/pgroll
            bash /pgroll/run_migrations.sh public
        "
}

assert_post_migration_state() {
    assert_count "DATASET config rows removed" \
        "SELECT COUNT(*) FROM configs WHERE type = 'DATASET';" \
        "0"
    assert_count "total config rows preserved except DATASET rows" \
        "SELECT COUNT(*) FROM configs;" \
        "5"
    assert_count "SERVICE config rows preserved" \
        "SELECT COUNT(*) FROM configs WHERE type = 'SERVICE';" \
        "2"
    assert_count "WORKFLOW config rows preserved" \
        "SELECT COUNT(*) FROM configs WHERE type = 'WORKFLOW';" \
        "3"
    assert_count "dataset config history rows removed" \
        "SELECT COUNT(*) FROM config_history WHERE lower(config_type) = 'dataset';" \
        "0"
    assert_count "total config history rows preserved except dataset rows" \
        "SELECT COUNT(*) FROM config_history;" \
        "2"
}

require_tool docker
require_tool openssl

write_seed_files

docker network create "${NETWORK_NAME}" >/dev/null

docker run -d \
    ${DOCKER_PLATFORM_ARGS[@]+"${DOCKER_PLATFORM_ARGS[@]}"} \
    --name "${POSTGRES_NAME}" \
    --network "${NETWORK_NAME}" \
    --volume "${WORK_DIR}:/docker-entrypoint-initdb.d:ro" \
    --volume "${WORK_DIR}:/certs:ro" \
    --env POSTGRES_DB="${POSTGRES_DB}" \
    --env POSTGRES_USER="${POSTGRES_USER}" \
    --env POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
    "${POSTGRES_IMAGE}" >/dev/null

wait_for_postgres
enable_postgres_ssl

echo "Running OSMO chart migrations..."
run_migrations
assert_post_migration_state

echo "Running migrations a second time to verify idempotency..."
run_migrations
assert_post_migration_state

echo "Dataset config cleanup migration validation passed."
