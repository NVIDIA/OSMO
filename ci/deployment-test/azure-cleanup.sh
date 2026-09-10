#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
ci_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=azure-inputs.sh
source "$ci_dir/azure-inputs.sh"
ci_azure_inputs
: "${RUN_DIR:?}"
mkdir -p "$RUN_DIR"
# No mutation may be authorized by a missing artifact or a failed job alone.
ci_azure_check_marker "${2:?Cloud-attempt marker is required}"
ci_azure_check_group

inventory() {
    az resource list --subscription "$TF_SUBSCRIPTION_ID" --resource-group "$TF_RESOURCE_GROUP" \
        --output json > "$RUN_DIR/remaining-resources.json"
    jq -e --arg prefix "/subscriptions/$TF_SUBSCRIPTION_ID/resourceGroups/$TF_RESOURCE_GROUP/" \
        'type == "array" and all(.[]; (.id | ascii_downcase | startswith($prefix | ascii_downcase)))' \
        "$RUN_DIR/remaining-resources.json" >/dev/null
}

record_node_groups() {
    # Remember AKS-owned groups BEFORE deleting the clusters. Never delete an
    # arbitrary group directly: AKS owns its dependent group lifecycle.
    az aks list --subscription "$TF_SUBSCRIPTION_ID" --resource-group "$TF_RESOURCE_GROUP" \
        --query '[].{name:name,nodeResourceGroup:nodeResourceGroup}' --output json > "$RUN_DIR/clusters.json"
    jq -er 'if type == "array" then [.[].nodeResourceGroup // empty] else error("Invalid AKS inventory") end' \
        "$RUN_DIR/clusters.json" > "$RUN_DIR/node-groups-current.json"
    if [[ -f "$RUN_DIR/node-groups.json" ]]; then
        jq -s 'add | unique' "$RUN_DIR/node-groups.json" "$RUN_DIR/node-groups-current.json" \
            > "$RUN_DIR/node-groups-next.json"
        mv "$RUN_DIR/node-groups-next.json" "$RUN_DIR/node-groups.json"
    else
        mv "$RUN_DIR/node-groups-current.json" "$RUN_DIR/node-groups.json"
    fi
}

node_groups_empty() {
    local group exists
    while IFS= read -r group; do
        exists=$(az group exists --subscription "$TF_SUBSCRIPTION_ID" --name "$group") || return
        if [[ "$exists" == true ]]; then
            az resource list --subscription "$TF_SUBSCRIPTION_ID" --resource-group "$group" \
                --output json > "$RUN_DIR/remaining-node-resources.json" || return
            jq -e 'type == "array" and length == 0' "$RUN_DIR/remaining-node-resources.json" >/dev/null || return
        elif [[ "$exists" != false ]]; then
            return 1
        fi
    done < <(jq -r '.[]' "$RUN_DIR/node-groups.json")
}

case "${1:-}" in
    sweep)
        record_node_groups
        deadline=$((SECONDS + ${AZURE_SWEEP_SECONDS:-540}))
        next_delete=0
        while (( SECONDS < deadline )); do
            inventory
            if jq -e 'length == 0' "$RUN_DIR/remaining-resources.json" >/dev/null && node_groups_empty; then
                echo "Confirmed empty Azure resource inventory (including AKS dependencies)."
                exit 0
            fi
            if (( SECONDS >= next_delete )); then
                while IFS= read -r resource; do
                    [[ -n "$resource" ]] || continue
                    timeout 40s az resource delete --subscription "$TF_SUBSCRIPTION_ID" \
                        --ids "$resource" --no-wait >> "$RUN_DIR/resource-delete.log" 2>&1 &
                done < <(jq -r '.[].id' "$RUN_DIR/remaining-resources.json")
                # Deletion conflicts are retried; only confirmed inventory can succeed.
                wait || true
                next_delete=$((SECONDS + 120))
            fi
            sleep 15
        done
        echo "Azure cleanup incomplete; see residual inventories" >&2
        exit 1
        ;;
    destroy)
        # Restore helper checks the encrypted payload; compare its independent
        # marker again before allowing Terraform to act on restored state.
        directory="${3:?Restored state directory is required}"
        ci_azure_check_marker "$directory/cloud-attempt.json"
        test -s "$directory/terraform.tfstate"
        record_node_groups
        cp "$ci_dir/../../deployments/terraform/azure/example/"*.tf "$directory/"
        terraform -chdir="$directory" init -input=false -no-color
        terraform -chdir="$directory" destroy -input=false -auto-approve -no-color \
            -var-file=single-plane.tfvars -var-file=ci.tfvars.json
        ;;
    diagnostics)
        umask 077
        private=$(mktemp -d)
        trap 'rm -rf -- "$private"' EXIT
        export KUBECONFIG="$private/kubeconfig"
        az aks get-credentials --subscription "$TF_SUBSCRIPTION_ID" --resource-group "$TF_RESOURCE_GROUP" \
            --name "$TF_CLUSTER_NAME" --admin --overwrite-existing --file "$KUBECONFIG"
        # Deliberately avoid Secrets, pod environment dumps, raw values and BEP.
        kubectl get pods -n osmo -o wide > "$RUN_DIR/pods.txt"
        kubectl get events -n osmo --sort-by=.lastTimestamp > "$RUN_DIR/events.txt"
        kubectl get pods -n osmo -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.containers[*]}{.image}{","}{end}{"\n"}{end}' \
            > "$RUN_DIR/image-refs.txt"
        helm status osmo -n osmo > "$RUN_DIR/helm-status.txt"
        for component in api worker agent logger router backend-listener backend-worker; do
            timeout 15s kubectl logs -n osmo "deployment/osmo-$component" \
                --all-containers --tail=200 --timestamps \
                > "$RUN_DIR/logs-$component.txt" 2>&1 || true
        done
        ;;
    *) echo "Usage: $0 sweep|destroy|diagnostics MARKER [RESTORED_STATE]" >&2; exit 2 ;;
esac
