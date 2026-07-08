#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

HELM_BIN=${HELM_BIN:-helm}
CHART=deployments/charts/service
VALUES=${CHART}/ci/mcp-values.yaml

render() {
  "${HELM_BIN}" template test-release "${CHART}" --values "${VALUES}" "$@"
}

extract_resource() {
  local kind=$1
  local name=$2

  awk -v target_kind="${kind}" -v target_name="${name}" '
    function reset_document() {
      document = ""
      has_kind = 0
      has_name = 0
    }
    function finish_document() {
      if (has_kind && has_name) {
        printf "%s", document
        matches++
      }
      reset_document()
    }
    BEGIN { reset_document() }
    /^---$/ { finish_document(); next }
    {
      document = document $0 ORS
      if ($0 == "kind: " target_kind) { has_kind = 1 }
      if ($0 == "  name: " target_name) { has_name = 1 }
    }
    END {
      finish_document()
      if (matches != 1) { exit 1 }
    }
  '
}

require_sequence() {
  local input=$1
  shift
  local expected
  expected=$(printf '%s\034' "$@")

  awk -v expected="${expected}" '
    BEGIN { count = split(expected, lines, "\034") - 1 }
    {
      if ($0 == lines[matched + 1]) {
        matched++
        if (matched == count) {
          occurrences++
          matched = 0
        }
      } else if ($0 == lines[1]) {
        matched = 1
      } else {
        matched = 0
      }
    }
    END { if (occurrences != 1) { exit 1 } }
  ' <<< "${input}"
}

expect_failure() {
  local description=$1
  local expected_message=$2
  shift 2

  local output
  if output=$(render "$@" 2>&1); then
    echo "Expected Helm failure: ${description}" >&2
    exit 1
  fi
  if ! grep -Fq -- "${expected_message}" <<< "${output}"; then
    echo "Helm failed for the wrong reason: ${description}" >&2
    echo "Expected message: ${expected_message}" >&2
    echo "Actual output: ${output}" >&2
    exit 1
  fi
}

