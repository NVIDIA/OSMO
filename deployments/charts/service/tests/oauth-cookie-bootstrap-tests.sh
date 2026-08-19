#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT INT TERM
FAKE_BIN="$TEST_DIRECTORY/bin"
FAKE_STATE_DIRECTORY="$TEST_DIRECTORY/state"
mkdir -p "$FAKE_BIN" "$FAKE_STATE_DIRECTORY"

cat > "$FAKE_BIN/kubectl" <<'FAKE_KUBECTL'
#!/bin/sh
set -eu

if [ "$1" = get ]; then
    secret_name="$3"
    if [ ! -f "$FAKE_STATE_DIRECTORY/$secret_name.exists" ]; then
        if [ -f "$FAKE_STATE_DIRECTORY/$secret_name.appear-after" ]; then
            remaining=$(cat "$FAKE_STATE_DIRECTORY/$secret_name.appear-after")
            if [ "$remaining" -le 0 ]; then
                touch "$FAKE_STATE_DIRECTORY/$secret_name.exists"
                rm -f "$FAKE_STATE_DIRECTORY/$secret_name.appear-after"
            else
                printf '%s' "$((remaining - 1))" \
                    > "$FAKE_STATE_DIRECTORY/$secret_name.appear-after"
            fi
        fi
    fi
    if [ ! -f "$FAKE_STATE_DIRECTORY/$secret_name.exists" ]; then
        case "$*" in *--ignore-not-found=true*) exit 0 ;; *) exit 1 ;; esac
    fi
    case "$*" in
        *metadata.name*) printf '%s' "$secret_name" ;;
        *metadata.resourceVersion*)
            cat "$FAKE_STATE_DIRECTORY/$secret_name.resource-version" \
                2>/dev/null || printf 1 ;;
        *app.kubernetes.io/managed-by*)
            cat "$FAKE_STATE_DIRECTORY/$secret_name.managed-by" 2>/dev/null || true ;;
        *app.kubernetes.io/instance*)
            cat "$FAKE_STATE_DIRECTORY/$secret_name.instance" 2>/dev/null || true ;;
        *'.data '*|*'index .data'*)
            if [ -f "$FAKE_STATE_DIRECTORY/$secret_name.cookie" ]; then
                base64 < "$FAKE_STATE_DIRECTORY/$secret_name.cookie" | tr -d '\n'
            fi ;;
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
    cp "$source_path" "$FAKE_STATE_DIRECTORY/pending-cookie"
    printf '%s' "$secret_name" > "$FAKE_STATE_DIRECTORY/pending-name"
    printf '{"apiVersion":"v1","kind":"Secret","metadata":{"name":"%s"}}\n' \
        "$secret_name"
    exit 0
fi

if [ "$1" = label ] && [ "$2" = --local ]; then
    cat
    exit 0
fi

