#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

bash_binary="$(command -v bash)"
real_helm="$(command -v helm)"
test_directory="$(mktemp -d)"
mock_directory="$test_directory/mock-bin"
command_log="$test_directory/commands.log"
mkdir -p "$mock_directory"
trap 'rm -rf "$test_directory"' EXIT

fail() {
    echo "assertion failed: $*" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local expected="$2"
    grep -Fq -- "$expected" "$file" || fail "expected $expected"
}

cat >"$mock_directory/kubectl" <<'EOF'
#!/bin/bash
set -euo pipefail
echo "kubectl $*" >>"$COMMAND_LOG"
[[ "$*" != "get crd podgroups.scheduling.run.ai" ]]
EOF
cat >"$mock_directory/helm" <<'EOF'
#!/bin/bash
set -euo pipefail
echo "helm $*" >>"$COMMAND_LOG"
[[ "$*" != "list -A -o json" ]] || printf '[]\n'
EOF
chmod +x "$mock_directory/kubectl" "$mock_directory/helm"

export COMMAND_LOG="$command_log"
export KUBECTL="$mock_directory/kubectl"
export HELM="$mock_directory/helm"

script="${TEST_SRCDIR}/_main/deployments/scripts/install-kai-scheduler.sh"
values="${TEST_SRCDIR}/_main/deployments/charts/osmo/examples/kai-values.yaml"
installer_values="$(dirname "$script")/../charts/osmo/examples/kai-values.yaml"

"$bash_binary" "$script"
assert_contains "$command_log" \
    "helm upgrade --install kai-scheduler https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.15.3/kai-scheduler-v0.15.3.tgz --namespace kai-scheduler --values $installer_values --wait --timeout 5m"

: >"$command_log"
KAI_VERSION=0.15.2 KAI_NAMESPACE=custom-namespace KAI_RELEASE=custom-release \
    KAI_HELM_TIMEOUT=9m "$bash_binary" "$script"
assert_contains "$command_log" \
    "helm upgrade --install custom-release https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.15.2/kai-scheduler-v0.15.2.tgz --namespace custom-namespace --values $installer_values --wait --timeout 9m"

rendered="$test_directory/kai.yaml"
"$real_helm" template kai-scheduler \
    https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.15.3/kai-scheduler-v0.15.3.tgz \
    --namespace kai-scheduler --values "$values" >"$rendered"
assert_contains "$rendered" 'gpuPodRuntimeClassName: ""'
assert_contains "$rendered" 'default-staleness-grace-period: 3m'
assert_contains "$rendered" 'update-pod-eviction-condition: "true"'
assert_contains "$rendered" 'feature-gates: DynamicResourceAllocation=false'
assert_contains "$rendered" 'stalegangeviction:'
assert_contains "$rendered" 'enabled: false'
