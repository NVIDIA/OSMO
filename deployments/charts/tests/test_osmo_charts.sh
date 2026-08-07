#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

MODE="${1:-all}"
if [[ -n "${TEST_SRCDIR:-}" && -n "${TEST_WORKSPACE:-}" ]]; then
    CHARTS_ROOT="$TEST_SRCDIR/$TEST_WORKSPACE/deployments/charts"
else
    CHARTS_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fi
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

require_contains() {
    local file=$1
    local expected=$2
    grep -Fq -- "$expected" "$file" || fail "expected '$expected' in $file"
}

require_not_contains() {
    local file=$1
    local unexpected=$2
    if grep -Fiq -- "$unexpected" "$file"; then
        fail "did not expect '$unexpected' in $file"
    fi
}

require_occurrences() {
    local file=$1
    local expected=$2
    local count=$3
    local actual
    actual=$(grep -Fc -- "$expected" "$file" || true)
    [[ "$actual" -eq "$count" ]] || \
        fail "expected '$expected' $count times in $file, found $actual"
}

deployment_names() {
    awk '
        /^kind: Deployment$/ { deployment = 1; metadata = 0; next }
        deployment && /^metadata:$/ { metadata = 1; next }
        deployment && metadata && /^  name: / {
            sub(/^  name: /, "")
            print
            deployment = 0
            metadata = 0
        }
        /^---$/ { deployment = 0; metadata = 0 }
    ' "$1"
}

resource_document() {
    local file=$1
    local kind=$2
    local name=$3
    awk -v kind="$kind" -v name="$name" '
        BEGIN { RS = "---" }
        $0 ~ ("\nkind: " kind "\n") && $0 ~ ("\n  name: " name "\n") { print }
    ' "$file"
}

require_deployment() {
    local file=$1
    local name=$2
    deployment_names "$file" | grep -Fxq -- "$name" || fail "expected Deployment/$name"
}

require_no_deployment() {
    local file=$1
    local name=$2
    if deployment_names "$file" | grep -Fxq -- "$name"; then
        fail "did not expect Deployment/$name"
    fi
}

require_clean_osmo_sources() {
    if rg -n '\.Values\.(global|controlPlane|components|services\.(configFile|configs|defaultAdmin|localstackS3|postgres|redis))' \
        "$CHARTS_ROOT/osmo/templates" >"$TEST_DIRECTORY/legacy-template-values.out"; then
        cat "$TEST_DIRECTORY/legacy-template-values.out" >&2
        fail "osmo templates still reference legacy values"
    fi
    if rg -n '\.Values\.external\b' \
        "$CHARTS_ROOT/osmo/templates" >"$TEST_DIRECTORY/legacy-external-values.out"; then
        cat "$TEST_DIRECTORY/legacy-external-values.out" >&2
        fail "osmo templates still reference the legacy external values block"
    fi
    if rg -n '^(global|controlPlane|components):|^    (imageName|imageTag|imagePullPolicy|serviceAccountName):' \
        "$CHARTS_ROOT/osmo/values.yaml" >"$TEST_DIRECTORY/legacy-default-values.out"; then
        cat "$TEST_DIRECTORY/legacy-default-values.out" >&2
        fail "osmo defaults still expose legacy values"
    fi
    require_not_contains "$CHARTS_ROOT/osmo/Chart.yaml" "dependencies:"
    [[ ! -e "$CHARTS_ROOT/osmo/Chart.lock" ]] || fail "osmo must not have a dependency lock"
    [[ ! -d "$CHARTS_ROOT/osmo/charts" ]] || fail "osmo must not contain packaged dependencies"
}

