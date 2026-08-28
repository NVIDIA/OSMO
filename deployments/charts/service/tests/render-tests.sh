#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

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
mcp_workload=$(helm template mcp-test "$CHART_DIR" --values "$mcp_values" \
    --show-only templates/mcp-service.yaml)

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

grep -q 'prefix: /mcp/' <<<"$(mcp_route mcp-oauth)"
grep -q 'prefix_rewrite: /$' <<<"$(mcp_route mcp-oauth)"
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
# writes a second provider differing only in audience.
aud_render=$(helm template mcp-aud "$CHART_DIR" --values "$mcp_values" \
    --set 'gateway.envoy.jwt.providers[0].audience=some-client-id')
grep -q -- '- some-client-id' <<<"$aud_render"
grep -q -- '- https://osmo.example.com/mcp' <<<"$aud_render"

# A provider already carrying that audience must not have it added twice.
dupes=$(grep -c -- '- https://osmo.example.com/mcp' <<<"$mcp_render" || true)
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
