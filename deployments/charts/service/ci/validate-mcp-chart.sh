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

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="$(dirname -- "$SCRIPT_DIR")"
VALUES_FILE="$SCRIPT_DIR/mcp-values.yaml"
PROXY_VALUES_FILE="$SCRIPT_DIR/mcp-oidc-proxy-values.yaml"
RENDERED_MANIFEST="$(mktemp)"
MCP_MANIFEST="$(mktemp)"
DISABLED_MANIFEST="$(mktemp)"
PROXY_RENDERED_MANIFEST="$(mktemp)"
PROXY_MCP_MANIFEST="$(mktemp)"
trap 'rm -f "$RENDERED_MANIFEST" "$MCP_MANIFEST" "$DISABLED_MANIFEST" \
  "$PROXY_RENDERED_MANIFEST" "$PROXY_MCP_MANIFEST"' EXIT

fail() {
  echo "MCP chart validation failed: $*" >&2
  exit 1
}

assert_file_contains() {
  local file="$1"
  local expected="$2"
  grep -F -- "$expected" "$file" >/dev/null || \
    fail "$(basename "$file") is missing: $expected"
}

assert_file_omits() {
  local file="$1"
  local forbidden="$2"
  if grep -F -- "$forbidden" "$file" >/dev/null; then
    fail "$(basename "$file") unexpectedly contains: $forbidden"
  fi
}

assert_env_value() {
  local file="$1"
  local name="$2"
  local value="$3"
  grep -A1 -F -- "name: $name" "$file" | \
    grep -F -- "value: \"$value\"" >/dev/null || \
    fail "managed environment variable $name does not equal $value"
}

assert_route_contains() {
  local file="$1"
  local route="$2"
  local expected="$3"
  awk -v marker="                - name: $route" '
    $0 == marker { found = 1 }
    found && $0 != marker && index($0, "                - ") == 1 { exit }
    found { print }
  ' "$file" | \
    grep -F -- "$expected" >/dev/null || \
    fail "Gateway route $route is missing: $expected"
}

assert_route_omits() {
  local file="$1"
  local route="$2"
  local forbidden="$3"
  if awk -v marker="                - name: $route" '
      $0 == marker { found = 1 }
      found && $0 != marker && index($0, "                - ") == 1 { exit }
      found { print }
    ' "$file" | \
      grep -F -- "$forbidden" >/dev/null; then
    fail "Gateway route $route unexpectedly contains: $forbidden"
  fi
}

expect_render_failure() {
  local values_file="$1"
  local description="$2"
  local expected_error="$3"
  shift 3

  local output
  if output=$(helm template mcp-validation "$CHART_DIR" \
      --values "$values_file" "$@" 2>&1); then
    fail "$description unexpectedly rendered successfully"
  fi
  case "$output" in
    *"$expected_error"*) ;;
    *) fail "$description returned an unexpected error: $output" ;;
  esac
}

helm lint "$CHART_DIR" --values "$VALUES_FILE"
helm lint "$CHART_DIR" --values "$PROXY_VALUES_FILE"
helm template mcp-disabled "$CHART_DIR" >"$DISABLED_MANIFEST"
helm template mcp-validation "$CHART_DIR" \
  --values "$VALUES_FILE" >"$RENDERED_MANIFEST"
helm template mcp-validation "$CHART_DIR" \
  --values "$VALUES_FILE" \
  --show-only templates/mcp-service.yaml >"$MCP_MANIFEST"
helm template mcp-proxy-validation "$CHART_DIR" \
  --values "$PROXY_VALUES_FILE" >"$PROXY_RENDERED_MANIFEST"
helm template mcp-proxy-validation "$CHART_DIR" \
  --values "$PROXY_VALUES_FILE" \
  --show-only templates/mcp-service.yaml >"$PROXY_MCP_MANIFEST"

for forbidden in \
    'name: osmo-mcp' \
    'cluster: osmo-mcp' \
    'path: /mcp' \
    'path: /.well-known/oauth-protected-resource/mcp'; do
  assert_file_omits "$DISABLED_MANIFEST" "$forbidden"
done

