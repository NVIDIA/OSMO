#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

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

# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock curl '#!/bin/bash' 'set -euo pipefail' 'echo "curl $*" >>"$COMMAND_LOG"'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock osmo '#!/bin/bash' 'set -euo pipefail' 'echo "osmo $*" >>"$COMMAND_LOG"' \
    'case "$1 $2" in' \
    '  "resource list") echo '\''{"resources":[{"name":"cpu"}]}'\'' ;;' \
    '  "workflow submit") echo '\''{"name":"wf-verify"}'\'' ;;' \
    '  "workflow query") echo '\''{"status":"COMPLETED"}'\'' ;;' \
    '  "workflow spec") echo "workflow: {}" ;;' \
    '  "workflow logs") echo "Object storage round trip verified" ;;' \
    'esac'

export COMMAND_LOG="$command_log"
export PATH="$mock_directory:$PATH"
export SKIP_GPU=1
export POLL_INTERVAL=1
export POOL_RESOURCE_TIMEOUT=2
export HELLO_POLL_TIMEOUT=2
export WORKFLOWS_DIR="${TEST_SRCDIR}/_main/deployments/workflows"

verify_script="${TEST_SRCDIR}/_main/deployments/scripts/verify.sh"
"$verify_script" >"$test_directory/output.log" 2>&1

grep -Fq 'osmo workflow spec wf-verify' "$command_log" || \
    fail "completed workflow spec was not fetched"
grep -Fq 'osmo workflow logs wf-verify' "$command_log" || \
    fail "completed workflow logs were not fetched"