OUTPUT=$(render)
MCP_DEPLOYMENT=$(extract_resource Deployment osmo-mcp <<< "${OUTPUT}")
MCP_NETWORK_POLICY=$(
  extract_resource NetworkPolicy osmo-mcp-allow-gateway-envoy <<< "${OUTPUT}"
)
MCP_ROUTE=$(awk '
  /^[[:space:]]*- name: osmo-mcp$/ { capture=1 }
  capture && /^[[:space:]]*- match:/ { exit }
  capture { print }
' <<< "${OUTPUT}")
METADATA_ROUTE=$(awk '
  /^[[:space:]]*- name: mcp-protected-resource-metadata$/ { capture=1 }
  capture && /^[[:space:]]*- name: osmo-mcp$/ { exit }
  capture { print }
' <<< "${OUTPUT}")

[[ $(grep -Ec '^[[:space:]]{16}- name: osmo-mcp$' <<< "${OUTPUT}") -eq 1 ]]
[[ $(grep -Ec '^[[:space:]]{16}- name: mcp-protected-resource-metadata$' <<< "${OUTPUT}") -eq 1 ]]
grep -Fq 'path: /mcp' <<< "${MCP_ROUTE}"
grep -Fq 'cluster: osmo-mcp' <<< "${MCP_ROUTE}"
grep -Fq 'request_headers_to_remove:' <<< "${MCP_ROUTE}"
if grep -Fq 'typed_per_filter_config:' <<< "${MCP_ROUTE}"; then
  echo 'The protected MCP route must not disable authentication filters.' >&2
  exit 1
fi
for header in \
  authorization \
  proxy-authorization \
  cookie \
  x-osmo-auth \
  x-osmo-roles \
  x-osmo-token-name \
  x-osmo-workflow-id \
  x-osmo-allowed-pools; do
  grep -Fq -- "- ${header}" <<< "${MCP_ROUTE}"
done
grep -Fq 'path: /.well-known/oauth-protected-resource/mcp' <<< "${METADATA_ROUTE}"
grep -Fq 'exact: GET' <<< "${METADATA_ROUTE}"
grep -Fq 'envoy.filters.http.jwt_authn:' <<< "${METADATA_ROUTE}"
grep -Fq 'envoy.filters.http.ext_authz:' <<< "${METADATA_ROUTE}"
[[ $(grep -Fc 'disabled: true' <<< "${METADATA_ROUTE}") -eq 2 ]]

require_sequence "${MCP_NETWORK_POLICY}" \
  '  podSelector:' \
  '    matchLabels:' \
  '      app: osmo-mcp'
require_sequence "${MCP_NETWORK_POLICY}" \
  '  ingress:' \
  '  - from:' \
  '    - podSelector:' \
  '        matchLabels:' \
  '          app.kubernetes.io/name: osmo-gateway' \
  '          app.kubernetes.io/instance: test-release' \
  '          app.kubernetes.io/component: envoy' \
  '    ports:' \
  '    - port: 8000' \
  '      protocol: TCP'
require_sequence "${MCP_DEPLOYMENT}" \
  '        - name: OSMO_MCP_SERVICE_TOKEN_FILE' \
  '          value: "/var/run/secrets/osmo-mcp/token"'
require_sequence "${MCP_DEPLOYMENT}" \
  '        - name: mcp-service-token' \
  '          mountPath: "/var/run/secrets/osmo-mcp"' \
  '          readOnly: true'
require_sequence "${MCP_DEPLOYMENT}" \
  '      - name: mcp-service-token' \
  '        secret:' \
  '          secretName: "osmo-mcp-service-token"' \
  '          items:' \
  '          - key: "token"' \
  '            path: "token"'

# Runtime and chart boundaries must agree exactly.
render --set services.mcp.tokenCacheMaxSize=1 >/dev/null
render --set services.mcp.tokenCacheMaxSize=10000 >/dev/null
render --set services.mcp.tokenCacheSkewSeconds=0 >/dev/null
render --set services.mcp.tokenCacheSkewSeconds=120 >/dev/null
render --set services.mcp.requestTimeoutSeconds=0.5 >/dev/null
render --set services.mcp.requestTimeoutSeconds=60 >/dev/null

CA_OUTPUT=$(render \
  --set-string services.mcp.gatewayCaSecretName=osmo-public-gateway-ca)
CA_DEPLOYMENT=$(extract_resource Deployment osmo-mcp <<< "${CA_OUTPUT}")
require_sequence "${CA_DEPLOYMENT}" \
  '        - name: OSMO_MCP_GATEWAY_CA_FILE' \
  '          value: "/var/run/secrets/osmo-mcp-gateway-ca/ca.crt"'
require_sequence "${CA_DEPLOYMENT}" \
  '        - name: mcp-gateway-ca' \
  '          mountPath: "/var/run/secrets/osmo-mcp-gateway-ca"' \
  '          readOnly: true'
require_sequence "${CA_DEPLOYMENT}" \
  '      - name: mcp-gateway-ca' \
  '        secret:' \
  '          secretName: "osmo-public-gateway-ca"' \
  '          items:' \
  '          - key: "ca.crt"' \
  '            path: "ca.crt"'

expect_failure 'Envoy disabled' \
  'services.mcp.enabled requires gateway.envoy.enabled=true' \
  --set gateway.envoy.enabled=false
expect_failure 'Authz disabled' \
  'services.mcp.enabled requires gateway.authz.enabled=true' \
  --set gateway.authz.enabled=false
expect_failure 'NetworkPolicy disabled' \
  'services.mcp.enabled requires gateway.networkPolicies.enabled=true' \
  --set gateway.networkPolicies.enabled=false
expect_failure 'file-backed roles enabled' \
  'services.mcp.enabled requires database-backed roles' \
  --set services.configs.enabled=true
expect_failure 'internal JWKS disabled' \
  'services.mcp.enabled requires gateway.envoy.internalJwks.enabled=true' \
  --set gateway.envoy.internalJwks.enabled=false

for provider_field in issuer audience user_claim cluster jwks_uri; do
  expect_failure "wrong OSMO provider ${provider_field}" \
    'services.mcp.enabled requires a matching OSMO JWT provider' \
    --set-string "gateway.envoy.jwt.providers[1].${provider_field}=wrong"
done

expect_failure 'HTTP MCP resource URL' \
  'services.mcp.resourceUrl must be an HTTPS origin' \
  --set-string services.mcp.resourceUrl=http://osmo.example.com/mcp
expect_failure 'MCP resource URL with userinfo' \
  'services.mcp.resourceUrl must be an HTTPS origin' \
  --set-string services.mcp.resourceUrl=https://user@osmo.example.com/mcp
expect_failure 'API and resource URL mismatch' \
  'services.mcp.apiUrl must be the HTTPS gateway origin' \
  --set-string services.mcp.apiUrl=https://other.example.com

expect_failure 'missing service-token Secret' \
  'services.mcp.serviceTokenSecretName is required' \
  --set-string services.mcp.serviceTokenSecretName=
expect_failure 'invalid service-token Secret key' \
  'services.mcp.serviceTokenSecretKey must be a valid Kubernetes Secret data key' \
  --set-string services.mcp.serviceTokenSecretKey=bad/key
expect_failure 'service-token path outside managed directory' \
  'services.mcp.serviceTokenFile must be a file directly under' \
  --set-string services.mcp.serviceTokenFile=/tmp/token
expect_failure 'invalid gateway CA Secret name' \
  'services.mcp.gatewayCaSecretName must be a valid Kubernetes Secret name' \
  --set-string services.mcp.gatewayCaSecretName=Bad_Name
expect_failure 'missing gateway CA Secret key' \
  'services.mcp.gatewayCaSecretKey is required' \
  --set-string services.mcp.gatewayCaSecretName=osmo-ca \
  --set-string services.mcp.gatewayCaSecretKey=
expect_failure 'gateway CA path outside managed directory' \
  'services.mcp.gatewayCaFile must be a file directly under' \
  --set-string services.mcp.gatewayCaSecretName=osmo-ca \
  --set-string services.mcp.gatewayCaFile=/tmp/ca.crt

expect_failure 'zero cache size' \
  'services.mcp.tokenCacheMaxSize must be between 1 and 10000' \
  --set services.mcp.tokenCacheMaxSize=0
expect_failure 'excessive cache size' \
  'services.mcp.tokenCacheMaxSize must be between 1 and 10000' \
  --set services.mcp.tokenCacheMaxSize=10001
expect_failure 'fractional cache size' \
  'services.mcp.tokenCacheMaxSize must be between 1 and 10000' \
  --set services.mcp.tokenCacheMaxSize=1.5
expect_failure 'negative cache skew' \
  'services.mcp.tokenCacheSkewSeconds must be between 0 and 120' \
  --set services.mcp.tokenCacheSkewSeconds=-0.5
expect_failure 'excessive cache skew' \
  'services.mcp.tokenCacheSkewSeconds must be between 0 and 120' \
  --set services.mcp.tokenCacheSkewSeconds=120.5
expect_failure 'nonnumeric cache skew' \
  'services.mcp.tokenCacheSkewSeconds must be between 0 and 120' \
  --set-string services.mcp.tokenCacheSkewSeconds=invalid
expect_failure 'zero request timeout' \
  'services.mcp.requestTimeoutSeconds must be greater than 0' \
  --set services.mcp.requestTimeoutSeconds=0
expect_failure 'excessive request timeout' \
  'services.mcp.requestTimeoutSeconds must be greater than 0' \
  --set services.mcp.requestTimeoutSeconds=60.5

expect_failure 'managed environment override' \
  'services.mcp.extraEnv must not override chart-managed variable OSMO_API_URL' \
  --set-string 'services.mcp.extraEnv[0].name=OSMO_API_URL' \
  --set-string 'services.mcp.extraEnv[0].value=https://attacker.test'
expect_failure 'empty authorization server' \
  'services.mcp.authorizationServers entry' \
  --set-json 'services.mcp.authorizationServers=[""]'
expect_failure 'authorization server with credentials' \
  'services.mcp.authorizationServers entry' \
  --set-json 'services.mcp.authorizationServers=["https://user@idp.example.com"]'
expect_failure 'scope containing whitespace' \
  'services.mcp.scopes entries must be valid OAuth scope tokens' \
  --set-json 'services.mcp.scopes=[" openid"]'
expect_failure 'scope containing a quote' \
  'services.mcp.scopes entries must be valid OAuth scope tokens' \
  --set-json 'services.mcp.scopes=["bad\"scope"]'
expect_failure 'scope containing a backslash' \
  'services.mcp.scopes entries must be valid OAuth scope tokens' \
  --set-json 'services.mcp.scopes=["bad\\scope"]'
expect_failure 'Origin containing credentials' \
  'services.mcp.allowedOrigins entry' \
  --set-json 'services.mcp.allowedOrigins=["https://user@client.example.com"]'
expect_failure 'Origin containing trailing whitespace' \
  'services.mcp.allowedOrigins entry' \
  --set-json 'services.mcp.allowedOrigins=["https://client.example.com "]'

expect_failure 'missing public PAT exchange' \
  'services.mcp.enabled requires /api/auth/jwt/access_token' \
  --set-json 'gateway.envoy.skipAuthPaths=["/api/version"]'
expect_failure 'delegation authentication bypass' \
  'overlaps the MCP delegation endpoint' \
  --set-string 'gateway.envoy.extraSkipAuthPaths[0]=/api/auth/jwt/delegated_access_token'
expect_failure 'MCP authentication bypass' \
  'overlaps a protected MCP path' \
  --set-string 'gateway.envoy.extraSkipAuthPaths[0]=/mcp'
expect_failure 'metadata authentication bypass prefix' \
  'overlaps a protected MCP path' \
  --set-string 'gateway.envoy.extraSkipAuthPaths[0]=/.well-known'

"${HELM_BIN}" lint "${CHART}" --values "${VALUES}" >/dev/null
echo 'MCP Helm security checks passed'
