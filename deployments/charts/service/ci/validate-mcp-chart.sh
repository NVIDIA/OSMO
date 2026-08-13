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
BROKER_VALUES_FILE="$SCRIPT_DIR/mcp-oauth-broker-values.yaml"
RENDERED_MANIFEST="$(mktemp)"
MCP_MANIFEST="$(mktemp)"
DISABLED_MANIFEST="$(mktemp)"
BROKER_RENDERED_MANIFEST="$(mktemp)"
BROKER_WORKLOAD_MANIFEST="$(mktemp)"
trap 'rm -f "$RENDERED_MANIFEST" "$MCP_MANIFEST" "$DISABLED_MANIFEST" \
  "$BROKER_RENDERED_MANIFEST" "$BROKER_WORKLOAD_MANIFEST"' EXIT

fail() {
  echo "MCP chart validation failed: $*" >&2
  exit 1
}

assert_rendered() {
  local expected="$1"
  grep -F -- "$expected" "$RENDERED_MANIFEST" >/dev/null || \
    fail "rendered manifest is missing: $expected"
}

assert_mcp_rendered() {
  local expected="$1"
  grep -F -- "$expected" "$MCP_MANIFEST" >/dev/null || \
    fail "rendered MCP manifest is missing: $expected"
}

assert_broker_rendered() {
  local expected="$1"
  grep -F -- "$expected" "$BROKER_RENDERED_MANIFEST" >/dev/null || \
    fail "rendered broker manifest is missing: $expected"
}

assert_broker_workload_rendered() {
  local expected="$1"
  grep -F -- "$expected" "$BROKER_WORKLOAD_MANIFEST" >/dev/null || \
    fail "rendered broker workload is missing: $expected"
}

assert_env_value() {
  local name="$1"
  local value="$2"
  grep -A1 -F -- "name: $name" "$MCP_MANIFEST" | \
    grep -F -- "value: \"$value\"" >/dev/null || \
    fail "managed environment variable $name does not equal $value"
}

expect_render_failure() {
  local description="$1"
  local expected_error="$2"
  shift 2

  local output
  if output=$(helm template mcp-validation "$CHART_DIR" \
      --values "$VALUES_FILE" "$@" 2>&1); then
    fail "$description unexpectedly rendered successfully"
  fi
  case "$output" in
    *"$expected_error"*) ;;
    *) fail "$description returned an unexpected error: $output" ;;
  esac
}

expect_broker_render_failure() {
  local description="$1"
  local expected_error="$2"
  shift 2

  local output
  if output=$(helm template mcp-broker-validation "$CHART_DIR" \
      --values "$BROKER_VALUES_FILE" "$@" 2>&1); then
    fail "$description unexpectedly rendered successfully"
  fi
  case "$output" in
    *"$expected_error"*) ;;
    *) fail "$description returned an unexpected error: $output" ;;
  esac
}

helm lint "$CHART_DIR" --values "$VALUES_FILE"
helm lint "$CHART_DIR" --values "$BROKER_VALUES_FILE"
helm template mcp-disabled "$CHART_DIR" >"$DISABLED_MANIFEST"
helm template mcp-validation "$CHART_DIR" \
  --values "$VALUES_FILE" >"$RENDERED_MANIFEST"
helm template mcp-validation "$CHART_DIR" \
  --values "$VALUES_FILE" \
  --show-only templates/mcp-service.yaml >"$MCP_MANIFEST"
helm template mcp-broker-validation "$CHART_DIR" \
  --values "$BROKER_VALUES_FILE" >"$BROKER_RENDERED_MANIFEST"
helm template mcp-broker-validation "$CHART_DIR" \
  --values "$BROKER_VALUES_FILE" \
  --show-only templates/mcp-oauth-broker.yaml >"$BROKER_WORKLOAD_MANIFEST"

for forbidden in \
    'name: osmo-mcp' \
    'cluster: osmo-mcp' \
    'path: /mcp' \
    'path: /.well-known/oauth-protected-resource/mcp'; do
  if grep -F -- "$forbidden" "$DISABLED_MANIFEST" >/dev/null; then
    fail "disabled mode rendered MCP configuration: $forbidden"
  fi
done

for forbidden in \
    'name: osmo-mcp-oauth' \
    'cluster: osmo-mcp-oauth' \
    'path: /.well-known/oauth-authorization-server' \
    'path: /authorize' \
    'path: /token'; do
  if grep -F -- "$forbidden" "$RENDERED_MANIFEST" >/dev/null; then
    fail "direct MCP mode rendered OAuth broker configuration: $forbidden"
  fi
done