for forbidden in \
    'path: /.well-known/oauth-authorization-server' \
    'path: /authorize' \
    'path: /auth/callback' \
    'path: /register' \
    'path: /token' \
    'path: /consent'; do
  assert_file_omits "$RENDERED_MANIFEST" "$forbidden"
done

for expected in \
    'kind: Deployment' \
    'kind: Service' \
    'name: osmo-mcp' \
    'image: nvcr.io/nvidia/osmo/mcp:latest' \
    'name: OSMO_GATEWAY_URL' \
    'name: OSMO_MCP_REQUEST_TIMEOUT_SECONDS' \
    'name: OSMO_MCP_AUTH_ENABLED' \
    'kind: NetworkPolicy' \
    'name: osmo-mcp-allow-gateway-envoy' \
    'app.kubernetes.io/component: envoy' \
    'automountServiceAccountToken: false'; do
  assert_file_contains "$MCP_MANIFEST" "$expected"
done
assert_file_contains "$RENDERED_MANIFEST" 'path: /mcp'
assert_file_contains "$RENDERED_MANIFEST" 'path: /.well-known/oauth-protected-resource/mcp'
assert_file_contains "$RENDERED_MANIFEST" '\"authorization_servers\":[\"https://issuer.example.com\"]'
assert_file_contains "$RENDERED_MANIFEST" '\"resource\":\"https://osmo.example.com/mcp\"'
assert_file_contains "$RENDERED_MANIFEST" '\"scopes_supported\":[\"mcp:Access\"]'
assert_file_contains "$RENDERED_MANIFEST" 'local safe_roles = {}'
assert_file_contains "$RENDERED_MANIFEST" "not string.find(role, '[,%c]')"
assert_file_contains "$RENDERED_MANIFEST" "table.concat(safe_roles, ',')"
assert_env_value "$MCP_MANIFEST" OSMO_GATEWAY_URL https://osmo.example.com
assert_env_value "$MCP_MANIFEST" OSMO_MCP_REQUEST_TIMEOUT_SECONDS 10
assert_env_value "$MCP_MANIFEST" OSMO_MCP_AUTH_ENABLED false
assert_route_omits "$RENDERED_MANIFEST" osmo-mcp 'typed_per_filter_config:'

for expected in \
    'name: OSMO_MCP_AUTH_ISSUER_URL' \
    'name: OSMO_MCP_AUTH_RESOURCE_URL' \
    'name: OSMO_MCP_AUTH_SCOPE' \
    'name: OSMO_MCP_AUTH_REDIS_URL' \
    'name: OSMO_MCP_AUTH_REDIS_CONNECT_TIMEOUT_SECONDS' \
    'name: OSMO_MCP_AUTH_REDIS_OPERATION_TIMEOUT_SECONDS' \
    'name: OSMO_MCP_AUTH_OIDC_CONFIG_URL' \
    'name: OSMO_MCP_AUTH_OIDC_CLIENT_ID' \
    'name: OSMO_MCP_AUTH_OIDC_CLIENT_SECRET_FILE' \
    'name: OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_ISSUER' \
    'name: OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_AUDIENCE' \
    'name: OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_JWKS_URL' \
    'name: OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_REQUIRED_SCOPE' \
    'name: OSMO_MCP_AUTH_UPSTREAM_TIMEOUT_SECONDS' \
    'secretName: mcp-oidc-proxy-secrets'; do
  assert_file_contains "$PROXY_MCP_MANIFEST" "$expected"
done

for route in \
    mcp-protected-resource-metadata \
    mcp-oauth-authorization-server-metadata \
    mcp-oauth-authorize-get \
    mcp-oauth-authorize-post \
    mcp-oauth-oidc-callback \
    mcp-oauth-register \
    mcp-oauth-token \
    mcp-oauth-consent-get \
    mcp-oauth-consent-post \
    mcp-oauth-authorization-server-metadata-options \
    mcp-oauth-authorize-options \
    mcp-oauth-oidc-callback-options \
    mcp-oauth-register-options \
    mcp-oauth-token-options \
    mcp-oauth-consent-options; do
  assert_route_contains "$PROXY_RENDERED_MANIFEST" "$route" 'cluster: osmo-mcp'
  assert_route_contains "$PROXY_RENDERED_MANIFEST" "$route" 'envoy.filters.http.jwt_authn:'
  assert_route_contains "$PROXY_RENDERED_MANIFEST" "$route" 'envoy.filters.http.ext_authz:'
