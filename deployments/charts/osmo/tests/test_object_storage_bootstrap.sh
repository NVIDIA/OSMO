#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SCRIPT="$CHART_ROOT/files/object-storage-bootstrap.sh"
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

[[ -x "$SCRIPT" ]] || fail "bootstrap script is missing or not executable: $SCRIPT"

mkdir -p "$TEST_DIRECTORY/bin"
cat >"$TEST_DIRECTORY/bin/kubectl" <<'FAKE_KUBECTL'
#!/bin/sh
set -eu

secret_directory() {
    printf '%s/secrets/%s' "$FAKE_STATE" "$1"
}

read_manifest() {
    while [ "$#" -gt 0 ]; do
        if [ "$1" = -f ]; then
            if [ "$2" = - ]; then
                cat
            else
                cat "$2"
            fi
            return
        fi
        shift
    done
    exit 2
}

command_name=$1
shift

case "$command_name" in
    get)
        resource=$1
        secret_name=$2
        shift 2
        [ "$resource" = secret ] || exit 2
        directory=$(secret_directory "$secret_name")
        [ -d "$directory" ] || exit 0
        case "$*" in
            *metadata.name*) printf '%s' "$secret_name" ;;
            *)
                key=$(printf '%s' "$*" | sed -n 's/.*index \.data "\([^"]*\)".*/\1/p')
                if [ -f "$FAKE_STATE/invalid-$secret_name-$key" ]; then
                    printf '%s' 'not-valid-base64!'
                elif [ -n "$key" ] && [ -f "$directory/$key" ]; then
                    base64 <"$directory/$key" | tr -d '\n'
                fi
                ;;
        esac
        ;;
    create)
        if [ "${1:-}" = secret ]; then
            [ "${2:-}" = generic ] || exit 2
            target_name=$3
            shift 3
            pending_directory="$FAKE_STATE/pending/$target_name"
            mkdir -p "$pending_directory"
            for argument in "$@"; do
                case "$argument" in
                    --from-file=*)
                        mapping=${argument#--from-file=}
                        key=${mapping%%=*}
                        source_file=${mapping#*=}
                        cp "$source_file" "$pending_directory/$key"
                        ;;
                esac
            done
            printf 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: %s\n' "$target_name"
        else
            echo "unsupported fake kubectl create: $*" >&2
            exit 2
        fi
        ;;
    label|annotate)
        read_manifest "$@"
        ;;
    apply)
        manifest=$(read_manifest "$@")
        target_name=$(printf '%s\n' "$manifest" | awk '$1 == "name:" { print $2; exit }')
        [ -n "$target_name" ] || exit 2
        pending_directory="$FAKE_STATE/pending/$target_name"
        target_directory=$(secret_directory "$target_name")
        [ -d "$pending_directory" ] || exit 2
        mkdir -p "$target_directory"
        cp "$pending_directory"/* "$target_directory/"
        printf 'secret/%s configured\n' "$target_name"
        ;;
    *)
        echo "unsupported fake kubectl command: $command_name" >&2
        exit 2
        ;;
esac
FAKE_KUBECTL
chmod +x "$TEST_DIRECTORY/bin/kubectl"

SOURCE_SECRET=osmo-6602-app-seaweedfs-s3-secret
TARGET_SECRET=osmo-6602-app-object-storage-credentials

write_source_credentials() {
    local state_directory=$1
    local access_key_id=$2
    local secret_access_key=$3
    local source_directory="$state_directory/secrets/$SOURCE_SECRET"
    mkdir -p "$source_directory"
    printf '%s' "$access_key_id" >"$source_directory/admin_access_key_id"
    printf '%s' "$secret_access_key" >"$source_directory/admin_secret_access_key"
}

run_bootstrap() {
    local state_directory=$1
    mkdir -p "$state_directory"
    PATH="$TEST_DIRECTORY/bin:$PATH" FAKE_STATE="$state_directory" \
        TMPDIR="$state_directory" \
        "$SCRIPT" \
        --namespace osmo-6602-app \
        --release-name osmo-6602-app \
        --source-secret-name "$SOURCE_SECRET" \
        --secret-name "$TARGET_SECRET"
}

generated_state="$TEST_DIRECTORY/generated"
write_source_credentials "$generated_state" \
    AAAAAAAAAAAAAAAAAAAA \
    BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
run_bootstrap "$generated_state" >"$TEST_DIRECTORY/install.out"
expected_credentials="$TEST_DIRECTORY/expected-object-storage.yaml"
printf '%s\n' \
    'access_key_id: AAAAAAAAAAAAAAAAAAAA' \
    'access_key: BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' \
    'addressing_style: path' >"$expected_credentials"
cmp "$expected_credentials" \
    "$generated_state/secrets/$TARGET_SECRET/object-storage.yaml" || \
    fail "derived OSMO credentials do not match the native SeaweedFS credentials"
[[ ! -e "$generated_state/secrets/$TARGET_SECRET/seaweedfs_s3_config" ]] || \
    fail "derived OSMO Secret duplicated the SeaweedFS S3 configuration"
grep -Fq "Synchronized object-storage Secret $TARGET_SECRET from $SOURCE_SECRET" \
    "$TEST_DIRECTORY/install.out" || fail "bootstrap did not report synchronization"

before=$(sha256sum "$generated_state/secrets/$TARGET_SECRET/object-storage.yaml")
run_bootstrap "$generated_state" >"$TEST_DIRECTORY/reinstall.out"
[[ "$before" = "$(sha256sum "$generated_state/secrets/$TARGET_SECRET/object-storage.yaml")" ]] || \
    fail "repeat synchronization changed unchanged credentials"

write_source_credentials "$generated_state" \
    CCCCCCCCCCCCCCCCCCCC \
    DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD
run_bootstrap "$generated_state" >"$TEST_DIRECTORY/rotation.out"
grep -Fqx 'access_key_id: CCCCCCCCCCCCCCCCCCCC' \
    "$generated_state/secrets/$TARGET_SECRET/object-storage.yaml" || \
    fail "source access-key rotation did not reach the OSMO Secret"
grep -Fqx 'access_key: DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD' \
    "$generated_state/secrets/$TARGET_SECRET/object-storage.yaml" || \
    fail "source secret-key rotation did not reach the OSMO Secret"

missing_state="$TEST_DIRECTORY/missing"
if run_bootstrap "$missing_state" >"$TEST_DIRECTORY/missing.out" 2>&1; then
    fail "bootstrap accepted a missing native SeaweedFS Secret"
fi
grep -Fq "Source SeaweedFS Secret $SOURCE_SECRET is missing" \
    "$TEST_DIRECTORY/missing.out" || fail "missing source Secret was not identified"

missing_key_state="$TEST_DIRECTORY/missing-key"
write_source_credentials "$missing_key_state" \
    EEEEEEEEEEEEEEEEEEEE \
    FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
rm "$missing_key_state/secrets/$SOURCE_SECRET/admin_secret_access_key"
if run_bootstrap "$missing_key_state" >"$TEST_DIRECTORY/missing-key.out" 2>&1; then
    fail "bootstrap accepted a native Secret with a missing key"
fi
grep -Fq "missing key admin_secret_access_key" \
    "$TEST_DIRECTORY/missing-key.out" || fail "missing source key was not identified"

invalid_base64_state="$TEST_DIRECTORY/invalid-base64"
write_source_credentials "$invalid_base64_state" \
    GGGGGGGGGGGGGGGGGGGG \
    HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH
touch "$invalid_base64_state/invalid-$SOURCE_SECRET-admin_access_key_id"
if run_bootstrap "$invalid_base64_state" \
        >"$TEST_DIRECTORY/invalid-base64.out" 2>&1; then
    fail "bootstrap accepted invalid base64 in the native Secret"
fi
grep -Fq "key admin_access_key_id is not valid base64" \
    "$TEST_DIRECTORY/invalid-base64.out" || fail "invalid base64 was not identified"

malformed_state="$TEST_DIRECTORY/malformed"
write_source_credentials "$malformed_state" short also-short
if run_bootstrap "$malformed_state" >"$TEST_DIRECTORY/malformed.out" 2>&1; then
    fail "bootstrap accepted malformed native credentials"
fi
grep -Fq "key admin_access_key_id has invalid format" \
    "$TEST_DIRECTORY/malformed.out" || fail "malformed credential was not identified"

echo "PASS: object-storage credential bootstrap tests"