assert_mcp_rendered 'kind: Deployment'
assert_mcp_rendered 'kind: Service'
assert_mcp_rendered 'name: osmo-mcp'
assert_mcp_rendered 'image: nvcr.io/nvidia/osmo/mcp:latest'
assert_mcp_rendered 'name: OSMO_GATEWAY_URL'
assert_mcp_rendered 'name: OSMO_MCP_REQUEST_TIMEOUT_SECONDS'
assert_mcp_rendered 'kind: NetworkPolicy'
assert_mcp_rendered 'name: osmo-mcp-allow-gateway-envoy'
assert_mcp_rendered 'app.kubernetes.io/component: envoy'
assert_mcp_rendered 'livenessProbe:'
assert_mcp_rendered 'readinessProbe:'
assert_mcp_rendered 'startupProbe:'
assert_mcp_rendered 'automountServiceAccountToken: false'
assert_rendered 'path: /mcp'
assert_rendered 'path: /.well-known/oauth-protected-resource/mcp'
assert_rendered '\"authorization_servers\":[\"https://issuer.example.com\"]'
assert_rendered '\"bearer_methods_supported\":[\"header\"]'
assert_rendered '\"resource\":\"https://osmo.example.com/mcp\"'
assert_rendered '\"scopes_supported\":[\"mcp:Access\"]'
assert_env_value 'OSMO_GATEWAY_URL' 'https://osmo.example.com'
assert_env_value 'OSMO_MCP_REQUEST_TIMEOUT_SECONDS' '10'

assert_broker_workload_rendered 'kind: Deployment'
assert_broker_workload_rendered 'kind: Service'
assert_broker_workload_rendered 'kind: NetworkPolicy'
assert_broker_workload_rendered 'name: osmo-mcp-oauth'
assert_broker_workload_rendered 'image: nvcr.io/nvidia/osmo/mcp:latest'
assert_broker_workload_rendered '- mcp-auth'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_ISSUER_URL'
assert_broker_workload_rendered 'value: "https://osmo.example.com"'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_TRUSTED_HTTPS_REDIRECT_ORIGINS'
assert_broker_workload_rendered 'value: "https://trusted-client.example.com"'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_REDIS_URL'
assert_broker_workload_rendered 'value: "rediss://broker-redis.example.internal:6380/14"'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_SCOPE'
assert_broker_workload_rendered 'value: "https://osmo.example.com/mcp/access_as_user"'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_OIDC_CONFIG_URL'
assert_broker_workload_rendered 'value: "https://login.example.com/example-tenant/v2.0/.well-known/openid-configuration"'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_OIDC_CLIENT_ID'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_OIDC_CLIENT_SECRET_FILE'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_ISSUER'
assert_broker_workload_rendered 'value: "https://sts.example.com/example-tenant/"'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_AUDIENCE'
assert_broker_workload_rendered 'value: "https://osmo.example.com/mcp"'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_JWKS_URL'
assert_broker_workload_rendered 'value: "https://login.example.com/example-tenant/discovery/v2.0/keys"'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_REQUIRED_SCOPE'
assert_broker_workload_rendered 'value: "access_as_user"'
assert_broker_workload_rendered 'name: OSMO_MCP_AUTH_SIGNING_JWKS_FILE'
assert_broker_workload_rendered 'path: /health/live'
assert_broker_workload_rendered 'path: /health/ready'
assert_broker_workload_rendered 'secretName: mcp-oauth-broker-secrets'
assert_broker_workload_rendered 'name: osmo-mcp-oauth-allow-gateway-envoy'
assert_broker_rendered '\"authorization_servers\":[\"https://osmo.example.com/\"]'
assert_broker_rendered '\"scopes_supported\":[\"https://osmo.example.com/mcp/access_as_user\"]'
assert_broker_rendered 'name: mcp-oauth-authorization-server-metadata'
assert_broker_rendered 'path: /.well-known/oauth-authorization-server'
assert_broker_rendered 'name: mcp-oauth-authorize-get'
assert_broker_rendered 'name: mcp-oauth-authorize-post'
assert_broker_rendered 'path: /authorize'
assert_broker_rendered 'name: mcp-oauth-oidc-callback'
assert_broker_rendered 'path: /auth/callback'
assert_broker_rendered 'name: mcp-oauth-register'
assert_broker_rendered 'path: /register'
assert_broker_rendered 'name: mcp-oauth-token'
assert_broker_rendered 'path: /token'
assert_broker_rendered 'name: mcp-oauth-consent-get'
assert_broker_rendered 'name: mcp-oauth-consent-post'
assert_broker_rendered 'path: /consent'
assert_broker_rendered 'name: mcp-oauth-token-options'
assert_broker_rendered 'issuer: https://osmo.example.com/'
assert_broker_rendered 'audiences:'
assert_broker_rendered '- https://osmo.example.com/mcp'
assert_broker_rendered 'local_jwks:'
assert_broker_rendered 'filename: "/etc/osmo/mcp-auth/signing-jwks.json"'
assert_broker_rendered 'name: mcp-oauth-signing-jwks'
assert_broker_rendered 'mountPath: "/etc/osmo/mcp-auth/signing-jwks.json"'
assert_broker_rendered 'subPath: signing-jwks.json'
assert_broker_rendered 'secretName: mcp-oauth-broker-secrets'
assert_broker_rendered 'cluster: osmo-mcp-oauth'
assert_broker_rendered 'path: "%PATH(NQ:ORIG_OR_PATH)%"'
assert_broker_rendered 'meta.verified_jwt.token_use ~= nil'
assert_broker_rendered "[':status'] = '401'"
assert_broker_rendered "'{\"error\":\"invalid_token\"}'"
assert_broker_rendered "local required_scope = \"https://osmo.example.com/mcp/access_as_user\""
assert_broker_rendered "[':status'] = '403'"
assert_broker_rendered "'{\"error\":\"insufficient_scope\"}'"
assert_broker_rendered 'if (meta.verified_jwt.iss == "https://osmo.example.com/" and type(claims.upstream_claims) == '\''table'\'') then'