done
assert_env_value "$PROXY_MCP_MANIFEST" OSMO_MCP_AUTH_ENABLED true
assert_env_value "$PROXY_MCP_MANIFEST" OSMO_MCP_AUTH_ISSUER_URL https://osmo.example.com
assert_env_value "$PROXY_MCP_MANIFEST" OSMO_MCP_AUTH_RESOURCE_URL https://osmo.example.com/mcp
assert_env_value "$PROXY_MCP_MANIFEST" OSMO_MCP_AUTH_SCOPE https://osmo.example.com/mcp/access_as_user
assert_env_value "$PROXY_MCP_MANIFEST" OSMO_MCP_AUTH_REDIS_URL rediss://proxy-redis.example.internal:6380/14

for expected in \
    'path: /.well-known/oauth-authorization-server' \
    'path: /authorize' \
    'path: /auth/callback' \
    'path: /register' \
    'path: /token' \
    'path: /consent' \
    'name: mcp-protected-resource-metadata' \
    'name: osmo-mcp' \
    'cluster: osmo-mcp' \
    'path: "%PATH(NQ:ORIG_OR_PATH)%"'; do
  assert_file_contains "$PROXY_RENDERED_MANIFEST" "$expected"
done

for forbidden in \
    'name: osmo-mcp-oauth' \
    'cluster: osmo-mcp-oauth' \
    'app.kubernetes.io/component: mcp-oauth-broker' \
    '- mcp-auth' \
    'local_jwks:' \
    'mcp-oauth-signing-jwks' \
    'OSMO_MCP_AUTH_SIGNING_JWKS_FILE' \
    'signing-jwks.json' \
    'upstream_claims' \
    'meta.verified_jwt.token_use'; do
  assert_file_omits "$PROXY_RENDERED_MANIFEST" "$forbidden"
done

assert_route_contains "$PROXY_RENDERED_MANIFEST" osmo-mcp 'envoy.filters.http.jwt_authn:'
assert_route_contains "$PROXY_RENDERED_MANIFEST" osmo-mcp 'envoy.filters.http.ext_authz:'
assert_file_omits "$PROXY_RENDERED_MANIFEST" '\"authorization_servers\"'

if awk -v secret_name='mcp-oidc-proxy-secrets' '
    $0 == "kind: Secret" { in_secret = 1; next }
    $0 == "---" { in_secret = 0 }
    in_secret && $1 == "name:" && $2 == secret_name { found = 1 }
    END { exit !found }
  ' "$PROXY_RENDERED_MANIFEST"; then
  fail 'OIDC proxy mode rendered credential material into a Secret'
fi

expect_render_failure "$VALUES_FILE" \
  'encoded alternate Gateway origin' \
  'services.mcp.resourceUrl must be a valid HTTPS origin' \
  --set 'services.mcp.resourceUrl=https://osmo.example.com%40evil.example.com/mcp'

expect_render_failure "$VALUES_FILE" \
  'managed Gateway URL override' \
  'services.mcp.extraEnv must not override managed variable OSMO_GATEWAY_URL' \
  --set-json 'services.mcp.extraEnv=[{"name":"OSMO_GATEWAY_URL","value":"https://evil.example.com"}]'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC proxy without MCP' \
  'services.mcp.oidcProxy.enabled requires services.mcp.enabled=true' \
  --set 'services.mcp.enabled=false'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC proxy with multiple replicas' \
  'services.mcp.replicas must be 1 when services.mcp.oidcProxy.enabled=true' \
  --set 'services.mcp.replicas=2'

expect_render_failure "$PROXY_VALUES_FILE" \
  'invalid OIDC proxy Redis port' \
  'services.mcp.oidcProxy.redis.port must be between 1 and 65535' \
  --set 'services.mcp.oidcProxy.redis.port=0'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC proxy Redis database below range' \
  'services.mcp.oidcProxy.redis.dbNumber must be between 0 and 15' \
  --set 'services.mcp.oidcProxy.redis.dbNumber=-1'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC proxy Redis database above range' \
  'services.mcp.oidcProxy.redis.dbNumber must be between 0 and 15' \
  --set 'services.mcp.oidcProxy.redis.dbNumber=16'

