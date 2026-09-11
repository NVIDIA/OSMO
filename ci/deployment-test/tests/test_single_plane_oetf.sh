#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
repo="${TEST_SRCDIR:?}/_main"
helper="$repo/ci/deployment-test/run-single-plane-oetf.sh"
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
mkdir "$temporary/bin"
export COMMAND_LOG="$temporary/commands" PF_PID_FILE="$temporary/pf.pid"
export ARM_SUBSCRIPTION_ID=sub AZURE_RESOURCE_GROUP=rg GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=2
export PATH="$temporary/bin:$PATH"
cat > "$temporary/bin/az" <<'MOCK'
#!/usr/bin/env bash
[[ "$1 $2" == 'aks get-credentials' ]]
MOCK
cat > "$temporary/bin/kubectl" <<'MOCK'
#!/usr/bin/env bash
if [[ "$*" == *port-forward* ]]; then
    echo "$$" > "$PF_PID_FILE"
    [[ "${CASE:-}" != dead-forward ]] || exit 1
    exec sleep 300
else
    printf 'password-sentinel' | base64
fi
MOCK
cat > "$temporary/bin/curl" <<'MOCK'
#!/usr/bin/env bash
sleep 0.05
exit 0
MOCK
cat > "$temporary/bin/date" <<'MOCK'
#!/usr/bin/env bash
[[ "$*" == '-u -d 2 days +%Y-%m-%d' ]] || exit 1
printf '2099-01-01\n'
MOCK
cat > "$temporary/bin/osmo" <<'MOCK'
#!/usr/bin/env bash
set -eu
echo "osmo $*" >> "$COMMAND_LOG"
case "$1 $2" in
    'login http://127.0.0.1:9100')
        [[ "$3 $4 $5" == '--method token --token-file' ]]
        [[ "$#" == 6 && "$(cat "$6")" == password-sentinel ]]
        [[ "${CASE:-}" != login-error ]] ;;
    'profile set') [[ "$*" == *'pool default'* ]] ;;
    'token set')
        if [[ "${CASE:-}" == empty-token ]]; then echo '{"token":""}'
        else echo '{"token":"token-sentinel"}'; fi ;;
    'token delete') exit 0 ;;
    *) exit 9 ;;
esac
MOCK
cat > "$temporary/bin/bazel" <<'MOCK'
#!/usr/bin/env bash
set -eu
echo "bazel $*" >> "$COMMAND_LOG"
[[ "$OETF_TOKEN" == token-sentinel ]]
[[ "$*" == *'--env azure-single-plane --pool default'* ]]
[[ "$*" == *'--tags api,websocket,logger,task-env,negative'* ]]
grep -q 'exclude_tags: \[auth, mcp\]' "$OETF_INTERNAL_YAML"
[[ "${CASE:-}" != suite-error ]] || exit 17
[[ "${CASE:-}" != missing-results ]] || exit 0
if [[ "${CASE:-}" == all-skipped ]]; then
    printf '{"total":1,"passed":0,"failed":0,"errored":0,"skipped":1}' > "$RUN_DIR/oetf-result.json"
elif [[ "${CASE:-}" == empty-results ]]; then
    printf '{"total":0,"passed":0,"failed":0,"errored":0,"skipped":0}' > "$RUN_DIR/oetf-result.json"
else
    printf '{"total":1,"passed":1,"failed":0,"errored":0,"skipped":0}' > "$RUN_DIR/oetf-result.json"
fi
MOCK
chmod +x "$temporary/bin/"*
for scenario in good login-error empty-token suite-error missing-results all-skipped empty-results dead-forward; do
    : > "$COMMAND_LOG"
    set +e
    env RUN_DIR="$temporary/$scenario" CASE="$scenario" \
        bash "$helper" > "$temporary/$scenario.log" 2>&1
    status=$?
    set -e
    if [[ "$scenario" == good ]]; then
        [[ "$status" == 0 ]] || { cat "$temporary/$scenario.log"; exit 1; }
        grep -q 'token set nightly-123-2 --roles osmo-admin --expires-at 2099-01-01 --format-type json' "$COMMAND_LOG"
        grep -q 'token delete nightly-123-2' "$COMMAND_LOG"
        if grep -q 'token-sentinel\|password-sentinel' "$temporary/$scenario/oetf.log"; then exit 1; fi
    else
        [[ "$status" != 0 ]] || { echo "Failure accepted: $scenario" >&2; exit 1; }
        if [[ "$scenario" == suite-error ]]; then [[ "$status" == 17 ]]; fi
        if [[ "$scenario" == login-error || "$scenario" == empty-token || "$scenario" == dead-forward ]]; then
            if grep -q '^bazel' "$COMMAND_LOG"; then exit 1; fi
        fi
    fi
    if [[ -s "$PF_PID_FILE" ]]; then
        sleep 0.1
        if kill -0 "$(cat "$PF_PID_FILE")" 2>/dev/null; then exit 1; fi
    fi
done
echo 'OETF authentication, selection, results, status and process cleanup checks passed'
