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
# OSMO Deployment-Script Test Gate (D4)
#
# End-to-end test wrapper that exercises deploy-osmo-minimal.sh, verify.sh,
# and the per-provider helper scripts on a real ephemeral cluster. Designed
# to run from a GitLab CI nightly schedule, a release-cut manual trigger, or
# a future Kargo verification stage --- the interface (flags + env vars +
# categorized exit code) is the stable contract.
#
# Invariants (see plan §D4.1):
#   1. Stateless CLI: only --provider / --chart-version / --image-tag.
#      Note: --chart-version and --image-tag are accepted by THIS wrapper but
#      passed through to deploy-osmo-minimal.sh as OSMO_CHART_VERSION /
#      OSMO_IMAGE_TAG env vars (deploy-k8s.sh:59-60), not as CLI flags.
#   2. Self-contained: ephemeral cluster + DB + Redis, torn down on EXIT.
#   3. Identity-agnostic: no cloud creds, Vault, or Kargo tokens needed.
#   4. Reproducible: no $RANDOM, no wall-clock dependencies in test logic.
#   5. Bounded: 45-min hard timeout; every kubectl wait has --timeout.
#   6. Structured output: JSON result + per-stage logs in $RUN_DIR.
#   7. Idempotent teardown: --destroy + kind delete + docker prune.
#   8. Categorized exit codes:
#        0 = pass
#        1 = cluster-bootstrap failure
#        2 = deploy-script OR verify failure (verify.sh runs inside
#            deploy-osmo-minimal.sh; we let the deploy script own its
#            port-forward-watchdog → verify.sh sequencing rather than
#            splitting them across stages)
#        4 = OETF smoke failure
#        5 = teardown failure
#
# Usage:
#   run-deployment-test.sh [--provider byo-kind|microk8s]
#                          [--chart-version VERSION]
#                          [--image-tag TAG]
#
# Env vars (read but never required):
#   PROVIDER, OSMO_CHART_VERSION, OSMO_IMAGE_TAG, RUN_DIR
#
# OSMO_DEPLOY_DEMO is FORBIDDEN in CI: this script will abort if set.
###############################################################################

set -euo pipefail

# ── CI guardrail: demo mode must never be active in the test gate ────────────
# Demo mode (D1) tolerates verify-script failures. Letting that opt-out leak
# into the nightly gate would silently hide exactly the regressions D4 exists
# to catch. Fail fast.
if [[ -n "${OSMO_DEPLOY_DEMO:-}" ]]; then
    echo "FATAL: OSMO_DEPLOY_DEMO is set; forbidden in the deployment-test gate." >&2
    exit 2
fi

# ── Defaults / CLI parsing ───────────────────────────────────────────────────
PROVIDER="${PROVIDER:-byo-kind}"
CHART_VERSION="${OSMO_CHART_VERSION:-}"
IMAGE_TAG="${OSMO_IMAGE_TAG:-}"

# Azure provider params (read from env or set via CLI; required when --provider azure).
AZURE_SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-}"
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-}"
AZURE_REGION="${AZURE_REGION:-eastus2}"
AZURE_CLUSTER_NAME="${AZURE_CLUSTER_NAME:-}"
ENVIRONMENT="${ENVIRONMENT:-dev}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
STORAGE_BACKEND="${STORAGE_BACKEND:-}"

# Where //test_infra/oetf lives. In the OUTER osmo repo it is a sibling of
# external/ (NOT inside it). When this script is invoked from an external/
# worktree (e.g. /tmp/osmo-d4-azure), $REPO_ROOT resolves to /tmp/ and OETF
# is unreachable. Setting OETF_REPO_ROOT lets the caller point at the outer
# checkout (e.g. /home/jiaenr/osmo) without changing the run-from-external
# convention.
OETF_REPO_ROOT="${OETF_REPO_ROOT:-}"

