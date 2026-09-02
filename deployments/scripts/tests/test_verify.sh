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
write_mock sleep '#!/bin/bash' 'exit 0'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock osmo '#!/bin/bash' 'set -euo pipefail' 'echo "osmo $*" >>"$COMMAND_LOG"' \
    'case "$1 $2" in' \
    '  "resource list") echo '\''{"resources":[{"name":"cpu"}]}'\'' ;;' \
    '  "workflow submit")' \
    '    case "$3" in' \
    '      *verify-hello.yaml) echo '\''{"name":"wf-hello"}'\'' ;;' \
    '      *verify-object-storage.yaml) echo '\''{"name":"wf-object-storage"}'\'' ;;' \
    '      *) exit 2 ;;' \
    '    esac' \
    '    ;;' \
    '  "workflow query") echo '\''{"status":"COMPLETED"}'\'' ;;' \
    '  "workflow spec") echo "workflow: {}" ;;' \
    '  "workflow logs")' \
    '    [[ "${FAIL_WORKFLOW_LOGS:-false}" != true ]] || exit 3' \
    '    if [[ "$3" == wf-object-storage && -f "${LOG_FAILURES_FILE:-}" ]]; then' \
    '      remaining="$(<"$LOG_FAILURES_FILE")"' \
    '      if ((remaining > 0)); then echo "$((remaining - 1))" >"$LOG_FAILURES_FILE"; exit 4; fi' \
    '    fi' \
    '    echo "Object storage round trip verified"' \
    '    ;;' \
    'esac'

export COMMAND_LOG="$command_log"
export PATH="$mock_directory:$PATH"
export SKIP_GPU=1
export POLL_INTERVAL=1
export POOL_RESOURCE_TIMEOUT=2
export HELLO_POLL_TIMEOUT=2
export OBJECT_STORAGE_POLL_TIMEOUT=2
export WORKFLOW_LOG_TIMEOUT=2
export WORKFLOWS_DIR="${TEST_SRCDIR}/_main/deployments/workflows"
export LOG_FAILURES_FILE="$test_directory/log-failures-remaining"
printf '1\n' >"$LOG_FAILURES_FILE"

verify_script="${TEST_SRCDIR}/_main/deployments/scripts/verify.sh"
"$verify_script" >"$test_directory/output.log" 2>&1

grep -Fq "osmo workflow submit $WORKFLOWS_DIR/verify-hello.yaml" "$command_log" || \
    fail "hello workflow was not submitted"
grep -Fq "osmo workflow submit $WORKFLOWS_DIR/verify-object-storage.yaml" "$command_log" || \
    fail "object-storage workflow was not submitted"
for workflow_id in wf-hello wf-object-storage; do
    grep -Fq "osmo workflow query $workflow_id" "$command_log" || \
        fail "$workflow_id was not queried"
    grep -Fq "osmo workflow spec $workflow_id" "$command_log" || \
        fail "$workflow_id spec was not fetched"
    grep -Fq "osmo workflow logs $workflow_id" "$command_log" || \
        fail "$workflow_id logs were not fetched"
done
[[ "$(grep -Fc 'osmo workflow logs wf-object-storage' "$command_log")" == 2 ]] || \
    fail "object-storage logs were not retried"

: >"$command_log"
export FAIL_WORKFLOW_LOGS=true WORKFLOW_LOG_TIMEOUT=0
if "$verify_script" >"$test_directory/log-timeout-output.log" 2>&1; then
    fail "permanent workflow-log failure unexpectedly succeeded"
fi
grep -Fq "Failed to fetch completed workflow logs for wf-hello" \
    "$test_directory/log-timeout-output.log" || fail "workflow-log timeout was not reported"
[[ "$(grep -Fc 'osmo workflow logs wf-hello' "$command_log")" == 1 ]] || \
    fail "zero-second workflow-log timeout was not bounded"
