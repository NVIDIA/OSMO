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

for required_command in awk grep helm tar; do
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

require_clean_osmo_sources() {
    require_not_contains "$CHARTS_ROOT/osmo/Chart.yaml" "dependencies:"
    [[ ! -e "$CHARTS_ROOT/osmo/Chart.lock" ]] || fail "osmo must not have a dependency lock"
    [[ ! -d "$CHARTS_ROOT/osmo/charts" ]] || fail "osmo must not contain packaged dependencies"
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
    rm -rf "$charts_copy/osmo/charts"
    rm -f "$charts_copy/osmo/Chart.lock"

    if ! helm lint "$charts_copy/osmo" >"$TEST_DIRECTORY/osmo-lint.out" 2>&1; then
        cat "$TEST_DIRECTORY/osmo-lint.out" >&2
        fail "expected chart defaults to pass helm lint"
    fi

    helm package "$charts_copy/osmo" --destination "$TEST_DIRECTORY" >/dev/null
    tar -tzf "$TEST_DIRECTORY/osmo-0.1.0.tgz" >"$TEST_DIRECTORY/osmo-package.txt"
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "osmo/tests/"
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "osmo/migrations/"
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "/migration-job.yaml"

    helm_template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        >"$rendered"

    require_deployment "$rendered" "osmo-api"
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

    helm_template osmo-tls "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
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
        --set global.imageRegistry=mirror.example.com \
        --set global.imagePullSecrets[0].name=mirror-secret \
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

    if helm_template unsupported-embedded "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set embeddedDependencies.postgresql.enabled=true \
        >"$TEST_DIRECTORY/unsupported-embedded.out" 2>&1; then
        fail "expected embeddedDependencies.postgresql.enabled=true to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-embedded.out" \
        "embedded PostgreSQL is not implemented"

    if helm_template unsupported-generated-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set secrets.postgresql.generate=true \
        >"$TEST_DIRECTORY/unsupported-generated-secret.out" 2>&1; then
        fail "expected secrets.postgresql.generate=true to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-generated-secret.out" \
        "generated Secrets are not implemented"

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