if [ "$1" = patch ] && [ "$2" = secret ]; then
    secret_name="$3"
    expect_patch_file=false
    for argument in "$@"; do
        if [ "$expect_patch_file" = true ]; then
            patch_file=$argument
            expect_patch_file=false
            continue
        fi
        case "$argument" in
            --patch-file) expect_patch_file=true ;;
            --patch-file=*) patch_file=${argument#*=} ;;
        esac
    done
    grep -q '"resourceVersion"' "$patch_file"
    if [ -f "$FAKE_STATE_DIRECTORY/$secret_name.conflict-once" ]; then
        cp "$FAKE_STATE_DIRECTORY/$secret_name.concurrent-cookie" \
            "$FAKE_STATE_DIRECTORY/$secret_name.cookie"
        printf 2 > "$FAKE_STATE_DIRECTORY/$secret_name.resource-version"
        rm -f "$FAKE_STATE_DIRECTORY/$secret_name.conflict-once"
        exit 1
    fi
    encoded_cookie=$(sed -n \
        's/.*"data":{"[^"]*":"\([^"]*\)"}.*/\1/p' "$patch_file")
    [ -n "$encoded_cookie" ]
    printf '%s' "$encoded_cookie" | base64 -d \
        > "$FAKE_STATE_DIRECTORY/$secret_name.cookie"
    printf 2 > "$FAKE_STATE_DIRECTORY/$secret_name.resource-version"
    exit 0
fi

printf 'Unexpected fake kubectl command: %s\n' "$*" >&2
exit 1
FAKE_KUBECTL
chmod +x "$FAKE_BIN/kubectl"
printf '#!/bin/sh\nexit 0\n' > "$FAKE_BIN/sleep"
chmod +x "$FAKE_BIN/sleep"

export FAKE_STATE_DIRECTORY
export PATH="$FAKE_BIN:$PATH"

run_bootstrap() {
    local script=$1
    shift
    bash "$script" \
        --namespace osmo \
        --release-name test-release \
        --secret-name test-cookie \
        --secret-key cookie_secret \
        "$@"
}

for bootstrap_script in \
        "$CHART_DIR/files/oauth-cookie-bootstrap.sh" \
        "$CHART_DIR/../osmo/files/oauth-cookie-bootstrap.sh"; do
    rm -f "$FAKE_STATE_DIRECTORY"/*
    touch "$FAKE_STATE_DIRECTORY/test-cookie.exists"
    printf osmo-oauth-cookie-bootstrap \
        > "$FAKE_STATE_DIRECTORY/test-cookie.managed-by"
    printf test-release > "$FAKE_STATE_DIRECTORY/test-cookie.instance"

    output=$(run_bootstrap "$bootstrap_script")
    generated_cookie=$(cat "$FAKE_STATE_DIRECTORY/test-cookie.cookie")
    if [[ ! "$generated_cookie" =~ ^[A-Za-z0-9_-]{43}=$ ]]; then
        echo 'Generated OAuth cookie is not a URL-safe 256-bit value' >&2
        exit 1
    fi
    if [[ "$output" == *"$generated_cookie"* ]]; then
        echo 'Bootstrap output exposed generated OAuth cookie material' >&2
        exit 1
    fi

    before_checksum=$(shasum -a 256 "$FAKE_STATE_DIRECTORY/test-cookie.cookie")
    run_bootstrap "$bootstrap_script" >/dev/null
    after_checksum=$(shasum -a 256 "$FAKE_STATE_DIRECTORY/test-cookie.cookie")
    if [[ "$before_checksum" != "$after_checksum" ]]; then
        echo 'Existing generated OAuth cookie was replaced' >&2
        exit 1
    fi

    concurrent_cookie=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
    : > "$FAKE_STATE_DIRECTORY/test-cookie.cookie"
    printf '%s' "$concurrent_cookie" \
        > "$FAKE_STATE_DIRECTORY/test-cookie.concurrent-cookie"
    touch "$FAKE_STATE_DIRECTORY/test-cookie.conflict-once"
    run_bootstrap "$bootstrap_script" >/dev/null
    if [[ $(cat "$FAKE_STATE_DIRECTORY/test-cookie.cookie") \
            != "$concurrent_cookie" ]]; then
        echo 'Concurrent OAuth cookie winner was overwritten' >&2
        exit 1
    fi

    printf 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' \
        > "$FAKE_STATE_DIRECTORY/test-cookie.cookie"
    if run_bootstrap "$bootstrap_script" >/dev/null 2>&1; then
        echo 'Non-canonical 44-character OAuth cookie was accepted' >&2
        exit 1
    fi
    printf '%s' "$generated_cookie" > "$FAKE_STATE_DIRECTORY/test-cookie.cookie"

    rm -f "$FAKE_STATE_DIRECTORY/test-cookie.exists" \
        "$FAKE_STATE_DIRECTORY/test-cookie.cookie"
    printf 2 > "$FAKE_STATE_DIRECTORY/test-cookie.appear-after"
    printf osmo-oauth-cookie-bootstrap \
        > "$FAKE_STATE_DIRECTORY/test-cookie.managed-by"
    printf test-release > "$FAKE_STATE_DIRECTORY/test-cookie.instance"
    run_bootstrap "$bootstrap_script" >/dev/null
    if [ ! -s "$FAKE_STATE_DIRECTORY/test-cookie.cookie" ]; then
        echo 'Bootstrap did not wait for the placeholder Secret to appear' >&2
        exit 1
    fi

    printf other-release > "$FAKE_STATE_DIRECTORY/test-cookie.instance"
    if run_bootstrap "$bootstrap_script" >/dev/null 2>&1; then
        echo 'Generated OAuth cookie owned by another release was accepted' >&2
        exit 1
    fi

    rm -f "$FAKE_STATE_DIRECTORY/test-cookie.exists"
    if run_bootstrap "$bootstrap_script" --fail-if-missing >/dev/null 2>&1; then
        echo 'Upgrade regenerated a missing OAuth cookie Secret' >&2
        exit 1
    fi
done
