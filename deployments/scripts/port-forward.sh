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

KUBECTL="${KUBECTL:-kubectl}"

WATCHDOG_TAG="osmo-pf-watchdog:${SVC}"
PGREP_ONESHOT="${KUBECTL} port-forward svc/${SVC} ${PORT}:.* -n ${NS}"

###############################################################################
# Watchdog mode — spawn a detached respawn loop and exit
###############################################################################
if [[ "$WATCHDOG" == "1" ]]; then
    # Replace any existing watchdog for this svc so re-runs are idempotent.
    # Kill the bash loop AND any kubectl child it may have spawned — the
    # WATCHDOG_TAG only appears in the bash loop's argv, so the child kubectl
    # port-forward survives a naive `pkill -f WATCHDOG_TAG` and keeps the
    # local port bound, leaving the next watchdog pointed at a stale tunnel.
    if pgrep -f "$WATCHDOG_TAG" >/dev/null; then
        pkill -f "$WATCHDOG_TAG" || true
        pkill -f "${KUBECTL} port-forward svc/${SVC} ${PORT}:.* -n ${NS}" || true
        sleep 1
    fi

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
    # it. Generous deadline because kube-proxy can take 10-30s to program a new
    # Service's endpoints right after a fresh install — the kubectl spawned by
    # the watchdog will exit and respawn until the endpoint is reachable.
    for _ in $(seq 1 90); do
        if curl -so /dev/null --max-time 1 "$URL/"; then
            echo "Watchdog $WATCHDOG_TAG started; PF healthy on localhost:$PORT"
            exit 0
        fi
        sleep 1
    done
    echo "ERROR: watchdog started but PF on $PORT did not become healthy in 90s" >&2
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
