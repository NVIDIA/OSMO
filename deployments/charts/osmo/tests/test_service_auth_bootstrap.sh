#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ -n "${TEST_SRCDIR:-}" && -n "${TEST_WORKSPACE:-}" ]]; then
    BOOTSTRAP_SCRIPT="$TEST_SRCDIR/$TEST_WORKSPACE/deployments/charts/osmo/files/service-auth-bootstrap.sh"
else
    BOOTSTRAP_SCRIPT="$CHART_DIRECTORY/files/service-auth-bootstrap.sh"
fi
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT INT TERM
FAKE_BIN="$TEST_DIRECTORY/bin"
FAKE_STATE_DIRECTORY="$TEST_DIRECTORY/state"
FAKE_SERVICE_ACCOUNT_DIRECTORY="$TEST_DIRECTORY/service-account"
mkdir -p "$FAKE_BIN" "$FAKE_STATE_DIRECTORY" "$FAKE_SERVICE_ACCOUNT_DIRECTORY"
printf 'test-token' >"$FAKE_SERVICE_ACCOUNT_DIRECTORY/token"
printf 'test-ca' >"$FAKE_SERVICE_ACCOUNT_DIRECTORY/ca.crt"

cat >"$FAKE_BIN/step" <<'FAKE_STEP'
#!/bin/sh
set -eu

if [ "$1 $2 $3" = "crypto jwk create" ]; then
    public_file="$4"
    private_file="$5"
    printf '%s' \
        '{"alg":"RS256","e":"AQAB","kid":"test-key","kty":"RSA","n":"public-modulus","use":"sig"}' \
        >"$public_file"
    printf '%s' \
        '{"alg":"RS256","d":"private-sentinel","dp":"dp","dq":"dq","e":"AQAB","kid":"test-key","kty":"RSA","n":"public-modulus","p":"p","q":"q","qi":"qi","use":"sig"}' \
        >"$private_file"
    exit 0
fi

if [ "$1 $2 $3" = "crypto jwk public" ]; then
    jq -cS '{alg,e,kid,kty,n,use}'
    exit 0
fi

printf 'Unexpected fake step command: %s\n' "$*" >&2
exit 1
FAKE_STEP

cat >"$FAKE_BIN/curl" <<'FAKE_CURL'
#!/bin/sh
set -eu

method=GET
output_file=""
input_file=""
url=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --request)
            method="$2"
            shift 2
            ;;
        --output)
            output_file="$2"
            shift 2
            ;;
        --data-binary)
            input_file=${2#@}
            shift 2
            ;;
        --cacert|--header|--write-out)
            shift 2
            ;;
        --silent|--show-error)
            shift
            ;;
        *)
            url="$1"
            shift
            ;;
    esac
done
printf '%s %s\n' "$method" "$url" >>"$FAKE_STATE_DIRECTORY/requests"

if [ "$method" = GET ]; then
    if [ -f "$FAKE_STATE_DIRECTORY/secret-response.json" ]; then
        cp "$FAKE_STATE_DIRECTORY/secret-response.json" "$output_file"
        printf '200'
    else
        printf '{"kind":"Status","reason":"NotFound"}' >"$output_file"
        printf '404'
    fi
    exit 0
fi

if [ "$method" = POST ]; then
    cp "$input_file" "$FAKE_STATE_DIRECTORY/create-request.json"
    jq '
        .data = (.stringData | with_entries(.value |= @base64)) |
        del(.stringData)
    ' "$input_file" >"$FAKE_STATE_DIRECTORY/secret-response.json"
    cp "$FAKE_STATE_DIRECTORY/secret-response.json" "$output_file"
    if [ "${FAKE_CREATE_CONFLICT:-false}" = true ]; then
        printf '409'
    elif [ "${FAKE_CREATE_FAILURE:-false}" = true ]; then
        printf '500'
    else
        printf '201'
    fi
    exit 0
fi

printf 'Unexpected fake curl request: %s %s\n' "$method" "$url" >&2
exit 1
FAKE_CURL

chmod +x "$FAKE_BIN/step" "$FAKE_BIN/curl"
export FAKE_STATE_DIRECTORY
export KUBERNETES_API_URL=https://kubernetes.test
export KUBERNETES_SERVICE_ACCOUNT_DIRECTORY="$FAKE_SERVICE_ACCOUNT_DIRECTORY"
export PATH="$FAKE_BIN:$PATH"

run_bootstrap() {
    work_directory=$(mktemp -d "$TEST_DIRECTORY/work.XXXXXX")
    sh "$BOOTSTRAP_SCRIPT" \
        --namespace osmo-test \
        --release-name test-release \
        --target-secret osmo-service-auth \
        --target-key authentication-config.json \
        --work-directory "$work_directory"
}

output=$(run_bootstrap)
if [[ "$output" != *'Initialized Kubernetes service auth Secret osmo-service-auth'* ]]; then
    echo 'Fresh bootstrap did not report Secret creation' >&2
    exit 1
fi
if [[ "$output" == *private-sentinel* ]]; then
    echo 'Fresh bootstrap output exposed private key material' >&2
    exit 1
