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
RENDERED_MANIFEST="$(mktemp)"
MCP_MANIFEST="$(mktemp)"
DISABLED_MANIFEST="$(mktemp)"
trap 'rm -f "$RENDERED_MANIFEST" "$MCP_MANIFEST" "$DISABLED_MANIFEST"' EXIT

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

helm lint "$CHART_DIR" --values "$VALUES_FILE"
helm template mcp-disabled "$CHART_DIR" >"$DISABLED_MANIFEST"
helm template mcp-validation "$CHART_DIR" \
  --values "$VALUES_FILE" >"$RENDERED_MANIFEST"
helm template mcp-validation "$CHART_DIR" \
  --values "$VALUES_FILE" \
  --show-only templates/mcp-service.yaml >"$MCP_MANIFEST"

for forbidden in \
    'name: osmo-mcp' \
    'cluster: osmo-mcp' \
    'path: /mcp' \
    'path: /.well-known/oauth-protected-resource/mcp'; do
  if grep -F -- "$forbidden" "$DISABLED_MANIFEST" >/dev/null; then
    fail "disabled mode rendered MCP configuration: $forbidden"
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

echo 'MCP chart validation passed'