for forbidden in \
    'name: OSMO_MCP_AUTH_ENTRA_' \
    'path: /oauth/jwks.json' \
    'path: /oauth/authorize' \
    'path: /oauth/callback/entra' \
    'path: /oauth/register' \
    'path: /oauth/token' \
    'path: /oauth/revoke' \
    'remote_jwks:'; do
  if grep -F -- "$forbidden" "$BROKER_RENDERED_MANIFEST" >/dev/null; then
    fail "FastMCP broker rendered removed custom-OAuth configuration: $forbidden"
  fi
done

if ! grep -A12 -F -- 'name: mcp-oauth-oidc-callback' \
    "$BROKER_RENDERED_MANIFEST" | grep -F -- 'timeout: 45s' >/dev/null; then
  fail 'broker callback route did not render its extended upstream timeout'
fi

if ! grep -A12 -F -- 'name: mcp-oauth-token' \
    "$BROKER_RENDERED_MANIFEST" | grep -F -- 'timeout: 45s' >/dev/null; then
  fail 'broker token route did not outlive the upstream OAuth timeout'
fi

assert_broker_rendered 'claims.preferred_username or claims.unique_name or claims.upn or claims.email'

if grep -F -- 'path: "%REQ(X-ENVOY-ORIGINAL-PATH?:PATH)%"' \
    "$BROKER_RENDERED_MANIFEST" >/dev/null; then
  fail 'Gateway access logs still include OAuth query parameters'
fi

if grep -F -- 'path: "%REQ_WITHOUT_QUERY(X-ENVOY-ORIGINAL-PATH?:PATH)%"' \
    "$BROKER_RENDERED_MANIFEST" >/dev/null; then
  fail 'Gateway access logs use the deprecated query-stripping formatter'
fi

if [[ $(grep -c -F -- 'exact: OPTIONS' "$BROKER_RENDERED_MANIFEST") -ne 6 ]]; then
  fail 'broker did not render exactly one OPTIONS route per public OAuth path'
fi

if grep -E -- "^[[:space:]]*prefix:[[:space:]]+/oauth[[:space:]]*$" \
    "$BROKER_RENDERED_MANIFEST" >/dev/null; then
  fail 'broker rendered a broad /oauth prefix route'
fi

if grep -E -- "^[[:space:]]*prefix:[[:space:]]+/auth[[:space:]]*$" \
    "$BROKER_RENDERED_MANIFEST" >/dev/null; then
  fail 'broker rendered a broad /auth prefix route'
fi

if grep -A12 -B2 -F 'kind: Secret' "$MCP_MANIFEST" | \
    grep -i -F 'mcp' >/dev/null; then
  fail 'enabled mode rendered an MCP credential Secret'
fi
if grep -E 'OSMO_MCP_(TOKEN|CREDENTIAL|SECRET)' \
    "$MCP_MANIFEST" >/dev/null; then
  fail 'enabled mode rendered an MCP credential environment variable'
fi

expect_render_failure \
  'encoded alternate Gateway origin' \
  'services.mcp.resourceUrl must be a valid HTTPS origin' \
  --set 'services.mcp.resourceUrl=https://osmo.example.com%40evil.example.com/mcp'