test_control_umbrella() {
    local charts_copy="$TEST_DIRECTORY/charts"
    local rendered="$TEST_DIRECTORY/osmo.yaml"
    mkdir -p "$charts_copy"
    cp -R "$CHARTS_ROOT/osmo" "$charts_copy/osmo"
    rm -rf "$charts_copy/osmo/charts"
    rm -f "$charts_copy/osmo/Chart.lock"

    helm package "$charts_copy/osmo" --destination "$TEST_DIRECTORY" >/dev/null
    tar -tzf "$TEST_DIRECTORY/osmo-0.1.0.tgz" >"$TEST_DIRECTORY/osmo-package.txt"
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "osmo/migrations/"
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "/migration-job.yaml"

    helm template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        >"$rendered"

    require_deployment "$rendered" "osmo-service"
    require_deployment "$rendered" "osmo-worker"
    require_deployment "$rendered" "osmo-router"
    require_deployment "$rendered" "osmo-logger"
    require_deployment "$rendered" "osmo-agent"
    require_deployment "$rendered" "osmo-delayed-job-monitor"
    require_deployment "$rendered" "osmo-ui"
    require_deployment "$rendered" "osmo-gateway-envoy"
    require_no_deployment "$rendered" "postgres"
    require_no_deployment "$rendered" "redis"
    require_no_deployment "$rendered" "localstack-s3"
    require_no_deployment "$rendered" "osmo-backend-listener"
    require_no_deployment "$rendered" "osmo-backend-worker"
    require_contains "$rendered" "external-postgresql"
    require_contains "$rendered" "external-valkey"
    require_contains "$rendered" "secretName: external-control-secrets"
    require_contains "$rendered" "https://s3.external.example.com"
    require_contains "$rendered" "nvcr.io/nvidia/osmo/service:6.3.1"
    require_contains "$rendered" "service_base_url: http://osmo-gateway"
    require_not_contains "$rendered" "service_base_url: http://osmo-gateway-envoy"
    require_not_contains "$rendered" "vault.hashicorp.com"
    require_not_contains "$rendered" "labels_config:"
    require_not_contains "$rendered" "OSMO_SCHEMA_VERSION"

    helm template osmo-tls "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set externalDependencies.postgresql.tls.enabled=true \
        --set externalDependencies.postgresql.tls.caExistingSecret=postgresql-ca \
        --set externalDependencies.valkey.tls.enabled=true \
        --set externalDependencies.valkey.tls.caExistingSecret=valkey-ca \
        --set gateway.authz.enabled=true \
        >"$TEST_DIRECTORY/osmo-tls.yaml"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "secretName: postgresql-ca"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "secretName: valkey-ca"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "name: PGSSLROOTCERT"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "/etc/osmo/ca/postgresql/ca.crt"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "name: SSL_CERT_FILE"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "/etc/osmo/ca/valkey/ca.crt"
    resource_document "$TEST_DIRECTORY/osmo-tls.yaml" Deployment \
        osmo-tls-gateway-authz >"$TEST_DIRECTORY/osmo-authz-tls.yaml"
    require_contains "$TEST_DIRECTORY/osmo-authz-tls.yaml" "secretName: postgresql-ca"
    require_contains "$TEST_DIRECTORY/osmo-authz-tls.yaml" "/etc/osmo/ca/postgresql"

    if helm template unsupported-migration "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set services.migration.enabled=true \
        >"$TEST_DIRECTORY/unsupported-migration.out" 2>&1; then
        fail "expected services.migration to fail schema validation"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-migration.out" "migration"

    helm template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/tests/control-mcp-values.yaml" \
        --set commonLabels.team=platform \
        --set-string 'podDefaults.nodeSelector.kubernetes\.io/os=linux' \
        >"$TEST_DIRECTORY/osmo-mcp.yaml"
    require_deployment "$TEST_DIRECTORY/osmo-mcp.yaml" "osmo-mcp"
    require_deployment "$TEST_DIRECTORY/osmo-mcp.yaml" "osmo-gateway-authz"
    require_contains "$TEST_DIRECTORY/osmo-mcp.yaml" "path: /mcp"
    require_contains "$TEST_DIRECTORY/osmo-mcp.yaml" \
        '\"resource\":\"https://osmo.example.com/mcp\"'
    require_occurrences "$TEST_DIRECTORY/osmo-mcp.yaml" \
        "kubernetes.io/os: linux" 10

    helm template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set commonLabels.team=platform \
        --set-string 'podDefaults.nodeSelector.kubernetes\.io/os=linux' \
        --set services.worker.image.name=custom-worker \
        --set services.worker.image.tag=test-tag \
        --set services.logger.enabled=false \
        >"$TEST_DIRECTORY/osmo-overrides.yaml"
    require_contains "$TEST_DIRECTORY/osmo-overrides.yaml" \
        "nvcr.io/nvidia/osmo/custom-worker:test-tag"
    require_contains "$TEST_DIRECTORY/osmo-overrides.yaml" "team: platform"
    require_contains "$TEST_DIRECTORY/osmo-overrides.yaml" "kubernetes.io/os: linux"
    require_no_deployment "$TEST_DIRECTORY/osmo-overrides.yaml" "osmo-logger"

    if helm template unsupported-compute "$charts_copy/osmo" \
        --set planes.compute.enabled=true \
        >"$TEST_DIRECTORY/unsupported-compute.out" 2>&1; then
        fail "expected planes.compute.enabled=true to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-compute.out" \
        "compute plane is not implemented"

    if helm template unsupported-embedded "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set embeddedDependencies.postgresql.enabled=true \
        >"$TEST_DIRECTORY/unsupported-embedded.out" 2>&1; then
        fail "expected embeddedDependencies.postgresql.enabled=true to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-embedded.out" \
        "embedded PostgreSQL is not implemented"

    if helm template unsupported-exposure "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set exposure.mode=gateway \
        >"$TEST_DIRECTORY/unsupported-exposure.out" 2>&1; then
        fail "expected exposure.mode=gateway to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-exposure.out" \
        "only external exposure is implemented"

    if helm template unsupported-generated-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set secrets.postgresql.generate=true \
        >"$TEST_DIRECTORY/unsupported-generated-secret.out" 2>&1; then
        fail "expected secrets.postgresql.generate=true to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-generated-secret.out" \
        "generated Secrets are not implemented"

    if helm template unsupported-legacy-values "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set controlPlane.enabled=true \
        >"$TEST_DIRECTORY/unsupported-legacy-values.out" 2>&1; then
        fail "expected legacy controlPlane values to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-legacy-values.out" \
        "controlPlane"

    if helm template unsupported-legacy-external "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set external.postgresql.host=legacy-postgresql \
        >"$TEST_DIRECTORY/unsupported-legacy-external.out" 2>&1; then
        fail "expected legacy external values to fail schema validation"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-legacy-external.out" "external"

    if helm template invalid-replicas "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set-string services.worker.replicas=invalid \
        >"$TEST_DIRECTORY/invalid-replicas.out" 2>&1; then
        fail "expected non-integer services.worker.replicas to fail schema validation"
    fi
    require_contains "$TEST_DIRECTORY/invalid-replicas.out" "/services/worker/replicas"

    if helm template unknown-root "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set unsupportedRoot.enabled=true \
        >"$TEST_DIRECTORY/unknown-root.out" 2>&1; then
        fail "expected an unknown top-level value to fail schema validation"
    fi
    require_contains "$TEST_DIRECTORY/unknown-root.out" "unsupportedRoot"

    if helm template legacy-component "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/tests/control-external-values.yaml" \
        --set services.worker.imageName=legacy-worker \
        >"$TEST_DIRECTORY/legacy-component.out" 2>&1; then
        fail "expected legacy per-service fields to fail schema validation"
    fi
    require_contains "$TEST_DIRECTORY/legacy-component.out" "/services/worker"
}

case "$MODE" in
    osmo)
        require_clean_osmo_sources
        test_control_umbrella
        ;;
    all)
        require_clean_osmo_sources
        test_control_umbrella
        ;;
    *)
        fail "unknown test mode: $MODE"
        ;;
esac

echo "PASS: OSMO Helm chart tests ($MODE)"
