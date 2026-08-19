#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

MODE="${1:-all}"
if [[ -n "${TEST_SRCDIR:-}" && -n "${TEST_WORKSPACE:-}" ]]; then
    CHARTS_ROOT="$TEST_SRCDIR/$TEST_WORKSPACE/deployments/charts"
else
    CHARTS_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
fi
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

for required_command in awk base64 grep helm tar; do
    command -v "$required_command" >/dev/null || \
        fail "required command not found: $required_command"
done

helm_template() {
    helm template "$@" --kube-version 1.30.0
}

require_contains() {
    local file=$1
    local expected=$2
    grep -Fq -- "$expected" "$file" || fail "expected '$expected' in $file"
}

require_schema_path() {
    local file=$1
    local expected=$2
    awk -v expected="$expected" '
        {
            gsub(/\//, ".")
            if (index($0, expected) > 0) {
                found = 1
            }
        }
        END { exit !found }
    ' "$file" || fail "expected schema path '$expected' in $file"
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

require_line_count() {
    local file=$1
    local expected=$2
    local actual
    actual=$(awk 'END { print NR }' "$file")
    [[ "$actual" -eq "$expected" ]] || \
        fail "expected $expected lines in $file, found $actual"
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
        function reset_document() {
            document = ""
            document_kind = ""
            document_name = ""
            in_metadata = 0
        }
        function finish_document() {
            if (document_kind == kind && document_name == name) {
                printf "%s", document
                found = 1
            }
        }
        BEGIN {
            found = 0
            reset_document()
        }
        /^---[[:space:]]*$/ {
            finish_document()
            reset_document()
            next
        }
        {
            document = document $0 ORS
        }
        /^kind: / {
            document_kind = $0
            sub(/^kind: /, "", document_kind)
            next
        }
        /^metadata:$/ {
            in_metadata = 1
            next
        }
        in_metadata && /^  name: / && document_name == "" {
            document_name = $0
            sub(/^  name: /, "", document_name)
            next
        }
        in_metadata && /^[^ ]/ {
            in_metadata = 0
        }
        END {
            finish_document()
            if (!found) {
                print "resource not found: " kind "/" name > "/dev/stderr"
                exit 1
            }
        }
    ' "$file"
}

secret_data_value() {
    local file=$1
    local key=$2
    awk -v key="$key" '
        $1 == key ":" {
            gsub(/^"|"$/, "", $2)
            print $2
            exit
        }
    ' "$file"
}

pod_template_labels() {
    awk '
        /^  template:$/ { in_template = 1; next }
        in_template && /^    metadata:$/ { in_metadata = 1; next }
        in_metadata && /^      labels:$/ { in_labels = 1; next }
        in_labels && /^        [^ ]/ {
            sub(/^        /, "")
            print
            next
        }
        in_labels { exit }
    ' "$1"
}

pod_template_annotations() {
    awk '
        /^  template:$/ { in_template = 1; next }
        in_template && /^    metadata:$/ { in_metadata = 1; next }
        in_metadata && /^      annotations:$/ { in_annotations = 1; next }
        in_annotations && /^        [^ ]/ {
            sub(/^        /, "")
            print
            next
        }
        in_annotations { exit }
    ' "$1"
}

deployment_selector_labels() {
    awk '
        /^  selector:$/ { in_selector = 1; next }
        in_selector && /^    matchLabels:$/ { in_labels = 1; next }
        in_labels && /^      [^ ]/ {
            sub(/^      /, "")
            print
            next
        }
        in_labels { exit }
    ' "$1"
}

topology_spread_constraints() {
    awk '
        /^      topologySpreadConstraints:$/ {
            in_constraints = 1
            print
            next
        }
        in_constraints && /^      [[:alnum:]]/ { exit }
        in_constraints { print }
    ' "$1"
}

require_resource_metadata_annotation() {
    local file=$1
    local annotation_key=$2
    awk -v annotation_key="$annotation_key" '
        function reset_document() {
            kind = ""
            name = ""
            in_metadata = 0
            in_annotations = 0
            found = 0
        }
        function finish_document() {
            if (kind != "" && !found) {
                print "missing " annotation_key " on " kind "/" name > "/dev/stderr"
                missing = 1
            }
        }
        BEGIN {
            missing = 0
            reset_document()
        }
        /^---[[:space:]]*$/ {
            finish_document()
            reset_document()
            next
        }
        /^kind: / {
            kind = $0
            sub(/^kind: /, "", kind)
            next
        }
        /^metadata:$/ {
            in_metadata = 1
            in_annotations = 0
            next
        }
        in_metadata && /^  name: / && name == "" {
            name = $0
            sub(/^  name: /, "", name)
            next
        }
        in_metadata && /^  annotations:$/ {
            in_annotations = 1
            next
        }
        in_annotations && index($0, "    " annotation_key ":") == 1 {
            found = 1
            next
        }
        in_metadata && /^[^ ]/ {
            in_metadata = 0
            in_annotations = 0
        }
        END {
            finish_document()
            exit missing
        }
    ' "$file" || fail "expected every rendered resource to have annotation $annotation_key"
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

require_resource() {
    local file=$1
    local kind=$2
    local name=$3
    local document=$TEST_DIRECTORY/resource.yaml
    resource_document "$file" "$kind" "$name" >"$document"
    [[ -s "$document" ]] || fail "expected $kind/$name"
}

require_no_resource() {
    local file=$1
    local kind=$2
    local name=$3
    local document=$TEST_DIRECTORY/resource.yaml
    if resource_document "$file" "$kind" "$name" >"$document" 2>/dev/null; then
        fail "did not expect $kind/$name"
    fi
}

require_downloaded_dependencies_untracked() {
    local repository_root
    local tracked_archives

    if ! repository_root=$(git -C "$CHARTS_ROOT/osmo" rev-parse --show-toplevel 2>/dev/null); then
        return
    fi

    tracked_archives=$(git -C "$repository_root" ls-files -- \
        'deployments/charts/osmo/charts/*.tgz')
    [[ -z "$tracked_archives" ]] || \
        fail "downloaded Helm dependency archives must not be tracked: $tracked_archives"
}

require_clean_osmo_sources() {
    require_contains "$CHARTS_ROOT/osmo/Chart.yaml" "name: cluster"
    require_contains "$CHARTS_ROOT/osmo/Chart.yaml" "version: 0.8.0"
    require_contains "$CHARTS_ROOT/osmo/Chart.yaml" \
        "condition: embeddedDependencies.postgresql.enabled"
    require_contains "$CHARTS_ROOT/osmo/Chart.yaml" "name: rustfs"
    require_contains "$CHARTS_ROOT/osmo/Chart.yaml" 'version: "1.0.0-rc.2"'
    require_contains "$CHARTS_ROOT/osmo/Chart.yaml" \
        "condition: embeddedDependencies.objectStorage.enabled"
    [[ -e "$CHARTS_ROOT/osmo/Chart.lock" ]] || fail "osmo must have a dependency lock"
    require_downloaded_dependencies_untracked
    [[ ! -e "$CHARTS_ROOT/osmo/templates/postgres.yaml" ]] || \
        fail "osmo must not contain an unimplemented embedded PostgreSQL template"
    [[ ! -e "$CHARTS_ROOT/osmo/templates/redis.yaml" ]] || \
        fail "osmo must not contain an unimplemented embedded Valkey template"
    [[ ! -e "$CHARTS_ROOT/osmo/templates/localstack-s3.yaml" ]] || \
        fail "osmo must not contain an unimplemented embedded object-storage template"
}

test_yaml_helpers() {
    local fixture="$TEST_DIRECTORY/yaml-helper-fixture.yaml"
    cat >"$fixture" <<'EOF'
apiVersion: v1
kind: ConfigMap
data:
  ca.crt: |
    -----BEGIN CERTIFICATE-----
    certificate-data
    -----END CERTIFICATE-----
metadata:
  name: certificate-config
  annotations:
    test.osmo.nvidia.com/required: "true"
---
apiVersion: v1
kind: Service
metadata:
  name: annotated-service
  annotations:
    test.osmo.nvidia.com/required: "true"
EOF

    require_resource_metadata_annotation "$fixture" \
        "test.osmo.nvidia.com/required"

    resource_document "$fixture" ConfigMap certificate-config \
        >"$TEST_DIRECTORY/certificate-config.yaml"
    require_contains "$TEST_DIRECTORY/certificate-config.yaml" \
        "certificate-data"

    if resource_document "$fixture" Secret missing-secret \
        >"$TEST_DIRECTORY/missing-resource.yaml" 2>/dev/null; then
        fail "expected absent resource extraction to fail"
    fi
}

test_control_umbrella() {
    local charts_copy="$TEST_DIRECTORY/charts"
    local rendered="$TEST_DIRECTORY/osmo.yaml"
    mkdir -p "$charts_copy"
    cp -R "$CHARTS_ROOT/osmo" "$charts_copy/osmo"
    if ! compgen -G "$charts_copy/osmo/charts/valkey-0.11.0.tgz" >/dev/null || \
        ! compgen -G "$charts_copy/osmo/charts/cluster-0.8.0.tgz" >/dev/null || \
        ! compgen -G "$charts_copy/osmo/charts/rustfs-1.0.0-rc.2.tgz" >/dev/null; then
        helm dependency build "$charts_copy/osmo" >/dev/null
    fi
    local rustfs_archive_verifier="$charts_copy/osmo/tests/verify_rustfs_chart_archive.sh"
    local rustfs_archive="$charts_copy/osmo/charts/rustfs-1.0.0-rc.2.tgz"
    [[ -f "$rustfs_archive_verifier" ]] || \
        fail "RustFS chart archive verifier is required"
    bash "$rustfs_archive_verifier" "$rustfs_archive" >/dev/null
    local altered_rustfs_archive="$TEST_DIRECTORY/altered-rustfs-1.0.0-rc.2.tgz"
    cp "$rustfs_archive" "$altered_rustfs_archive"
    printf 'altered archive\n' >>"$altered_rustfs_archive"
    if bash "$rustfs_archive_verifier" "$altered_rustfs_archive" \
        >"$TEST_DIRECTORY/altered-rustfs-archive.out" 2>&1; then
        fail "expected an altered RustFS chart archive to fail digest verification"
    fi
    require_contains "$TEST_DIRECTORY/altered-rustfs-archive.out" \
        "RustFS chart archive SHA-256 mismatch:"

    if ! helm lint "$charts_copy/osmo" >"$TEST_DIRECTORY/osmo-lint.out" 2>&1; then
        cat "$TEST_DIRECTORY/osmo-lint.out" >&2
        fail "expected chart defaults to pass helm lint"
    fi

    helm package "$charts_copy/osmo" --destination "$TEST_DIRECTORY" >/dev/null
    tar -tzf "$TEST_DIRECTORY/osmo-0.1.0.tgz" >"$TEST_DIRECTORY/osmo-package.txt"
    if ! grep -Fq "osmo/charts/valkey/Chart.yaml" \
        "$TEST_DIRECTORY/osmo-package.txt" && \
        ! grep -Fq "osmo/charts/valkey-0.11.0.tgz" \
        "$TEST_DIRECTORY/osmo-package.txt"; then
        fail "packaged OSMO chart does not contain Valkey 0.11.0"
    fi
    if ! grep -Fq "osmo/charts/cluster/Chart.yaml" \
        "$TEST_DIRECTORY/osmo-package.txt" && \
        ! grep -Fq "osmo/charts/cluster-0.8.0.tgz" \
        "$TEST_DIRECTORY/osmo-package.txt"; then
        fail "packaged OSMO chart does not contain CloudNativePG cluster 0.8.0"
    fi
    if ! grep -Fq "osmo/charts/rustfs/Chart.yaml" \
        "$TEST_DIRECTORY/osmo-package.txt" && \
        ! grep -Fq "osmo/charts/rustfs-1.0.0-rc.2.tgz" \
        "$TEST_DIRECTORY/osmo-package.txt"; then
        fail "packaged OSMO chart does not contain RustFS 1.0.0-rc.2"
    fi
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "osmo/tests/"
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "osmo/migrations/"
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "/migration-job.yaml"

    helm_template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        >"$rendered"

    require_deployment "$rendered" "osmo-api"
    resource_document "$rendered" Deployment osmo-api \
        >"$TEST_DIRECTORY/osmo-api-external-postgresql.yaml"
    require_contains "$TEST_DIRECTORY/osmo-api-external-postgresql.yaml" \
        "name: OSMO_POSTGRES_PASSWORD"
    require_contains "$TEST_DIRECTORY/osmo-api-external-postgresql.yaml" \
        "name: external-postgresql-secret"
    require_contains "$TEST_DIRECTORY/osmo-api-external-postgresql.yaml" \
        "key: external-db-password"
    require_no_deployment "$rendered" "osmo-service"
    require_not_contains "$rendered" "name: osmo-service"
    require_deployment "$rendered" "osmo-worker"
    require_deployment "$rendered" "osmo-router"
    require_deployment "$rendered" "osmo-logger"
    require_deployment "$rendered" "osmo-agent"
    require_deployment "$rendered" "osmo-delayed-job-monitor"
    require_deployment "$rendered" "osmo-ui"
    require_deployment "$rendered" "osmo-gateway-envoy"
    local hardened_component
    for hardened_component in \
        api worker router logger agent delayed-job-monitor ui gateway-envoy; do
        resource_document "$rendered" Deployment "osmo-$hardened_component" \
            >"$TEST_DIRECTORY/osmo-$hardened_component.yaml"
        require_contains "$TEST_DIRECTORY/osmo-$hardened_component.yaml" \
            "readOnlyRootFilesystem: true"
    done
    for hardened_component in api router logger agent; do
        require_contains "$TEST_DIRECTORY/osmo-$hardened_component.yaml" \
            "mountPath: /tmp"
        require_contains "$TEST_DIRECTORY/osmo-$hardened_component.yaml" \
            "name: osmo-runtime-tmp"
    done
    for hardened_component in worker logger agent delayed-job-monitor; do
        require_contains "$TEST_DIRECTORY/osmo-$hardened_component.yaml" \
            "mountPath: /var/run/osmo"
        require_contains "$TEST_DIRECTORY/osmo-$hardened_component.yaml" \
            "name: osmo-progress-files"
    done

    helm_template protected-writable-volumes "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-volume-extension-values.yaml" \
        >"$TEST_DIRECTORY/osmo-protected-writable-volumes.yaml"
    resource_document "$TEST_DIRECTORY/osmo-protected-writable-volumes.yaml" \
        Deployment protected-writable-volumes-osmo-api \
        >"$TEST_DIRECTORY/osmo-protected-api-volumes.yaml"
    require_contains "$TEST_DIRECTORY/osmo-protected-api-volumes.yaml" \
        "name: osmo-runtime-tmp"
    require_contains "$TEST_DIRECTORY/osmo-protected-api-volumes.yaml" \
        "name: api-extension"
    resource_document "$TEST_DIRECTORY/osmo-protected-writable-volumes.yaml" \
        Deployment protected-writable-volumes-osmo-worker \
        >"$TEST_DIRECTORY/osmo-protected-worker-volumes.yaml"
    require_contains "$TEST_DIRECTORY/osmo-protected-worker-volumes.yaml" \
        "name: osmo-progress-files"
    require_contains "$TEST_DIRECTORY/osmo-protected-worker-volumes.yaml" \
        "name: worker-extension"
    require_no_deployment "$rendered" "postgres"
    require_no_deployment "$rendered" "redis"
    require_no_deployment "$rendered" "osmo-valkey"
    require_no_resource "$rendered" StatefulSet "osmo-valkey"
    require_no_resource "$rendered" Service "osmo-valkey"
    require_no_resource "$rendered" ServiceAccount "osmo-valkey"
    require_no_resource "$rendered" NetworkPolicy "osmo-valkey"
    require_no_resource "$rendered" Secret "osmo-valkey-credentials"
    require_no_resource "$rendered" PersistentVolumeClaim "osmo-valkey"
    require_no_deployment "$rendered" "localstack-s3"
    require_no_deployment "$rendered" "osmo-backend-listener"
    require_no_deployment "$rendered" "osmo-backend-worker"
    require_contains "$rendered" "external-postgresql"
    require_contains "$rendered" "external-valkey"
    require_contains "$rendered" "name: external-postgresql-secret"
    require_contains "$rendered" "name: external-valkey-secret"
    require_contains "$rendered" "secretName: external-object-storage-secret"
    require_contains "$rendered" "secretName: external-master-encryption-key-secret"
    require_contains "$rendered" "https://s3.external.example.com"
    resource_document "$rendered" ConfigMap osmo-api-config \
        >"$TEST_DIRECTORY/osmo-external-object-storage-config.yaml"
    require_contains "$TEST_DIRECTORY/osmo-external-object-storage-config.yaml" \
        "override_url: https://s3.external.example.com"
    require_contains "$TEST_DIRECTORY/osmo-external-object-storage-config.yaml" \
        "region: us-east-1"
    require_contains "$TEST_DIRECTORY/osmo-external-object-storage-config.yaml" \
        "endpoint: s3://osmo-workflows/workflows"
    require_contains "$TEST_DIRECTORY/osmo-external-object-storage-config.yaml" \
        "endpoint: s3://osmo-logs/logs"
    require_contains "$TEST_DIRECTORY/osmo-external-object-storage-config.yaml" \
        "endpoint: s3://osmo-apps/apps"
    require_contains "$TEST_DIRECTORY/osmo-external-object-storage-config.yaml" \
        "secretKey: object-storage.yaml"
    require_contains "$rendered" "nvcr.io/nvidia/osmo/service:6.3.1"
    require_contains "$rendered" "- INFO"
    require_contains "$rendered" "service_base_url: http://osmo-gateway"
    require_not_contains "$rendered" "service_base_url: http://osmo-gateway-envoy"
    require_not_contains "$rendered" "vault.hashicorp.com"
    require_not_contains "$rendered" "labels_config:"
    require_not_contains "$rendered" "OSMO_SCHEMA_VERSION"
    require_contains "$rendered" "app.kubernetes.io/name: osmo"
    require_contains "$rendered" "app.kubernetes.io/component: api"
    resource_document "$rendered" Service osmo-gateway \
        >"$TEST_DIRECTORY/osmo-gateway-service.yaml"
    require_contains "$TEST_DIRECTORY/osmo-gateway-service.yaml" "type: ClusterIP"
    require_occurrences "$TEST_DIRECTORY/osmo-gateway-service.yaml" \
        "targetPort: envoy-http" 1
    require_not_contains "$rendered" "kind: Ingress"
    require_not_contains "$rendered" "kind: HTTPRoute"

    helm_template ingress-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set ingress.enabled=true \
        --set ingress.ingressClassName=nginx \
        --set ingress.hostname=osmo.example.com \
        --set ingress.tls.enabled=true \
        --set ingress.tls.secretName=osmo-ingress-tls \
        --set ingress.extraHosts[0].name=extra.example.com \
        --set ingress.extraHosts[0].path=/extra \
        --set ingress.extraPaths[0].path=/custom \
        --set ingress.extraPaths[0].pathType=Exact \
        --set ingress.extraPaths[0].backend.service.name=custom-service \
        --set ingress.extraPaths[0].backend.service.port.number=8080 \
        --set ingress.extraRules[0].host=rule.example.com \
        --set ingress.extraRules[0].http.paths[0].path=/rule \
        --set ingress.extraRules[0].http.paths[0].pathType=Prefix \
        --set ingress.extraRules[0].http.paths[0].backend.service.name=rule-service \
        --set ingress.extraRules[0].http.paths[0].backend.service.port.number=8081 \
        --set ingress.extraTls[0].hosts[0]=extra.example.com \
        --set ingress.extraTls[0].secretName=extra-tls \
        --set-string 'ingress.labels.app\.kubernetes\.io/name=wrong' \
        --set-string 'ingress.labels.app\.kubernetes\.io/component=wrong' \
        >"$TEST_DIRECTORY/osmo-ingress.yaml"
    resource_document "$TEST_DIRECTORY/osmo-ingress.yaml" Ingress \
        ingress-release-osmo-gateway >"$TEST_DIRECTORY/osmo-ingress-resource.yaml"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" \
        "ingressClassName: nginx"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" \
        'host: "osmo.example.com"'
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" \
        "name: ingress-release-osmo-gateway"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" "number: 80"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" \
        "secretName: osmo-ingress-tls"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" \
        'host: "extra.example.com"'
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" "path: /extra"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" "path: /custom"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" \
        "name: custom-service"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" \
        "host: rule.example.com"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" "name: rule-service"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" \
        "secretName: extra-tls"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" \
        "app.kubernetes.io/name: osmo"
    require_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" \
        "app.kubernetes.io/component: gateway-envoy"
    require_not_contains "$TEST_DIRECTORY/osmo-ingress-resource.yaml" "wrong"
    require_occurrences "$TEST_DIRECTORY/osmo-ingress.yaml" "kind: Ingress" 1
    require_not_contains "$TEST_DIRECTORY/osmo-ingress.yaml" "kind: HTTPRoute"

    helm_template wildcard-ingress-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set ingress.enabled=true \
        --set-string 'ingress.hostname=*.example.com' \
        --set ingress.tls.enabled=true \
        --set ingress.tls.secretName=wildcard-ingress-tls \
        --set-string 'ingress.extraHosts[0].name=*.extra.example.com' \
        --set-string 'ingress.extraTls[0].hosts[0]=*.tls.example.com' \
        --set ingress.extraTls[0].secretName=wildcard-extra-tls \
        >"$TEST_DIRECTORY/osmo-wildcard-ingress.yaml"
    resource_document "$TEST_DIRECTORY/osmo-wildcard-ingress.yaml" Ingress \
        wildcard-ingress-release-osmo-gateway \
        >"$TEST_DIRECTORY/osmo-wildcard-ingress-resource.yaml"
    require_occurrences "$TEST_DIRECTORY/osmo-wildcard-ingress-resource.yaml" \
        '"*.example.com"' 2
    require_contains "$TEST_DIRECTORY/osmo-wildcard-ingress-resource.yaml" \
        '"*.extra.example.com"'
    require_contains "$TEST_DIRECTORY/osmo-wildcard-ingress-resource.yaml" \
        "'*.tls.example.com'"

    helm_template route-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set httproute.enabled=true \
        --set httproute.parentRefs[0].name=shared-gateway \
        --set httproute.parentRefs[0].namespace=ingress-system \
        --set httproute.parentRefs[0].sectionName=https \
        --set httproute.hostnames[0]=osmo.example.com \
        --set httproute.rules[0].matches[0].path.type=PathPrefix \
        --set httproute.rules[0].matches[0].path.value=/ \
        --set httproute.rules[0].backendRefs[0].name=wrong-backend \
        --set httproute.rules[0].backendRefs[0].port=9999 \
        --set-string 'httproute.labels.app\.kubernetes\.io/name=wrong' \
        --set-string 'httproute.labels.app\.kubernetes\.io/component=wrong' \
        >"$TEST_DIRECTORY/osmo-httproute.yaml"
    resource_document "$TEST_DIRECTORY/osmo-httproute.yaml" HTTPRoute \
        route-release-osmo-gateway >"$TEST_DIRECTORY/osmo-httproute-resource.yaml"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" \
        "apiVersion: gateway.networking.k8s.io/v1"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" \
        "name: shared-gateway"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" \
        "namespace: ingress-system"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" \
        "sectionName: https"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" \
        "- osmo.example.com"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" \
        "type: PathPrefix"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" "value: /"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" \
        "name: route-release-osmo-gateway"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" "port: 80"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" \
        "app.kubernetes.io/name: osmo"
    require_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" \
        "app.kubernetes.io/component: gateway-envoy"
    require_not_contains "$TEST_DIRECTORY/osmo-httproute-resource.yaml" "wrong"
    require_occurrences "$TEST_DIRECTORY/osmo-httproute.yaml" "kind: HTTPRoute" 1
    require_not_contains "$TEST_DIRECTORY/osmo-httproute.yaml" "kind: Ingress"
    require_not_contains "$TEST_DIRECTORY/osmo-httproute.yaml" "kind: GatewayClass"
    require_not_contains "$TEST_DIRECTORY/osmo-httproute.yaml" "kind: Gateway"
    require_not_contains "$TEST_DIRECTORY/osmo-httproute.yaml" "kind: GRPCRoute"

    helm_template combined-edge-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set ingress.enabled=true \
        --set ingress.hostname=osmo.example.com \
        --set httproute.enabled=true \
        --set httproute.parentRefs[0].name=shared-gateway \
        >"$TEST_DIRECTORY/osmo-combined-edge.yaml"
    require_occurrences "$TEST_DIRECTORY/osmo-combined-edge.yaml" \
        "kind: Ingress" 1
    require_occurrences "$TEST_DIRECTORY/osmo-combined-edge.yaml" \
        "kind: HTTPRoute" 1

    helm_template load-balancer-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.envoy.service.type=LoadBalancer \
        --set gateway.envoy.service.port=443 \
        --set gateway.envoy.service.nodePort=30443 \
        --set gateway.envoy.service.loadBalancerClass=example.com/lb \
        --set gateway.envoy.service.loadBalancerSourceRanges[0]=192.0.2.0/24 \
        --set gateway.envoy.ssl.enabled=true \
        >"$TEST_DIRECTORY/osmo-load-balancer.yaml"
    resource_document "$TEST_DIRECTORY/osmo-load-balancer.yaml" Service \
        load-balancer-release-osmo-gateway \
        >"$TEST_DIRECTORY/osmo-load-balancer-service.yaml"
    require_contains "$TEST_DIRECTORY/osmo-load-balancer-service.yaml" \
        "type: LoadBalancer"
    require_contains "$TEST_DIRECTORY/osmo-load-balancer-service.yaml" \
        "loadBalancerClass: example.com/lb"
    require_contains "$TEST_DIRECTORY/osmo-load-balancer-service.yaml" \
        "- 192.0.2.0/24"
    require_contains "$TEST_DIRECTORY/osmo-load-balancer-service.yaml" \
        "externalTrafficPolicy: Cluster"
    require_contains "$TEST_DIRECTORY/osmo-load-balancer-service.yaml" "name: https"
    require_contains "$TEST_DIRECTORY/osmo-load-balancer-service.yaml" "port: 443"
    require_contains "$TEST_DIRECTORY/osmo-load-balancer-service.yaml" \
        "nodePort: 30443"
    require_occurrences "$TEST_DIRECTORY/osmo-load-balancer-service.yaml" \
        "targetPort: envoy-http" 1
    require_not_contains "$TEST_DIRECTORY/osmo-load-balancer.yaml" "kind: Ingress"
    require_not_contains "$TEST_DIRECTORY/osmo-load-balancer.yaml" "kind: HTTPRoute"

    helm_template node-port-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.envoy.service.type=NodePort \
        --set gateway.envoy.service.port=8080 \
        --set gateway.envoy.service.nodePort=30080 \
        --set gateway.envoy.service.externalTrafficPolicy=Local \
        >"$TEST_DIRECTORY/osmo-node-port.yaml"
    resource_document "$TEST_DIRECTORY/osmo-node-port.yaml" Service \
        node-port-release-osmo-gateway >"$TEST_DIRECTORY/osmo-node-port-service.yaml"
    require_contains "$TEST_DIRECTORY/osmo-node-port-service.yaml" "type: NodePort"
    require_contains "$TEST_DIRECTORY/osmo-node-port-service.yaml" \
        "externalTrafficPolicy: Local"
    require_contains "$TEST_DIRECTORY/osmo-node-port-service.yaml" "port: 8080"
    require_contains "$TEST_DIRECTORY/osmo-node-port-service.yaml" \
        "nodePort: 30080"
    resource_document "$TEST_DIRECTORY/osmo-node-port.yaml" Deployment \
        node-port-release-osmo-ui >"$TEST_DIRECTORY/osmo-node-port-ui.yaml"
    require_contains "$TEST_DIRECTORY/osmo-node-port-ui.yaml" \
        'value: "node-port-release-osmo-gateway:8080"'

    helm_template external-url-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set-string externalUrl=https://osmo.example.com:8443/osmo/ \
        --set gateway.oauth2Proxy.enabled=true \
        >"$TEST_DIRECTORY/osmo-external-url.yaml"
    resource_document "$TEST_DIRECTORY/osmo-external-url.yaml" Deployment \
        external-url-release-osmo-gateway-oauth2-proxy \
        >"$TEST_DIRECTORY/osmo-external-url-oauth2-proxy.yaml"
    require_contains "$TEST_DIRECTORY/osmo-external-url-oauth2-proxy.yaml" \
        "- --redirect-url=https://osmo.example.com:8443/osmo/oauth2/callback"

    helm_template external-http-url-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set-string externalUrl=http://osmo.example.com:65535/base/ \
        --set gateway.oauth2Proxy.enabled=true \
        >"$TEST_DIRECTORY/osmo-external-http-url.yaml"
    resource_document "$TEST_DIRECTORY/osmo-external-http-url.yaml" Deployment \
        external-http-url-release-osmo-gateway-oauth2-proxy \
        >"$TEST_DIRECTORY/osmo-external-http-url-oauth2-proxy.yaml"
    require_contains "$TEST_DIRECTORY/osmo-external-http-url-oauth2-proxy.yaml" \
        "- --redirect-url=http://osmo.example.com:65535/base/oauth2/callback"

    helm_template values-api "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.api.auth.enabled=true \
        --set services.api.auth.deviceEndpoint=https://idp.example.com/device \
        --set services.api.auth.deviceClientId=device-client \
        --set services.api.auth.browserEndpoint=https://idp.example.com/authorize \
        --set services.api.auth.browserClientId=browser-client \
        --set services.api.auth.tokenEndpoint=https://idp.example.com/token \
        --set services.api.auth.logoutEndpoint=https://idp.example.com/logout \
        >"$TEST_DIRECTORY/osmo-values-api.yaml"
    resource_document "$TEST_DIRECTORY/osmo-values-api.yaml" Deployment values-api-osmo-api \
        >"$TEST_DIRECTORY/osmo-values-api-deployment.yaml"
    require_contains "$TEST_DIRECTORY/osmo-values-api-deployment.yaml" \
        "https://idp.example.com/device"
    require_contains "$TEST_DIRECTORY/osmo-values-api-deployment.yaml" "device-client"
    require_contains "$TEST_DIRECTORY/osmo-values-api-deployment.yaml" \
        "https://idp.example.com/authorize"
    require_contains "$TEST_DIRECTORY/osmo-values-api-deployment.yaml" "browser-client"
    require_contains "$TEST_DIRECTORY/osmo-values-api-deployment.yaml" \
        "https://idp.example.com/token"
    require_contains "$TEST_DIRECTORY/osmo-values-api-deployment.yaml" \
        "https://idp.example.com/logout"

    local invalid_gateway_value
    local invalid_gateway_property
    while IFS='|' read -r invalid_gateway_value invalid_gateway_property; do
        if helm_template invalid-gateway-values "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            --set-string "$invalid_gateway_value" \
            >"$TEST_DIRECTORY/invalid-gateway-values.out" 2>&1; then
            fail "expected invalid $invalid_gateway_value to fail schema validation"
        fi
        require_schema_path "$TEST_DIRECTORY/invalid-gateway-values.out" \
            "$invalid_gateway_property"
    done <<'EOF'
gateway.upstreams.api.port=not-a-port|gateway.upstreams.api.port
gateway.networkPolicies.enabled=not-a-boolean|gateway.networkPolicies.enabled
gateway.tls.enabled=not-a-boolean|gateway.tls.enabled
gateway.tls.upstreamCerts.api[0]=invalid|gateway.tls.upstreamCerts.api
EOF

    helm_template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-hostile-metadata-values.yaml" \
        >"$TEST_DIRECTORY/osmo-hostile-labels.yaml"
    require_deployment "$TEST_DIRECTORY/osmo-hostile-labels.yaml" "osmo-api"
    resource_document "$TEST_DIRECTORY/osmo-hostile-labels.yaml" Deployment osmo-api \
        >"$TEST_DIRECTORY/osmo-api-hostile-labels.yaml"
    pod_template_labels "$TEST_DIRECTORY/osmo-api-hostile-labels.yaml" \
        >"$TEST_DIRECTORY/osmo-api-pod-labels.yaml"
    deployment_selector_labels "$TEST_DIRECTORY/osmo-api-hostile-labels.yaml" \
        >"$TEST_DIRECTORY/osmo-api-selector-labels.yaml"
    require_line_count "$TEST_DIRECTORY/osmo-api-selector-labels.yaml" 3
    require_contains "$TEST_DIRECTORY/osmo-api-selector-labels.yaml" \
        "app.kubernetes.io/name: osmo"
    require_contains "$TEST_DIRECTORY/osmo-api-selector-labels.yaml" \
        "app.kubernetes.io/instance: osmo"
    require_contains "$TEST_DIRECTORY/osmo-api-selector-labels.yaml" \
        "app.kubernetes.io/component: api"
    require_occurrences "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "helm.sh/chart:" 1
    require_occurrences "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/name:" 1
    require_occurrences "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/instance:" 1
    require_occurrences "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/version:" 1
    require_occurrences "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/managed-by:" 1
    require_occurrences "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/part-of:" 1
    require_occurrences "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/component:" 1
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "helm.sh/chart: osmo-0.1.0"
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/name: osmo"
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/instance: osmo"
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/version: 6.3.1"
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/managed-by: Helm"
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/part-of: osmo"
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "app.kubernetes.io/component: api"
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "example.com/common-label: preserved"
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "example.com/pod-default-label: preserved"
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "example.com/component-label: preserved"
    require_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" \
        "example.com/precedence: component"
    require_not_contains "$TEST_DIRECTORY/osmo-api-pod-labels.yaml" "wrong-"

    local topology_component
    for topology_component in api ui router worker logger agent; do
        resource_document "$TEST_DIRECTORY/osmo-hostile-labels.yaml" Deployment \
            "osmo-$topology_component" \
            >"$TEST_DIRECTORY/osmo-$topology_component-hostile-topology.yaml"
        topology_spread_constraints \
            "$TEST_DIRECTORY/osmo-$topology_component-hostile-topology.yaml" \
            >"$TEST_DIRECTORY/osmo-$topology_component-topology.yaml"
        require_occurrences \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "labelSelector:" 1
        require_occurrences \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "app.kubernetes.io/name: osmo" 1
        require_occurrences \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "app.kubernetes.io/instance: osmo" 1
        require_occurrences \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "app.kubernetes.io/component: $topology_component" 1
        require_contains \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "matchLabelKeys:"
        require_contains \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "- pod-template-hash"
        require_contains \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "maxSkew: 2"
        require_contains \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "minDomains: 2"
        require_contains \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "topologyKey: topology.example.com/$topology_component"
        require_contains \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "whenUnsatisfiable: DoNotSchedule"
        require_not_contains \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "user.example.com/selector"
        require_not_contains \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "user.example.com/expression"
        require_not_contains \
            "$TEST_DIRECTORY/osmo-$topology_component-topology.yaml" \
            "helm.sh/chart"
    done

    resource_document "$rendered" Role osmo-api-configmap-events \
        >"$TEST_DIRECTORY/osmo-api-role.yaml"
    resource_document "$rendered" RoleBinding osmo-api-configmap-events \
        >"$TEST_DIRECTORY/osmo-api-role-binding.yaml"
    require_contains "$TEST_DIRECTORY/osmo-api-role.yaml" \
        "app.kubernetes.io/component: api"
    require_contains "$TEST_DIRECTORY/osmo-api-role-binding.yaml" \
        "app.kubernetes.io/component: api"

    resource_document "$rendered" Deployment osmo-ui \
        >"$TEST_DIRECTORY/osmo-ui.yaml"
    require_contains "$TEST_DIRECTORY/osmo-ui.yaml" \
        "serviceAccountName: default"
    require_no_resource "$rendered" ConfigMap "osmo-object-storage-bootstrap"
    require_no_resource "$rendered" Job "osmo-object-storage-bootstrap"

    local embedded_object_storage_settings=(
        --set embeddedDependencies.objectStorage.enabled=true
        --set-string externalDependencies.objectStorage.endpoint=
        --set-string externalDependencies.objectStorage.buckets.workflows=
        --set-string externalDependencies.objectStorage.buckets.logs=
        --set-string externalDependencies.objectStorage.buckets.apps=
        --set secrets.objectStorage.generate=true
        --set-string secrets.objectStorage.existingSecret=
    )

    helm_template embedded-object-storage "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        >"$TEST_DIRECTORY/osmo-embedded-object-storage.yaml"

    require_deployment "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        embedded-object-storage-rustfs
    require_resource "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" Service \
        embedded-object-storage-rustfs-svc
    require_resource "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        PersistentVolumeClaim embedded-object-storage-rustfs-data
    require_resource "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" Secret \
        osmo-rustfs-credentials
    require_resource "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" ConfigMap \
        embedded-object-storage-osmo-object-storage-bootstrap
    require_resource "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" Job \
        embedded-object-storage-osmo-object-storage-bootstrap
    require_occurrences "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        "kind: Secret" 1

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        Secret osmo-rustfs-credentials \
        >"$TEST_DIRECTORY/osmo-rustfs-secret.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-secret.yaml" \
        "helm.sh/resource-policy: keep"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-secret.yaml" \
        "RUSTFS_ACCESS_KEY:"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-secret.yaml" \
        "RUSTFS_SECRET_KEY:"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-secret.yaml" \
        "object-storage.yaml:"
    local rustfs_access_key
    local rustfs_secret_key
    local rustfs_credentials
    rustfs_access_key=$(secret_data_value \
        "$TEST_DIRECTORY/osmo-rustfs-secret.yaml" RUSTFS_ACCESS_KEY | \
        base64 --decode)
    rustfs_secret_key=$(secret_data_value \
        "$TEST_DIRECTORY/osmo-rustfs-secret.yaml" RUSTFS_SECRET_KEY | \
        base64 --decode)
    rustfs_credentials=$(secret_data_value \
        "$TEST_DIRECTORY/osmo-rustfs-secret.yaml" object-storage.yaml | \
        base64 --decode)
    [[ "${#rustfs_access_key}" -eq 20 ]] || \
        fail "expected a 20-character generated RustFS access key"
    [[ "${#rustfs_secret_key}" -eq 64 ]] || \
        fail "expected a 64-character generated RustFS secret key"
    [[ "$rustfs_credentials" == *"access_key_id: $rustfs_access_key"* ]] || \
        fail "expected OSMO credentials to use the generated RustFS access key"
    [[ "$rustfs_credentials" == *"access_key: $rustfs_secret_key"* ]] || \
        fail "expected OSMO credentials to use the generated RustFS secret key"
    [[ "$rustfs_credentials" == *"addressing_style: path"* ]] || \
        fail "expected generated OSMO credentials to use path-style addressing"

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        ConfigMap embedded-object-storage-osmo-object-storage-bootstrap \
        >"$TEST_DIRECTORY/osmo-object-storage-bootstrap-configmap.yaml"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-configmap.yaml" \
        "object-storage-bootstrap.sh:"

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        Job embedded-object-storage-osmo-object-storage-bootstrap \
        >"$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "helm.sh/hook: post-install,post-upgrade"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "helm.sh/hook-delete-policy: before-hook-creation,hook-succeeded"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "backoffLimit: 3"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "amazon/aws-cli:2.31.13@sha256:e14216fb361cce909ce199616711ad103182d5937f851cda9bebf25867d7180a"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "name: AWS_ACCESS_KEY_ID"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "name: AWS_SECRET_ACCESS_KEY"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "name: osmo-rustfs-credentials"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "key: RUSTFS_ACCESS_KEY"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "key: RUSTFS_SECRET_KEY"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "name: AWS_ENDPOINT_URL"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        'value: "http://embedded-object-storage-rustfs-svc:9000"'
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "name: AWS_DEFAULT_REGION"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        'value: "us-east-1"'
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "name: OSMO_WORKFLOW_BUCKET"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "name: OSMO_LOG_BUCKET"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "name: OSMO_APP_BUCKET"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "name: OSMO_STORAGE_BOOTSTRAP_ATTEMPTS"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "automountServiceAccountToken: false"
    require_not_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "serviceAccountName:"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "mountPath: /tmp"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "type: RuntimeDefault"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "runAsUser: 10001"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "runAsNonRoot: true"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "readOnlyRootFilesystem: true"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "allowPrivilegeEscalation: false"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "- ALL"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "resources:"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "cpu: 10m"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "memory: 32Mi"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "cpu: 100m"
    require_contains "$TEST_DIRECTORY/osmo-object-storage-bootstrap-job.yaml" \
        "memory: 128Mi"

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        Deployment embedded-object-storage-rustfs \
        >"$TEST_DIRECTORY/osmo-rustfs-deployment.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" "type: Recreate"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" \
        "runAsNonRoot: true"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" \
        "readOnlyRootFilesystem: true"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" \
        "allowPrivilegeEscalation: false"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" "- ALL"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" \
        "type: RuntimeDefault"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" \
        "fsGroupChangePolicy: OnRootMismatch"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" "livenessProbe:"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" "readinessProbe:"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" "resources:"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" "cpu: 500m"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" "memory: 1Gi"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" "cpu: 1"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" "memory: 2Gi"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" \
        "rustfs/rustfs:1.0.0-rc.2@sha256:7d6d361c49c08d427250fb59aae5d78df83d644c3405d9ccf4b21cda0b0692d0"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-deployment.yaml" \
        "busybox:stable@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662"

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        ConfigMap embedded-object-storage-rustfs-config \
        >"$TEST_DIRECTORY/osmo-rustfs-config.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-config.yaml" \
        'RUSTFS_REGION: "us-east-1"'

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        ServiceAccount embedded-object-storage-rustfs \
        >"$TEST_DIRECTORY/osmo-rustfs-service-account.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-service-account.yaml" \
        "automountServiceAccountToken: false"

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        PersistentVolumeClaim embedded-object-storage-rustfs-data \
        >"$TEST_DIRECTORY/osmo-rustfs-pvc.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-pvc.yaml" \
        "helm.sh/resource-policy: keep"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-pvc.yaml" "ReadWriteOnce"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-pvc.yaml" "storage: 10Gi"

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        ConfigMap embedded-object-storage-osmo-api-config \
        >"$TEST_DIRECTORY/osmo-embedded-object-storage-config.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-object-storage-config.yaml" \
        "override_url: http://embedded-object-storage-rustfs-svc:9000"
    require_contains "$TEST_DIRECTORY/osmo-embedded-object-storage-config.yaml" \
        "endpoint: s3://osmo-workflows/workflows"
    require_contains "$TEST_DIRECTORY/osmo-embedded-object-storage-config.yaml" \
        "endpoint: s3://osmo-logs/logs"
    require_contains "$TEST_DIRECTORY/osmo-embedded-object-storage-config.yaml" \
        "endpoint: s3://osmo-apps/apps"
    require_contains "$TEST_DIRECTORY/osmo-embedded-object-storage-config.yaml" \
        "secretName: osmo-rustfs-credentials"
    require_contains "$TEST_DIRECTORY/osmo-embedded-object-storage-config.yaml" \
        "secretKey: object-storage.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-object-storage-config.yaml" \
        "region: us-east-1"
    local object_storage_consumer
    for object_storage_consumer in api worker logger agent; do
        resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
            Deployment "embedded-object-storage-osmo-$object_storage_consumer" \
            >"$TEST_DIRECTORY/osmo-$object_storage_consumer-object-storage.yaml"
        require_contains \
            "$TEST_DIRECTORY/osmo-$object_storage_consumer-object-storage.yaml" \
            "secretName: osmo-rustfs-credentials"
        require_contains \
            "$TEST_DIRECTORY/osmo-$object_storage_consumer-object-storage.yaml" \
            "mountPath: /etc/osmo/secrets/osmo-rustfs-credentials"
    done
    require_not_contains "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        "kind: Ingress"
    require_not_contains "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        "kind: Gateway"
    require_not_contains "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        "kind: HTTPRoute"
    require_not_contains "$TEST_DIRECTORY/osmo-embedded-object-storage.yaml" \
        "kind: HTTPProxy"

    helm_template embedded-non-default-region "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set-string embeddedDependencies.objectStorage.region=us-west-2 \
        --set-string rustfs.config.rustfs.region=us-west-2 \
        >"$TEST_DIRECTORY/osmo-embedded-non-default-region.yaml"
    resource_document "$TEST_DIRECTORY/osmo-embedded-non-default-region.yaml" \
        ConfigMap embedded-non-default-region-rustfs-config \
        >"$TEST_DIRECTORY/osmo-rustfs-non-default-region-config.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-non-default-region-config.yaml" \
        'RUSTFS_REGION: "us-west-2"'
    resource_document "$TEST_DIRECTORY/osmo-embedded-non-default-region.yaml" \
        ConfigMap embedded-non-default-region-osmo-api-config \
        >"$TEST_DIRECTORY/osmo-non-default-region-config.yaml"
    require_contains "$TEST_DIRECTORY/osmo-non-default-region-config.yaml" \
        "region: us-west-2"
    resource_document "$TEST_DIRECTORY/osmo-embedded-non-default-region.yaml" \
        Job embedded-non-default-region-osmo-object-storage-bootstrap \
        >"$TEST_DIRECTORY/osmo-non-default-region-bootstrap-job.yaml"
    require_contains \
        "$TEST_DIRECTORY/osmo-non-default-region-bootstrap-job.yaml" \
        'value: "us-west-2"'

    helm_template embedded-object-storage-custom-key "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set-string secrets.objectStorage.keys.credentials=custom-storage.yaml \
        --set-string rustfs.secret.existingSecret=custom-rustfs-credentials \
        >"$TEST_DIRECTORY/osmo-embedded-object-storage-custom-key.yaml"
    resource_document \
        "$TEST_DIRECTORY/osmo-embedded-object-storage-custom-key.yaml" Secret \
        custom-rustfs-credentials \
        >"$TEST_DIRECTORY/osmo-rustfs-custom-key-secret.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-custom-key-secret.yaml" \
        "custom-storage.yaml:"
    require_not_contains "$TEST_DIRECTORY/osmo-rustfs-custom-key-secret.yaml" \
        "object-storage.yaml:"
    require_contains \
        "$TEST_DIRECTORY/osmo-embedded-object-storage-custom-key.yaml" \
        "secretKey: custom-storage.yaml"
    require_contains \
        "$TEST_DIRECTORY/osmo-embedded-object-storage-custom-key.yaml" \
        "secretName: custom-rustfs-credentials"

    helm_template embedded-object-storage-existing "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set secrets.objectStorage.generate=false \
        --set-string secrets.objectStorage.existingSecret=existing-rustfs-secret \
        --set-string rustfs.secret.existingSecret=existing-rustfs-secret \
        >"$TEST_DIRECTORY/osmo-embedded-object-storage-existing.yaml"
    require_no_resource "$TEST_DIRECTORY/osmo-embedded-object-storage-existing.yaml" \
        Secret existing-rustfs-secret
    require_contains "$TEST_DIRECTORY/osmo-embedded-object-storage-existing.yaml" \
        "secretName: existing-rustfs-secret"

    helm_template embedded-object-storage-ha "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/embedded-rustfs-ha-values.yaml" \
        >"$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml"
    require_no_deployment \
        "$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml" \
        embedded-object-storage-ha-rustfs
    require_no_resource "$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml" \
        PersistentVolumeClaim embedded-object-storage-ha-rustfs-data
    require_resource "$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml" \
        StatefulSet embedded-object-storage-ha-rustfs
    require_resource "$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml" \
        PodDisruptionBudget embedded-object-storage-ha-rustfs
    require_no_resource "$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml" \
        Secret osmo-rustfs-credentials

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml" \
        StatefulSet embedded-object-storage-ha-rustfs \
        >"$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        "replicas: 4"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        "requiredDuringSchedulingIgnoredDuringExecution:"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        "topologyKey: kubernetes.io/hostname"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        "name: data"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        'accessModes: ["ReadWriteOnce"]'
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        "storageClassName: standard"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        "storage: 100Gi"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        "name: RUSTFS_LOCAL_ENDPOINT_HOST"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        "cpu: 500m"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        "memory: 1Gi"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-statefulset.yaml" \
        "memory: 2Gi"

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml" \
        PodDisruptionBudget embedded-object-storage-ha-rustfs \
        >"$TEST_DIRECTORY/osmo-rustfs-ha-pdb.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-pdb.yaml" \
        "maxUnavailable: 1"

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml" \
        ConfigMap embedded-object-storage-ha-rustfs-config \
        >"$TEST_DIRECTORY/osmo-rustfs-ha-config.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-config.yaml" \
        'RUSTFS_STORAGE_CLASS_STANDARD: "EC:2"'
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-config.yaml" \
        'rustfs-{0...3}.embedded-object-storage-ha-rustfs-headless.default.svc.cluster.local:9000/data'

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml" \
        ConfigMap embedded-object-storage-ha-osmo-api-config \
        >"$TEST_DIRECTORY/osmo-rustfs-ha-osmo-config.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-osmo-config.yaml" \
        "override_url: http://embedded-object-storage-ha-rustfs-svc:9000"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-osmo-config.yaml" \
        "endpoint: s3://osmo-workflows/workflows"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-osmo-config.yaml" \
        "endpoint: s3://osmo-logs/logs"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-osmo-config.yaml" \
        "endpoint: s3://osmo-apps/apps"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-osmo-config.yaml" \
        "secretName: osmo-rustfs-credentials"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-osmo-config.yaml" \
        "secretKey: object-storage.yaml"

    resource_document "$TEST_DIRECTORY/osmo-embedded-object-storage-ha.yaml" \
        Job embedded-object-storage-ha-osmo-object-storage-bootstrap \
        >"$TEST_DIRECTORY/osmo-rustfs-ha-bootstrap-job.yaml"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-bootstrap-job.yaml" \
        'value: "http://embedded-object-storage-ha-rustfs-svc:9000"'
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-bootstrap-job.yaml" \
        "name: OSMO_WORKFLOW_BUCKET"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-bootstrap-job.yaml" \
        "name: OSMO_LOG_BUCKET"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-bootstrap-job.yaml" \
        "name: OSMO_APP_BUCKET"
    require_contains "$TEST_DIRECTORY/osmo-rustfs-ha-bootstrap-job.yaml" \
        "name: osmo-rustfs-credentials"

    if helm_template mismatched-embedded-object-storage-region \
        "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set-string embeddedDependencies.objectStorage.region=us-west-2 \
        >"$TEST_DIRECTORY/mismatched-embedded-object-storage-region.out" 2>&1; then
        fail "expected mismatched embedded object-storage regions to fail"
    fi
    require_contains \
        "$TEST_DIRECTORY/mismatched-embedded-object-storage-region.out" \
        "embeddedDependencies.objectStorage.region must match rustfs.config.rustfs.region"

    local conflicting_external_object_storage_value
    local conflicting_external_object_storage_message
    while IFS='|' read -r conflicting_external_object_storage_value \
        conflicting_external_object_storage_message; do
        if helm_template conflicting-object-storage "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            "${embedded_object_storage_settings[@]}" \
            --set-string "$conflicting_external_object_storage_value" \
            >"$TEST_DIRECTORY/conflicting-object-storage.out" 2>&1; then
            fail "expected embedded and external object-storage configuration to fail"
        fi
        require_contains "$TEST_DIRECTORY/conflicting-object-storage.out" \
            "$conflicting_external_object_storage_message"
    done <<'EOF'
externalDependencies.objectStorage.endpoint=https://unexpected.example.com|externalDependencies.objectStorage.endpoint must be empty
externalDependencies.objectStorage.buckets.workflows=unexpected-workflows|externalDependencies.objectStorage.buckets.workflows must be empty
externalDependencies.objectStorage.buckets.logs=unexpected-logs|externalDependencies.objectStorage.buckets.logs must be empty
externalDependencies.objectStorage.buckets.apps=unexpected-apps|externalDependencies.objectStorage.buckets.apps must be empty
EOF

    if helm_template duplicate-object-storage-credentials "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set-string secrets.objectStorage.existingSecret=existing-rustfs-secret \
        >"$TEST_DIRECTORY/duplicate-object-storage-credentials.out" 2>&1; then
        fail "expected duplicate embedded object-storage credential ownership to fail"
    fi
    require_contains "$TEST_DIRECTORY/duplicate-object-storage-credentials.out" \
        "generate and existingSecret are mutually exclusive"

    local invalid_object_storage_credentials_key
    local invalid_object_storage_credentials_key_message
    while IFS='|' read -r invalid_object_storage_credentials_key \
        invalid_object_storage_credentials_key_message; do
        if helm_template invalid-object-storage-credentials-key \
            "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            "${embedded_object_storage_settings[@]}" \
            --set-string "$invalid_object_storage_credentials_key" \
            >"$TEST_DIRECTORY/invalid-object-storage-credentials-key.out" \
            2>&1; then
            fail "expected invalid object-storage credentials key to fail"
        fi
        require_contains \
            "$TEST_DIRECTORY/invalid-object-storage-credentials-key.out" \
            "$invalid_object_storage_credentials_key_message"
    done <<'EOF'
secrets.objectStorage.keys.credentials=|must be a non-empty valid Kubernetes Secret data key
secrets.objectStorage.keys.credentials=object/storage.yaml|must be a non-empty valid Kubernetes Secret data key
secrets.objectStorage.keys.credentials=RUSTFS_ACCESS_KEY|must not use a reserved RustFS key name
secrets.objectStorage.keys.credentials=RUSTFS_SECRET_KEY|must not use a reserved RustFS key name
EOF

    if helm_template missing-object-storage-credentials "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set secrets.objectStorage.generate=false \
        >"$TEST_DIRECTORY/missing-object-storage-credentials.out" 2>&1; then
        fail "expected missing embedded object-storage credentials to fail"
    fi
    require_contains "$TEST_DIRECTORY/missing-object-storage-credentials.out" \
        "requires generated or existing credentials"

    if helm_template generated-external-object-storage "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set secrets.objectStorage.generate=true \
        --set-string secrets.objectStorage.existingSecret= \
        >"$TEST_DIRECTORY/generated-external-object-storage.out" 2>&1; then
        fail "expected generated credentials outside embedded object storage to fail"
    fi
    require_contains "$TEST_DIRECTORY/generated-external-object-storage.out" \
        "secrets.objectStorage.generate is supported only when embedded object storage is enabled"

    if helm_template mismatched-object-storage-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set secrets.objectStorage.generate=false \
        --set-string secrets.objectStorage.existingSecret=existing-rustfs-secret \
        >"$TEST_DIRECTORY/mismatched-object-storage-secret.out" 2>&1; then
        fail "expected mismatched embedded object-storage Secret names to fail"
    fi
    require_contains "$TEST_DIRECTORY/mismatched-object-storage-secret.out" \
        "rustfs.secret.existingSecret must match the effective object-storage Secret"

    local inline_rustfs_credential
    for inline_rustfs_credential in access_key secret_key; do
        if helm_template inline-rustfs-credential "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            "${embedded_object_storage_settings[@]}" \
            --set-string "rustfs.secret.rustfs.$inline_rustfs_credential=plaintext" \
            >"$TEST_DIRECTORY/inline-rustfs-credential.out" 2>&1; then
            fail "expected inline RustFS $inline_rustfs_credential to fail"
        fi
        require_contains "$TEST_DIRECTORY/inline-rustfs-credential.out" \
            "inline RustFS credentials are not supported"
    done

    if helm_template both-rustfs-topologies "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set rustfs.mode.distributed.enabled=true \
        --set rustfs.replicaCount=2 \
        >"$TEST_DIRECTORY/both-rustfs-topologies.out" 2>&1; then
        fail "expected both RustFS topology modes to fail"
    fi
    require_contains "$TEST_DIRECTORY/both-rustfs-topologies.out" \
        "exactly one RustFS topology mode must be enabled"

    if helm_template neither-rustfs-topology "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set rustfs.mode.standalone.enabled=false \
        >"$TEST_DIRECTORY/neither-rustfs-topology.out" 2>&1; then
        fail "expected neither RustFS topology mode to fail"
    fi
    require_contains "$TEST_DIRECTORY/neither-rustfs-topology.out" \
        "exactly one RustFS topology mode must be enabled"

    local longest_legal_helm_release
    longest_legal_helm_release=$(printf 'r%.0s' {1..53})
    if helm_template "$longest_legal_helm_release" "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        >"$TEST_DIRECTORY/standalone-rustfs-name-overflow.out" 2>&1; then
        fail "expected an overlong standalone RustFS Service name to fail"
    fi
    require_contains "$TEST_DIRECTORY/standalone-rustfs-name-overflow.out" \
        "standalone embedded RustFS fullname must be at most 59 characters"

    local distributed_rustfs_name_overflow_release
    distributed_rustfs_name_overflow_release=$(printf 'd%.0s' {1..48})
    if helm_template "$distributed_rustfs_name_overflow_release" \
        "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set rustfs.mode.standalone.enabled=false \
        --set rustfs.mode.distributed.enabled=true \
        --set rustfs.replicaCount=2 \
        >"$TEST_DIRECTORY/distributed-rustfs-name-overflow.out" 2>&1; then
        fail "expected an overlong distributed RustFS headless Service name to fail"
    fi
    require_contains "$TEST_DIRECTORY/distributed-rustfs-name-overflow.out" \
        "distributed embedded RustFS fullname must be at most 54 characters"

    local standalone_rustfs_name_boundary_release
    local standalone_rustfs_name_boundary_fullname
    standalone_rustfs_name_boundary_release=$(printf 's%.0s' {1..52})
    standalone_rustfs_name_boundary_fullname="${standalone_rustfs_name_boundary_release}-rustfs"
    helm_template "$standalone_rustfs_name_boundary_release" \
        "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        >"$TEST_DIRECTORY/standalone-rustfs-name-boundary.yaml"
    require_resource "$TEST_DIRECTORY/standalone-rustfs-name-boundary.yaml" \
        Service "${standalone_rustfs_name_boundary_fullname}-svc"

    local distributed_rustfs_name_boundary_release
    local distributed_rustfs_name_boundary_fullname
    distributed_rustfs_name_boundary_release=$(printf 'd%.0s' {1..47})
    distributed_rustfs_name_boundary_fullname="${distributed_rustfs_name_boundary_release}-rustfs"
    helm_template "$distributed_rustfs_name_boundary_release" \
        "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set rustfs.mode.standalone.enabled=false \
        --set rustfs.mode.distributed.enabled=true \
        --set rustfs.replicaCount=2 \
        >"$TEST_DIRECTORY/distributed-rustfs-name-boundary.yaml"
    require_resource "$TEST_DIRECTORY/distributed-rustfs-name-boundary.yaml" \
        Service "${distributed_rustfs_name_boundary_fullname}-headless"

    local rustfs_topology
    local rustfs_name_override
    local rustfs_name_boundary_length
    local rustfs_name_overflow_length
    local rustfs_name_error
    while IFS='|' read -r rustfs_topology rustfs_name_override \
        rustfs_name_boundary_length rustfs_name_overflow_length rustfs_name_error; do
        local rustfs_name_boundary_value
        local rustfs_name_boundary_effective
        local rustfs_service_suffix
        local rustfs_topology_settings=()
        printf -v rustfs_name_boundary_value '%*s' \
            "$rustfs_name_boundary_length" ''
        rustfs_name_boundary_value=${rustfs_name_boundary_value// /x}
        rustfs_name_boundary_effective=$rustfs_name_boundary_value
        rustfs_service_suffix=svc
        if [[ "$rustfs_name_override" == nameOverride ]]; then
            rustfs_name_boundary_effective="n-$rustfs_name_boundary_value"
        fi
        if [[ "$rustfs_topology" == distributed ]]; then
            rustfs_service_suffix=headless
            rustfs_topology_settings=(
                --set rustfs.mode.standalone.enabled=false
                --set rustfs.mode.distributed.enabled=true
                --set rustfs.replicaCount=2
            )
        fi
        helm_template n "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            "${embedded_object_storage_settings[@]}" \
            "${rustfs_topology_settings[@]}" \
            --set-string "rustfs.$rustfs_name_override=$rustfs_name_boundary_value" \
            >"$TEST_DIRECTORY/$rustfs_topology-$rustfs_name_override-boundary.yaml"
        require_resource \
            "$TEST_DIRECTORY/$rustfs_topology-$rustfs_name_override-boundary.yaml" \
            Service "${rustfs_name_boundary_effective}-${rustfs_service_suffix}"

        local rustfs_name_overflow_value
        printf -v rustfs_name_overflow_value '%*s' \
            "$rustfs_name_overflow_length" ''
        rustfs_name_overflow_value=${rustfs_name_overflow_value// /x}
        if helm_template n "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            "${embedded_object_storage_settings[@]}" \
            "${rustfs_topology_settings[@]}" \
            --set-string "rustfs.$rustfs_name_override=$rustfs_name_overflow_value" \
            >"$TEST_DIRECTORY/$rustfs_topology-$rustfs_name_override-overflow.out" 2>&1; then
            fail "expected overlong $rustfs_topology rustfs.$rustfs_name_override to fail"
        fi
        require_contains \
            "$TEST_DIRECTORY/$rustfs_topology-$rustfs_name_override-overflow.out" \
            "$rustfs_name_error"
    done <<'EOF'
standalone|fullnameOverride|59|60|standalone embedded RustFS fullname must be at most 59 characters
standalone|nameOverride|57|58|standalone embedded RustFS fullname must be at most 59 characters
distributed|fullnameOverride|54|55|distributed embedded RustFS fullname must be at most 54 characters
distributed|nameOverride|52|53|distributed embedded RustFS fullname must be at most 54 characters
EOF

    if helm_template unsupported-rustfs-port "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        "${embedded_object_storage_settings[@]}" \
        --set rustfs.service.endpoint.port=9002 \
        >"$TEST_DIRECTORY/unsupported-rustfs-port.out" 2>&1; then
        fail "expected a non-9000 RustFS endpoint port to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-rustfs-port.out" \
        "embedded RustFS requires endpoint service port 9000"

    local exposed_rustfs_value
    local exposed_rustfs_message
    while IFS='|' read -r exposed_rustfs_value exposed_rustfs_message; do
        if helm_template exposed-rustfs "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            "${embedded_object_storage_settings[@]}" \
            --set "$exposed_rustfs_value" \
            >"$TEST_DIRECTORY/exposed-rustfs.out" 2>&1; then
            fail "expected exposed RustFS endpoint to fail"
        fi
        require_contains "$TEST_DIRECTORY/exposed-rustfs.out" \
            "$exposed_rustfs_message"
    done <<'EOF'
rustfs.ingress.enabled=true|rustfs.ingress.enabled must be false
rustfs.ingress.className=contour|rustfs.ingress.className must not be contour
rustfs.gatewayApi.enabled=true|rustfs.gatewayApi.enabled must be false
rustfs.mtls.enabled=true|rustfs.mtls.enabled must be false
rustfs.service.type=NodePort|rustfs.service.type must be ClusterIP
rustfs.service.externalIPs[0]=192.0.2.10|rustfs.service.externalIPs must be empty
rustfs.service.loadBalancerIP=192.0.2.10|rustfs.service.loadBalancerIP must be empty
rustfs.service.loadBalancerClass=example.com/lb|rustfs.service.loadBalancerClass must be empty
rustfs.service.loadBalancerSourceRanges[0]=192.0.2.0/24|rustfs.service.loadBalancerSourceRanges must be empty
EOF

    local invalid_embedded_bucket_value
    local invalid_embedded_bucket_message
    while IFS='|' read -r invalid_embedded_bucket_value \
        invalid_embedded_bucket_message; do
        if helm_template invalid-embedded-bucket "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            "${embedded_object_storage_settings[@]}" \
            --set-string "$invalid_embedded_bucket_value" \
            >"$TEST_DIRECTORY/invalid-embedded-bucket.out" 2>&1; then
            fail "expected invalid embedded object-storage bucket to fail"
        fi
        require_contains "$TEST_DIRECTORY/invalid-embedded-bucket.out" \
            "$invalid_embedded_bucket_message"
    done <<'EOF'
embeddedDependencies.objectStorage.buckets.workflows=|embedded object-storage bucket names must be non-empty
embeddedDependencies.objectStorage.buckets.logs=osmo-workflows|embedded object-storage bucket names must be unique
embeddedDependencies.objectStorage.buckets.apps=OSMO-APPS|embedded object-storage bucket names must use valid S3 syntax
embeddedDependencies.objectStorage.buckets.apps=osmo_apps|embedded object-storage bucket names must use valid S3 syntax
EOF

    helm_template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret= \
        --set-string commonLabels.owner=platform \
        --set-string commonAnnotations.owner=platform \
        >"$TEST_DIRECTORY/osmo-embedded-valkey.yaml"

    require_deployment "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" "osmo-valkey"
    require_resource "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" Service "osmo-valkey"
    require_resource "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" \
        PersistentVolumeClaim "osmo-valkey"
    require_resource "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" \
        ServiceAccount "osmo-valkey"
    require_resource "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" \
        NetworkPolicy "osmo-valkey"
    require_resource "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" \
        Secret "osmo-valkey-credentials"
    resource_document "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" Secret \
        osmo-valkey-credentials >"$TEST_DIRECTORY/osmo-valkey-secret.yaml"
    require_occurrences "$TEST_DIRECTORY/osmo-valkey-secret.yaml" \
        "owner: platform" 2
    require_contains "$TEST_DIRECTORY/osmo-valkey-secret.yaml" \
        "helm.sh/resource-policy: keep"

    resource_document "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" Deployment \
        osmo-valkey >"$TEST_DIRECTORY/osmo-valkey.yaml"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "type: Recreate"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "readinessProbe:"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "livenessProbe:"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "startupProbe:"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "readOnlyRootFilesystem: true"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "allowPrivilegeEscalation: false"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "automountServiceAccountToken: false"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "resources:"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "cpu: 500m"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "memory: 1Gi"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "cpu: 1"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" "memory: 2Gi"

    resource_document "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" \
        PersistentVolumeClaim osmo-valkey >"$TEST_DIRECTORY/osmo-valkey-pvc.yaml"
    require_contains "$TEST_DIRECTORY/osmo-valkey-pvc.yaml" \
        '"helm.sh/resource-policy": keep'
    require_contains "$TEST_DIRECTORY/osmo-valkey-pvc.yaml" "ReadWriteOnce"
    require_contains "$TEST_DIRECTORY/osmo-valkey-pvc.yaml" "storage: 8Gi"

    resource_document "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" ConfigMap \
        osmo-valkey-config >"$TEST_DIRECTORY/osmo-valkey-config.yaml"
    require_contains "$TEST_DIRECTORY/osmo-valkey-config.yaml" "appendonly yes"
    require_contains "$TEST_DIRECTORY/osmo-valkey-config.yaml" "appendfsync everysec"
    require_contains "$TEST_DIRECTORY/osmo-valkey-config.yaml" "maxmemory 1gb"
    require_contains "$TEST_DIRECTORY/osmo-valkey-config.yaml" \
        "maxmemory-policy noeviction"
    require_contains "$TEST_DIRECTORY/osmo-valkey.yaml" \
        "secretName: osmo-valkey-credentials"
    require_contains "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" \
        "redis-password:"

    local valkey_consumer
    for valkey_consumer in api worker logger agent delayed-job-monitor; do
        resource_document "$TEST_DIRECTORY/osmo-embedded-valkey.yaml" Deployment \
            "osmo-$valkey_consumer" \
            >"$TEST_DIRECTORY/osmo-$valkey_consumer-valkey.yaml"
        require_contains "$TEST_DIRECTORY/osmo-$valkey_consumer-valkey.yaml" \
            "- osmo-valkey"
        require_contains "$TEST_DIRECTORY/osmo-$valkey_consumer-valkey.yaml" \
            "name: osmo-valkey-credentials"
        require_contains "$TEST_DIRECTORY/osmo-$valkey_consumer-valkey.yaml" \
            "key: redis-password"
    done

    helm_template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-review-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret= \
        >"$TEST_DIRECTORY/osmo-embedded-valkey-gateway.yaml"
    resource_document "$TEST_DIRECTORY/osmo-embedded-valkey-gateway.yaml" \
        Deployment osmo-gateway-oauth2-proxy \
        >"$TEST_DIRECTORY/osmo-embedded-valkey-oauth2-proxy.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-valkey-oauth2-proxy.yaml" \
        "--redis-connection-url=redis://osmo-valkey:6379/0"
    require_contains "$TEST_DIRECTORY/osmo-embedded-valkey-oauth2-proxy.yaml" \
        "name: osmo-valkey-credentials"
    resource_document "$TEST_DIRECTORY/osmo-embedded-valkey-gateway.yaml" \
        Deployment osmo-gateway-ratelimit \
        >"$TEST_DIRECTORY/osmo-embedded-valkey-ratelimit.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-valkey-ratelimit.yaml" \
        "value: osmo-valkey:6379"
    require_contains "$TEST_DIRECTORY/osmo-embedded-valkey-ratelimit.yaml" \
        "name: osmo-valkey-credentials"
    require_contains "$TEST_DIRECTORY/osmo-embedded-valkey-ratelimit.yaml" \
        'value: "false"'

    helm_template existing-embedded "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set-string secrets.valkey.existingSecret=existing-embedded-valkey \
        --set-string valkey.auth.usersExistingSecret=existing-embedded-valkey \
        >"$TEST_DIRECTORY/osmo-existing-embedded-valkey.yaml"
    require_no_resource "$TEST_DIRECTORY/osmo-existing-embedded-valkey.yaml" Secret \
        existing-embedded-valkey-credentials
    require_contains "$TEST_DIRECTORY/osmo-existing-embedded-valkey.yaml" \
        "secretName: existing-embedded-valkey"

    if helm_template conflicting-embedded "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret=existing-embedded-valkey \
        >"$TEST_DIRECTORY/conflicting-embedded.out" 2>&1; then
        fail "expected embedded and external Valkey configuration to fail"
    fi
    require_contains "$TEST_DIRECTORY/conflicting-embedded.out" \
        "externalDependencies.valkey.host must be empty"

    if helm_template missing-embedded-credentials "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set-string secrets.valkey.existingSecret= \
        >"$TEST_DIRECTORY/missing-embedded-credentials.out" 2>&1; then
        fail "expected missing embedded Valkey credentials to fail"
    fi
    require_contains "$TEST_DIRECTORY/missing-embedded-credentials.out" \
        "requires generated or existing credentials"

    if helm_template duplicate-embedded-credentials "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret=existing-embedded-valkey \
        >"$TEST_DIRECTORY/duplicate-embedded-credentials.out" 2>&1; then
        fail "expected duplicate embedded Valkey credential ownership to fail"
    fi
    require_contains "$TEST_DIRECTORY/duplicate-embedded-credentials.out" \
        "generate and existingSecret are mutually exclusive"

    if helm_template inline-embedded-password "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret= \
        --set-string valkey.auth.aclUsers.default.password=plaintext \
        >"$TEST_DIRECTORY/inline-embedded-password.out" 2>&1; then
        fail "expected inline embedded Valkey credentials to fail"
    fi
    require_contains "$TEST_DIRECTORY/inline-embedded-password.out" \
        "inline Valkey passwords are not supported"

    if helm_template mismatched-embedded-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set-string secrets.valkey.existingSecret=existing-embedded-valkey \
        --set-string valkey.auth.usersExistingSecret=other-valkey \
        >"$TEST_DIRECTORY/mismatched-embedded-secret.out" 2>&1; then
        fail "expected mismatched embedded Valkey Secret names to fail"
    fi
    require_contains "$TEST_DIRECTORY/mismatched-embedded-secret.out" \
        "must match the effective Valkey Secret"

    if helm_template context-sensitive-embedded-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set-string secrets.valkey.existingSecret=osmo \
        --set-literal 'valkey.auth.usersExistingSecret={{ .Chart.Name }}' \
        >"$TEST_DIRECTORY/context-sensitive-embedded-secret.out" 2>&1; then
        fail "expected context-sensitive embedded Valkey Secret name to fail"
    fi
    require_contains "$TEST_DIRECTORY/context-sensitive-embedded-secret.out" \
        "must not contain templates when using an existing Secret"

    helm_template generated-secret-render "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret= \
        >"$TEST_DIRECTORY/generated-secret-render.yaml"
    require_resource "$TEST_DIRECTORY/generated-secret-render.yaml" Secret \
        "generated-secret-render-valkey-credentials"

    if helm_template embedded-tls "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret= \
        --set valkey.tls.enabled=true \
        --set valkey.tls.existingSecret=valkey-tls \
        >"$TEST_DIRECTORY/embedded-tls.out" 2>&1; then
        fail "expected unsupported embedded Valkey TLS to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-tls.out" \
        "embedded Valkey TLS is not supported"

    if helm_template embedded-custom-port "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret= \
        --set valkey.service.port=6380 \
        >"$TEST_DIRECTORY/embedded-custom-port.out" 2>&1; then
        fail "expected unsupported embedded Valkey port to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-custom-port.out" \
        "embedded Valkey requires service port 6379"

    if helm_template embedded-external-database "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set externalDependencies.valkey.database=1 \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret= \
        >"$TEST_DIRECTORY/embedded-external-database.out" 2>&1; then
        fail "expected an external Valkey database in embedded mode to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-external-database.out" \
        "externalDependencies.valkey.database must be 0 when embedded Valkey is enabled"

    helm_template replicated-embedded "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret= \
        --set valkey.replica.enabled=true \
        >"$TEST_DIRECTORY/osmo-replicated-valkey.yaml"
    require_resource "$TEST_DIRECTORY/osmo-replicated-valkey.yaml" StatefulSet \
        replicated-embedded-valkey
    require_resource "$TEST_DIRECTORY/osmo-replicated-valkey.yaml" \
        PodDisruptionBudget replicated-embedded-valkey
    require_resource "$TEST_DIRECTORY/osmo-replicated-valkey.yaml" Service \
        replicated-embedded-valkey
    resource_document "$TEST_DIRECTORY/osmo-replicated-valkey.yaml" Deployment \
        replicated-embedded-osmo-api \
        >"$TEST_DIRECTORY/osmo-replicated-valkey-api.yaml"
    require_contains "$TEST_DIRECTORY/osmo-replicated-valkey-api.yaml" \
        "- replicated-embedded-valkey"
    resource_document "$TEST_DIRECTORY/osmo-replicated-valkey.yaml" StatefulSet \
        replicated-embedded-valkey \
        >"$TEST_DIRECTORY/osmo-replicated-valkey-statefulset.yaml"
    require_contains "$TEST_DIRECTORY/osmo-replicated-valkey-statefulset.yaml" \
        "replicas: 3"
    require_contains "$TEST_DIRECTORY/osmo-replicated-valkey-statefulset.yaml" \
        "whenDeleted: Retain"
    require_contains "$TEST_DIRECTORY/osmo-replicated-valkey-statefulset.yaml" \
        "whenScaled: Retain"
    require_contains "$TEST_DIRECTORY/osmo-replicated-valkey-statefulset.yaml" \
        "storage: \"8Gi\""
    resource_document "$TEST_DIRECTORY/osmo-replicated-valkey.yaml" ConfigMap \
        replicated-embedded-valkey-init-scripts \
        >"$TEST_DIRECTORY/osmo-replicated-valkey-init.yaml"
    require_contains "$TEST_DIRECTORY/osmo-replicated-valkey-init.yaml" \
        "min-replicas-to-write 1"

    cat >"$charts_copy/osmo/templates/postgresql-helper-contract.yaml" <<'EOF'
{{- if .Values.embeddedDependencies.postgresql.enabled }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}-postgresql-helper-contract
data:
  clusterName: {{ include "osmo.postgresql.clusterName" . | quote }}
  host: {{ include "osmo.postgresql.host" . | quote }}
  port: {{ include "osmo.postgresql.port" . | quote }}
  database: {{ include "osmo.postgresql.database" . | quote }}
  username: {{ include "osmo.postgresql.username" . | quote }}
  secretName: {{ include "osmo.postgresql.secretName" . | quote }}
  passwordKey: {{ include "osmo.postgresql.passwordKey" . | quote }}
  sslMode: {{ include "osmo.postgresql.sslMode" . | quote }}
  caSecretName: {{ include "osmo.postgresql.caSecretName" . | quote }}
  caKey: {{ include "osmo.postgresql.caKey" . | quote }}
  connectionCaEnabled: {{ include "osmo.externalDependencies.connectionCaEnabled" . | quote }}
{{- end }}
EOF
    helm_template embedded-helper-contract "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        >"$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml"
    rm "$charts_copy/osmo/templates/postgresql-helper-contract.yaml"
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'clusterName: "embedded-helper-contract-pg"'
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'host: "embedded-helper-contract-pg-rw"'
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'port: "5432"'
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'database: "osmo"'
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'username: "osmo"'
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'secretName: "embedded-helper-contract-pg-app"'
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'passwordKey: "password"'
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'sslMode: "verify-full"'
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'caSecretName: "embedded-helper-contract-pg-ca"'
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'caKey: "ca.crt"'
    require_contains "$TEST_DIRECTORY/osmo-postgresql-helper-contract.yaml" \
        'connectionCaEnabled: "true"'

    local long_release
    long_release=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    helm_template "$long_release" "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        >"$TEST_DIRECTORY/osmo-long-release.yaml"
    require_resource "$TEST_DIRECTORY/osmo-long-release.yaml" Cluster \
        "$long_release-pg"
    resource_document "$TEST_DIRECTORY/osmo-long-release.yaml" Deployment \
        "$long_release-osmo-api" >"$TEST_DIRECTORY/osmo-long-release-api.yaml"
    require_contains "$TEST_DIRECTORY/osmo-long-release-api.yaml" \
        "$long_release-pg-rw"

    local long_override
    long_override=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    if helm_template embedded-name-too-long "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set "postgresql.fullnameOverride=$long_override" \
        >"$TEST_DIRECTORY/osmo-long-override.out" 2>&1; then
        fail "expected an embedded PostgreSQL cluster name over 60 characters to fail"
    fi
    require_contains "$TEST_DIRECTORY/osmo-long-override.out" \
        "embedded PostgreSQL cluster name must be at most 60 characters"

    helm_template embedded-osmo "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        >"$TEST_DIRECTORY/osmo-embedded.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" \
        "apiVersion: postgresql.cnpg.io/v1"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" "kind: Cluster"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" "instances: 3"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" "size: 20Gi"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" "method: any"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" "number: 1"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" \
        "dataDurability: required"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" "database: osmo"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" "owner: osmo"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" \
        "enableSuperuserAccess: false"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" \
        "podAntiAffinityType: required"
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" "cpu: \"1\""
    require_contains "$TEST_DIRECTORY/osmo-embedded.yaml" "memory: 2Gi"
    resource_document "$TEST_DIRECTORY/osmo-embedded.yaml" Cluster \
        embedded-osmo-pg >"$TEST_DIRECTORY/osmo-embedded-postgresql.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-postgresql.yaml" "bootstrap:"
    require_contains "$TEST_DIRECTORY/osmo-embedded-postgresql.yaml" "initdb:"
    require_not_contains "$TEST_DIRECTORY/osmo-embedded-postgresql.yaml" "secret:"

    local embedded_deployment
    for embedded_deployment in agent api delayed-job-monitor gateway-authz logger router worker; do
        resource_document "$TEST_DIRECTORY/osmo-embedded.yaml" Deployment \
            "embedded-osmo-$embedded_deployment" \
            >"$TEST_DIRECTORY/osmo-embedded-$embedded_deployment.yaml"
        require_contains "$TEST_DIRECTORY/osmo-embedded-$embedded_deployment.yaml" \
            "embedded-osmo-pg-rw"
        require_contains "$TEST_DIRECTORY/osmo-embedded-$embedded_deployment.yaml" \
            "name: OSMO_POSTGRES_PASSWORD"
        require_contains "$TEST_DIRECTORY/osmo-embedded-$embedded_deployment.yaml" \
            "name: embedded-osmo-pg-app"
        require_contains "$TEST_DIRECTORY/osmo-embedded-$embedded_deployment.yaml" \
            "key: password"
        require_contains "$TEST_DIRECTORY/osmo-embedded-$embedded_deployment.yaml" \
            "name: PGSSLMODE"
        require_contains "$TEST_DIRECTORY/osmo-embedded-$embedded_deployment.yaml" \
            "value: verify-full"
        require_contains "$TEST_DIRECTORY/osmo-embedded-$embedded_deployment.yaml" \
            "name: PGSSLROOTCERT"
        require_contains "$TEST_DIRECTORY/osmo-embedded-$embedded_deployment.yaml" \
            "secretName: embedded-osmo-pg-ca"
        require_contains "$TEST_DIRECTORY/osmo-embedded-$embedded_deployment.yaml" \
            "/etc/osmo/ca/postgresql/ca.crt"
    done
    require_contains "$TEST_DIRECTORY/osmo-embedded-gateway-authz.yaml" \
        "--postgres-ssl-mode=verify-full"

    helm_template embedded-profile "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        >"$TEST_DIRECTORY/osmo-embedded-profile.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-profile.yaml" \
        "kind: Cluster"
    require_contains "$TEST_DIRECTORY/osmo-embedded-profile.yaml" \
        "name: embedded-profile-pg-app"

    helm_template combined-embedded "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret= \
        >"$TEST_DIRECTORY/osmo-combined-embedded.yaml"
    require_resource "$TEST_DIRECTORY/osmo-combined-embedded.yaml" Cluster \
        combined-embedded-pg
    require_deployment "$TEST_DIRECTORY/osmo-combined-embedded.yaml" \
        combined-embedded-valkey
    require_resource "$TEST_DIRECTORY/osmo-combined-embedded.yaml" Secret \
        combined-embedded-valkey-credentials
    resource_document "$TEST_DIRECTORY/osmo-combined-embedded.yaml" Deployment \
        combined-embedded-osmo-api \
        >"$TEST_DIRECTORY/osmo-combined-embedded-api.yaml"
    require_contains "$TEST_DIRECTORY/osmo-combined-embedded-api.yaml" \
        "- combined-embedded-pg-rw"
    require_contains "$TEST_DIRECTORY/osmo-combined-embedded-api.yaml" \
        "- combined-embedded-valkey"
    require_contains "$TEST_DIRECTORY/osmo-combined-embedded-api.yaml" \
        "name: combined-embedded-pg-app"
    require_contains "$TEST_DIRECTORY/osmo-combined-embedded-api.yaml" \
        "name: combined-embedded-valkey-credentials"

    helm_template embedded-existing "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.cluster.initdb.secret.name=embedded-postgresql-credentials \
        >"$TEST_DIRECTORY/osmo-embedded-existing.yaml"
    resource_document "$TEST_DIRECTORY/osmo-embedded-existing.yaml" Cluster \
        embedded-existing-pg >"$TEST_DIRECTORY/osmo-embedded-existing-postgresql.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-existing-postgresql.yaml" \
        "name: embedded-postgresql-credentials"
    resource_document "$TEST_DIRECTORY/osmo-embedded-existing.yaml" Deployment \
        embedded-existing-osmo-api >"$TEST_DIRECTORY/osmo-embedded-existing-api.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-existing-api.yaml" \
        "name: embedded-postgresql-credentials"
    require_contains "$TEST_DIRECTORY/osmo-embedded-existing-api.yaml" "key: password"

    helm_template embedded-scaled "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.cluster.instances=5 \
        >"$TEST_DIRECTORY/osmo-embedded-scaled.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-scaled.yaml" "instances: 5"
    require_contains "$TEST_DIRECTORY/osmo-embedded-scaled.yaml" \
        "embedded-scaled-pg-rw"

    helm_template embedded-named "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.fullnameOverride=custom-embedded-database \
        >"$TEST_DIRECTORY/osmo-embedded-named.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-named.yaml" \
        "name: custom-embedded-database"
    require_contains "$TEST_DIRECTORY/osmo-embedded-named.yaml" \
        "custom-embedded-database-rw"
    require_contains "$TEST_DIRECTORY/osmo-embedded-named.yaml" \
        "name: custom-embedded-database-app"
    require_contains "$TEST_DIRECTORY/osmo-embedded-named.yaml" \
        "secretName: custom-embedded-database-ca"

    helm_template embedded-name-override "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.nameOverride=custom-postgresql \
        >"$TEST_DIRECTORY/osmo-embedded-name-override.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-name-override.yaml" \
        "name: embedded-name-override-custom-postgresql"
    require_contains "$TEST_DIRECTORY/osmo-embedded-name-override.yaml" \
        "embedded-name-override-custom-postgresql-rw"
    require_contains "$TEST_DIRECTORY/osmo-embedded-name-override.yaml" \
        "secretName: embedded-name-override-custom-postgresql-ca"

    helm_template embedded-custom-ca "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.cluster.certificates.serverCASecret=custom-server-ca \
        --set postgresql.cluster.certificates.serverTLSSecret=custom-server-tls \
        >"$TEST_DIRECTORY/osmo-embedded-custom-ca.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-custom-ca.yaml" \
        "serverCASecret: custom-server-ca"
    require_contains "$TEST_DIRECTORY/osmo-embedded-custom-ca.yaml" \
        "serverTLSSecret: custom-server-tls"
    require_contains "$TEST_DIRECTORY/osmo-embedded-custom-ca.yaml" \
        "secretName: custom-server-ca"
    require_not_contains "$TEST_DIRECTORY/osmo-embedded-custom-ca.yaml" \
        "secretName: embedded-custom-ca-pg-ca"

    helm_template embedded-dev "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.cluster.instances=1 \
        --set postgresql.cluster.enablePDB=false \
        --set postgresql.cluster.postgresql.synchronous.number=0 \
        --set postgresql.cluster.postgresql.synchronous.dataDurability=preferred \
        >"$TEST_DIRECTORY/osmo-embedded-dev.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-dev.yaml" "instances: 1"
    require_contains "$TEST_DIRECTORY/osmo-embedded-dev.yaml" \
        "dataDurability: preferred"
    require_contains "$TEST_DIRECTORY/osmo-embedded-dev.yaml" \
        "enablePDB: false"
    require_contains "$TEST_DIRECTORY/osmo-embedded-dev.yaml" \
        "number: 0"

    resource_document "$rendered" Deployment osmo-agent \
        >"$TEST_DIRECTORY/osmo-agent.yaml"
    require_occurrences "$TEST_DIRECTORY/osmo-agent.yaml" "        ports:" 1
    require_contains "$TEST_DIRECTORY/osmo-agent.yaml" "- --redis_db_number"

    resource_document "$rendered" Deployment osmo-logger \
        >"$TEST_DIRECTORY/osmo-logger.yaml"
    require_occurrences "$TEST_DIRECTORY/osmo-logger.yaml" "        ports:" 1
    require_contains "$TEST_DIRECTORY/osmo-logger.yaml" "- --redis_db_number"

    helm_template review-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-review-values.yaml" \
        >"$TEST_DIRECTORY/osmo-review.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" 'value: "*docs"'
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" 'value: "&install"'
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" ConfigMap \
        review-release-osmo-api-config \
        >"$TEST_DIRECTORY/osmo-review-api-config.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-api-config.yaml" \
        "service_base_url: https://osmo.example.com"
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" Deployment \
        review-release-osmo-worker >"$TEST_DIRECTORY/osmo-review-worker.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-worker.yaml" \
        "topologyKey: worker-zone"
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" Deployment \
        review-release-osmo-delayed-job-monitor \
        >"$TEST_DIRECTORY/osmo-review-delayed-job-monitor.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-delayed-job-monitor.yaml" \
        "cpu: 321m"
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" Deployment \
        review-release-osmo-router >"$TEST_DIRECTORY/osmo-review-router.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-router.yaml" \
        "name: EMPTY_VALUE"
    require_contains "$TEST_DIRECTORY/osmo-review-router.yaml" 'value: ""'
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" Deployment \
        review-release-osmo-agent >"$TEST_DIRECTORY/osmo-review-agent.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-agent.yaml" \
        "serviceAccountName: review-release-osmo-agent"
    require_contains "$TEST_DIRECTORY/osmo-review-agent.yaml" \
        "path: /review-ready"
    require_contains "$TEST_DIRECTORY/osmo-review-agent.yaml" \
        "periodSeconds: 17"
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" ServiceAccount \
        review-release-osmo-agent \
        >"$TEST_DIRECTORY/osmo-review-agent-service-account.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-agent-service-account.yaml" \
        "name: review-release-osmo-agent"
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" Service \
        review-release-osmo-gateway \
        >"$TEST_DIRECTORY/osmo-review-gateway-service.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-gateway-service.yaml" \
        "type: ClusterIP"
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" \
        'value: "review-release-osmo-gateway:80"'
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" \
        "address: review-release-osmo-api"
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" \
        "address: review-release-osmo-router-headless"
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" \
        "address: review-release-osmo-ui"
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" \
        "address: review-release-osmo-agent"
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" \
        "address: review-release-osmo-logger-headless"
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" \
        "name: review-release-osmo-otel-monitor"
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" \
        "name: review-release-osmo-gateway-envoy-monitor"
    require_contains "$TEST_DIRECTORY/osmo-review.yaml" \
        "name: review-release-osmo-gateway-oauth2-proxy-monitor"
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" NetworkPolicy \
        review-release-osmo-gateway-allow-envoy-to-api \
        >"$TEST_DIRECTORY/osmo-review-service-network-policy.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-service-network-policy.yaml" \
        "app.kubernetes.io/component: api"
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" Deployment \
        review-release-osmo-gateway-oauth2-proxy \
        >"$TEST_DIRECTORY/osmo-review-oauth2-proxy.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-oauth2-proxy.yaml" \
        "name: OAUTH2_PROXY_REDIS_PASSWORD"
    require_contains "$TEST_DIRECTORY/osmo-review-oauth2-proxy.yaml" \
        "key: redis-password"
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" Deployment \
        review-release-osmo-gateway-ratelimit \
        >"$TEST_DIRECTORY/osmo-review-ratelimit.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-ratelimit.yaml" \
        "name: REDIS_AUTH"
    require_contains "$TEST_DIRECTORY/osmo-review-ratelimit.yaml" \
        'value: "false"'
    require_contains "$TEST_DIRECTORY/osmo-review-ratelimit.yaml" \
        'image: "docker.io/envoyproxy/ratelimit:875d418c"'
    helm_template authz-database "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set configuration.enabled=false \
        --set gateway.authz.enabled=true \
        >"$TEST_DIRECTORY/osmo-authz-database.yaml"
    resource_document "$TEST_DIRECTORY/osmo-authz-database.yaml" Deployment \
        authz-database-osmo-gateway-authz \
        >"$TEST_DIRECTORY/osmo-authz-database-deployment.yaml"
    require_contains "$TEST_DIRECTORY/osmo-authz-database-deployment.yaml" \
        "--postgres-ssl-mode=disable"
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" Ingress \
        review-release-osmo-gateway \
        >"$TEST_DIRECTORY/osmo-review-ingress.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-ingress.yaml" \
        "alb.ingress.kubernetes.io/backend-protocol: HTTPS"
    resource_document "$TEST_DIRECTORY/osmo-review.yaml" Deployment \
        review-release-osmo-api >"$TEST_DIRECTORY/osmo-review-api.yaml"
    require_contains "$TEST_DIRECTORY/osmo-review-api.yaml" "path: /health"
    require_not_contains "$TEST_DIRECTORY/osmo-review-api.yaml" "x-osmo-roles"

    helm_template osmo-system-ca "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-review-values.yaml" \
        --set externalDependencies.valkey.tls.enabled=true \
        --set configuration.enabled=false \
        >"$TEST_DIRECTORY/osmo-system-ca.yaml"
    resource_document "$TEST_DIRECTORY/osmo-system-ca.yaml" Deployment \
        osmo-system-ca-api >"$TEST_DIRECTORY/osmo-api-system-ca.yaml"
    require_contains "$TEST_DIRECTORY/osmo-api-system-ca.yaml" \
        "--redis_tls_enable"
    require_not_contains "$TEST_DIRECTORY/osmo-api-system-ca.yaml" \
        "name: SSL_CERT_FILE"
    require_not_contains "$TEST_DIRECTORY/osmo-api-system-ca.yaml" \
        "name: valkey-ca"
    resource_document "$TEST_DIRECTORY/osmo-system-ca.yaml" Deployment \
        osmo-system-ca-gateway-oauth2-proxy \
        >"$TEST_DIRECTORY/osmo-oauth2-proxy-system-ca.yaml"
    require_contains "$TEST_DIRECTORY/osmo-oauth2-proxy-system-ca.yaml" \
        "--redis-connection-url=rediss://external-valkey:6379/0"
    require_not_contains "$TEST_DIRECTORY/osmo-oauth2-proxy-system-ca.yaml" \
        "name: SSL_CERT_FILE"
    require_not_contains "$TEST_DIRECTORY/osmo-oauth2-proxy-system-ca.yaml" \
        "name: valkey-ca"
    resource_document "$TEST_DIRECTORY/osmo-system-ca.yaml" Deployment \
        osmo-system-ca-gateway-ratelimit \
        >"$TEST_DIRECTORY/osmo-ratelimit-system-ca.yaml"
    require_contains "$TEST_DIRECTORY/osmo-ratelimit-system-ca.yaml" \
        'value: "true"'
    require_not_contains "$TEST_DIRECTORY/osmo-ratelimit-system-ca.yaml" \
        "name: SSL_CERT_FILE"
    require_not_contains "$TEST_DIRECTORY/osmo-ratelimit-system-ca.yaml" \
        "name: valkey-ca"

    helm_template osmo-tls "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-review-values.yaml" \
        --set externalDependencies.postgresql.tls.enabled=true \
        --set externalDependencies.postgresql.tls.caExistingSecret=postgresql-ca \
        --set externalDependencies.valkey.tls.enabled=true \
        --set externalDependencies.valkey.tls.caExistingSecret=valkey-ca \
        --set configuration.enabled=false \
        --set gateway.authz.enabled=true \
        >"$TEST_DIRECTORY/osmo-tls.yaml"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "secretName: postgresql-ca"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "secretName: valkey-ca"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "name: PGSSLROOTCERT"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "/etc/osmo/ca/postgresql/ca.crt"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "name: SSL_CERT_FILE"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "/etc/osmo/ca/valkey/ca-bundle.crt"
    require_contains "$TEST_DIRECTORY/osmo-tls.yaml" "key: ca-bundle.crt"
    resource_document "$TEST_DIRECTORY/osmo-tls.yaml" Deployment \
        osmo-tls-router >"$TEST_DIRECTORY/osmo-router-tls.yaml"
    require_contains "$TEST_DIRECTORY/osmo-router-tls.yaml" \
        "/etc/osmo/ca/postgresql/ca.crt"
    require_contains "$TEST_DIRECTORY/osmo-router-tls.yaml" \
        "/etc/osmo/ca/valkey/ca-bundle.crt"
    resource_document "$TEST_DIRECTORY/osmo-tls.yaml" Deployment \
        osmo-tls-gateway-authz >"$TEST_DIRECTORY/osmo-authz-tls.yaml"
    require_contains "$TEST_DIRECTORY/osmo-authz-tls.yaml" "secretName: postgresql-ca"
    require_contains "$TEST_DIRECTORY/osmo-authz-tls.yaml" "/etc/osmo/ca/postgresql"
    require_contains "$TEST_DIRECTORY/osmo-authz-tls.yaml" \
        "--postgres-ssl-mode=verify-full"
    resource_document "$TEST_DIRECTORY/osmo-tls.yaml" Deployment \
        osmo-tls-gateway-oauth2-proxy \
        >"$TEST_DIRECTORY/osmo-oauth2-proxy-tls.yaml"
    require_contains "$TEST_DIRECTORY/osmo-oauth2-proxy-tls.yaml" \
        "--redis-connection-url=rediss://external-valkey:6379/0"
    require_contains "$TEST_DIRECTORY/osmo-oauth2-proxy-tls.yaml" \
        "name: SSL_CERT_FILE"
    require_contains "$TEST_DIRECTORY/osmo-oauth2-proxy-tls.yaml" \
        "/etc/osmo/ca/valkey/ca-bundle.crt"
    require_contains "$TEST_DIRECTORY/osmo-oauth2-proxy-tls.yaml" \
        "secretName: valkey-ca"
    resource_document "$TEST_DIRECTORY/osmo-tls.yaml" Deployment \
        osmo-tls-gateway-ratelimit \
        >"$TEST_DIRECTORY/osmo-ratelimit-tls.yaml"
    require_contains "$TEST_DIRECTORY/osmo-ratelimit-tls.yaml" \
        "name: SSL_CERT_FILE"
    require_contains "$TEST_DIRECTORY/osmo-ratelimit-tls.yaml" \
        "/etc/osmo/ca/valkey/ca-bundle.crt"
    require_contains "$TEST_DIRECTORY/osmo-ratelimit-tls.yaml" \
        "secretName: valkey-ca"

    helm_template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-mcp-values.yaml" \
        --set commonLabels.team=platform \
        --set-string 'podDefaults.nodeSelector.kubernetes\.io/os=linux' \
        >"$TEST_DIRECTORY/osmo-mcp.yaml"
    require_deployment "$TEST_DIRECTORY/osmo-mcp.yaml" "osmo-mcp"
    require_deployment "$TEST_DIRECTORY/osmo-mcp.yaml" "osmo-gateway-authz"
    require_contains "$TEST_DIRECTORY/osmo-mcp.yaml" "path: /mcp"
    require_contains "$TEST_DIRECTORY/osmo-mcp.yaml" \
        '\"resource\":\"https://osmo.example.com/mcp\"'
    require_contains "$TEST_DIRECTORY/osmo-mcp.yaml" \
        "issuer: https://issuer.example.com"
    require_contains "$TEST_DIRECTORY/osmo-mcp.yaml" \
        "uri: https://issuer.example.com/.well-known/jwks.json"
    require_contains "$TEST_DIRECTORY/osmo-mcp.yaml" \
        "image: nvcr.io/nvidia/osmo/mcp-self-hosted:6.3.1"
    require_occurrences "$TEST_DIRECTORY/osmo-mcp.yaml" \
        "kubernetes.io/os: linux" 10

    helm_template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set commonLabels.team=platform \
        --set-string 'podDefaults.nodeSelector.kubernetes\.io/os=linux' \
        --set services.worker.image.repository=nvidia/osmo/custom-worker \
        --set services.worker.image.tag=test-tag \
        --set services.logger.enabled=false \
        >"$TEST_DIRECTORY/osmo-overrides.yaml"
    require_contains "$TEST_DIRECTORY/osmo-overrides.yaml" \
        "nvcr.io/nvidia/osmo/custom-worker:test-tag"
    require_contains "$TEST_DIRECTORY/osmo-overrides.yaml" "team: platform"
    require_contains "$TEST_DIRECTORY/osmo-overrides.yaml" "kubernetes.io/os: linux"
    require_no_deployment "$TEST_DIRECTORY/osmo-overrides.yaml" "osmo-logger"

    helm_template scaling-disabled "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.api.autoscaling.enabled=false \
        --set services.api.replicas=4 \
        >"$TEST_DIRECTORY/osmo-scaling-disabled.yaml"
    resource_document "$TEST_DIRECTORY/osmo-scaling-disabled.yaml" Deployment \
        scaling-disabled-osmo-api \
        >"$TEST_DIRECTORY/osmo-scaling-disabled-api.yaml"
    require_contains "$TEST_DIRECTORY/osmo-scaling-disabled-api.yaml" \
        "replicas: 4"
    if resource_document "$TEST_DIRECTORY/osmo-scaling-disabled.yaml" \
        HorizontalPodAutoscaler scaling-disabled-osmo-api \
        >"$TEST_DIRECTORY/osmo-scaling-disabled-api-hpa.yaml" 2>/dev/null; then
        fail "did not expect HorizontalPodAutoscaler/scaling-disabled-osmo-api"
    fi

    helm_template scaling-enabled "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.api.autoscaling.enabled=true \
        --set services.api.autoscaling.behavior.scaleDown.stabilizationWindowSeconds=300 \
        >"$TEST_DIRECTORY/osmo-scaling-enabled.yaml"
    resource_document "$TEST_DIRECTORY/osmo-scaling-enabled.yaml" \
        HorizontalPodAutoscaler scaling-enabled-osmo-api \
        >"$TEST_DIRECTORY/osmo-scaling-enabled-api-hpa.yaml"
    require_contains "$TEST_DIRECTORY/osmo-scaling-enabled-api-hpa.yaml" \
        "stabilizationWindowSeconds: 300"
    resource_document "$TEST_DIRECTORY/osmo-scaling-enabled.yaml" Deployment \
        scaling-enabled-osmo-api \
        >"$TEST_DIRECTORY/osmo-scaling-enabled-api.yaml"
    require_not_contains "$TEST_DIRECTORY/osmo-scaling-enabled-api.yaml" \
        "replicas:"

    if helm_template scaling-without-cpu-request "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.api.autoscaling.enabled=true \
        --set services.api.resources.requests.memory=256Mi \
        --set-string services.api.resources.requests.cpu= \
        >"$TEST_DIRECTORY/scaling-without-cpu-request.out" 2>&1; then
        fail "expected API CPU autoscaling without a CPU request to fail"
    fi
    require_contains "$TEST_DIRECTORY/scaling-without-cpu-request.out" \
        "services.api autoscaling CPU target requires resources.requests.cpu"

    if helm_template scaling-without-memory-request "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.worker.autoscaling.enabled=true \
        --set services.worker.resources.requests.cpu=100m \
        --set-string services.worker.resources.requests.memory= \
        >"$TEST_DIRECTORY/scaling-without-memory-request.out" 2>&1; then
        fail "expected worker memory autoscaling without a memory request to fail"
    fi
    require_contains "$TEST_DIRECTORY/scaling-without-memory-request.out" \
        "services.worker autoscaling memory target requires resources.requests.memory"

    helm_template workload-policy "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-workload-policy-values.yaml" \
        >"$TEST_DIRECTORY/osmo-workload-policy.yaml"
    resource_document "$TEST_DIRECTORY/osmo-workload-policy.yaml" Deployment \
        workload-policy-osmo-api \
        >"$TEST_DIRECTORY/osmo-workload-policy-api.yaml"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "type: Recreate"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "terminationGracePeriodSeconds: 75"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "seccompProfile:"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "type: RuntimeDefault"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "fsGroup: 2000"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "runAsGroup: 2001"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "readOnlyRootFilesystem: true"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "runAsUser: 4321"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "nodeAffinity:"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "podAntiAffinity:"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api.yaml" \
        "automountServiceAccountToken: true"
    resource_document "$TEST_DIRECTORY/osmo-workload-policy.yaml" ServiceAccount \
        workload-policy-osmo-api \
        >"$TEST_DIRECTORY/osmo-workload-policy-api-service-account.yaml"
    require_contains \
        "$TEST_DIRECTORY/osmo-workload-policy-api-service-account.yaml" \
        "automountServiceAccountToken: true"

    resource_document "$TEST_DIRECTORY/osmo-workload-policy.yaml" Deployment \
        workload-policy-osmo-worker \
        >"$TEST_DIRECTORY/osmo-workload-policy-worker.yaml"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-worker.yaml" \
        "terminationGracePeriodSeconds: 45"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-worker.yaml" \
        "runAsUser: 1234"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-worker.yaml" \
        "automountServiceAccountToken: false"

    resource_document "$TEST_DIRECTORY/osmo-workload-policy.yaml" Deployment \
        workload-policy-osmo-ui \
        >"$TEST_DIRECTORY/osmo-workload-policy-ui.yaml"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-ui.yaml" \
        "serviceAccountName: default"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-ui.yaml" \
        "automountServiceAccountToken: false"
    require_occurrences "$TEST_DIRECTORY/osmo-workload-policy.yaml" \
        "type: RuntimeDefault" 10

    resource_document "$TEST_DIRECTORY/osmo-workload-policy.yaml" \
        PodDisruptionBudget workload-policy-osmo-api \
        >"$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml" \
        "maxUnavailable: 1"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml" \
        "unhealthyPodEvictionPolicy: AlwaysAllow"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml" \
        "futureSpecField: forwarded"
    require_not_contains "$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml" \
        "user-supplied-selector"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml" \
        "policy-owner: platform"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml" \
        "policy.example.com/reason: api-availability"
    require_occurrences "$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml" \
        "app.kubernetes.io/managed-by:" 1
    require_occurrences "$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml" \
        "app.kubernetes.io/component: api" 2
    require_occurrences "$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml" \
        "app.kubernetes.io/instance: workload-policy" 2
    require_occurrences "$TEST_DIRECTORY/osmo-workload-policy-api-pdb.yaml" \
        "app.kubernetes.io/name: osmo" 2

    resource_document "$TEST_DIRECTORY/osmo-workload-policy.yaml" \
        PodDisruptionBudget workload-policy-osmo-worker \
        >"$TEST_DIRECTORY/osmo-workload-policy-worker-pdb.yaml"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-worker-pdb.yaml" \
        "minAvailable: 1"
    require_contains "$TEST_DIRECTORY/osmo-workload-policy-worker-pdb.yaml" \
        "unhealthyPodEvictionPolicy: IfHealthyBudget"

    helm_template monitoring "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-monitoring-values.yaml" \
        >"$TEST_DIRECTORY/osmo-monitoring.yaml"
    require_resource_metadata_annotation "$TEST_DIRECTORY/osmo-monitoring.yaml" \
        "platform.example.com/owner"
    resource_document "$TEST_DIRECTORY/osmo-monitoring.yaml" PodMonitor \
        monitoring-osmo-otel-monitor \
        >"$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "prometheus: platform"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "platform.example.com/owner: monitor"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "interval: 99s"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "scrapeTimeout: 88s"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "scheme: https"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "insecureSkipVerify: true"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "honorLabels: true"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "podTargetLabels:"
    require_occurrences "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "  targetLabels:" 0
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "targetLabel: cluster"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "replacement: osmo-test"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-pod-monitor.yaml" \
        "regex: unwanted_metric"

    resource_document "$TEST_DIRECTORY/osmo-monitoring.yaml" Ingress \
        monitoring-osmo-gateway \
        >"$TEST_DIRECTORY/osmo-monitoring-ingress.yaml"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-ingress.yaml" \
        "platform.example.com/owner: edge"
    resource_document "$TEST_DIRECTORY/osmo-monitoring.yaml" Deployment \
        monitoring-osmo-api \
        >"$TEST_DIRECTORY/osmo-monitoring-api.yaml"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-api.yaml" \
        "platform.example.com/owner: common"
    require_contains "$TEST_DIRECTORY/osmo-monitoring-api.yaml" \
        "platform.example.com/owner: pod"
    resource_document "$TEST_DIRECTORY/osmo-monitoring.yaml" Deployment \
        monitoring-osmo-gateway-envoy \
        >"$TEST_DIRECTORY/osmo-monitoring-envoy.yaml"
    pod_template_annotations "$TEST_DIRECTORY/osmo-monitoring-envoy.yaml" \
        >"$TEST_DIRECTORY/osmo-monitoring-envoy-pod-annotations.yaml"
    require_occurrences \
        "$TEST_DIRECTORY/osmo-monitoring-envoy-pod-annotations.yaml" \
        "checksum/envoy-config:" 1
    require_not_contains \
        "$TEST_DIRECTORY/osmo-monitoring-envoy-pod-annotations.yaml" \
        "checksum/envoy-config: wrong"

    helm_template monitoring-defaults "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-monitoring-values.yaml" \
        >"$TEST_DIRECTORY/osmo-monitoring-defaults.yaml"
    require_resource_metadata_annotation \
        "$TEST_DIRECTORY/osmo-monitoring-defaults.yaml" \
        "platform.example.com/owner"

    helm_template monitoring-mcp "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-mcp-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-monitoring-values.yaml" \
        >"$TEST_DIRECTORY/osmo-monitoring-mcp.yaml"
    require_resource_metadata_annotation \
        "$TEST_DIRECTORY/osmo-monitoring-mcp.yaml" \
        "platform.example.com/owner"

    helm_template image-defaults "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        >"$TEST_DIRECTORY/osmo-image-defaults.yaml"
    require_contains "$TEST_DIRECTORY/osmo-image-defaults.yaml" \
        "image: nvcr.io/nvidia/osmo/service:6.3.1"
    require_contains "$TEST_DIRECTORY/osmo-image-defaults.yaml" \
        "image: nvcr.io/nvidia/osmo/web-ui:6.3.1"
    require_contains "$TEST_DIRECTORY/osmo-image-defaults.yaml" \
        "image: nvcr.io/nvidia/osmo/worker:6.3.1"
    require_contains "$TEST_DIRECTORY/osmo-image-defaults.yaml" \
        "image: nvcr.io/nvidia/osmo/router:6.3.1"
    require_contains "$TEST_DIRECTORY/osmo-image-defaults.yaml" \
        "image: nvcr.io/nvidia/osmo/logger:6.3.1"
    require_contains "$TEST_DIRECTORY/osmo-image-defaults.yaml" \
        "image: nvcr.io/nvidia/osmo/agent:6.3.1"
    require_contains "$TEST_DIRECTORY/osmo-image-defaults.yaml" \
        "image: nvcr.io/nvidia/osmo/delayed-job-monitor:6.3.1"
    require_contains "$TEST_DIRECTORY/osmo-image-defaults.yaml" \
        "image: nvcr.io/nvidia/osmo/authz-sidecar:6.3.1"
    require_contains "$TEST_DIRECTORY/osmo-image-defaults.yaml" \
        'image: "docker.io/envoyproxy/envoy:v1.38.1"'
    require_contains "$TEST_DIRECTORY/osmo-image-defaults.yaml" \
        'image: "quay.io/oauth2-proxy/oauth2-proxy:v7.14.2"'

    helm_template image-mirror "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set imageRegistry=mirror.example.com \
        --set imagePullSecrets[0].name=mirror-secret \
        >"$TEST_DIRECTORY/osmo-image-mirror.yaml"
    require_contains "$TEST_DIRECTORY/osmo-image-mirror.yaml" \
        "image: mirror.example.com/nvidia/osmo/service:6.3.1"
    require_contains "$TEST_DIRECTORY/osmo-image-mirror.yaml" \
        'image: "mirror.example.com/envoyproxy/envoy:v1.38.1"'
    require_contains "$TEST_DIRECTORY/osmo-image-mirror.yaml" \
        'image: "mirror.example.com/oauth2-proxy/oauth2-proxy:v7.14.2"'
    require_contains "$TEST_DIRECTORY/osmo-image-mirror.yaml" \
        "- mirror.example.com/nvidia/osmo"
    require_contains "$TEST_DIRECTORY/osmo-image-mirror.yaml" \
        "name: mirror-secret"

    helm_template embedded-image-pull-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.valkey.enabled=true \
        --set-string externalDependencies.valkey.host= \
        --set secrets.valkey.generate=true \
        --set-string secrets.valkey.existingSecret= \
        --set imageRegistry=osmo-mirror.example.com \
        --set valkey.image.registry=valkey-mirror.example.com \
        --set imagePullSecrets[0].name=osmo-mirror-secret \
        --set valkey.imagePullSecrets[0]=valkey-mirror-secret \
        >"$TEST_DIRECTORY/osmo-embedded-image-pull-secret.yaml"
    resource_document "$TEST_DIRECTORY/osmo-embedded-image-pull-secret.yaml" \
        Deployment embedded-image-pull-secret-osmo-api \
        >"$TEST_DIRECTORY/osmo-api-image-pull-secret.yaml"
    require_contains "$TEST_DIRECTORY/osmo-api-image-pull-secret.yaml" \
        "name: osmo-mirror-secret"
    require_contains "$TEST_DIRECTORY/osmo-api-image-pull-secret.yaml" \
        "image: osmo-mirror.example.com/nvidia/osmo/service:6.3.1"
    require_not_contains "$TEST_DIRECTORY/osmo-api-image-pull-secret.yaml" \
        "valkey-mirror.example.com"
    require_not_contains "$TEST_DIRECTORY/osmo-api-image-pull-secret.yaml" \
        "name: valkey-mirror-secret"
    resource_document "$TEST_DIRECTORY/osmo-embedded-image-pull-secret.yaml" \
        Deployment embedded-image-pull-secret-valkey \
        >"$TEST_DIRECTORY/osmo-valkey-image-pull-secret.yaml"
    require_contains "$TEST_DIRECTORY/osmo-valkey-image-pull-secret.yaml" \
        "name: valkey-mirror-secret"
    require_contains "$TEST_DIRECTORY/osmo-valkey-image-pull-secret.yaml" \
        "image: valkey-mirror.example.com/valkey/valkey:9.1.1"
    require_not_contains "$TEST_DIRECTORY/osmo-valkey-image-pull-secret.yaml" \
        "osmo-mirror.example.com"
    require_not_contains "$TEST_DIRECTORY/osmo-valkey-image-pull-secret.yaml" \
        "name: osmo-mirror-secret"

    if helm_template invalid-image-pull-secret-scalar "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set imagePullSecrets[0]=mirror-secret \
        >"$TEST_DIRECTORY/invalid-image-pull-secret-scalar.out" 2>&1; then
        fail "expected scalar imagePullSecrets entry to fail schema validation"
    fi
    require_schema_path "$TEST_DIRECTORY/invalid-image-pull-secret-scalar.out" \
        "imagePullSecrets.0"

    if helm_template invalid-image-pull-secret-name "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set imagePullSecrets[0].unexpected=mirror-secret \
        >"$TEST_DIRECTORY/invalid-image-pull-secret-name.out" 2>&1; then
        fail "expected imagePullSecrets entry without name to fail schema validation"
    fi
    require_schema_path "$TEST_DIRECTORY/invalid-image-pull-secret-name.out" \
        "imagePullSecrets.0"

    helm_template image-component "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.worker.image.registry=registry.example.com \
        --set services.worker.image.repository=custom/team/worker \
        --set services.worker.image.tag=v2 \
        >"$TEST_DIRECTORY/osmo-image-component.yaml"
    require_contains "$TEST_DIRECTORY/osmo-image-component.yaml" \
        "image: registry.example.com/custom/team/worker:v2"

    helm_template image-digest "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.worker.image.tag=ignored \
        --set-string services.worker.image.digest=sha256:0123456789abcdef \
        >"$TEST_DIRECTORY/osmo-image-digest.yaml"
    require_contains "$TEST_DIRECTORY/osmo-image-digest.yaml" \
        "image: nvcr.io/nvidia/osmo/worker@sha256:0123456789abcdef"
    require_not_contains "$TEST_DIRECTORY/osmo-image-digest.yaml" \
        "worker:ignored"

    helm_template unknown-root "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set unsupportedRoot.enabled=true \
        >"$TEST_DIRECTORY/unknown-root.yaml"
    require_deployment "$TEST_DIRECTORY/unknown-root.yaml" "unknown-root-osmo-api"

    helm_template unknown-nested "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.worker.typo=true \
        --set services.worker.image.typo=true \
        --set gateway.envoy.service.loadBalancerIP=192.0.2.1 \
        >"$TEST_DIRECTORY/unknown-nested.yaml"
    require_deployment "$TEST_DIRECTORY/unknown-nested.yaml" \
        "unknown-nested-osmo-worker"

    if helm_template invalid-pdb "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.api.podDisruptionBudget.enabled=true \
        --set services.api.podDisruptionBudget.minAvailable=1 \
        --set services.api.podDisruptionBudget.maxUnavailable=1 \
        >"$TEST_DIRECTORY/invalid-pdb.out" 2>&1; then
        fail "expected a PDB with both availability fields to fail"
    fi
    require_contains "$TEST_DIRECTORY/invalid-pdb.out" \
        "services.api.podDisruptionBudget cannot set both minAvailable and maxUnavailable"

    if helm_template unsupported-compute "$charts_copy/osmo" \
        --set planes.compute.enabled=true \
        >"$TEST_DIRECTORY/unsupported-compute.out" 2>&1; then
        fail "expected planes.compute.enabled=true to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-compute.out" \
        "compute plane is not implemented"

    if helm_template missing-cnpg-operator "$charts_copy/osmo" \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        >"$TEST_DIRECTORY/missing-cnpg-operator.out" 2>&1; then
        fail "expected embedded PostgreSQL without the CloudNativePG API to fail"
    fi
    require_contains "$TEST_DIRECTORY/missing-cnpg-operator.out" \
        "install a compatible CloudNativePG operator"

    if helm_template embedded-external-host "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set externalDependencies.postgresql.host=unexpected-postgresql \
        >"$TEST_DIRECTORY/embedded-external-host.out" 2>&1; then
        fail "expected an external PostgreSQL host in embedded mode to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-external-host.out" \
        "externalDependencies.postgresql.host must be empty"

    if helm_template embedded-other-namespace "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.namespaceOverride=another-namespace \
        >"$TEST_DIRECTORY/embedded-other-namespace.out" 2>&1; then
        fail "expected embedded PostgreSQL in another namespace to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-other-namespace.out" \
        "postgresql.namespaceOverride must be empty"

    if helm_template embedded-postgresql-recovery "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.mode=recovery \
        >"$TEST_DIRECTORY/embedded-postgresql-recovery.out" 2>&1; then
        fail "expected embedded PostgreSQL recovery mode to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-postgresql-recovery.out" \
        "postgresql.mode"
    require_contains "$TEST_DIRECTORY/embedded-postgresql-recovery.out" \
        "standalone"

    if helm_template embedded-postgresql-replica "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.mode=replica \
        --set postgresql.replica.bootstrap.source=pg_basebackup \
        >"$TEST_DIRECTORY/embedded-postgresql-replica.out" 2>&1; then
        fail "expected embedded PostgreSQL replica mode to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-postgresql-replica.out" \
        "postgresql.mode"
    require_contains "$TEST_DIRECTORY/embedded-postgresql-replica.out" \
        "standalone"

    if helm_template embedded-postgresql-server-tls-only "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.cluster.certificates.serverTLSSecret=custom-server-tls \
        >"$TEST_DIRECTORY/embedded-postgresql-server-tls-only.out" 2>&1; then
        fail "expected embedded PostgreSQL server TLS without a CA Secret to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-postgresql-server-tls-only.out" \
        "serverCASecret is required"

    if helm_template embedded-too-small "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.cluster.instances=1 \
        --set postgresql.cluster.postgresql.synchronous.number=0 \
        --set postgresql.cluster.postgresql.synchronous.dataDurability=required \
        >"$TEST_DIRECTORY/embedded-too-small.out" 2>&1; then
        fail "expected required synchronous replication with one instance to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-too-small.out" \
        "required synchronous replication needs at least 2 instances"

    if helm_template embedded-external-secret "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set secrets.postgresql.existingSecret=external-only-secret \
        >"$TEST_DIRECTORY/embedded-external-secret.out" 2>&1; then
        fail "expected external PostgreSQL Secret to fail in embedded mode"
    fi
    require_contains "$TEST_DIRECTORY/embedded-external-secret.out" \
        "secrets.postgresql.existingSecret must be empty when embedded PostgreSQL is enabled"
    require_contains "$TEST_DIRECTORY/embedded-external-secret.out" \
        "postgresql.cluster.initdb.secret.name"

    if helm_template embedded-backups "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.backups.enabled=true \
        --set postgresql.backups.s3.region=us-east-1 \
        --set postgresql.backups.s3.bucket=test-backups \
        --set postgresql.backups.s3.accessKey=test-access \
        --set postgresql.backups.s3.secretKey=test-secret \
        >"$TEST_DIRECTORY/embedded-backups.out" 2>&1; then
        fail "expected the deferred embedded backup surface to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-backups.out" \
        "embedded backup and restore are not supported"

    if helm_template embedded-wal-archiver "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set postgresql.cluster.plugins[0].name=test-wal-archiver \
        --set postgresql.cluster.plugins[0].enabled=true \
        --set postgresql.cluster.plugins[0].isWALArchiver=true \
        >"$TEST_DIRECTORY/embedded-wal-archiver.out" 2>&1; then
        fail "expected an enabled embedded WAL archiver plugin to fail"
    fi
    require_contains "$TEST_DIRECTORY/embedded-wal-archiver.out" \
        "postgresql.cluster.plugins: embedded WAL archiver plugins are not supported"

    if helm_template invalid-postgresql-instances "$charts_copy/osmo" \
        --api-versions postgresql.cnpg.io/v1 \
        -f "$CHARTS_ROOT/osmo/tests/control-embedded-values.yaml" \
        --set-string postgresql.cluster.instances=invalid \
        >"$TEST_DIRECTORY/invalid-postgresql-instances.out" 2>&1; then
        fail "expected non-integer postgresql.cluster.instances to fail schema validation"
    fi
    require_contains "$TEST_DIRECTORY/invalid-postgresql-instances.out" "instances"
    require_contains "$TEST_DIRECTORY/invalid-postgresql-instances.out" "integer"

    if helm_template unsupported-legacy-values "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set controlPlane.enabled=true \
        >"$TEST_DIRECTORY/unsupported-legacy-values.out" 2>&1; then
        fail "expected legacy controlPlane values to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-legacy-values.out" \
        "controlPlane"

    if helm_template invalid-replicas "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set-string services.worker.replicas=invalid \
        >"$TEST_DIRECTORY/invalid-replicas.out" 2>&1; then
        fail "expected non-integer services.worker.replicas to fail schema validation"
    fi
    require_contains "$TEST_DIRECTORY/invalid-replicas.out" "replicas"
    require_contains "$TEST_DIRECTORY/invalid-replicas.out" "integer"

    if helm_template invalid-mcp-timeout "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-mcp-values.yaml" \
        --set services.mcp.requestTimeoutSeconds=61 \
        >"$TEST_DIRECTORY/invalid-mcp-timeout.out" 2>&1; then
        fail "expected services.mcp.requestTimeoutSeconds=61 to fail schema validation"
    fi
    require_contains "$TEST_DIRECTORY/invalid-mcp-timeout.out" \
        "requestTimeoutSeconds"
    require_contains "$TEST_DIRECTORY/invalid-mcp-timeout.out" "60"

    local invalid_service_value
    local invalid_service_property
    while IFS='|' read -r invalid_service_value invalid_service_property; do
        if helm_template invalid-gateway-service "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            --set "$invalid_service_value" \
            >"$TEST_DIRECTORY/invalid-gateway-service.out" 2>&1; then
            fail "expected invalid $invalid_service_value to fail schema validation"
        fi
        require_schema_path "$TEST_DIRECTORY/invalid-gateway-service.out" \
            "$invalid_service_property"
    done <<'EOF'
gateway.envoy.service.type=ExternalName|gateway.envoy.service.type
gateway.envoy.service.port=0|gateway.envoy.service.port
gateway.envoy.service.nodePort=65536|gateway.envoy.service.nodePort
gateway.envoy.service.externalTrafficPolicy=Nearest|gateway.envoy.service.externalTrafficPolicy
EOF

    if helm_template invalid-ingress "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set ingress.enabled=true \
        >"$TEST_DIRECTORY/invalid-ingress.out" 2>&1; then
        fail "expected ingress.enabled=true without hostname to fail"
    fi
    require_contains "$TEST_DIRECTORY/invalid-ingress.out" \
        "ingress.hostname is required when ingress.enabled=true"

    if helm_template invalid-httproute "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set httproute.enabled=true \
        >"$TEST_DIRECTORY/invalid-httproute.out" 2>&1; then
        fail "expected httproute.enabled=true without parentRefs to fail"
    fi
    require_contains "$TEST_DIRECTORY/invalid-httproute.out" \
        "httproute.parentRefs requires at least one entry when httproute.enabled=true"

    if helm_template dangling-ingress "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.envoy.enabled=false \
        --set ingress.enabled=true \
        --set ingress.hostname=osmo.example.com \
        >"$TEST_DIRECTORY/dangling-ingress.out" 2>&1; then
        fail "expected ingress.enabled=true with Envoy disabled to fail"
    fi
    require_contains "$TEST_DIRECTORY/dangling-ingress.out" \
        "ingress.enabled=true requires gateway.envoy.enabled=true"

    if helm_template dangling-httproute "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.envoy.enabled=false \
        --set httproute.enabled=true \
        --set httproute.parentRefs[0].name=shared-gateway \
        >"$TEST_DIRECTORY/dangling-httproute.out" 2>&1; then
        fail "expected httproute.enabled=true with Envoy disabled to fail"
    fi
    require_contains "$TEST_DIRECTORY/dangling-httproute.out" \
        "httproute.enabled=true requires gateway.envoy.enabled=true"

    local invalid_external_url
    for invalid_external_url in \
        " " \
        " https://osmo.example.com" \
        "osmo.example.com" \
        "ftp://osmo.example.com" \
        "https:///missing-host" \
        "https://osmo.example.com/bad path" \
        "https://osmo.example.com/foo\"bar" \
        "https://osmo.example.com/<bad>" \
        "https://osmo.example.com/{bad}" \
        "https://osmo.example.com/%ZZ" \
        "https://osmo.example.com/foo|bar" \
        "https://osmo.example.com/foo\\\\bar" \
        "https://osmo.example.com:65536/base" \
        "https://osmo.example.com?next=/base" \
        "https://osmo.example.com#base" \
        "https://[2001:db8::1]:8443/osmo/"; do
        if helm_template invalid-external-url "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            --set-string "externalUrl=$invalid_external_url" \
            >"$TEST_DIRECTORY/invalid-external-url.out" 2>&1; then
            fail "expected invalid externalUrl '$invalid_external_url' to fail"
        fi
        require_contains "$TEST_DIRECTORY/invalid-external-url.out" "externalUrl"
    done

    local required_value
    local expected_message
    while IFS='|' read -r required_value expected_message; do
        if helm_template missing-required "$charts_copy/osmo" \
            -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
            -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
            --set-string "$required_value=" \
            >"$TEST_DIRECTORY/missing-required.out" 2>&1; then
            fail "expected empty $required_value to fail"
        fi
        require_contains "$TEST_DIRECTORY/missing-required.out" "$expected_message"
    done <<'EOF'
externalUrl|externalUrl is required
externalDependencies.objectStorage.buckets.workflows|buckets.workflows is required
externalDependencies.objectStorage.buckets.logs|buckets.logs is required
externalDependencies.objectStorage.buckets.apps|buckets.apps is required
EOF

    cat >"$charts_copy/osmo/templates/test-notes.yaml" <<'EOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: rendered-notes
data:
  notes: |-
{{ include "osmo.notes" . | indent 4 }}
EOF
    helm_template notes-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.envoy.service.port=8443 \
        --set gateway.envoy.ssl.enabled=true \
        >"$TEST_DIRECTORY/osmo-notes.yaml"
    resource_document "$TEST_DIRECTORY/osmo-notes.yaml" ConfigMap rendered-notes \
        >"$TEST_DIRECTORY/osmo-notes-configmap.yaml"
    require_contains "$TEST_DIRECTORY/osmo-notes-configmap.yaml" \
        "service/notes-release-osmo-gateway 8080:8443"
    require_contains "$TEST_DIRECTORY/osmo-notes-configmap.yaml" \
        "local-only TLS check"
    require_contains "$TEST_DIRECTORY/osmo-notes-configmap.yaml" \
        "curl --insecure https://127.0.0.1:8080/api/version"

    helm_template notes-http-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.envoy.ssl.enabled=false \
        >"$TEST_DIRECTORY/osmo-http-notes.yaml"
    resource_document "$TEST_DIRECTORY/osmo-http-notes.yaml" ConfigMap rendered-notes \
        >"$TEST_DIRECTORY/osmo-http-notes-configmap.yaml"
    require_contains "$TEST_DIRECTORY/osmo-http-notes-configmap.yaml" \
        "curl http://127.0.0.1:8080/api/version"
    require_not_contains "$TEST_DIRECTORY/osmo-http-notes-configmap.yaml" \
        "--insecure"

    helm_template notes-embedded-release "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        -f "$CHARTS_ROOT/osmo/embedded-rustfs-ha-values.yaml" \
        >"$TEST_DIRECTORY/osmo-embedded-notes.yaml"
    resource_document "$TEST_DIRECTORY/osmo-embedded-notes.yaml" ConfigMap \
        rendered-notes >"$TEST_DIRECTORY/osmo-embedded-notes-configmap.yaml"
    require_contains "$TEST_DIRECTORY/osmo-embedded-notes-configmap.yaml" \
        "http://notes-embedded-release-rustfs-svc:9000"
    require_contains "$TEST_DIRECTORY/osmo-embedded-notes-configmap.yaml" \
        "osmo-rustfs-credentials"
    require_contains "$TEST_DIRECTORY/osmo-embedded-notes-configmap.yaml" \
        "PersistentVolumeClaims are retained"
    require_contains "$TEST_DIRECTORY/osmo-embedded-notes-configmap.yaml" \
        "restore the matching credential Secret"
    require_contains "$TEST_DIRECTORY/osmo-embedded-notes-configmap.yaml" \
        "kubectl get deployment,statefulset,pod,pvc,job"
    require_contains "$TEST_DIRECTORY/osmo-embedded-notes-configmap.yaml" \
        "service/notes-embedded-release-osmo-gateway 8080:80"

}

case "$MODE" in
    osmo|all)
        test_yaml_helpers
        require_clean_osmo_sources
        test_control_umbrella
        ;;
    *)
        fail "unknown test mode: $MODE"
        ;;
esac

echo "PASS: OSMO Helm chart tests ($MODE)"