expect_render_failure \
  'non-integer timeout' \
  'services.mcp.requestTimeoutSeconds must be between 1 and 60' \
  --set 'services.mcp.requestTimeoutSeconds=true'

expect_render_failure \
  'managed Gateway URL override' \
  'services.mcp.extraEnv must not override managed variable OSMO_GATEWAY_URL' \
  --set-json \
  'services.mcp.extraEnv=[{"name":"OSMO_GATEWAY_URL","value":"https://evil.example.com"}]'

expect_render_failure \
  'MCP authentication bypass' \
  'overlaps a protected MCP path' \
  --set 'gateway.envoy.extraSkipAuthPaths[0]=/mcp'

expect_render_failure \
  'query-prefixed MCP authentication bypass' \
  'overlaps a protected MCP path' \
  --set-string 'gateway.envoy.extraSkipAuthPaths[0]=/mcp?bypass=true'

expect_render_failure \
  'query-prefixed MCP metadata authentication bypass' \
  'overlaps a protected MCP path' \
  --set-string \
  'gateway.envoy.extraSkipAuthPaths[0]=/.well-known/oauth-protected-resource/mcp?bypass=true'

expect_broker_render_failure \
  'broker without MCP' \
  'services.mcp.oauthBroker.enabled requires services.mcp.enabled=true' \
  --set 'services.mcp.enabled=false'

expect_broker_render_failure \
  'broker issuer with a path' \
  'services.mcp.oauthBroker.issuerUrl must be a valid HTTPS origin without a path' \
  --set 'services.mcp.oauthBroker.issuerUrl=https://osmo.example.com/oauth'

expect_broker_render_failure \
  'broker issuer on a different origin' \
  'services.mcp.oauthBroker.issuerUrl must equal services.mcp.resourceUrl without /mcp' \
  --set 'services.mcp.oauthBroker.issuerUrl=https://other.example.com'

expect_broker_render_failure \
  'invalid broker Redis port' \
  'services.mcp.oauthBroker.redis.port must be between 1 and 65535' \
  --set 'services.mcp.oauthBroker.redis.port=0'

expect_broker_render_failure \
  'OIDC configuration with userinfo' \
  'services.mcp.oauthBroker.oidc.configUrl must be an absolute HTTPS URL without query or fragment' \
  --set 'services.mcp.oauthBroker.oidc.configUrl=https://user@login.example.com/.well-known/openid-configuration'

expect_broker_render_failure \
  'invalid OIDC JWKS port' \
  'services.mcp.oauthBroker.oidc.accessTokenJwksUrl port must be between 1 and 65535' \
  --set 'services.mcp.oauthBroker.oidc.accessTokenJwksUrl=https://login.example.com:65536/keys'

expect_broker_render_failure \
  'OIDC access-token audience with whitespace' \
  'services.mcp.oauthBroker.oidc.accessTokenAudience must be one non-empty value without whitespace or control characters' \
  --set-string 'services.mcp.oauthBroker.oidc.accessTokenAudience=api audience'

expect_broker_render_failure \
  'OIDC access-token audience mismatch' \
  'services.mcp.oauthBroker.oidc.accessTokenAudience must equal services.mcp.resourceUrl' \
  --set 'services.mcp.oauthBroker.oidc.accessTokenAudience=https://other.example.com/mcp'

expect_broker_render_failure \
  'OIDC full scope mismatch' \
  'services.mcp.oauthBroker.scope must equal services.mcp.resourceUrl followed by oidc.accessTokenRequiredScope' \
  --set 'services.mcp.oauthBroker.scope=https://other.example.com/access_as_user'

expect_broker_render_failure \
  'untrusted redirect origin with a path' \
  'trustedHttpsRedirectOrigins entries must be exact HTTPS origins' \
  --set 'services.mcp.oauthBroker.trustedHttpsRedirectOrigins[0]=https://trusted.example.com/callback'

expect_broker_render_failure \
  'broad OIDC callback authentication bypass' \
  'overlaps a protected MCP path' \
  --set 'gateway.envoy.extraSkipAuthPaths[0]=/auth'

expect_broker_render_failure \
  'broker managed issuer override' \
  'services.mcp.oauthBroker.extraEnv must not override managed variable OSMO_MCP_AUTH_ISSUER_URL' \
  --set-json \
  'services.mcp.oauthBroker.extraEnv=[{"name":"OSMO_MCP_AUTH_ISSUER_URL","value":"https://evil.example.com"}]'

echo 'MCP chart validation passed'
