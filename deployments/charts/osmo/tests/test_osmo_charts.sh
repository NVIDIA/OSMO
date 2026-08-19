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
            gsub(/^"|"$/, "", document_name)
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
        ! compgen -G "$charts_copy/osmo/charts/cluster-0.8.0.tgz" >/dev/null; then
        helm dependency build "$charts_copy/osmo" >/dev/null
    fi

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
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "osmo/tests/"
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "osmo/migrations/"
    require_not_contains "$TEST_DIRECTORY/osmo-package.txt" "/migration-job.yaml"

    helm_template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        >"$rendered"

    resource_document "$rendered" List osmo-internal-tls-bootstrap \
        >"$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml"
    require_contains "$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml" \
        'command: ["internal-tls-bootstrap"]'
    require_contains "$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml" \
        'verbs: ["get", "update"]'
    require_contains "$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml" \
        'resourceNames:'
    require_contains "$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml" \
        'activeDeadlineSeconds: 300'
    require_contains "$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml" \
        'ttlSecondsAfterFinished: 300'
    require_contains "$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml" \
        'nodeSelector:'
    require_contains "$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml" \
        'tolerations:'
    require_contains "$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml" \
        'seccompProfile:'
    require_not_contains "$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml" \
        'hook-failed'
    require_contains "$CHARTS_ROOT/SECRET_ROTATION.md" 'chart_kind=service'
    require_contains "$CHARTS_ROOT/SECRET_ROTATION.md" \
        '"$osmo_fullname-api"'
    require_contains "$CHARTS_ROOT/SECRET_ROTATION.md" \
        '"$osmo_fullname-gateway-envoy"'
    if [[ $(grep -c -- '--consumer-deployment' \
            "$TEST_DIRECTORY/osmo-internal-tls-bootstrap.yaml") -ne 5 ]]; then
        fail 'generated TLS hook does not verify every consumer Deployment'
    fi
    require_not_contains "$rendered" '--ssl_self_signed'
    local tls_placeholder
    for tls_placeholder in \
        osmo-internal-tls-ca osmo-internal-tls-trust \
        osmo-internal-tls-api osmo-internal-tls-router \
        osmo-internal-tls-agent osmo-internal-tls-logger; do
        resource_document "$rendered" Secret "$tls_placeholder" \
            >"$TEST_DIRECTORY/$tls_placeholder.yaml"
        if grep -Eq '^(data|stringData):' \
                "$TEST_DIRECTORY/$tls_placeholder.yaml"; then
            fail "generated TLS placeholder $tls_placeholder contains key material"
        fi
        require_contains "$TEST_DIRECTORY/$tls_placeholder.yaml" 'type: Opaque'
    done
    helm_template tlsmcp "$charts_copy/osmo" --is-upgrade \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.mcp.enabled=true \
        --set gateway.authz.enabled=true \
        --set-string services.mcp.resourceUrl=https://osmo.example.com/mcp \
        --set-string 'services.mcp.authorizationServers[0]=https://login.example.com' \
        --set-string 'services.mcp.scopes[0]=mcp.read' \
        --set-string 'gateway.envoy.jwt.providers[0].issuer=https://login.example.com' \
        --set-string 'gateway.envoy.jwt.providers[0].audience=https://osmo.example.com/mcp' \
        --set-string 'gateway.envoy.jwt.providers[0].jwks_uri=https://login.example.com/keys' \
        --set-string 'gateway.envoy.jwt.providers[0].cluster=osmo-api' \
        >"$TEST_DIRECTORY/osmo-tls-mcp-upgrade.yaml"
    resource_document "$TEST_DIRECTORY/osmo-tls-mcp-upgrade.yaml" Secret \
        tlsmcp-osmo-internal-tls-mcp \
        >"$TEST_DIRECTORY/osmo-tls-mcp-upgrade-placeholder.yaml"
    require_contains "$TEST_DIRECTORY/osmo-tls-mcp-upgrade-placeholder.yaml" \
        'helm.sh/hook: pre-install,pre-upgrade'
    if grep -Eq '^(data|stringData):' \
            "$TEST_DIRECTORY/osmo-tls-mcp-upgrade-placeholder.yaml"; then
        fail 'MCP TLS upgrade placeholder contains key material'
    fi
    local upstream_identity
    for upstream_identity in \
            osmo-api osmo-router-headless osmo-agent osmo-logger-headless; do
        require_contains "$rendered" 'match_typed_subject_alt_names:'
        require_contains "$rendered" "exact: \"$upstream_identity\""
    done

    helm_template existingtls "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.tls.generated.enabled=false \
        --set gateway.tls.caSecret=operator-trust \
        --set gateway.tls.upstreamCerts.api=operator-api-tls \
        --set gateway.tls.upstreamCerts.router=operator-router-tls \
        --set gateway.tls.upstreamCerts.agent=operator-agent-tls \
        --set gateway.tls.upstreamCerts.logger=operator-logger-tls \
        >"$TEST_DIRECTORY/osmo-existing-internal-tls.yaml"
    require_contains "$TEST_DIRECTORY/osmo-existing-internal-tls.yaml" \
        'secretName: "operator-trust"'
    require_contains "$TEST_DIRECTORY/osmo-existing-internal-tls.yaml" \
        'secretName: "operator-api-tls"'
    if resource_document "$TEST_DIRECTORY/osmo-existing-internal-tls.yaml" \
            List existingtls-osmo-internal-tls-bootstrap >/dev/null 2>&1; then
        fail 'existing internal TLS mode rendered a Secret mutator'
    fi

    if helm_template mixed-internal-tls "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.tls.caSecret=operator-trust \
        >"$TEST_DIRECTORY/mixed-internal-tls.out" 2>&1; then
        fail 'expected mixed generated and existing internal TLS to fail'
    fi
    require_contains "$TEST_DIRECTORY/mixed-internal-tls.out" \
        'cannot be combined with caSecret or upstreamCerts'

    if helm_template missing-ca-rotation-id "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.tls.generated.caRotation.phase=prepare \
        >"$TEST_DIRECTORY/missing-ca-rotation-id.out" 2>&1; then
        fail 'expected generated CA prepare without a rotation id to fail'
    fi
    require_contains "$TEST_DIRECTORY/missing-ca-rotation-id.out" \
        'caRotation.id is required'

    if helm_template unfrozen-ca-rotation "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set-string gateway.tls.generated.caRotation.id=ca-test \
        --set gateway.tls.generated.caRotation.phase=prepare \
        >"$TEST_DIRECTORY/unfrozen-ca-rotation.out" 2>&1; then
        fail 'expected CA prepare without frozen consumer HPAs to fail'
    fi
    require_contains "$TEST_DIRECTORY/unfrozen-ca-rotation.out" \
        'freezeHpas must be true'

    helm_template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set-string gateway.tls.generated.caRotation.id=ca-test \
        --set gateway.tls.generated.caRotation.phase=prepare \
        --set gateway.tls.generated.caRotation.freezeHpas=true \
        >"$TEST_DIRECTORY/frozen-ca-rotation.yaml"
    local hpa hpa_document minimum maximum
    for hpa in osmo-api osmo-router osmo-agent osmo-logger osmo-gateway-envoy; do
        hpa_document=$(resource_document \
            "$TEST_DIRECTORY/frozen-ca-rotation.yaml" \
            HorizontalPodAutoscaler "$hpa")
        minimum=$(awk '$1 == "minReplicas:" { print $2 }' <<<"$hpa_document")
        maximum=$(awk '$1 == "maxReplicas:" { print $2 }' <<<"$hpa_document")
        if [[ -z "$minimum" || "$minimum" != "$maximum" ]]; then
            fail "CA rotation did not freeze HorizontalPodAutoscaler/$hpa"
        fi
    done

    helm_template generated-oauth-cookie "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.oauth2Proxy.enabled=true \
        --set secrets.oauthClientSecret.existingSecret=operator-oauth-client \
        --set secrets.oauthCookieSecret.generate=true \
        --set-string secrets.oauthCookieSecret.existingSecret= \
        >"$TEST_DIRECTORY/generated-oauth-cookie.yaml"
    resource_document "$TEST_DIRECTORY/generated-oauth-cookie.yaml" Secret \
        generated-oauth-cookie-osmo-oauth-cookie \
        >"$TEST_DIRECTORY/generated-oauth-cookie-placeholder.yaml"
    if grep -Eq '^(data|stringData):' \
            "$TEST_DIRECTORY/generated-oauth-cookie-placeholder.yaml"; then
        fail 'generated OAuth cookie placeholder contains key material'
    fi
    resource_document "$TEST_DIRECTORY/generated-oauth-cookie.yaml" List \
        generated-oauth-cookie-osmo-oauth-cookie-bootstrap \
        >"$TEST_DIRECTORY/generated-oauth-cookie-bootstrap.yaml"
    require_contains "$TEST_DIRECTORY/generated-oauth-cookie-bootstrap.yaml" \
        'resourceNames: ["generated-oauth-cookie-osmo-oauth-cookie"]'
    require_contains "$TEST_DIRECTORY/generated-oauth-cookie-bootstrap.yaml" \
        'verbs: ["get", "patch"]'
    bash -n "$charts_copy/osmo/files/oauth-cookie-bootstrap.sh"

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
    local mek_component
    for mek_component in api worker router logger agent delayed-job-monitor; do
        resource_document "$rendered" Deployment "osmo-$mek_component" \
            >"$TEST_DIRECTORY/mek-$mek_component-deployment.yaml"
        require_contains "$TEST_DIRECTORY/mek-$mek_component-deployment.yaml" \
            "app.kubernetes.io/instance: osmo"
    done
    require_not_contains "$rendered" "osmo.nvidia.com/mek-consumer"

    helm_template mek-adoption-hpas "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.api.autoscaling.enabled=true \
        --set services.worker.autoscaling.enabled=true \
        --set services.router.autoscaling.enabled=true \
        --set services.logger.autoscaling.enabled=true \
        --set services.agent.autoscaling.enabled=true \
        >"$TEST_DIRECTORY/mek-adoption-hpas.yaml"
    for mek_component in api worker router logger agent; do
        resource_document "$TEST_DIRECTORY/mek-adoption-hpas.yaml" \
            HorizontalPodAutoscaler "mek-adoption-hpas-osmo-$mek_component" \
            >"$TEST_DIRECTORY/mek-$mek_component-hpa.yaml"
        require_contains "$TEST_DIRECTORY/mek-$mek_component-hpa.yaml" \
            "app.kubernetes.io/instance: mek-adoption-hpas"
    done
    require_contains "$CHARTS_ROOT/osmo/README.md" \
        "app.kubernetes.io/instance=<release>,app.kubernetes.io/component in (api,worker,router,logger,agent,delayed-job-monitor)"
    require_contains "$CHARTS_ROOT/osmo/README.md" \
        'kubectl delete horizontalpodautoscaler'
    require_contains "$CHARTS_ROOT/osmo/README.md" 'kubectl wait pod'
    require_contains "$CHARTS_ROOT/osmo/README.md" 'set -euo pipefail'
    require_contains "$CHARTS_ROOT/osmo/README.md" 'remaining=$(kubectl get pod'
    if bash -c 'set -euo pipefail; kubectl() { return 1; }; remaining=$(kubectl get pod); test -z "$remaining"'; then
        fail "MEK adoption runbook would ignore a kubectl get failure"
    fi
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
    require_contains "$rendered" 'secretName: "external-object-storage-secret"'
    require_contains "$rendered" 'secretName: "external-master-encryption-key-secret"'
    require_occurrences "$rendered" 'secretName: "external-master-encryption-key-secret"' 6
    require_occurrences "$rendered" 'key: "keyring.yaml"' 6
    require_occurrences "$rendered" 'mountPath: "/opt/osmo/mek"' 6
    require_occurrences "$rendered" "name: OSMO_POD_UID" 6
    require_occurrences "$rendered" "name: OSMO_MEK_CONSUMER" 6
    require_occurrences "$rendered" "name: OSMO_ALLOW_EXISTING_MEK_ADOPTION" 6
    require_not_contains "$rendered" "subPath: mek.yaml"
    require_not_contains "$rendered" "app.kubernetes.io/component: mek-bootstrap"

    helm_template bootstrap-osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set secrets.masterEncryptionKey.bootstrap.enabled=true \
        >"$TEST_DIRECTORY/mek-bootstrap.yaml"
    resource_document "$TEST_DIRECTORY/mek-bootstrap.yaml" List \
        bootstrap-osmo-mek-bootstrap \
        >"$TEST_DIRECTORY/mek-bootstrap-list.yaml"
    resource_document "$TEST_DIRECTORY/mek-bootstrap.yaml" ConfigMap \
        bootstrap-osmo-mek-bootstrap-diagnostic \
        >"$TEST_DIRECTORY/mek-bootstrap-diagnostic.yaml"
    resource_document "$TEST_DIRECTORY/mek-bootstrap.yaml" Secret \
        external-master-encryption-key-secret \
        >"$TEST_DIRECTORY/mek-bootstrap-placeholder.yaml"
    require_contains "$TEST_DIRECTORY/mek-bootstrap-placeholder.yaml" \
        'osmo.nvidia.com/mek-bootstrap-placeholder: "true"'
    if grep -Eq '^(data|stringData):' \
            "$TEST_DIRECTORY/mek-bootstrap-placeholder.yaml"; then
        fail 'MEK bootstrap placeholder must not contain key material'
    fi
    require_contains "$TEST_DIRECTORY/mek-bootstrap-list.yaml" \
        'image: "alpine/kubectl:1.33.4"'
    require_contains "$TEST_DIRECTORY/mek-bootstrap-list.yaml" \
        '--from-file="$secret_key=$temporary_directory/mek.yaml"'
    require_contains "$TEST_DIRECTORY/mek-bootstrap-list.yaml" \
        '- "external-master-encryption-key-secret"'
    require_contains "$TEST_DIRECTORY/mek-bootstrap-list.yaml" '- "keyring.yaml"'
    require_contains "$TEST_DIRECTORY/mek-bootstrap-list.yaml" \
        'resourceNames: ["external-master-encryption-key-secret"]'
    require_contains "$TEST_DIRECTORY/mek-bootstrap-list.yaml" \
        'verbs: ["get", "patch"]'
    require_not_contains "$TEST_DIRECTORY/mek-bootstrap-list.yaml" '"create"'
    require_contains "$TEST_DIRECTORY/mek-bootstrap-list.yaml" 'kind: Job'
    require_contains "$TEST_DIRECTORY/mek-bootstrap-list.yaml" \
        'activeDeadlineSeconds: 120'
    require_contains "$TEST_DIRECTORY/mek-bootstrap-list.yaml" 'kind: RoleBinding'
    local role_binding_line
    local job_line
    role_binding_line=$(grep -n 'kind: RoleBinding' \
        "$TEST_DIRECTORY/mek-bootstrap-list.yaml" | cut -d: -f1)
    job_line=$(grep -n 'kind: Job' "$TEST_DIRECTORY/mek-bootstrap-list.yaml" \
        | cut -d: -f1)
    if [[ "$role_binding_line" -ge "$job_line" ]]; then
        fail 'MEK bootstrap RoleBinding must precede the Job'
    fi
    require_contains "$TEST_DIRECTORY/mek-bootstrap-diagnostic.yaml" \
        'privileged resources were removed'

    helm_template bootstrap-osmo-upgrade "$charts_copy/osmo" \
        --is-upgrade \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set secrets.masterEncryptionKey.bootstrap.enabled=true \
        >"$TEST_DIRECTORY/mek-bootstrap-upgrade.yaml"
    require_contains "$TEST_DIRECTORY/mek-bootstrap-upgrade.yaml" \
        '--fail-if-missing'
    resource_document "$TEST_DIRECTORY/mek-bootstrap-upgrade.yaml" List \
        bootstrap-osmo-upgrade-mek-bootstrap \
        >"$TEST_DIRECTORY/mek-bootstrap-upgrade-list.yaml"
    require_occurrences "$TEST_DIRECTORY/mek-bootstrap-upgrade-list.yaml" \
        'hook-delete-policy: before-hook-creation,hook-succeeded,hook-failed' 1
    require_occurrences "$TEST_DIRECTORY/mek-bootstrap-upgrade.yaml" \
        'mek-bootstrap-placeholder' 1
    resource_document "$TEST_DIRECTORY/mek-bootstrap-upgrade.yaml" ConfigMap \
        bootstrap-osmo-upgrade-mek-bootstrap-diagnostic \
        >"$TEST_DIRECTORY/mek-bootstrap-upgrade-diagnostic.yaml"
    require_not_contains "$TEST_DIRECTORY/mek-bootstrap-upgrade-diagnostic.yaml" \
        'hook-failed'
    bash -n "$charts_copy/osmo/files/mek-bootstrap.sh"

    helm_template mek-string-sentinels "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set-string secrets.masterEncryptionKey.existingSecret.name=true \
        --set-string secrets.masterEncryptionKey.existingSecret.key=null \
        >"$TEST_DIRECTORY/mek-string-sentinels.yaml"
    require_occurrences "$TEST_DIRECTORY/mek-string-sentinels.yaml" \
        'secretName: "true"' 6
    require_occurrences "$TEST_DIRECTORY/mek-string-sentinels.yaml" 'key: "null"' 6
    require_occurrences "$TEST_DIRECTORY/mek-string-sentinels.yaml" 'path: "mek.yaml"' 6
    require_occurrences "$TEST_DIRECTORY/mek-string-sentinels.yaml" \
        'mountPath: "/opt/osmo/mek"' 6
    require_occurrences "$TEST_DIRECTORY/mek-string-sentinels.yaml" \
        '- "/opt/osmo/mek/mek.yaml"' 6

    if helm_template invalid-mek-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set-string secrets.masterEncryptionKey.existingSecret=legacy-secret \
        >"$TEST_DIRECTORY/invalid-mek-secret.out" 2>&1; then
        fail "expected legacy scalar MEK existingSecret to fail schema validation"
    fi
    require_schema_path "$TEST_DIRECTORY/invalid-mek-secret.out" \
        "secrets.masterEncryptionKey.existingSecret"
    if helm_template invalid-mek-bootstrap "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set-string secrets.masterEncryptionKey.bootstrap.imagePullPolicy=Sometimes \
        >"$TEST_DIRECTORY/invalid-mek-bootstrap.out" 2>&1; then
        fail "expected invalid MEK bootstrap imagePullPolicy to fail schema validation"
    fi
    require_schema_path "$TEST_DIRECTORY/invalid-mek-bootstrap.out" \
        "secrets.masterEncryptionKey.bootstrap.imagePullPolicy"
    require_contains "$rendered" 'key: "object-storage.yaml"'
    if awk '
        /^---[[:space:]]*$/ { secret = 0 }
        /^kind: Secret$/ { secret = 1 }
        secret && /^(data|stringData):$/ { found = 1 }
        END { exit !found }
    ' "$rendered"; then
        fail 'Helm rendered Secret material into release state'
    fi
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
        --set secrets.oauthClientSecret.existingSecret=oauth-client \
        --set secrets.oauthCookieSecret.existingSecret=oauth-cookie \
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
        --set secrets.oauthClientSecret.existingSecret=oauth-client \
        --set secrets.oauthCookieSecret.existingSecret=oauth-cookie \
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

    helm_template secret-rollout "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set secrets.postgresql.rolloutNonce=postgres-v2 \
        --set secrets.valkey.rolloutNonce=valkey-v2 \
        --set secrets.objectStorage.rolloutNonce=storage-v2 \
        --set secrets.defaultAdmin.rolloutNonce=admin-v2 \
        >"$TEST_DIRECTORY/osmo-secret-rollout.yaml"
    require_occurrences "$TEST_DIRECTORY/osmo-secret-rollout.yaml" \
        'osmo.nvidia.com/postgresql-secret-rollout: "postgres-v2"' 6
    require_occurrences "$TEST_DIRECTORY/osmo-secret-rollout.yaml" \
        'osmo.nvidia.com/valkey-secret-rollout: "valkey-v2"' 6
    require_occurrences "$TEST_DIRECTORY/osmo-secret-rollout.yaml" \
        'osmo.nvidia.com/object-storage-secret-rollout: "storage-v2"' 6
    require_occurrences "$TEST_DIRECTORY/osmo-secret-rollout.yaml" \
        'osmo.nvidia.com/default-admin-secret-rollout: "admin-v2"' 1
    require_not_contains "$TEST_DIRECTORY/osmo-secret-rollout.yaml" \
        "osmo.nvidia.com/mek-secret-rollout"

    helm_template oauth-secret-rollout "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.oauth2Proxy.enabled=true \
        --set secrets.oauthClientSecret.existingSecret=oauth-client \
        --set secrets.oauthClientSecret.rolloutNonce=client-v2 \
        --set secrets.oauthCookieSecret.existingSecret=oauth-cookie \
        --set secrets.oauthCookieSecret.rolloutNonce=cookie-v2 \
        >"$TEST_DIRECTORY/osmo-oauth-secret-rollout.yaml"
    resource_document "$TEST_DIRECTORY/osmo-oauth-secret-rollout.yaml" Deployment \
        oauth-secret-rollout-osmo-gateway-oauth2-proxy \
        >"$TEST_DIRECTORY/osmo-oauth-secret-rollout-deployment.yaml"
    require_contains "$TEST_DIRECTORY/osmo-oauth-secret-rollout-deployment.yaml" \
        'osmo.nvidia.com/oauth-client-secret-rollout: "client-v2"'
    require_contains "$TEST_DIRECTORY/osmo-oauth-secret-rollout-deployment.yaml" \
        'osmo.nvidia.com/oauth-cookie-secret-rollout: "cookie-v2"'
    require_not_contains "$TEST_DIRECTORY/osmo-oauth-secret-rollout-deployment.yaml" \
        "osmo.nvidia.com/mek-secret-rollout"

    helm_template backend-token-existing "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.backendApiTokens.enabled=true \
        --set services.backendApiTokens.rolloutNonce=backend-v2 \
        --set services.backendApiTokens.credentials[0].name=default \
        --set services.backendApiTokens.credentials[0].existingSecret.name=backend-token \
        >"$TEST_DIRECTORY/osmo-backend-token-existing.yaml"
    resource_document "$TEST_DIRECTORY/osmo-backend-token-existing.yaml" Deployment \
        backend-token-existing-osmo-api \
        >"$TEST_DIRECTORY/osmo-backend-token-api.yaml"
    require_contains "$TEST_DIRECTORY/osmo-backend-token-api.yaml" \
        "--backend_token_directory"
    require_contains "$TEST_DIRECTORY/osmo-backend-token-api.yaml" \
        "/etc/osmo/backend-tokens/default"
    require_contains "$TEST_DIRECTORY/osmo-backend-token-api.yaml" \
        'secretName: "backend-token"'
    require_contains "$TEST_DIRECTORY/osmo-backend-token-api.yaml" \
        'osmo.nvidia.com/backend-token-rollout: "backend-v2"'
    require_not_contains "$TEST_DIRECTORY/osmo-backend-token-existing.yaml" \
        "backend-token-bootstrap"
    require_not_contains "$TEST_DIRECTORY/osmo-backend-token-existing.yaml" \
        'resourceNames: ["backend-token"]'
    if resource_document "$TEST_DIRECTORY/osmo-backend-token-existing.yaml" \
            Secret backend-token >/dev/null 2>&1; then
        fail 'backend existing-Secret mode rendered the credential Secret'
    fi

    if helm_template unsupported-managed-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set services.backendApiTokens.enabled=true \
        --set services.backendApiTokens.credentials[0].name=development \
        --set services.backendApiTokens.credentials[0].managedSecret.name=backend-token-dev \
        >"$TEST_DIRECTORY/unsupported-managed-secret.out" 2>&1; then
        fail "expected chart-managed backend Secret configuration to fail"
    fi

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
    require_contains "$TEST_DIRECTORY/osmo-review-oauth2-proxy.yaml" \
        'secretName: "oauth-client"'
    require_contains "$TEST_DIRECTORY/osmo-review-oauth2-proxy.yaml" \
        'secretName: "oauth-cookie"'
    require_contains "$TEST_DIRECTORY/osmo-review-oauth2-proxy.yaml" \
        'key: "client_secret"'
    require_contains "$TEST_DIRECTORY/osmo-review-oauth2-proxy.yaml" \
        'key: "cookie_secret"'
    require_contains "$TEST_DIRECTORY/osmo-review-oauth2-proxy.yaml" \
        "mountPath: /etc/oauth2-proxy/client-secret"
    require_contains "$TEST_DIRECTORY/osmo-review-oauth2-proxy.yaml" \
        "mountPath: /etc/oauth2-proxy/cookie-secret"

    helm_template quoted-secret-scalars "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.oauth2Proxy.enabled=true \
        --set-string secrets.objectStorage.keys.credentials=null \
        --set-string secrets.oauthClientSecret.existingSecret=true \
        --set-string secrets.oauthClientSecret.keys.value=false \
        --set-string secrets.oauthCookieSecret.existingSecret=null \
        --set-string secrets.oauthCookieSecret.keys.value=true \
        >"$TEST_DIRECTORY/osmo-quoted-secret-scalars.yaml"
    require_contains "$TEST_DIRECTORY/osmo-quoted-secret-scalars.yaml" \
        'secretName: "true"'
    require_contains "$TEST_DIRECTORY/osmo-quoted-secret-scalars.yaml" \
        'secretName: "null"'
    require_contains "$TEST_DIRECTORY/osmo-quoted-secret-scalars.yaml" \
        'key: "false"'
    require_contains "$TEST_DIRECTORY/osmo-quoted-secret-scalars.yaml" \
        'key: "true"'
    require_contains "$TEST_DIRECTORY/osmo-quoted-secret-scalars.yaml" \
        'key: "null"'
    require_contains "$TEST_DIRECTORY/osmo-quoted-secret-scalars.yaml" \
        'path: "null"'
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
        "kubernetes.io/os: linux" 11

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
        --set secrets.oauthClientSecret.existingSecret=oauth-client \
        --set secrets.oauthCookieSecret.existingSecret=oauth-cookie \
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
        "type: RuntimeDefault" 11

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
        --set secrets.oauthClientSecret.existingSecret=oauth-client \
        --set secrets.oauthCookieSecret.existingSecret=oauth-cookie \
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
        --set secrets.oauthClientSecret.existingSecret=oauth-client \
        --set secrets.oauthCookieSecret.existingSecret=oauth-cookie \
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

    if helm_template unsupported-generated-oauth-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set secrets.oauthClientSecret.generate=true \
        >"$TEST_DIRECTORY/unsupported-generated-oauth-secret.out" 2>&1; then
        fail "expected secrets.oauthClientSecret.generate=true to fail"
    fi
    require_schema_path "$TEST_DIRECTORY/unsupported-generated-oauth-secret.out" \
        "secrets.oauthClientSecret"

    if helm_template missing-oauth-client-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.oauth2Proxy.enabled=true \
        --set-string secrets.oauthClientSecret.existingSecret= \
        --set-string secrets.oauthCookieSecret.existingSecret= \
        >"$TEST_DIRECTORY/missing-oauth-client-secret.out" 2>&1; then
        fail "expected an enabled OAuth2 proxy without credential Secrets to fail"
    fi
    require_contains "$TEST_DIRECTORY/missing-oauth-client-secret.out" \
        "secrets.oauthClientSecret.existingSecret is required when the OAuth2 proxy is enabled"

    if helm_template legacy-oauth-secret-values "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set gateway.oauth2Proxy.secretName=legacy-oauth \
        >"$TEST_DIRECTORY/legacy-oauth-secret-values.out" 2>&1; then
        fail "expected legacy OAuth Secret values to fail"
    fi
    require_contains "$TEST_DIRECTORY/legacy-oauth-secret-values.out" \
        "gateway.oauth2Proxy legacy Secret values are not supported"

    if helm_template untyped-postgresql-secret "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$CHARTS_ROOT/osmo/tests/control-external-values.yaml" \
        --set-string secrets.postgresql.inlinePassword=do-not-render \
        >"$TEST_DIRECTORY/untyped-postgresql-secret.out" 2>&1; then
        fail "expected an inline PostgreSQL password field to fail schema validation"
    fi
    require_not_contains "$TEST_DIRECTORY/untyped-postgresql-secret.out" "do-not-render"

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
