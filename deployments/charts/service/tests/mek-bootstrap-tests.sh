#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BOOTSTRAP_SCRIPT="$CHART_DIR/files/mek-bootstrap.sh"
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
    if [ ! -f "$FAKE_STATE_DIRECTORY/$secret_name.exists" ]; then
        case "$*" in
            *--ignore-not-found=true*) exit 0 ;;
            *) exit 1 ;;
        esac
    fi
    case "$*" in
        *metadata.name*) printf '%s' "$secret_name" ;;
        *'.data '*)
            if [ -f "$FAKE_STATE_DIRECTORY/$secret_name.mek" ]; then
                base64 < "$FAKE_STATE_DIRECTORY/$secret_name.mek" | tr -d '\n'
            fi
            ;;
        *mek-bootstrap-placeholder*)
            if [ -f "$FAKE_STATE_DIRECTORY/$secret_name.placeholder" ]; then
                printf true
            fi
            ;;
    esac
    exit 0
fi

if [ "$1" = create ] && [ "$2" = secret ]; then
    secret_name="$4"
    for argument in "$@"; do
        case "$argument" in
            --from-file=*) source_path=${argument#*=}; source_path=${source_path#*=} ;;
        esac
    done
    cp "$source_path" "$FAKE_STATE_DIRECTORY/pending-mek"
    printf '%s' "$secret_name" > "$FAKE_STATE_DIRECTORY/pending-name"
    printf '{"apiVersion":"v1","kind":"Secret","metadata":{"name":"%s"}}\n' \
        "$secret_name"
    exit 0
fi

if { [ "$1" = label ] || [ "$1" = annotate ]; } && [ "$2" = --local ]; then
    cat
    exit 0
fi

if [ "$1" = patch ] && [ "$2" = secret ]; then
    secret_name=$(cat "$FAKE_STATE_DIRECTORY/pending-name")
    if [ "${FAKE_PATCH_FAILURE:-false}" = true ]; then
        exit 1
    fi
    cp "$FAKE_STATE_DIRECTORY/pending-mek" \
        "$FAKE_STATE_DIRECTORY/$secret_name.mek"
    touch "$FAKE_STATE_DIRECTORY/$secret_name.exists"
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
        --secret-name test-mek \
        --secret-key mek.yaml \
        "$@"
}

touch "$FAKE_STATE_DIRECTORY/test-mek.exists"
touch "$FAKE_STATE_DIRECTORY/test-mek.placeholder"
output=$(run_bootstrap)
generated_file="$FAKE_STATE_DIRECTORY/test-mek.mek"
grep -qx 'currentMek: key1' "$generated_file"
grep -qx 'meks:' "$generated_file"
jwk_encoded=$(awk '$1 == "key1:" { print $2 }' "$generated_file")
jwk=$(printf '%s' "$jwk_encoded" | base64 -d)
jwk_pattern='^\{"k":"[A-Za-z0-9_-]{43}","kid":"key1","kty":"oct"\}$'
if [[ ! "$jwk" =~ $jwk_pattern ]]; then
    echo 'Generated MEK is not a 256-bit oct JWK keyring' >&2
    exit 1
fi
key_material=$(sed -E 's/^\{"k":"([^"]+)".*/\1/' <<<"$jwk")
if [[ "$output" == *"$key_material"* ]] || [[ "$output" == *"$jwk_encoded"* ]]; then
    echo 'Bootstrap output exposed generated MEK material' >&2
    exit 1
fi

before_checksum=$(shasum -a 256 "$generated_file")
output=$(run_bootstrap)
after_checksum=$(shasum -a 256 "$generated_file")
if [[ "$before_checksum" != "$after_checksum" ]] || \
        [[ "$output" != *'already exists; preserving it'* ]]; then
    echo 'Existing MEK Secret was not preserved' >&2
    exit 1
fi

if output=$(run_bootstrap --fail-if-missing \
        --secret-name missing-mek 2>&1); then
    echo 'Upgrade unexpectedly regenerated a missing MEK Secret' >&2
    exit 1
fi
if [[ "$output" != *'missing during upgrade'* ]]; then
    echo 'Missing-upgrade failure did not explain the recovery action' >&2
    exit 1
fi
: > "$FAKE_STATE_DIRECTORY/empty-mek.mek"
touch "$FAKE_STATE_DIRECTORY/empty-mek.exists"
if output=$(run_bootstrap --secret-name empty-mek 2>&1); then
    echo 'Empty MEK Secret key was accepted' >&2
    exit 1
fi
if [[ "$output" != *'is missing key mek.yaml'* ]]; then
    echo 'Empty-key failure did not identify the invalid Secret' >&2
    exit 1
fi

if output=$(run_bootstrap --secret-name absent-mek 2>&1); then
    echo 'Bootstrap unexpectedly initialized an absent non-placeholder Secret' >&2
    exit 1
fi
if [[ "$output" != *'placeholder absent-mek is missing during install'* ]]; then
    echo 'Missing-placeholder failure did not identify the affected Secret' >&2
    exit 1
fi

touch "$FAKE_STATE_DIRECTORY/failed-mek.exists"
touch "$FAKE_STATE_DIRECTORY/failed-mek.placeholder"
export FAKE_PATCH_FAILURE=true
if output=$(run_bootstrap --secret-name failed-mek 2>&1); then
    echo 'Bootstrap unexpectedly ignored a MEK Secret patch failure' >&2
    exit 1
fi
unset FAKE_PATCH_FAILURE
if [[ "$output" != *'Unable to initialize MEK Secret failed-mek'* ]]; then
    echo 'Patch failure did not identify the affected MEK Secret' >&2
    exit 1
fi

if grep -qE '^create -f| create secret.*[^-]$' "$FAKE_STATE_DIRECTORY/commands"; then
    echo 'Bootstrap attempted a server-side Secret create' >&2
    exit 1
fi

if ! cmp -s "$BOOTSTRAP_SCRIPT" "$CHART_DIR/../osmo/files/mek-bootstrap.sh"; then
    echo 'The service and unified chart MEK bootstrap scripts diverged' >&2
    exit 1
fi
