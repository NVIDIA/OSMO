#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

###############################################################################
# Post-install smoke tests for OSMO
#
# Submits two workflows via `osmo workflow submit` and polls until each reaches
# a terminal state:
#   - verify-hello.yaml — alpine task, proves scheduling + backend round-trip
#   - verify-gpu.yaml   — nvidia-smi task, proves the pool has GPU capacity
#
# Skips the GPU test if SKIP_GPU=1 (use on CPU-only clusters).
#
# Assumes:
#   - osmo CLI is installed
#   - $OSMO_URL is reachable (caller has port-forwarded or used an ingress)
#   - pool $POOL is registered and ONLINE
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

OSMO_URL="${OSMO_URL:-http://localhost:9000}"
POOL="${POOL:-default}"
OSMO_USERNAME="${OSMO_USERNAME:-admin}"
OSMO_LOGIN_METHOD="${OSMO_LOGIN_METHOD:-dev}"
WORKFLOWS_DIR="${WORKFLOWS_DIR:-$SCRIPT_DIR/../workflows}"

# Per-workflow poll timeouts (seconds). Should comfortably exceed each spec's
# queue_timeout + exec_timeout. Override via env if your cluster needs longer.
HELLO_POLL_TIMEOUT="${HELLO_POLL_TIMEOUT:-600}"
GPU_POLL_TIMEOUT="${GPU_POLL_TIMEOUT:-1500}"
POLL_INTERVAL="${POLL_INTERVAL:-10}"

check_command osmo
check_command jq
check_command curl

# Probe URL — fail fast if no PF / ingress is reachable
if ! curl -so /dev/null --max-time 2 "$OSMO_URL/"; then
    log_error "OSMO not reachable at $OSMO_URL"
    log_error "Ensure port-forward is running (./port-forward.sh --watchdog osmo-service 9000)"
    log_error "or set OSMO_URL to a reachable endpoint."
    exit 1
fi

osmo login "$OSMO_URL" --method="$OSMO_LOGIN_METHOD" --username="$OSMO_USERNAME"

# Submit a workflow, poll until terminal state, dump logs on failure.
# Polls every $POLL_INTERVAL seconds up to $timeout seconds. Terminal states
# per OSMO: COMPLETED / FAILED / CANCELLED.
run_workflow() {
    local spec="$1"
    local label="$2"
    local timeout="${3:-600}"
    log_info "Submitting $label ($spec, poll timeout ${timeout}s)"

    # OSMO 6.3 returns the workflow identifier in `.name` (legacy 6.2 used
    # `.id` / `.workflow_id`). Fall back across all three for compatibility.
    # Capture submit output explicitly so a CLI error (auth blip, server 5xx)
    # surfaces in the log instead of silently producing an empty wf_id and
    # the unhelpful "Failed to parse workflow id" message.
    #
    # Some OSMO CLI versions print non-JSON banner lines to stdout
    # (e.g. "WARNING: New client X available") before the JSON body — pipe
    # through `sed -n '/^{/,/^}/p'` to extract just the JSON object before
    # handing to jq.
    local wf_id submit_out
    if ! submit_out=$(osmo workflow submit "$spec" --pool "$POOL" -t json 2>&1); then
        log_error "Failed to submit $label"
        printf '%s\n' "$submit_out" >&2
        return 1
    fi
    wf_id=$(printf '%s\n' "$submit_out" | sed -n '/^{/,/^}/p' \
        | jq -r '.name // .id // .workflow_id // empty')
    if [[ -z "$wf_id" ]]; then
        log_error "Failed to parse workflow id from submit output"
        printf '%s\n' "$submit_out" >&2
        return 1
    fi
    log_info "  workflow id: $wf_id"

    local status=""
    local iterations=$(( timeout / POLL_INTERVAL ))
    local query_out
    for _ in $(seq 1 "$iterations"); do
        # Tolerate transient query failures — server may be momentarily 5xx
        # mid-deploy. Log a warning, sleep, retry — don't abort the verify.
        if ! query_out=$(osmo workflow query "$wf_id" -t json 2>&1); then
            log_warning "Query failed for $wf_id; retrying"
            sleep "$POLL_INTERVAL"
            continue
        fi
        status=$(printf '%s\n' "$query_out" | sed -n '/^{/,/^}/p' \
            | jq -r '.status // .state // "UNKNOWN"')
        case "$status" in
            COMPLETED)
                log_success "$label: COMPLETED"
                return 0
                ;;
            FAILED|CANCELLED)
                log_error "$label ended in $status"
                echo "---- osmo workflow events $wf_id ----" >&2
                osmo workflow events "$wf_id" >&2 || true
                echo "---- osmo workflow logs $wf_id ----" >&2
                osmo workflow logs "$wf_id" >&2 || true
                return 1
                ;;
        esac
        sleep "$POLL_INTERVAL"
    done

    log_error "$label did not reach a terminal state within ${timeout}s (last status: $status)"
    osmo workflow query "$wf_id" >&2 || true
    return 1
}

run_workflow "$WORKFLOWS_DIR/verify-hello.yaml" "verify-hello" "$HELLO_POLL_TIMEOUT"

if [[ "${SKIP_GPU:-0}" == "1" ]]; then
    log_warning "SKIP_GPU=1 — skipping GPU smoke test"
else
    run_workflow "$WORKFLOWS_DIR/verify-gpu.yaml" "verify-gpu" "$GPU_POLL_TIMEOUT"
fi

log_success "All smoke tests passed"
