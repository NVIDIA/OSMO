#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BOOTSTRAP_SCRIPT="$CHART_DIR/files/backend-token-bootstrap.sh"
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT INT TERM
FAKE_BIN="$TEST_DIRECTORY/bin"
FAKE_STATE_DIRECTORY="$TEST_DIRECTORY/state"
mkdir -p "$FAKE_BIN" "$FAKE_STATE_DIRECTORY"

cat > "$FAKE_BIN/kubectl" <<'FAKE_KUBECTL'
#!/bin/sh
set -eu

printf '%s\n' "$*" >> "$FAKE_STATE_DIRECTORY/commands"

if [ "$1" = get ]; then
    secret_name="$3"
    output_arguments="$*"
    if [ ! -f "$FAKE_STATE_DIRECTORY/$secret_name.token" ]; then
        case "$output_arguments" in
            *--ignore-not-found=true*) exit 0 ;;
            *) exit 1 ;;
        esac
    fi
    case "$output_arguments" in
        *metadata.name*) printf '%s' "$secret_name" ;;
        *previous-token*)
            if [ -f "$FAKE_STATE_DIRECTORY/$secret_name.previous-token" ]; then
                base64 < "$FAKE_STATE_DIRECTORY/$secret_name.previous-token" | tr -d '\n'
            else
                case "$output_arguments" in
                    *'{{with index '*) ;;
                    *) printf '<no value>' ;;
                esac
            fi
            ;;
        *token*) base64 < "$FAKE_STATE_DIRECTORY/$secret_name.token" | tr -d '\n' ;;
    esac
    exit 0
fi

if [ "$1" = create ] && [ "$2" = secret ]; then
    secret_name="$4"
    cat > "$FAKE_STATE_DIRECTORY/pending-token"
    printf '%s\n' \
        'apiVersion: v1' \
        'kind: Secret' \
        'metadata:' \
        "  name: $secret_name" \
        'type: Opaque'
    printf '%s' "$secret_name" > "$FAKE_STATE_DIRECTORY/pending-name"
    exit 0
fi

if { [ "$1" = label ] || [ "$1" = annotate ]; } && [ "$2" = --local ]; then
    cat
    exit 0
fi

if [ "$1" = create ] && [ "$2" = -f ]; then
    cat >/dev/null
    secret_name=$(cat "$FAKE_STATE_DIRECTORY/pending-name")
    if [ "${FAKE_CREATE_FAILURE:-false}" = true ]; then
        exit 1
    fi
    cp "$FAKE_STATE_DIRECTORY/pending-token" \
        "$FAKE_STATE_DIRECTORY/$secret_name.token"
    if [ "${FAKE_CREATE_RACE:-false}" = true ]; then
        exit 1
    fi
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
        "$@"
}

output=$(run_bootstrap --secret-name generated-token)
generated_token=$(cat "$FAKE_STATE_DIRECTORY/generated-token.token")
if [[ ${#generated_token} -ne 43 ]]; then
    echo 'Generated backend token does not have the required 43-character length' >&2
    exit 1
fi
if [[ "$output" == *"$generated_token"* ]]; then
    echo 'Bootstrap output exposed generated token material' >&2
    exit 1
fi

output=$(run_bootstrap --secret-name generated-token)
if [[ "$output" != *'already exists; preserving it'* ]]; then
    echo 'Existing backend token was not preserved' >&2
    exit 1
fi
if ! grep -q '{{with index .data "previous-token"}}{{.}}{{end}}' \
        "$FAKE_STATE_DIRECTORY/commands"; then
    echo 'Optional token lookup does not suppress the kubectl <no value> marker' >&2
    exit 1
fi

previous_token=$(printf 'p%.0s' {1..43})
printf '%s' "$previous_token" > \
    "$FAKE_STATE_DIRECTORY/generated-token.previous-token"
run_bootstrap --secret-name generated-token >/dev/null

printf '%s' "$generated_token" > \
    "$FAKE_STATE_DIRECTORY/generated-token.previous-token"
if output=$(run_bootstrap --secret-name generated-token 2>&1); then
    echo 'Duplicate current and previous backend tokens were accepted' >&2
    exit 1
fi
if [[ "$output" != *'contains duplicate tokens'* ]]; then
    echo 'Duplicate-token failure did not identify the invalid Secret' >&2
    exit 1
fi
rm -f "$FAKE_STATE_DIRECTORY/generated-token.previous-token"

if output=$(run_bootstrap --fail-if-missing --secret-name missing-token 2>&1); then
    echo 'Upgrade unexpectedly regenerated a missing backend token' >&2
    exit 1
fi
if [[ "$output" != *'missing during upgrade'* ]]; then
    echo 'Missing-upgrade failure did not explain the recovery action' >&2
    exit 1
fi

export FAKE_CREATE_RACE=true
output=$(run_bootstrap --secret-name raced-token)
unset FAKE_CREATE_RACE
if [[ "$output" != *'created concurrently; preserving it'* ]]; then
    echo 'Concurrent Secret creation was not reconciled' >&2
    exit 1
fi

export FAKE_CREATE_FAILURE=true
if output=$(run_bootstrap --secret-name failed-token 2>&1); then
    echo 'Bootstrap unexpectedly ignored a Secret create failure' >&2
    exit 1
fi
unset FAKE_CREATE_FAILURE
if [[ "$output" != *'Unable to create backend token Secret failed-token'* ]]; then
    echo 'Secret create failure did not identify the affected Secret' >&2
    exit 1
fi
