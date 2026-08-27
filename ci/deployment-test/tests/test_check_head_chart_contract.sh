#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

REPO_ROOT="${TEST_SRCDIR}/_main"
CHECKER="$REPO_ROOT/ci/deployment-test/check-head-chart-contract.sh"
FAKE_BIN="$(mktemp -d)"
TEST_TMP="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN" "$TEST_TMP"' EXIT

cat > "$FAKE_BIN/helm" <<'FAKE_HELM'
#!/bin/bash
set -euo pipefail

case "$1" in
    lint)
        exit 0
        ;;
    show)
        chart_name="${3##*/}"
        if [[ "$chart_name" == "backend-operator" ]]; then
            printf 'version: %s\n' "${FAKE_OPERATOR_VERSION:-1.4.0}"
        else
            printf 'version: %s\n' "${FAKE_SERVICE_VERSION:-1.4.0}"
        fi
        ;;
    template)
        printf '%s\n' "$*" >> "$FAKE_HELM_LOG"
        if [[ "${FAKE_CHART_COMPAT:-false}" == "true" ]]; then
            if [[ "$2" == "osmo-minimal" ]]; then
                cat <<'SERVICE'
kind: ConfigMap
data:
  config.yaml: |
    k8s_namespace: osmo-minimal
    init: nvcr.io/nvstaging/osmo/init-container:head-contract
---
kind: Deployment
spec:
  template:
    spec:
      containers:
        - image: nvcr.io/nvstaging/osmo/service:head-contract
          args:
            - --backend_token_directory
      volumes:
        - secret:
            secretName: osmo-operator-token
SERVICE
            else
                cat <<'OPERATOR'
kind: Deployment
spec:
  template:
    spec:
      containers:
        - image: nvcr.io/nvstaging/osmo/backend-listener:head-contract
        - image: nvcr.io/nvstaging/osmo/backend-worker:head-contract
      volumes:
        - secret:
            secretName: osmo-operator-token
OPERATOR
            fi
        else
            printf 'kind: Deployment\nmetadata:\n  name: %s\n' "$2"
        fi
        ;;
    *)
        echo "unexpected helm invocation: $*" >&2
        exit 2
        ;;
esac
FAKE_HELM
chmod +x "$FAKE_BIN/helm"

assert_file_contains() {
    local description="$1" file="$2" expected="$3"
    if ! grep -Fq -- "$expected" "$file"; then
        echo "assertion failed: $description" >&2
        echo "expected: $expected" >&2
        exit 1
    fi
}

assert_file_not_contains() {
    local description="$1" file="$2" unexpected="$3"
    if grep -Fq -- "$unexpected" "$file"; then
        echo "assertion failed: $description" >&2
        echo "unexpected sensitive value was present in $file" >&2
        exit 1
    fi
}

incompatible_output="$TEST_TMP/incompatible.out"
incompatible_log="$TEST_TMP/incompatible-helm.log"
if PATH="$FAKE_BIN:$PATH" \
    FAKE_HELM_LOG="$incompatible_log" \
    FAKE_CHART_COMPAT=false \
    bash "$CHECKER" >"$incompatible_output" 2>&1; then
    echo "expected incompatible HEAD charts to fail" >&2
    exit 1
fi

assert_file_contains 'reports backend namespace contract' "$incompatible_output" \
    'missing backend namespace'
assert_file_contains 'reports service token argument contract' "$incompatible_output" \
    'missing control-plane backend token argument'
assert_file_contains 'reports service token mount contract' "$incompatible_output" \
    'missing control-plane backend token Secret mount'
assert_file_contains 'reports operator token mount contract' "$incompatible_output" \
    'missing operator backend token Secret mount'
assert_file_contains 'reports service image contract' "$incompatible_output" \
    'missing HEAD service image'
assert_file_contains 'reports operator image contract' "$incompatible_output" \
    'missing HEAD backend-listener image'
assert_file_not_contains 'does not print registry auth' "$incompatible_output" \
    'contract-test-api-key'

assert_file_contains 'renders service chart from HEAD' "$incompatible_log" \
    "$REPO_ROOT/deployments/charts/service"
assert_file_contains 'uses service base values' "$incompatible_log" \
    "-f $REPO_ROOT/deployments/values/service.yaml"
assert_file_contains 'uses generated-storage fixture' "$incompatible_log" \
    "-f $REPO_ROOT/ci/deployment-test/fixtures/minio-storage-values.yaml"
assert_file_contains 'uses Azure deployment overrides' "$incompatible_log" \
    "-f $REPO_ROOT/ci/deployment-test/azure-overrides.yaml"
assert_file_contains 'uses dynamic backend image credential' "$incompatible_log" \
    '--set services.configs.workflow.backend_images.credential.auth='
assert_file_contains 'renders operator chart from HEAD' "$incompatible_log" \
    "$REPO_ROOT/deployments/charts/backend-operator"
assert_file_contains 'uses operator base values' "$incompatible_log" \
    "-f $REPO_ROOT/deployments/values/backend-operator.yaml"

compatible_output="$TEST_TMP/compatible.out"
compatible_log="$TEST_TMP/compatible-helm.log"
github_output="$TEST_TMP/github-output"
github_summary="$TEST_TMP/github-summary"
PATH="$FAKE_BIN:$PATH" \
FAKE_HELM_LOG="$compatible_log" \
FAKE_CHART_COMPAT=true \
GITHUB_OUTPUT="$github_output" \
GITHUB_STEP_SUMMARY="$github_summary" \
bash "$CHECKER" >"$compatible_output" 2>&1

assert_file_contains 'compatible fixture passes' "$compatible_output" \
    'HEAD charts 1.4.0 satisfy the current deployment contract'
assert_file_contains 'emits the chart version' "$github_output" \
    'chart_version=1.4.0'
assert_file_contains 'writes the contract summary' "$github_summary" \
    'HEAD chart contract passed'
assert_file_not_contains 'compatible output does not print registry auth' "$compatible_output" \
    'contract-test-api-key'

if PATH="$FAKE_BIN:$PATH" \
    FAKE_HELM_LOG="$TEST_TMP/mismatch-helm.log" \
    FAKE_CHART_COMPAT=true \
    FAKE_OPERATOR_VERSION=1.4.1 \
    bash "$CHECKER" >"$TEST_TMP/mismatch.out" 2>&1; then
    echo "expected mismatched HEAD chart versions to fail" >&2
    exit 1
fi
assert_file_contains 'reports chart-version mismatch' "$TEST_TMP/mismatch.out" \
    'HEAD chart versions do not match: service=1.4.0 operator=1.4.1'