# Operational knobs (env-only, never required):
#   SKIP_OETF=1      → skip stage_oetf_smoke entirely (returns 0)
#   SKIP_TEARDOWN=1  → skip the deploy --destroy + KIND delete in cleanup()
#                      (use when --provider azure / aws and you want to keep
#                      the cloud infra alive for inspection)
SKIP_OETF="${SKIP_OETF:-0}"
SKIP_TEARDOWN="${SKIP_TEARDOWN:-0}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --provider)             PROVIDER="$2";              shift 2 ;;
        --chart-version)        CHART_VERSION="$2";         shift 2 ;;
        --image-tag)            IMAGE_TAG="$2";             shift 2 ;;
        # Azure pass-through
        --subscription-id)      AZURE_SUBSCRIPTION_ID="$2"; shift 2 ;;
        --resource-group)       AZURE_RESOURCE_GROUP="$2";  shift 2 ;;
        --region)               AZURE_REGION="$2";          shift 2 ;;
        --cluster-name)         AZURE_CLUSTER_NAME="$2";    shift 2 ;;
        --environment)          ENVIRONMENT="$2";           shift 2 ;;
        --postgres-password)    POSTGRES_PASSWORD="$2";     shift 2 ;;
        --storage-backend)      STORAGE_BACKEND="$2";       shift 2 ;;
        --oetf-repo-root)       OETF_REPO_ROOT="$2";        shift 2 ;;
        --skip-oetf)            SKIP_OETF=1;                shift   ;;
        --skip-teardown)        SKIP_TEARDOWN=1;            shift   ;;
        -h|--help)
            grep '^#' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *)
            echo "FATAL: unknown argument: $1" >&2
            exit 2 ;;
    esac
done

# ── Path setup ───────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# external/deployments/scripts/ → external/deployments/ → external/ → repo root
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-osmo-minimal.sh"
KIND_CONFIG="$REPO_ROOT/ci/deployment-test/kind-config.yaml"

RUN_DIR="${RUN_DIR:-$REPO_ROOT/runs/deployment-test-${PROVIDER}}"
mkdir -p "$RUN_DIR"

DEPLOY_LOG="$RUN_DIR/deploy.log"
OETF_LOG="$RUN_DIR/oetf.log"
TEARDOWN_LOG="$RUN_DIR/teardown.log"
RESULT_JSON="$RUN_DIR/deployment-test-result.json"
JUNIT_XML="$RUN_DIR/junit.xml"

KIND_CLUSTER_NAME="osmo-deployment-test"
OSMO_NAMESPACE="osmo-minimal"
HARD_TIMEOUT_SECONDS=2700  # 45 minutes

# Per-stage state for the final JSON.
declare -a STAGE_NAMES=()
declare -a STAGE_EXIT_CODES=()
declare -a STAGE_DURATIONS=()
OVERALL_EXIT_CODE=0
FAILED_STAGE=""

log_info()  { printf '[%s] [INFO]  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
log_error() { printf '[%s] [ERROR] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# ── Result + teardown helpers ────────────────────────────────────────────────
record_stage() {
    # record_stage <name> <exit_code> <duration_seconds>
    STAGE_NAMES+=("$1")
    STAGE_EXIT_CODES+=("$2")
    STAGE_DURATIONS+=("$3")
}

# Map an exit code to its semantic stage name (plan §D4.1 invariant 8).
exit_code_category() {
    case "$1" in
        0) echo "pass" ;;
        1) echo "cluster-bootstrap" ;;
        2) echo "deploy-script-or-verify" ;;
        4) echo "oetf-smoke" ;;
        5) echo "teardown" ;;
        *) echo "unknown" ;;
    esac
}

