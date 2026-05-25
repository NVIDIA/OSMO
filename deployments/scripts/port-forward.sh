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
# Port-forward helper for OSMO services
#
# Two modes:
#   port-forward.sh <svc> <port> [namespace]
#       One-shot: ensures a single live kubectl port-forward, idempotent against
#       kube-context drift. Prints the PID on stdout. Caller is responsible for
#       cleanup (or relies on session-end pkill).
#
#   port-forward.sh --watchdog <svc> <port> [namespace]
#       Long-running: spawns a setsid-detached respawn loop tagged
#       `osmo-pf-watchdog:<svc>`. The loop restarts the PF whenever it dies
#       (pod rescheduled, kubectl crash, network blip). Cleanup the whole
#       set with: pkill -f 'osmo-pf-watchdog:'
#
# Usage examples:
#   ./port-forward.sh osmo-service 9000
#   ./port-forward.sh --watchdog osmo-service 9000 osmo-minimal
#   ./port-forward.sh --watchdog osmo-ui 3000 osmo-minimal
###############################################################################

set -euo pipefail

WATCHDOG=0
if [[ "${1:-}" == "--watchdog" ]]; then
    WATCHDOG=1
    shift
fi

SVC="${1:?usage: $0 [--watchdog] <svc> <port> [namespace]}"
PORT="${2:?usage: $0 [--watchdog] <svc> <port> [namespace]}"
NS="${3:-osmo-minimal}"
TARGET_PORT="${TARGET_PORT:-80}"
URL="http://localhost:${PORT}"
WATCHDOG_HEALTH_TIMEOUT_SECONDS="${OSMO_PF_HEALTH_TIMEOUT_SECONDS:-300}"

KUBECTL="${KUBECTL:-kubectl}"

WATCHDOG_TAG="osmo-pf-watchdog:${SVC}"
PGREP_ONESHOT="${KUBECTL} port-forward svc/${SVC} ${PORT}:.* -n ${NS}"
PGREP_WATCHDOG_PORT_FORWARD="port-forward svc/[^ ]+ ${PORT}:.* -n ${NS}"

kill_processes_matching() {
    local pattern="$1"
    local pid
    local current_bash_pid="${BASHPID:-}"
    while read -r pid; do
        [[ -n "$pid" ]] || continue
        [[ "$pid" != "$$" && "$pid" != "$current_bash_pid" ]] || continue
        kill "$pid" 2>/dev/null || true
    done < <(pgrep -f "$pattern" 2>/dev/null || true)
}

stop_watchdog_port_forwards_on_port() {
    # A re-run may resolve a different service name for the same local API port
    # (for example osmo-service before osmo-gateway appears). Replace by local
    # port, not just watchdog tag, so stale watchdogs cannot race for :9000.
    kill_processes_matching "$PGREP_WATCHDOG_PORT_FORWARD"
    sleep 1
    kill_processes_matching "$PGREP_WATCHDOG_PORT_FORWARD"
}