expect_render_failure "$PROXY_VALUES_FILE" \
  'invalid OIDC proxy Redis key prefix' \
  'services.mcp.oidcProxy.redis.keyPrefix contains unsupported characters' \
  --set 'services.mcp.oidcProxy.redis.keyPrefix=invalid/prefix'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC proxy access-token TTL below range' \
  'services.mcp.oidcProxy.accessTokenTtlSeconds must be between 60 and 3600' \
  --set 'services.mcp.oidcProxy.accessTokenTtlSeconds=59'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC proxy access-token TTL above range' \
  'services.mcp.oidcProxy.accessTokenTtlSeconds must be between 60 and 3600' \
  --set 'services.mcp.oidcProxy.accessTokenTtlSeconds=3601'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC proxy refresh-token TTL below range' \
  'services.mcp.oidcProxy.refreshTokenTtlSeconds must be between 300 and 604800' \
  --set 'services.mcp.oidcProxy.refreshTokenTtlSeconds=299'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC proxy refresh-token TTL above range' \
  'services.mcp.oidcProxy.refreshTokenTtlSeconds must be between 300 and 604800' \
  --set 'services.mcp.oidcProxy.refreshTokenTtlSeconds=604801'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC proxy upstream timeout below range' \
  'services.mcp.oidcProxy.upstreamTimeoutSeconds must be between 1 and 60' \
  --set 'services.mcp.oidcProxy.upstreamTimeoutSeconds=0'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC proxy upstream timeout above range' \
  'services.mcp.oidcProxy.upstreamTimeoutSeconds must be between 1 and 60' \
  --set 'services.mcp.oidcProxy.upstreamTimeoutSeconds=61'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC access-token audience mismatch' \
  'services.mcp.oidcProxy.oidc.accessTokenAudience must equal services.mcp.resourceUrl' \
  --set 'services.mcp.oidcProxy.oidc.accessTokenAudience=https://other.example.com/mcp'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC full scope mismatch' \
  'services.mcp.oidcProxy.scope must equal services.mcp.resourceUrl followed by oidc.accessTokenRequiredScope' \
  --set 'services.mcp.oidcProxy.scope=https://other.example.com/access_as_user'

expect_render_failure "$PROXY_VALUES_FILE" \
  'relative OIDC client-secret path' \
  'services.mcp.oidcProxy.oidc.clientSecretFile must be an absolute path' \
  --set 'services.mcp.oidcProxy.oidc.clientSecretFile=client-secret'

expect_render_failure "$PROXY_VALUES_FILE" \
  'relative Redis password path' \
  'services.mcp.oidcProxy.redis.passwordFile must be an absolute path' \
  --set 'services.mcp.oidcProxy.redis.passwordFile=redis-password'

expect_render_failure "$PROXY_VALUES_FILE" \
  'OIDC client-secret path outside the existing Secret mount' \
  'services.mcp.oidcProxy.oidc.clientSecretFile must be <existingSecret.mountPath>/client-secret' \
  --set 'services.mcp.oidcProxy.oidc.clientSecretFile=/other/client-secret'

expect_render_failure "$PROXY_VALUES_FILE" \
  'Redis password path outside the existing Secret mount' \
  'services.mcp.oidcProxy.redis.passwordFile must be <existingSecret.mountPath>/redis-password' \
  --set 'services.mcp.oidcProxy.redis.passwordFile=/other/redis-password'

expect_render_failure "$PROXY_VALUES_FILE" \
  'untrusted redirect origin with a path' \
  'trustedHttpsRedirectOrigins entries must be exact HTTPS origins' \
  --set 'services.mcp.oidcProxy.trustedHttpsRedirectOrigins[0]=https://trusted.example.com/callback'

expect_render_failure "$PROXY_VALUES_FILE" \
  'managed OIDC proxy issuer override' \
  'services.mcp.extraEnv must not override managed variable OSMO_MCP_AUTH_ISSUER_URL' \
  --set-json 'services.mcp.extraEnv=[{"name":"OSMO_MCP_AUTH_ISSUER_URL","value":"https://evil.example.com"}]'

echo 'MCP chart validation passed'