fi
if ! jq -e '
    .metadata.labels["app.kubernetes.io/managed-by"] ==
        "osmo-service-auth-bootstrap" and
    .metadata.annotations["osmo.nvidia.com/service-auth-bootstrap-installation"] ==
        "osmo-test/test-release" and
    .metadata.annotations["osmo.nvidia.com/credential-source"] ==
        "osmo-chart-bootstrap" and
    (.stringData["authentication-config.json"] | fromjson |
        .active_key == "test-key" and
        .issuer == "osmo" and .audience == "osmo" and
        (.keys["test-key"].private_key | fromjson | .d == "private-sentinel"))
' "$FAKE_STATE_DIRECTORY/create-request.json" >/dev/null; then
    echo 'Fresh bootstrap did not create the expected service auth Secret' >&2
    exit 1
fi

output=$(run_bootstrap)
if [[ "$output" != *'Validated existing bootstrap service auth Secret osmo-service-auth'* ]]; then
    echo 'Exact bootstrap retry was not preserved' >&2
    exit 1
fi
if [[ $(grep -c '^POST ' "$FAKE_STATE_DIRECTORY/requests") -ne 1 ]]; then
    echo 'Exact bootstrap retry attempted to recreate the Secret' >&2
    exit 1
fi

cp "$FAKE_STATE_DIRECTORY/secret-response.json" \
    "$FAKE_STATE_DIRECTORY/valid-secret-response.json"
jq '.metadata.annotations["osmo.nvidia.com/service-auth-bootstrap-installation"] = "other/release"' \
    "$FAKE_STATE_DIRECTORY/valid-secret-response.json" \
    >"$FAKE_STATE_DIRECTORY/secret-response.json"
if output=$(run_bootstrap 2>&1); then
    echo 'Bootstrap accepted a Secret owned by another installation' >&2
    exit 1
fi
if [[ "$output" != *'not an exact bootstrap retry'* ]]; then
    echo 'Bootstrap did not explain the ownership rejection' >&2
    exit 1
fi

cp "$FAKE_STATE_DIRECTORY/valid-secret-response.json" \
    "$FAKE_STATE_DIRECTORY/secret-response.json"
jq '.metadata.annotations["osmo.nvidia.com/service-auth-bootstrap-digest"] =
        "0000000000000000000000000000000000000000000000000000000000000000"' \
    "$FAKE_STATE_DIRECTORY/secret-response.json" \
    >"$FAKE_STATE_DIRECTORY/tampered-secret.json"
mv "$FAKE_STATE_DIRECTORY/tampered-secret.json" \
    "$FAKE_STATE_DIRECTORY/secret-response.json"
if output=$(run_bootstrap 2>&1); then
    echo 'Bootstrap accepted a Secret with a mismatched digest' >&2
    exit 1
fi
if [[ "$output" != *'identity does not match its data'* ]]; then
    echo 'Bootstrap did not explain the digest rejection' >&2
    exit 1
fi

cp "$FAKE_STATE_DIRECTORY/valid-secret-response.json" \
    "$FAKE_STATE_DIRECTORY/secret-response.json"
jq -er '.data["authentication-config.json"]' \
    "$FAKE_STATE_DIRECTORY/secret-response.json" | base64 -d \
    >"$FAKE_STATE_DIRECTORY/tampered-auth.json"
jq -cS '.keys["test-key"].private_key |=
    (fromjson | .n = "different-private-modulus" | tojson)' \
    "$FAKE_STATE_DIRECTORY/tampered-auth.json" \
    >"$FAKE_STATE_DIRECTORY/tampered-key-auth.json"
tampered_key_digest=$(sha256sum "$FAKE_STATE_DIRECTORY/tampered-key-auth.json" |
    awk '{print $1}')
tampered_key_data=$(base64 <"$FAKE_STATE_DIRECTORY/tampered-key-auth.json" |
    tr -d '\n')
jq --arg digest "$tampered_key_digest" --arg data "$tampered_key_data" '
    .metadata.annotations["osmo.nvidia.com/service-auth-bootstrap-digest"] = $digest |
    .data["authentication-config.json"] = $data
' "$FAKE_STATE_DIRECTORY/secret-response.json" \
    >"$FAKE_STATE_DIRECTORY/tampered-key-secret.json"
mv "$FAKE_STATE_DIRECTORY/tampered-key-secret.json" \
    "$FAKE_STATE_DIRECTORY/secret-response.json"
if output=$(run_bootstrap 2>&1); then
    echo 'Bootstrap accepted a mismatched public/private key pair' >&2
    exit 1
fi
if [[ "$output" != *'Secret osmo-service-auth is invalid'* ]]; then
    echo 'Bootstrap did not explain the mismatched key-pair rejection' >&2
    exit 1
fi

rm "$FAKE_STATE_DIRECTORY/secret-response.json"
output=$(FAKE_CREATE_CONFLICT=true run_bootstrap)
if [[ "$output" != *'was created concurrently; preserving it'* ]]; then
    echo 'Bootstrap did not preserve an exact concurrent create' >&2
    exit 1
fi

rm "$FAKE_STATE_DIRECTORY/secret-response.json"
if output=$(FAKE_CREATE_FAILURE=true run_bootstrap 2>&1); then
    echo 'Bootstrap ignored a Kubernetes API create failure' >&2
    exit 1
fi
if [[ "$output" != *'Kubernetes API status 500'* ]]; then
    echo 'Bootstrap did not report the Kubernetes API create failure' >&2
    exit 1
fi

echo 'Service auth bootstrap tests passed'