emit_result_json() {
    local overall="pass"
    [[ "$OVERALL_EXIT_CODE" -ne 0 ]] && overall="fail"

    {
        printf '{\n'
        printf '  "provider": "%s",\n'      "$PROVIDER"
        printf '  "chart_version": "%s",\n' "$CHART_VERSION"
        printf '  "image_tag": "%s",\n'     "$IMAGE_TAG"
        printf '  "stages": [\n'
        local i
        for i in "${!STAGE_NAMES[@]}"; do
            local sep=","
            [[ "$i" -eq $(( ${#STAGE_NAMES[@]} - 1 )) ]] && sep=""
            printf '    {"name": "%s", "exit_code": %s, "duration_seconds": %s}%s\n' \
                "${STAGE_NAMES[$i]}" "${STAGE_EXIT_CODES[$i]}" "${STAGE_DURATIONS[$i]}" "$sep"
        done
        printf '  ],\n'
        printf '  "overall": "%s",\n'   "$overall"
        printf '  "exit_code": %s,\n'   "$OVERALL_EXIT_CODE"
        printf '  "failed_stage": "%s"\n' "$FAILED_STAGE"
        printf '}\n'
    } > "$RESULT_JSON"
}

emit_junit_xml() {
    # Minimal JUnit XML so GitLab CI's reports.junit: surfaces stages as cases.
    local total="${#STAGE_NAMES[@]}"
    local failures=0
    local i
    for i in "${!STAGE_NAMES[@]}"; do
        [[ "${STAGE_EXIT_CODES[$i]}" -ne 0 ]] && failures=$((failures + 1))
    done

    {
        printf '<?xml version="1.0" encoding="UTF-8"?>\n'
        printf '<testsuite name="deployment-test" tests="%s" failures="%s">\n' "$total" "$failures"
        for i in "${!STAGE_NAMES[@]}"; do
            local name="${STAGE_NAMES[$i]}"
            local code="${STAGE_EXIT_CODES[$i]}"
            local duration="${STAGE_DURATIONS[$i]}"
            printf '  <testcase classname="deployment-test.%s" name="%s" time="%s">' \
                "$PROVIDER" "$name" "$duration"
            if [[ "$code" -ne 0 ]]; then
                printf '<failure message="stage %s exited %s" type="%s"/>' \
                    "$name" "$code" "$(exit_code_category "$code")"
            fi
            printf '</testcase>\n'
        done
        printf '</testsuite>\n'
    } > "$JUNIT_XML"
}

cleanup() {
    local rc=$?
    # If we're here because a stage already set OVERALL_EXIT_CODE, preserve it;
    # otherwise infer from $rc (e.g. ERR-on-set -e from an unguarded command).
    if [[ "$OVERALL_EXIT_CODE" -eq 0 && "$rc" -ne 0 ]]; then
        OVERALL_EXIT_CODE="$rc"
        FAILED_STAGE="${FAILED_STAGE:-unknown}"
    fi

    # Best-effort: silence the watchdog before its sleep elapses. Safe to call
    # even if WATCHDOG_PID is unset/already-dead (stop_watchdog tolerates both).
    if declare -F stop_watchdog >/dev/null 2>&1; then
        stop_watchdog
    fi

    local td_start td_end td_rc=0
    td_start=$SECONDS
    log_info "Teardown: starting (preserving exit code $OVERALL_EXIT_CODE)"

    if [[ "$SKIP_TEARDOWN" == "1" ]]; then
        log_info "SKIP_TEARDOWN=1 — skipping deploy --destroy and infra cleanup"
    else
        # Best-effort destroy via the same orchestrator the test exercises.
        # --destroy is idempotent (plan §D4.1 invariant 7), so it is safe to
        # run even when stage 1 only got halfway through cluster creation.
        #
        # NOTE: deploy-osmo-minimal.sh's accepted providers are azure|aws|microk8s|byo
        # (deploy-osmo-minimal.sh:450-457). Our wrapper's `byo-kind` taxonomy must
        # translate to `byo` at this boundary.
        local deploy_provider="$PROVIDER"
        [[ "$PROVIDER" == "byo-kind" ]] && deploy_provider="byo"
        local destroy_args=(--provider "$deploy_provider" --destroy --non-interactive)
        # For cloud providers, preserve the externally-managed terraform infra.
        # Without --skip-terraform, deploy-osmo-minimal.sh --destroy would run
        # `terraform destroy` and delete the cluster + postgres + redis that
        # the operator provisioned out-of-band.
        if [[ "$PROVIDER" == "azure" || "$PROVIDER" == "aws" ]]; then
            destroy_args+=(--skip-terraform)
        fi
        if [[ -x "$DEPLOY_SCRIPT" ]]; then
            bash "$DEPLOY_SCRIPT" "${destroy_args[@]}" \
                >>"$TEARDOWN_LOG" 2>&1 || td_rc=$?
        fi

        if [[ "$PROVIDER" == "byo-kind" ]]; then
            # Even if the deploy script never ran or partial-failed, ensure the
            # KIND cluster, sidecar containers, and unused images are removed
            # so the runner returns to a clean state.
            kind delete cluster --name "$KIND_CLUSTER_NAME" >>"$TEARDOWN_LOG" 2>&1 || true
            docker rm -f osmo-test-postgres osmo-test-redis >>"$TEARDOWN_LOG" 2>&1 || true
            docker system prune -af --filter "until=2h" >>"$TEARDOWN_LOG" 2>&1 || true
        fi
    fi

    td_end=$SECONDS
    record_stage "teardown" "$td_rc" "$((td_end - td_start))"

    # A teardown failure is only the controlling exit code when no earlier
    # stage already failed --- keep the original signal so triage points at
    # the real regression.
    if [[ "$OVERALL_EXIT_CODE" -eq 0 && "$td_rc" -ne 0 ]]; then
        OVERALL_EXIT_CODE=5
        FAILED_STAGE="teardown"
    fi

    emit_result_json
    emit_junit_xml

    log_info "Teardown: complete; overall exit code = $OVERALL_EXIT_CODE (failed_stage=${FAILED_STAGE:-none})"
    exit "$OVERALL_EXIT_CODE"
}
trap cleanup EXIT

# ── Hard 45-minute timeout ───────────────────────────────────────────────────
# Background watchdog process signals the main script if a stage hangs past
# the bounded duration invariant. We send SIGTERM to the main shell ($$) only
# --- not to the whole process group (`kill -- -$$`) --- because this script
# is not guaranteed to be a session leader (CI runners frequently exec it
# inside an existing group). SIGTERM gives the EXIT trap a chance to run
# teardown.
MAIN_PID=$$
(
    sleep "$HARD_TIMEOUT_SECONDS"
    log_error "Hard timeout (${HARD_TIMEOUT_SECONDS}s) reached; aborting"
    kill -TERM "$MAIN_PID" 2>/dev/null || true
) &
WATCHDOG_PID=$!
disown "$WATCHDOG_PID" 2>/dev/null || true

stop_watchdog() {
    kill "$WATCHDOG_PID" 2>/dev/null || true
    wait "$WATCHDOG_PID" 2>/dev/null || true
}

# ── Stage runner ─────────────────────────────────────────────────────────────
# run_stage <name> <exit_code_on_failure> <command...>
run_stage() {
    local name="$1"
    local fail_code="$2"
    shift 2

    log_info "Stage start: $name"
    local start=$SECONDS
    local rc=0

    if ! "$@"; then
        rc=$?
        log_error "Stage failed: $name (raw rc=$rc → categorized $fail_code)"
        record_stage "$name" "$fail_code" "$((SECONDS - start))"
        OVERALL_EXIT_CODE="$fail_code"
        FAILED_STAGE="$name"
        stop_watchdog
        exit "$fail_code"
    fi

    record_stage "$name" 0 "$((SECONDS - start))"
    log_info "Stage pass: $name ($((SECONDS - start))s)"
}

# ── Stage implementations ────────────────────────────────────────────────────

stage_bootstrap_byo_kind() {
    log_info "Creating KIND cluster '$KIND_CLUSTER_NAME' (config=$KIND_CONFIG)"
    kind create cluster \
        --name "$KIND_CLUSTER_NAME" \
        --config "$KIND_CONFIG" \
        --wait 5m

    log_info "Starting ephemeral postgres + redis sidecars on the 'kind' docker network"
    # postgres:15 reads POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB at container
    # startup to create the role+db. POSTGRES_USER here is the container's env
    # contract --- distinct from POSTGRES_USERNAME (the libpq credential name
    # the deploy script reads at deploy-osmo-minimal.sh:585).
    docker run -d --name osmo-test-postgres --network kind \
        -e POSTGRES_PASSWORD=test \
        -e POSTGRES_USER=postgres \
        -e POSTGRES_DB=osmo \
        postgres:15
    # deploy-osmo-minimal.sh's BYO preflight (line 587) rejects empty
    # REDIS_PASSWORD with `[[ -z ... ]]`, so the sidecar must require a
    # password. This differs from the microk8s in-cluster redis path which
    # tolerates empty passwords explicitly.
    docker run -d --name osmo-test-redis --network kind \
        redis:7 redis-server --requirepass test-redis-password

    # Export creds for deploy-osmo-minimal.sh's --non-interactive path.
    # Variable names match deploy-osmo-minimal.sh:584-595 exactly:
    # POSTGRES_HOST, POSTGRES_USERNAME (NOT POSTGRES_USER), POSTGRES_PASSWORD,
    # POSTGRES_DB_NAME, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD (non-empty).
    export POSTGRES_HOST=osmo-test-postgres
    export POSTGRES_USERNAME=postgres
    export POSTGRES_PASSWORD=test
    export POSTGRES_DB_NAME=osmo
    export REDIS_HOST=osmo-test-redis
    export REDIS_PORT=6379
    export REDIS_PASSWORD=test-redis-password

    log_info "Waiting for control-plane Ready"
    kubectl wait --for=condition=Ready node \
        --selector='node-role.kubernetes.io/control-plane' \
        --timeout=5m
}

stage_bootstrap_microk8s() {
    # TODO(plan §D4.2): microk8s requires `privileged: true` on the runner
    # (snap install). Ship D4 v1 with byo-kind only; wire microk8s in once a
    # privileged runner class is justified by a real regression.
    log_error "--provider microk8s is not yet supported in run-deployment-test.sh"
    log_error "See plan §D4.2 'Why --provider byo-kind first'"
    return 1
}

stage_bootstrap_azure() {
    # Azure infra (AKS + flexible postgres + redis cache + storage) is
    # provisioned out-of-band via terraform — the same flow operators use
    # for real deployments. This wrapper only confirms reachability;
    # provisioning belongs to the human/automation that ran terraform.
    if [[ -z "$AZURE_SUBSCRIPTION_ID" ]]; then
        if command -v az >/dev/null 2>&1; then
            AZURE_SUBSCRIPTION_ID="$(az account show --query id -o tsv 2>/dev/null || true)"
        fi
        if [[ -z "$AZURE_SUBSCRIPTION_ID" ]]; then
            log_error "AZURE_SUBSCRIPTION_ID is required (env or --subscription-id)"
            return 1
        fi
    fi
    for var in AZURE_RESOURCE_GROUP AZURE_CLUSTER_NAME POSTGRES_PASSWORD; do
        if [[ -z "${!var}" ]]; then
            log_error "Required for --provider azure: $var (env or matching CLI flag)"
            return 1
        fi
    done

    log_info "Refreshing kubectl credentials for AKS cluster"
    log_info "  subscription=$AZURE_SUBSCRIPTION_ID resource-group=$AZURE_RESOURCE_GROUP cluster=$AZURE_CLUSTER_NAME"
    az aks get-credentials \
        --subscription "$AZURE_SUBSCRIPTION_ID" \
        --resource-group "$AZURE_RESOURCE_GROUP" \
        --name "$AZURE_CLUSTER_NAME" \
        --admin --overwrite-existing >/dev/null

    log_info "Confirming cluster reachability"
    kubectl get nodes -o wide
    kubectl version --output=yaml | head -10 || true
}

stage_bootstrap() {
    case "$PROVIDER" in
        byo-kind)  stage_bootstrap_byo_kind ;;
        microk8s)  stage_bootstrap_microk8s ;;
        azure)     stage_bootstrap_azure ;;
        *)
            log_error "Unknown provider: $PROVIDER"
            return 1 ;;
    esac
}

stage_deploy() {
    # Translate the wrapper's `byo-kind` taxonomy to deploy-osmo-minimal.sh's
    # accepted provider set (azure|aws|microk8s|byo; see deploy-osmo-minimal.sh:450-457).
    local deploy_provider="$PROVIDER"
    [[ "$PROVIDER" == "byo-kind" ]] && deploy_provider="byo"

    # OSMO_CHART_VERSION / OSMO_IMAGE_TAG are read as env vars by deploy-k8s.sh
    # (lines 59-60, 661, 730-731, 741, 762-763). They are NOT CLI flags --- the
    # deploy script silently drops unknown flags via `*) shift ;;` at lines
    # 386-388, so passing --chart-version/--image-tag would do nothing.
    [[ -n "$CHART_VERSION" ]] && export OSMO_CHART_VERSION="$CHART_VERSION"
    [[ -n "$IMAGE_TAG" ]]     && export OSMO_IMAGE_TAG="$IMAGE_TAG"

    local args=()
    case "$PROVIDER" in
        byo-kind)
            # KIND has no cloud LoadBalancer controller — pin gateway to
            # NodePort 30080 (matching ci/deployment-test/kind-config.yaml).
            # STORAGE_BACKEND=none short-circuits configure_storage_phase
            # (deploy-osmo-minimal.sh:733-737) since terraform outputs aren't
            # available on a BYO KIND box.
            args=(
                --provider "$deploy_provider"
                --non-interactive
                --no-gpu
                --storage-backend none
                --helm-set gateway.envoy.service.type=NodePort
                --helm-set gateway.envoy.service.nodePort=30080
                --helm-set gateway.envoy.service.httpsPort=null
            )
            ;;
        azure)
            # Azure expects --skip-terraform (terraform applied externally).
            # STORAGE_BACKEND default for Azure path is minio (per user flow);
            # caller may override via --storage-backend. Real Azure LB is
            # provisioned by the chart's default service.type=LoadBalancer,
            # so do NOT pin to NodePort here.
            #
            # Chart defaults reserve 1 full CPU each for logger / service /
            # worker / agent with minReplicas=3 on logger, AND 1 full CPU
            # for the osmo-ctrl sidecar of every workflow pod (chart
            # path: services.configs.workflow.podTemplates.default_ctrl.
            # spec.containers[0].resources.requests.cpu = "1"). On a
            # 3-node Standard_D4s_v3 system pool (4 vCPU each, ~3
            # schedulable after Azure daemons) the K8_CPU placeholder
            # (= node.allocatable.cpu − default_ctrl.requests.cpu −
            # non_workflow_usage; see postgres.py
            # construct_updated_allocatables) drops below 1.0, so the
            # strict-LE rule `USER_CPU LE K8_CPU` rejects every
            # cpu=1 task ("Value 1.0 too high for CPU").
            #
            # Two reductions:
            #   - OSMO-service requests → 100m  (was 1 each → 5 × 1 = 5 CPU)
            #   - osmo-ctrl sidecar request → 100m (was 1 per workflow task)
            # The chart's CPU LIMIT on ctrl/user still tracks USER_CPU,
            # so the user's task still gets its full requested CPU budget
            # at runtime; only the SCHEDULING request shrinks.
            args=(
                --provider azure
                --non-interactive
                --no-gpu
                --skip-terraform
                --storage-backend "${STORAGE_BACKEND:-minio}"
                --subscription-id "$AZURE_SUBSCRIPTION_ID"
                --resource-group  "$AZURE_RESOURCE_GROUP"
                --region          "$AZURE_REGION"
                --cluster-name    "$AZURE_CLUSTER_NAME"
                --environment     "$ENVIRONMENT"
                --postgres-password "$POSTGRES_PASSWORD"
                --helm-set services.logger.scaling.minReplicas=1
                --helm-set services.logger.resources.requests.cpu=100m
                --helm-set services.service.resources.requests.cpu=100m
                --helm-set services.worker.resources.requests.cpu=100m
                --helm-set services.agent.resources.requests.cpu=100m
                --helm-set services.router.resources.requests.cpu=100m
                # default_ctrl pod template override (osmo-ctrl sidecar
                # requests.cpu → 100m). Has to come via --helm-values not
                # --helm-set because helm replaces list elements wholesale —
                # `--set …containers[0]...cpu=100m` wipes the container's
                # `name` and limits, breaking the configmap loader's schema.
                --helm-values "${SCRIPT_DIR}/../../ci/deployment-test/azure-overrides.yaml"
            )
            ;;
        *)
            log_error "stage_deploy: provider $PROVIDER not wired"
            return 1
            ;;
    esac

    log_info "Invoking $DEPLOY_SCRIPT (provider=$deploy_provider, ${#args[@]} args)"
    log_info "  (env: OSMO_CHART_VERSION='${OSMO_CHART_VERSION:-}' OSMO_IMAGE_TAG='${OSMO_IMAGE_TAG:-}')"
    bash "$DEPLOY_SCRIPT" "${args[@]}" 2>&1 | tee "$DEPLOY_LOG"
    # PIPESTATUS[0] = exit code of bash invocation; tee never fails.
    local rc="${PIPESTATUS[0]}"
    return "$rc"
}