###############################################################################
# Watchdog mode — spawn a detached respawn loop and exit
###############################################################################
if [[ "$WATCHDOG" == "1" ]]; then
    # Replace any existing watchdog on this local port so re-runs are idempotent.
    # Kill the bash loop AND any kubectl child it may have spawned — the
    # WATCHDOG_TAG only appears in the bash loop's argv, so the child kubectl
    # port-forward survives a naive `pkill -f WATCHDOG_TAG` and keeps the
    # local port bound, leaving the next watchdog pointed at a stale tunnel.
    stop_watchdog_port_forwards_on_port

    # The watchdog tag is embedded as a literal env-var assignment so it shows
    # up in `ps -eo args` / `pgrep -fl`. A leading `#` comment inside `bash -c`
    # would be discarded at parse time and never appear in argv.
    #
    # Use `nohup` (POSIX, available on macOS + Linux) for SIGHUP-immunity. The
    # `&` + `disown` pair detaches the child from the parent's job table so it
    # survives this script's exit. `setsid` would also work but isn't installed
    # by default on macOS.
    #
    # The loop traps TERM/INT and forwards the signal to the active kubectl
    # child via $! — without this, killing the loop leaves a stranded kubectl.
    nohup bash -c "
        export OSMO_PF_WATCHDOG_TAG=${WATCHDOG_TAG}
        PF_PID=
        cleanup() { [[ -n \"\$PF_PID\" ]] && kill \"\$PF_PID\" 2>/dev/null || true; exit 0; }
        trap cleanup TERM INT
        while true; do
            ${KUBECTL} port-forward svc/${SVC} ${PORT}:${TARGET_PORT} -n ${NS} >/dev/null 2>&1 &
            PF_PID=\$!
            wait \"\$PF_PID\" 2>/dev/null || true
            PF_PID=
            sleep 2
        done
    " </dev/null >/dev/null 2>&1 &
    WATCHDOG_PID=$!
    disown "$WATCHDOG_PID" 2>/dev/null || true

    # Wait for the PF to become healthy before returning so callers can rely on
    # it. Keep the deadline generous for AKS cold-starts, where newly installed
    # Service endpoints and load-balancer plumbing can lag well past 90s. The
    # kubectl spawned by the watchdog exits and respawns until the endpoint is
    # reachable.
    watchdog_health_start_time=$(date +%s)
    watchdog_health_end_time=$((watchdog_health_start_time + WATCHDOG_HEALTH_TIMEOUT_SECONDS))
    while true; do
        watchdog_health_now=$(date +%s)
        watchdog_health_remaining_seconds=$((watchdog_health_end_time - watchdog_health_now))
        if (( watchdog_health_remaining_seconds <= 0 )); then
            break
        fi
        curl_max_time="$watchdog_health_remaining_seconds"
        if (( curl_max_time > 1 )); then
            curl_max_time=1
        fi
        if curl -so /dev/null --max-time "$curl_max_time" "$URL/"; then
            echo "Watchdog $WATCHDOG_TAG started; PF healthy on localhost:$PORT"
            exit 0
        fi
        watchdog_health_now=$(date +%s)
        watchdog_health_remaining_seconds=$((watchdog_health_end_time - watchdog_health_now))
        if (( watchdog_health_remaining_seconds <= 0 )); then
            break
        fi
        sleep_seconds="$watchdog_health_remaining_seconds"
        if (( sleep_seconds > 1 )); then
            sleep_seconds=1
        fi
        sleep "$sleep_seconds"
    done
    echo "ERROR: watchdog started but PF on $PORT did not become healthy in ${WATCHDOG_HEALTH_TIMEOUT_SECONDS}s" >&2
    stop_watchdog_port_forwards_on_port
    exit 1
fi

###############################################################################
# One-shot mode — idempotent single port-forward bound to current kube context
###############################################################################
CTX_FILE="${TMPDIR:-/tmp}/osmo-pf-${SVC}-${PORT}.ctx"
CURRENT_CTX=$($KUBECTL config current-context)
CURRENT_CLUSTER=$($KUBECTL config view --minify -o jsonpath='{.clusters[0].cluster.server}')
CURRENT_ID="${CURRENT_CTX}|${CURRENT_CLUSTER}|${NS}|${PORT}"

EXISTING=""
if pgrep -f "$PGREP_ONESHOT" >/dev/null; then
    EXISTING=$(pgrep -f "$PGREP_ONESHOT" | head -1)
fi

reuse_ok=false
if [[ -n "$EXISTING" ]] && curl -so /dev/null --max-time 2 "$URL/"; then
    if [[ -f "$CTX_FILE" ]] && [[ "$(cat "$CTX_FILE")" == "$CURRENT_ID" ]]; then
        reuse_ok=true
    fi
fi

if [[ "$reuse_ok" == "true" ]]; then
    echo "$EXISTING"
    exit 0
fi

if [[ -n "$EXISTING" ]]; then
    echo "Replacing port-forward (context/namespace changed or unverified)" >&2
    pkill -f "$PGREP_ONESHOT" || true
    sleep 1
fi

$KUBECTL port-forward "svc/${SVC}" "${PORT}:${TARGET_PORT}" -n "$NS" >/dev/null 2>&1 &
PF=$!

for _ in $(seq 1 30); do
    if ! kill -0 "$PF" 2>/dev/null; then
        echo "ERROR: kubectl port-forward exited before becoming healthy" >&2
        exit 1
    fi
    if curl -so /dev/null --max-time 1 "$URL/"; then
        echo "$CURRENT_ID" > "$CTX_FILE"
        echo "$PF"
        exit 0
    fi
    sleep 0.5
done

echo "ERROR: port-forward on $PORT did not become healthy in 15s" >&2
if kill -0 "$PF" 2>/dev/null; then kill "$PF"; fi
exit 1
