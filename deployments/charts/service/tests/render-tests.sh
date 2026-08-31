#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

resource_document() {
    local rendered=$1
    local kind=$2
    local name=$3
    awk -v kind="$kind" -v name="$name" '
        function reset() { document = ""; document_kind = ""; document_name = ""; metadata = 0 }
        function finish() {
            if (document_kind == kind && document_name == name) {
                printf "%s", document
                found = 1
            }
        }
        BEGIN { found = 0; reset() }
        /^---[[:space:]]*$/ { finish(); reset(); next }
        { document = document $0 ORS }
        /^kind: / { document_kind = $0; sub(/^kind: /, "", document_kind); next }
        /^metadata:$/ { metadata = 1; next }
        metadata && /^  name: / {
            document_name = $0
            sub(/^  name: /, "", document_name)
            gsub(/^"|"$/, "", document_name)
            metadata = 0
        }
        END { finish(); if (!found) exit 1 }
    ' <<<"$rendered"
}

helm_args=(
    --namespace osmo
    --set 'services.backendApiTokens.enabled=true'
)

managed_render=$(helm template managed-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].managedSecret.name=agent-token')
grep -q '^kind: Job$' <<<"$managed_render"
grep -q 'image: "alpine/kubectl:1.33.4"' <<<"$managed_render"
grep -q -- '--from-file=token=/dev/stdin' <<<"$managed_render"
if grep -q 'backend_token_bootstrap' <<<"$managed_render"; then
    echo 'Managed backend credential still uses the service bootstrap binary' >&2
    exit 1
fi
if grep -q '^kind: Secret$' <<<"$managed_render"; then
    echo 'Managed backend credential rendered secret material' >&2
    exit 1
fi

existing_render=$(helm template existing-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].existingSecret.name=existing-token')
if grep -q 'backend_token_bootstrap' <<<"$existing_render"; then
    echo 'Existing backend credential unexpectedly rendered a bootstrap hook' >&2
    exit 1
fi
grep -q 'secretName: "existing-token"' <<<"$existing_render"

legacy_render=$(helm template legacy-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].secretName=legacy-token')
grep -q 'secretName: "legacy-token"' <<<"$legacy_render"

if helm template invalid "$CHART_DIR" "${helm_args[@]}" \
        --set 'services.backendApiTokens.credentials[0].name=default' \
        --set 'services.backendApiTokens.credentials[0].existingSecret.name=one' \
        --set 'services.backendApiTokens.credentials[0].managedSecret.name=two' \
        >/dev/null 2>&1; then
    echo 'Conflicting backend credential sources were accepted' >&2
    exit 1
fi

