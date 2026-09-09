#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.

set -euo pipefail

test_directory="$(mktemp -d)"
mock_directory="$test_directory/mock-bin"
command_log="$test_directory/commands.log"
mkdir -p "$mock_directory"
trap 'rm -rf "$test_directory"' EXIT

fail() {
    echo "assertion failed: $*" >&2
    exit 1
}

write_mock() {
    local name="$1"
    shift
    printf '%s\n' "$@" >"$mock_directory/$name"
    chmod +x "$mock_directory/$name"
}

write_mock docker '#!/bin/bash' 'set -euo pipefail' \
    'echo "docker $*" >>"$COMMAND_LOG"' \
    'case "$1" in' \
    '  info) echo "containerd version: test" ;;' \
    '  create) echo "docker-${4##*/}" ;;' \
    '  start) [[ "${DOCKER_START_FAIL:-0}" != 1 ]] ;;' \
    '  wait) echo 0 ;;' \
    'esac'

write_mock crictl '#!/bin/bash' 'set -euo pipefail' \
    'echo "crictl $*" >>"$COMMAND_LOG"' \
    'case "$*" in' \
    '  *" version")' \
    '    printf "RuntimeName:  cri-o\nRuntimeVersion:  %s\n" "${CRICTL_RUNTIME_VERSION:-1.34.0}"' \
    '    ;;' \
    '  *" runp "*) echo "pod-${*: -1}" ;;' \
    '  *" create "*) echo "container-${*: -2:1}" ;;' \
    '  *" start "*) [[ "${CRICTL_START_FAIL:-0}" != 1 ]] ;;' \
    '  *" inspect "*) echo '\''{"status":{"state":"CONTAINER_EXITED","exitCode":0}}'\'' ;;' \
    'esac'

export COMMAND_LOG="$command_log"
export PATH="$mock_directory:$PATH"
export CRICTL="$mock_directory/crictl"
validator_path="${TEST_SRCDIR}/_main/$1"

"$validator_path" \
    nvcr.io/nvstaging/osmo test-tag unix:///run/crio/crio.sock

for image in backend-listener backend-worker backend-test-runner; do
    reference="nvcr.io/nvstaging/osmo/$image:test-tag"
    crio_pull="crictl --runtime-endpoint=unix:///run/crio/crio.sock"
    crio_pull+=" --image-endpoint=unix:///run/crio/crio.sock pull $reference"
    grep -Fq "docker pull $reference" "$command_log" || fail "containerd did not pull $reference"
    grep -Fq "docker create --entrypoint /usr/bin/python $reference --version" "$command_log" || \
        fail "containerd did not create $reference with the smoke command"
    grep -Fq "$crio_pull" \
        "$command_log" || fail "CRI-O did not pull $reference"
done

[[ "$(grep -c '^docker start ' "$command_log")" -eq 3 ]] || fail "containerd did not start all images"
[[ "$(grep -c ' start container-' "$command_log")" -eq 3 ]] || fail "CRI-O did not start all images"

if CRICTL_RUNTIME_VERSION=1.33.9 \
    "$validator_path" \
        nvcr.io/nvstaging/osmo test-tag unix:///run/crio/crio.sock >/dev/null 2>&1; then
    fail "validation accepted a CRI-O version other than 1.34"
fi

: >"$command_log"
if DOCKER_START_FAIL=1 \
    "$validator_path" \
        nvcr.io/nvstaging/osmo test-tag unix:///run/crio/crio.sock >/dev/null 2>&1; then
    fail "validation ignored a containerd start failure"
fi
grep -Fq "docker rm --force docker-backend-listener:test-tag" "$command_log" || \
    fail "containerd start failure did not clean up the created container"

: >"$command_log"
if CRICTL_START_FAIL=1 \
    "$validator_path" \
        nvcr.io/nvstaging/osmo test-tag unix:///run/crio/crio.sock >/dev/null 2>&1; then
    fail "validation ignored a CRI-O start failure"
fi
grep -Eq ' rm --force container-' "$command_log" || \
    fail "CRI-O start failure did not clean up the created container"
grep -Eq ' stopp pod-' "$command_log" || \
    fail "CRI-O start failure did not stop the pod sandbox"
grep -Eq ' rmp --force pod-' "$command_log" || \
    fail "CRI-O start failure did not remove the pod sandbox"
