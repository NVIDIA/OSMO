#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

test_directory="$(mktemp -d)"
mock_directory="$test_directory/mock-bin"
command_log="$test_directory/commands.log"
mkdir -p "$mock_directory"
trap 'rm -rf "$test_directory"' EXIT

cat >"$mock_directory/kubectl" <<'EOF'
#!/bin/bash
set -euo pipefail
if [[ "$*" == "get crd podgroups.scheduling.run.ai" ]]; then
    [[ "${EXISTING_KAI_VERSION:-}" != none ]]
    exit
fi
echo "kubectl $*" >>"$COMMAND_LOG"
[[ "$*" != "get namespace kai-scheduler" ]]
EOF

cat >"$mock_directory/helm" <<'EOF'
#!/bin/bash
set -euo pipefail
if [[ "$*" == "list -A -o json" ]]; then
    if [[ "${EXISTING_KAI_VERSION:-none}" == none ]]; then
        printf '[]\n'
    else
        printf '[{"chart":"kai-scheduler-v%s"}]\n' "$EXISTING_KAI_VERSION"
    fi
    exit
fi
echo "helm $*" >>"$COMMAND_LOG"
EOF

chmod +x "$mock_directory/kubectl" "$mock_directory/helm"
export COMMAND_LOG="$command_log"
export PATH="$mock_directory:$PATH"

script="${TEST_SRCDIR}/_main/deployments/scripts/install-kai-scheduler.sh"

EXISTING_KAI_VERSION=none "$script"
grep -Fq 'helm upgrade --install kai-scheduler https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.12.10/kai-scheduler-v0.12.10.tgz --namespace kai-scheduler --wait --timeout 5m' "$command_log"

: >"$command_log"
if EXISTING_KAI_VERSION=0.14.0 "$script" >"$test_directory/mismatch.log" 2>&1; then
    echo "mismatched KAI version unexpectedly accepted" >&2
    exit 1
fi
grep -Fq '0.12.10' "$test_directory/mismatch.log"
! grep -Fq 'helm upgrade' "$command_log"
