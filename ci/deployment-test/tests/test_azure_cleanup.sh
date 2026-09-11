#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
repo="${TEST_SRCDIR:?}/_main"
helper="$repo/ci/deployment-test/azure-cleanup.sh"
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
mkdir "$temporary/bin"
export COMMAND_LOG="$temporary/commands" DELETED="$temporary/deleted"
export RUN_DIR="$temporary/run" ARM_SUBSCRIPTION_ID=sub AZURE_RESOURCE_GROUP=rg
export GITHUB_SHA=sha GITHUB_RUN_ID=123 GITHUB_RUN_ATTEMPT=2 PRODUCER_ATTEMPT=2
export PATH="$temporary/bin:$PATH"
cat > "$temporary/bin/az" <<'MOCK'
#!/usr/bin/env bash
set -eu
echo "az $*" >> "$COMMAND_LOG"
case "$1 $2" in
    'group show') echo eastus2 ;;
    'group exists') echo false ;;
    'aks list') echo '[{"nodeResourceGroup":"MC_rg_cluster"}]' ;;
    'resource list')
        [[ "${CASE:-}" != query-error ]] || exit 2
        if [[ "${CASE:-}" == wrong-resource ]]; then
            echo '[{"id":"/subscriptions/other/resourceGroups/rg/providers/example/resource"}]'
        elif [[ -f "$DELETED" ]]; then
            echo '[]'
        else
            echo '[{"id":"/subscriptions/sub/resourceGroups/rg/providers/example/resource"}]'
        fi ;;
    'resource delete') touch "$DELETED" ;;
    *) echo "Unexpected Azure operation: $*" >&2; exit 9 ;;
esac
MOCK
cat > "$temporary/bin/terraform" <<'MOCK'
#!/usr/bin/env bash
echo "terraform $*" >> "$COMMAND_LOG"
[[ "${CASE:-}" != destroy-error ]]
MOCK
cat > "$temporary/bin/sleep" <<'MOCK'
#!/usr/bin/env bash
exit 0
MOCK
chmod +x "$temporary/bin/"*
# shellcheck source=../azure-inputs.sh
source "$repo/ci/deployment-test/azure-inputs.sh"
ci_azure_inputs
ci_azure_save_inputs "$temporary/inputs"
ci_azure_write_marker "$temporary/marker.json"
jq -e '.cluster_name == "osmo-deployment-test" and .node_group_min_size == 3 and
    .redis_sku_name == "MemoryOptimized_M10" and .redis_location == "westus3" and
    .redis_high_availability_enabled == false and (has("postgres_password") | not)' \
    "$temporary/inputs/ci.tfvars.json" >/dev/null
# Prove missing/wrong-attempt markers cannot issue ANY Azure request.
for marker in "$temporary/missing.json" "$temporary/marker.json"; do
    : > "$COMMAND_LOG"
    if PRODUCER_ATTEMPT=3 bash "$helper" sweep "$marker" >/dev/null 2>&1; then
        echo 'Invalid marker accepted' >&2; exit 1
    fi
    [[ ! -s "$COMMAND_LOG" ]]
done
bash "$helper" sweep "$temporary/marker.json"
grep -q 'resource delete' "$COMMAND_LOG"
grep -q 'group exists.*MC_rg_cluster' "$COMMAND_LOG"
if grep -q 'group delete' "$COMMAND_LOG"; then exit 1; fi
for scenario in query-error wrong-resource; do
    : > "$COMMAND_LOG"
    if CASE="$scenario" bash "$helper" sweep "$temporary/marker.json" >/dev/null 2>&1; then
        echo 'Unknown/wrong resource inventory accepted' >&2; exit 1
    fi
    if grep -q 'resource delete' "$COMMAND_LOG"; then exit 1; fi
done
mkdir "$temporary/restored"
cp "$temporary/marker.json" "$temporary/restored/cloud-attempt.json"
: > "$COMMAND_LOG"
if bash "$helper" destroy "$temporary/marker.json" "$temporary/restored" >/dev/null 2>&1; then
    echo 'Missing state accepted as successful destruction' >&2; exit 1
fi
if grep -q terraform "$COMMAND_LOG"; then exit 1; fi
printf '{}' > "$temporary/restored/terraform.tfstate"
bash "$helper" destroy "$temporary/marker.json" "$temporary/restored"
grep -q 'destroy.*-var-file=single-plane.tfvars -var-file=ci.tfvars.json' "$COMMAND_LOG"
if CASE=destroy-error bash "$helper" destroy "$temporary/marker.json" "$temporary/restored"; then
    echo 'Terraform failure swallowed' >&2; exit 1
fi
# The separate fallback can still clean after a failed destroy or missing state.
bash "$helper" sweep "$temporary/marker.json"
echo 'Scoped cleanup, producer identity, failure and CI input checks passed'