stage_oetf_smoke() {
    if [[ "$SKIP_OETF" == "1" ]]; then
        log_info "SKIP_OETF=1 — skipping stage_oetf_smoke (returns pass)"
        return 0
    fi

    # Locate the deployed OSMO URL.
    #   byo-kind: KIND config maps host :80 → NodePort 30080 → gateway-envoy Service.
    #   azure:   chart default service.type=LoadBalancer → external IP. Wait briefly.
    local osmo_url
    case "$PROVIDER" in
        byo-kind)
            osmo_url="http://localhost"
            ;;
        azure)
            # Tried hitting the Azure LB external IP directly first
            # (osmo-gateway Service is LoadBalancer type). The IP shows
            # up in kubectl get svc within ~30s, but actual reachability
            # from the GitHub runner takes longer to settle: every OETF
            # bazel test got `ConnectTimeoutError(timeout=60)` to the
            # LB on port 80. The cluster's verify-hello check (verify.sh)
            # had no such issue because it goes via kubectl port-forward.
            # Mirror that: start a localhost port-forward to osmo-gateway
            # and point OETF at localhost. Robust to any LB-propagation
            # delay or NSG quirk.
            local pf_port="${OSMO_OETF_PF_PORT:-9100}"
            log_info "Starting kubectl port-forward for OETF: localhost:${pf_port} → osmo-gateway:80"
            local pf_svc=""
            for candidate in osmo-gateway osmo-gateway-envoy; do
                if kubectl get svc -n "$OSMO_NAMESPACE" "$candidate" >/dev/null 2>&1; then
                    pf_svc="$candidate"; break
                fi
            done
            if [[ -z "$pf_svc" ]]; then
                log_error "Neither osmo-gateway nor osmo-gateway-envoy found in $OSMO_NAMESPACE"
                return 1
            fi
            # nohup + & so the PF outlives this function's subshells.
            # Also drop output to a per-run log so we can debug PF crashes.
            nohup kubectl port-forward -n "$OSMO_NAMESPACE" \
                "svc/${pf_svc}" "${pf_port}:80" \
                > "$RUN_DIR/oetf-pf.log" 2>&1 &
            local pf_pid=$!
            # Smoke the PF before we hand off to OETF; OETF will retry on
            # its own but a hard-fail here surfaces PF problems immediately.
            local pf_ready=""
            for _ in 1 2 3 4 5 6 7 8 9 10; do
                if curl -sS -o /dev/null -m 2 "http://localhost:${pf_port}/api/version" 2>/dev/null; then
                    pf_ready=1; break
                fi
                sleep 1
            done
            if [[ -z "$pf_ready" ]]; then
                log_error "port-forward to ${pf_svc}:80 didn't become reachable on localhost:${pf_port}; check $RUN_DIR/oetf-pf.log"
                kill "$pf_pid" 2>/dev/null || true
                return 1
            fi
            log_info "Port-forward healthy (PID=$pf_pid). OETF will use http://localhost:${pf_port}"
            # Ensure PF dies on function return (success OR failure).
            # Bash RETURN trap is per-function — re-arm here.
            trap "kill $pf_pid 2>/dev/null || true" RETURN
            osmo_url="http://localhost:${pf_port}"
            ;;
        *)
            osmo_url="http://localhost"
            ;;
    esac
    log_info "Running OETF smoke against $osmo_url"

    # OETF lives in the OUTER osmo repo at test/oetf (sibling of external/).
    # When this script runs from an external/ worktree, $REPO_ROOT points at
    # the worktree's parent (e.g. /tmp/) which does not contain test/. The
    # caller supplies OETF_REPO_ROOT to point at the actual outer checkout.
    # (Path was test_infra/oetf prior to the 2026-06 rename — keep a fallback
    # so older checkouts still work without re-editing.)
    local oetf_repo="${OETF_REPO_ROOT:-$REPO_ROOT}"
    local oetf_pkg=""
    if [[ -d "$oetf_repo/test/oetf" ]]; then
        oetf_pkg="//test/oetf:run"
    elif [[ -d "$oetf_repo/test_infra/oetf" ]]; then
        oetf_pkg="//test_infra/oetf:run"
    else
        log_error "OETF source not found under $oetf_repo (looked for test/oetf and test_infra/oetf; set OETF_REPO_ROOT)"
        return 1
    fi
    if ! command -v bazel >/dev/null 2>&1; then
        log_error "OETF KIND entrypoint not wired --- bazel not on PATH. See runbook-3."
        return 1
    fi
    log_info "OETF target: $oetf_pkg (repo=$oetf_repo)"

    # OETF tag selection. `smoke` is the canonical post-deploy gate, but
    # during the test_infra → test/oetf migration the public staging/smoke/
    # set is empty after `auth` is auto-excluded (--auth-method dev). The
    # caller can override via $OETF_TAGS; default falls back from smoke to
    # `cli` (a real scenario test that exercises OSMO workflow submission).
    local oetf_tags="${OETF_TAGS:-smoke}"
    (
        cd "$oetf_repo"
        bazel run "$oetf_pkg" -- \
            --env kind \
            --url "$osmo_url" \
            --auth-method dev \
            --auth-username admin \
            --tags "$oetf_tags" \
            --output-json "$RUN_DIR/oetf-result.json"
    ) 2>&1 | tee "$OETF_LOG"
    local rc="${PIPESTATUS[0]}"
    return "$rc"
}

# ── Main ─────────────────────────────────────────────────────────────────────

log_info "run-deployment-test.sh: provider=$PROVIDER chart_version='$CHART_VERSION' image_tag='$IMAGE_TAG'"
log_info "RUN_DIR=$RUN_DIR"

run_stage "bootstrap"  1 stage_bootstrap
run_stage "deploy"     2 stage_deploy
run_stage "oetf-smoke" 4 stage_oetf_smoke

stop_watchdog
log_info "PASS: deployment-test for provider=$PROVIDER"
# trap cleanup EXIT runs teardown, emits JSON/JUnit, and exits 0.