multiple_render=$(helm template multiple-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=one' \
    --set 'services.backendApiTokens.credentials[0].managedSecret.name=token-one' \
    --set 'services.backendApiTokens.credentials[1].name=two' \
    --set 'services.backendApiTokens.credentials[1].managedSecret.name=token-two')
if [[ $(grep -c -- '^        - --secret-name$' <<<"$multiple_render") -ne 2 ]]; then
    echo 'Multiple managed backend credentials were not passed to the hook' >&2
    exit 1
fi

upgrade_render=$(helm template upgrade-test "$CHART_DIR" "${helm_args[@]}" \
    --is-upgrade \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].managedSecret.name=agent-token')
grep -q -- '--fail-if-missing' <<<"$upgrade_render"
if [[ $(grep -c 'hook-failed' <<<"$upgrade_render") -ne 3 ]]; then
    echo 'Bootstrap RBAC hooks do not clean up after failure' >&2
    exit 1
fi
if grep -A8 '^kind: Job$' <<<"$upgrade_render" | grep -q 'hook-failed'; then
    echo 'Failed bootstrap Job would be deleted before diagnosis' >&2
    exit 1
fi

bash -n "$CHART_DIR/files/backend-token-bootstrap.sh"
bash "$CHART_DIR/tests/backend-token-bootstrap-tests.sh"

mek_bootstrap_render=$(helm template mek-bootstrap "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set 'services.masterEncryptionKey.existingSecret.key=keyring.yaml')
if grep -q '^kind: Lease$\|^kind: Secret$' <<<"$mek_bootstrap_render"; then
    echo 'MEK bootstrap rendered mutable lifecycle state into Helm desired state' >&2
    exit 1
fi
grep -q 'command: \["mek-lifecycle"\]' <<<"$mek_bootstrap_render"
grep -A1 -- '- --operation' <<<"$mek_bootstrap_render" | grep -q -- '- "bootstrap"'
grep -q 'resourceNames: \["test-mek"\]' <<<"$mek_bootstrap_render"
grep -q 'verbs: \["create"\]' <<<"$mek_bootstrap_render"
grep -q 'runAsUser: 1001' <<<"$mek_bootstrap_render"
mek_bootstrap_name=$(awk '/^kind: Job$/{job=1; next} job && /^  name:/{gsub(/"/,"",$2); print $2; exit}' \
    <<<"$mek_bootstrap_render")
mek_bootstrap_changed=$(helm template mek-bootstrap "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true' \
    --set 'services.masterEncryptionKey.bootstrap.activeDeadlineSeconds=899' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set 'services.masterEncryptionKey.existingSecret.key=keyring.yaml')
mek_bootstrap_changed_name=$(awk '/^kind: Job$/{job=1; next} job && /^  name:/{gsub(/"/,"",$2); print $2; exit}' \
    <<<"$mek_bootstrap_changed")
if [[ "$mek_bootstrap_name" == "$mek_bootstrap_changed_name" ]]; then
    echo 'MEK bootstrap immutable template change reused a completed Job name' >&2
    exit 1
fi
mek_bootstrap_retry=$(helm template mek-bootstrap "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true' \
    --set-string 'services.masterEncryptionKey.bootstrap.attempt=2' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set 'services.masterEncryptionKey.existingSecret.key=keyring.yaml')
mek_bootstrap_retry_name=$(awk '/^kind: Job$/{job=1; next} job && /^  name:/{gsub(/"/,"",$2); print $2; exit}' \
    <<<"$mek_bootstrap_retry")
if [[ "$mek_bootstrap_name" == "$mek_bootstrap_retry_name" ]]; then
    echo 'MEK bootstrap attempt did not create a new GitOps retry Job name' >&2
    exit 1
fi
mek_bootstrap_password_one=$(helm template mek-bootstrap "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set-string 'services.postgres.password=credential-sentinel-one')
mek_bootstrap_password_two=$(helm template mek-bootstrap "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set-string 'services.postgres.password=credential-sentinel-two')
mek_bootstrap_password_one_name=$(awk '/^kind: Job$/{job=1; next} job && /^  name:/{gsub(/"/,"",$2); print $2; exit}' \
    <<<"$mek_bootstrap_password_one")
mek_bootstrap_password_two_name=$(awk '/^kind: Job$/{job=1; next} job && /^  name:/{gsub(/"/,"",$2); print $2; exit}' \
    <<<"$mek_bootstrap_password_two")
if [[ "$mek_bootstrap_password_one_name" != "$mek_bootstrap_password_two_name" ]]; then
    echo 'Inline credential bytes influenced a public MEK lifecycle resource name' >&2
    exit 1
fi
if helm template mek-bootstrap "$CHART_DIR" --namespace osmo \
        --set 'services.masterEncryptionKey.managementMode=osmo' \
        --set 'services.masterEncryptionKey.bootstrap.enabled=true' \
        --set 'services.masterEncryptionKey.rotation.requestId=rotate' \
        --set 'services.masterEncryptionKey.rotation.phase=prepare' >/dev/null 2>&1; then
    echo 'MEK rotation phase was accepted while bootstrap remained enabled' >&2
    exit 1
fi
if grep -q 'name: mek-volume' <<<"$(resource_document "$mek_bootstrap_render" Job \
        "$(awk '/^kind: Role$/{role=1; next} role && /^  name:/{gsub(/"/,"",$2); print $2; exit}' \
        <<<"$mek_bootstrap_render")")"; then
    echo 'Create-only MEK bootstrap Job requires the not-yet-created Secret volume' >&2
    exit 1
fi

quick_start_render=$(helm template quick-start "$CHART_DIR" --namespace osmo \
    -f "$CHART_DIR/quick-start-values.yaml")
grep -q 'command: \["mek-lifecycle"\]' <<<"$quick_start_render"

mek_prepare_render=$(helm template mek-prepare "$CHART_DIR" --namespace osmo \
    --is-upgrade \
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set 'services.masterEncryptionKey.rotation.requestId=rotate-2026-08' \
    --set 'services.masterEncryptionKey.rotation.phase=prepare' \
    --set 'services.masterEncryptionKey.rotation.rolloutRevision=prepare-2026-08' \
    --set 'services.masterEncryptionKey.rotation.activeDeadlineSeconds=321')
grep -A1 -- '- --operation' <<<"$mek_prepare_render" | grep -q -- '- "prepare"'
grep -q 'resources: \["pods/log"\]' <<<"$mek_prepare_render"
grep -q 'resources: \["deployments", "replicasets"\]' <<<"$mek_prepare_render"
mek_prepare_name=$(awk '/^kind: Role$/{role=1; next} role && /^  name:/{gsub(/"/,"",$2); print $2; exit}' \
    <<<"$mek_prepare_render")
mek_prepare_job=$(resource_document "$mek_prepare_render" Job "$mek_prepare_name")
if grep -q 'name: OSMO_POSTGRES_PASSWORD' <<<"$mek_prepare_job"; then
    echo 'MEK PREPARE received unnecessary database credentials' >&2
    exit 1
fi
grep -A1 -- '--active_deadline_seconds' <<<"$mek_prepare_render" | grep -q -- '"321"'
if [[ $(grep -c 'osmo.nvidia.com/mek-rollout: "prepare-2026-08"' \
        <<<"$mek_prepare_render") -ne 6 ]]; then
    echo 'MEK rollout revision was not applied to all six consumers' >&2
    exit 1
fi
if grep -q 'verbs: \["delete"\]' <<<"$mek_prepare_render"; then
    echo 'MEK lifecycle received workload deletion authority' >&2
    exit 1
fi

mek_rewrap_render=$(helm template mek-rewrap "$CHART_DIR" --namespace osmo \
    --is-upgrade \
    --set 'services.masterEncryptionKey.managementMode=external' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set 'services.masterEncryptionKey.rotation.requestId=rotate-2026-08' \
    --set 'services.masterEncryptionKey.rotation.phase=rewrap' \
    --set 'services.masterEncryptionKey.rotation.activeDeadlineSeconds=432')
grep -A1 -- '- --operation' <<<"$mek_rewrap_render" | grep -q -- '- "rewrap"'
grep -A1 -- '--active_deadline_seconds' <<<"$mek_rewrap_render" | grep -q -- '"432"'
mek_rewrap_name=$(awk '/^kind: Role$/{role=1; next} role && /^  name:/{gsub(/"/,"",$2); print $2; exit}' \
    <<<"$mek_rewrap_render")
mek_rewrap_role=$(resource_document "$mek_rewrap_render" Role "$mek_rewrap_name")
awk '
    /resources: \["secrets"\]/ { secret_rule = 1; next }
    secret_rule && /verbs:/ {
        if ($0 != "  verbs: [\"get\"]") exit 1
        found = 1
        secret_rule = 0
    }
    END { if (!found) exit 1 }
' <<<"$mek_rewrap_role" || {
    echo 'External MEK rewrap has Secret mutation permission' >&2
    exit 1
}
mek_rewrap_job=$(resource_document "$mek_rewrap_render" Job "$mek_rewrap_name")
grep -q 'runAsUser: 1001' <<<"$mek_rewrap_job"
grep -q 'name: "db-secret"' <<<"$mek_rewrap_job"
grep -q 'key: "db-password"' <<<"$mek_rewrap_job"
if grep -q 'ttlSecondsAfterFinished' <<<"$mek_rewrap_job"; then
    echo 'GitOps would recreate a TTL-cleaned MEK Job' >&2
    exit 1
fi

if helm template invalid-external-prepare "$CHART_DIR" --namespace osmo --is-upgrade \
        --set 'services.masterEncryptionKey.managementMode=external' \
        --set 'services.masterEncryptionKey.rotation.requestId=invalid' \
        --set 'services.masterEncryptionKey.rotation.phase=prepare' >/dev/null 2>&1; then
    echo 'External PREPARE Secret mutation was accepted' >&2
    exit 1
fi

mek_settled_external_render=$(helm template mek-settled "$CHART_DIR" --namespace osmo \
    --is-upgrade \
    --set 'services.masterEncryptionKey.managementMode=external')
if grep -q 'command: \["mek-lifecycle"\]' <<<"$mek_settled_external_render"; then
    echo 'Settled external mode rendered lifecycle RBAC or a Job' >&2
    exit 1
fi


mek_render=$(helm template mek-test "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.existingSecret.name=customer-mek' \
    --set 'services.masterEncryptionKey.existingSecret.key=keyring.yaml' \
    --set 'services.router.extraVolumeMounts[0].name=router-extra' \
    --set 'services.router.extraVolumeMounts[0].mountPath=/tmp/router-extra')
grep -q 'mountPath: /tmp/router-extra' <<<"$mek_render"
if [[ $(grep -c -- '- --mek_file' <<<"$mek_render") -ne 6 ]]; then
    echo 'Not every MEK consumer receives --mek_file' >&2
    exit 1
fi
if [[ $(grep -c 'secretName: "customer-mek"' <<<"$mek_render") -ne 6 ]]; then
    echo 'Not every MEK consumer mounts the existing Secret' >&2
    exit 1
fi
if [[ $(grep -c -- '- "/opt/osmo/mek/mek.yaml"' <<<"$mek_render") -ne 6 ]] || \
   [[ $(grep -c 'mountPath: "/opt/osmo/mek"' <<<"$mek_render") -ne 6 ]]; then
    echo 'MEK consumers do not use the fixed chart-owned path' >&2
    exit 1
fi
if grep -q 'name: OSMO_MEK_CONSUMER\|name: OSMO_ALLOW_EXISTING_MEK_ADOPTION' <<<"$mek_render"; then
    echo 'Legacy database-backed MEK adoption environment is still rendered' >&2
    exit 1
fi
if grep -q 'subPath:.*mek' <<<"$mek_render"; then
    echo 'MEK is still mounted with subPath and cannot receive kubelet updates' >&2
    exit 1
fi
if grep -q 'name: mek-config' <<<"$mek_render"; then
    echo 'Legacy MEK ConfigMap support is still rendered' >&2
    exit 1
fi
if grep -q 'vault.hashicorp.com' <<<"$mek_render"; then
    echo 'Vault annotations are still rendered for the MEK' >&2
    exit 1
fi

mek_deployments=(
    osmo-service osmo-worker osmo-router osmo-logger osmo-agent
    osmo-delayed-job-monitor
)
for deployment in "${mek_deployments[@]}"; do
    document=$(resource_document "$mek_render" Deployment "$deployment")
    if ! grep -q 'app.kubernetes.io/instance: "mek-test"' <<<"$document"; then
        echo "MEK rollout selector is incomplete on Deployment/$deployment" >&2
        exit 1
    fi
    if ! grep -q 'app.kubernetes.io/part-of: osmo' <<<"$document"; then
        echo "MEK consumer Deployment/$deployment lacks the standard part-of label" >&2
        exit 1
    fi
done
for hpa in osmo-service osmo-worker osmo-router osmo-logger osmo-agent; do
    document=$(resource_document "$mek_render" HorizontalPodAutoscaler "$hpa")
    if ! grep -q 'app.kubernetes.io/instance: "mek-test"' <<<"$document"; then
        echo "MEK rollout selector is incomplete on HorizontalPodAutoscaler/$hpa" >&2
        exit 1
    fi
done
if grep -q 'osmo.nvidia.com/mek-consumer' <<<"$mek_render"; then
    echo 'Product chart rendered the KIND-only MEK consumer label' >&2
    exit 1
fi

# --- MCP -------------------------------------------------------------------
# Behaviour only. Numeric ranges and URL shapes are enforced by MCPAuthConfig
# at start-up; re-proving them here just duplicates the same contract in a
# second language.

mcp_values="$CHART_DIR/tests/mcp-proxy-values.yaml"

disabled_render=$(helm template mcp-disabled "$CHART_DIR")
for forbidden in 'name: osmo-mcp' 'cluster: osmo-mcp' 'path: /mcp'; do
    if grep -q "$forbidden" <<<"$disabled_render"; then
        echo "MCP is disabled but the render still contains: $forbidden" >&2
        exit 1
    fi
done

mcp_render=$(helm template mcp-test "$CHART_DIR" --values "$mcp_values")
mcp_workload=$(awk '/^# Source: /{keep = ($3 ~ /templates\/mcp-service\.yaml$/)} keep' \
    <<<"$mcp_render")

# FastMCP advertises its OAuth endpoints under /mcp; the gateway publishes that
# prefix and rewrites it off before forwarding to the root paths the MCP SDK
# registers. One prefix route, not an entry per endpoint name.
mcp_route() {
    # Stop at the next entry *at the route's own indentation*. Matching any
    # "- name:" ends the route at its first header matcher, which hides
    # everything below it -- including prefix_rewrite.
    awk -v route="- name: $1" '
        function indent(line) { match(line, /^ */); return RLENGTH }
        index($0, route) { found = 1; depth = indent($0); next }
        found && indent($0) == depth && /- name: / { exit }
        found { print }
    ' <<<"$mcp_render"
}

oauth_route=$(mcp_route mcp-oauth)
grep -q 'prefix: /mcp/' <<<"$oauth_route"
grep -q 'prefix_rewrite: /$' <<<"$oauth_route"
grep -q 'prefix_rewrite: /.well-known/oauth-authorization-server' \
    <<<"$(mcp_route mcp-authorization-server-metadata)"

# The /mcp prefix publishes the container's whole root namespace, so the health
# endpoints are carved out ahead of it -- and the carve-out has to answer 404
# itself rather than let jwt_authn answer 401 first.
health_route=$(mcp_route mcp-health-not-public)
grep -q 'status: 404' <<<"$health_route"
grep -q 'envoy.filters.http.jwt_authn:' <<<"$health_route"
grep -q 'envoy.filters.http.ext_authz:' <<<"$health_route"

# The roles Lua filter has no other coverage in the repo.
grep -q 'local safe_roles = {}' <<<"$mcp_render"
grep -q "not string.find(role, '\[,%c\]')" <<<"$mcp_render"
grep -q "table.concat(safe_roles, ',')" <<<"$mcp_render"

# Redis connection details come from services.redis; only the database is local.
grep -q 'value: "rediss://redis:6379/14"' <<<"$mcp_workload"

# A Redis needing no password must not force a key into the Secret.
no_redis_pw=$(helm template mcp-nopw "$CHART_DIR" --values "$mcp_values" \
    --set 'services.mcp.oidcProxy.existingSecret.redisPasswordKey=')
if grep -q 'redis-password' <<<"$no_redis_pw"; then
    echo 'MCP demands a redis-password key when none was asked for' >&2
    exit 1
fi

# Authentication is not a mode, so nothing advertises it as one. The fixture
# sets no enabled flag; the OIDC variables above must render regardless.
if grep -q 'name: OSMO_MCP_AUTH_ENABLED' <<<"$mcp_workload"; then
    echo 'MCP still renders an auth-enabled switch' >&2
    exit 1
fi

# Values the deployment derives must not reappear as deployer inputs.
for derived in OSMO_MCP_AUTH_ISSUER_URL OSMO_MCP_AUTH_SCOPE \
        OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_AUDIENCE \
        OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_JWKS_URL; do
    if grep -q "name: $derived" <<<"$mcp_workload"; then
        echo "MCP still asks for a derived value: $derived" >&2
        exit 1
    fi
done

# Only a provider issuing v1-format access tokens needs the issuer stated. With
# it unset the issuer comes from the configuration URL, and the gateway provider
# for that issuer is the one the MCP audience is added to.
no_issuer=$(helm template mcp-no-issuer "$CHART_DIR" --values "$mcp_values" \
    --set 'services.mcp.oidcProxy.oidc.accessTokenIssuer=' \
    --set 'gateway.envoy.jwt.providers[0].issuer=https://login.example.com/example-tenant/v2.0')
grep -q 'issuer: https://login.example.com/example-tenant/v2.0' <<<"$no_issuer"

# The secret file paths follow the mount, so a deployer states neither of them.
mount_render=$(helm template mcp-mount "$CHART_DIR" --values "$mcp_values" \
    --set 'services.mcp.oidcProxy.existingSecret.mountPath=/var/run/mcp')
grep -q 'value: "/var/run/mcp/client-secret"' <<<"$mount_render"
grep -q 'value: "/var/run/mcp/redis-password"' <<<"$mount_render"
grep -q 'mountPath: /var/run/mcp' <<<"$mount_render"

# The MCP audience is added to the provider for its issuer, so no deployment
# writes a second provider differing only in audience. Scoped to the audiences
# list: the resource URL also renders as the service's own env var.
jwt_audiences() {
    awk '
        /^ *audiences:/ { found = 1; match($0, /^ */); depth = RLENGTH; next }
        found && /^ *- / && index($0, "- ") == depth + 1 { print $2; next }
        found { found = 0 }
    ' <<<"$1"
}

aud_render=$(helm template mcp-aud "$CHART_DIR" --values "$mcp_values" \
    --set 'gateway.envoy.jwt.providers[0].audience=some-client-id')
grep -qx 'some-client-id' <<<"$(jwt_audiences "$aud_render")"
grep -qx 'https://osmo.example.com/mcp' <<<"$(jwt_audiences "$aud_render")"

# A provider already carrying that audience must not have it added twice.
dupes=$(grep -cx 'https://osmo.example.com/mcp' <<<"$(jwt_audiences "$mcp_render")" || true)
if [ "$dupes" -ne 1 ]; then
    echo "MCP audience appears $dupes times on the gateway provider, want 1" >&2
    exit 1
fi

# The proxy keeps its state in Redis, so scaling out must render.
helm template mcp-scale "$CHART_DIR" --values "$mcp_values" \
    --set 'services.mcp.replicas=2' >/dev/null

# A deployer must not be able to redirect the relay through extraEnv.
if helm template mcp-override "$CHART_DIR" --values "$mcp_values" \
        --set-json 'services.mcp.extraEnv=[{"name":"OSMO_GATEWAY_URL","value":"https://evil.example.com"}]' \
        >/dev/null 2>&1; then
    echo 'MCP accepted an extraEnv override of a managed variable' >&2
    exit 1
fi

# resourceUrl is the value everything else is derived from.
if helm template mcp-bad-url "$CHART_DIR" --values "$mcp_values" \
        --set 'services.mcp.resourceUrl=https://osmo.example.com%40evil.example.com/mcp' \
        >/dev/null 2>&1; then
    echo 'MCP accepted a malformed resourceUrl' >&2
    exit 1
fi
