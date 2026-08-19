#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BOOTSTRAP_SCRIPT="$CHART_DIRECTORY/files/mek-bootstrap.sh"
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT INT TERM
FAKE_BIN="$TEST_DIRECTORY/bin"
FAKE_STATE_DIRECTORY="$TEST_DIRECTORY/state"
mkdir -p "$FAKE_BIN" "$FAKE_STATE_DIRECTORY"

cat >"$FAKE_BIN/kubectl" <<'FAKE_KUBECTL'
#!/bin/sh
set -eu

printf '%s\n' "$*" >>"$FAKE_STATE_DIRECTORY/commands"

if [ "$1" = get ]; then
    secret_name="$3"
    output_arguments="$*"
    secret_file="$FAKE_STATE_DIRECTORY/$secret_name.mek.yaml"
    if [ ! -f "$secret_file" ]; then
        case "$output_arguments" in
            *--ignore-not-found=true*) exit 0 ;;
            *) exit 1 ;;
        esac
    fi
    case "$output_arguments" in
        *metadata.name*) printf '%s' "$secret_name" ;;
        *'.data '*) base64 <"$secret_file" | tr -d '\n' ;;
        *) exit 1 ;;
    esac
    exit 0
fi

if [ "$1" = create ] && [ "$2" = secret ]; then
    secret_name="$4"
    secret_file=""
    for argument in "$@"; do
        case "$argument" in
            --from-file=*) secret_file=${argument#*=}; secret_file=${secret_file#*=} ;;
        esac
    done
    [ -n "$secret_file" ]
    cp "$secret_file" "$FAKE_STATE_DIRECTORY/pending-mek.yaml"
    printf '%s\n' \
        'apiVersion: v1' \
        'kind: Secret' \
        'metadata:' \
        "  name: $secret_name" \
        'type: Opaque'
    printf '%s' "$secret_name" >"$FAKE_STATE_DIRECTORY/pending-name"
    exit 0
fi

if { [ "$1" = label ] || [ "$1" = annotate ]; } && [ "$2" = --local ]; then
    cat
    exit 0
fi

if [ "$1" = create ] && [ "$2" = -f ]; then
    cat >/dev/null
    secret_name=$(cat "$FAKE_STATE_DIRECTORY/pending-name")
    cp "$FAKE_STATE_DIRECTORY/pending-mek.yaml" \
        "$FAKE_STATE_DIRECTORY/$secret_name.mek.yaml"
    exit 0
fi

printf 'Unexpected fake kubectl command: %s\n' "$*" >&2
exit 1
FAKE_KUBECTL
chmod +x "$FAKE_BIN/kubectl"

export FAKE_STATE_DIRECTORY
export PATH="$FAKE_BIN:$PATH"

run_bootstrap() {
    bash "$BOOTSTRAP_SCRIPT" \
        --namespace osmo \
        --release-name test-release \
        --secret-name generated-mek \
        --secret-key mek.yaml \
        "$@"
}

output=$(run_bootstrap)
generated_mek="$FAKE_STATE_DIRECTORY/generated-mek.mek.yaml"
if [[ "$output" == *'currentMek:'* ]]; then
    echo 'Bootstrap output exposed MEK configuration' >&2
    exit 1
fi
grep -Fxq 'currentMek: key1' "$generated_mek"
grep -Fxq 'meks:' "$generated_mek"
grep -Eq '^  key1: [A-Za-z0-9+/=]+$' "$generated_mek"

encoded_jwk=$(awk '$1 == "key1:" { print $2 }' "$generated_mek")
jwk_json=$(printf '%s' "$encoded_jwk" | base64 --decode)
jwk_pattern='^\{"k":"([A-Za-z0-9_-]{43})","kid":"key1","kty":"oct"\}$'
if [[ ! "$jwk_json" =~ $jwk_pattern ]]; then
    echo 'Generated MEK does not contain the required 256-bit octet JWK' >&2
    exit 1
fi

first_digest=$(sha256sum "$generated_mek")
output=$(run_bootstrap)
if [[ "$first_digest" != "$(sha256sum "$generated_mek")" ]]; then
    echo 'Existing MEK was regenerated' >&2
    exit 1
fi
if [[ "$output" != *'already exists; preserving it'* ]]; then
    echo 'Existing MEK was not reported as preserved' >&2
    exit 1
fi

rm -f "$generated_mek"
if output=$(run_bootstrap --fail-if-missing 2>&1); then
    echo 'Upgrade unexpectedly regenerated a missing MEK' >&2
    exit 1
fi
if [[ "$output" != *'missing during upgrade'* ]]; then
    echo 'Missing-upgrade failure did not explain MEK recovery' >&2
    exit 1
fi

printf '%s\n' \
    'currentMek: leaked-invalid-mek' \
    'meks:' \
    '  leaked-invalid-mek: definitely-not-a-jwk' >"$generated_mek"
if output=$(run_bootstrap 2>&1); then
    echo 'Malformed MEK was accepted' >&2
    exit 1
fi
if [[ "$output" != *'has invalid format'* ]]; then
    echo 'Malformed MEK failure did not identify the invalid Secret' >&2
    exit 1
fi
if [[ "$output" == *'leaked-invalid-mek'* || "$output" == *'definitely-not-a-jwk'* ]]; then
    echo 'Malformed MEK content was exposed in bootstrap output' >&2
    exit 1
fi

echo 'PASS: MEK bootstrap tests'
