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
    '  "workflow query") printf '\''{"status":"%s"}\n'\'' "${WORKFLOW_STATUS:-COMPLETED}" ;;' \
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

: >"$command_log"
unset FAIL_WORKFLOW_LOGS
export SKIP_OBJECT_STORAGE=1 WORKFLOW_LOG_TIMEOUT=2
"$verify_script" >"$test_directory/skip-object-storage-output.log" 2>&1
grep -Fq "osmo workflow submit $WORKFLOWS_DIR/verify-hello.yaml" "$command_log" || \
    fail "hello workflow was not submitted when object-storage verification was skipped"
if grep -Fq 'verify-object-storage.yaml' "$command_log"; then
    fail "object-storage workflow was submitted despite SKIP_OBJECT_STORAGE=1"
fi

: >"$command_log"
password_file="$test_directory/admin-password"
printf '%s' 'admin-password' >"$password_file"
export OSMO_LOGIN_METHOD=password OSMO_PASSWORD_FILE="$password_file"
"$verify_script" >"$test_directory/password-login-output.log" 2>&1
grep -Fq "osmo login http://localhost:9000 --method=password --username=admin --password-file=$password_file" \
    "$command_log" || fail "password-file login was not passed to the OSMO CLI"

: >"$command_log"
token_file="$test_directory/admin-token"
printf '%s' 'bootstrap-token-sentinel' >"$token_file"
export OSMO_LOGIN_METHOD=token OSMO_TOKEN_FILE="$token_file"
"$verify_script" >"$test_directory/token-login-output.log" 2>&1
grep -Fxq "osmo login http://localhost:9000 --method=token --token-file=$token_file" \
    "$command_log" || fail "token-file login was not passed to the OSMO CLI"
if grep -Fq bootstrap-token-sentinel "$command_log" "$test_directory/token-login-output.log"; then
    fail "bootstrap token was exposed"
fi

: >"$command_log"
unset OSMO_TOKEN_FILE
if "$verify_script" >"$test_directory/missing-token-output.log" 2>&1; then
    fail "token login without a token file unexpectedly succeeded"
fi
if grep -q '^osmo login' "$command_log"; then
    fail "token login without a token file reached the CLI"
fi

export OSMO_LOGIN_METHOD=dev
for WORKFLOW_STATUS in FAILED FAILED_EXEC_TIMEOUT FAILED_SERVER_ERROR CANCELLED; do
    export WORKFLOW_STATUS
    : >"$command_log"
    if "$verify_script" >"$test_directory/terminal-failure.log" 2>&1; then
        fail "$WORKFLOW_STATUS unexpectedly succeeded"
    fi
    grep -Fq "verify-hello ended in $WORKFLOW_STATUS" "$test_directory/terminal-failure.log" || \
        fail "$WORKFLOW_STATUS was not recognized as terminal"
    [[ "$(grep -Fc 'osmo workflow query wf-hello' "$command_log")" == 1 ]] || \
        fail "$WORKFLOW_STATUS did not stop polling immediately"
    for diagnostic in events logs; do
        grep -Fq "osmo workflow $diagnostic wf-hello" "$command_log" || \
            fail "$WORKFLOW_STATUS omitted workflow $diagnostic"
    done
done

: >"$command_log"
export WORKFLOW_STATUS=RUNNING
if "$verify_script" >"$test_directory/poll-timeout.log" 2>&1; then
    fail "nonterminal workflow unexpectedly succeeded"
fi
grep -Fq 'did not reach a terminal state' "$test_directory/poll-timeout.log" || \
    fail "poll timeout was not reported"
for diagnostic in events logs; do
    grep -Fq "osmo workflow $diagnostic wf-hello" "$command_log" || \
        fail "poll timeout omitted workflow $diagnostic"
done
