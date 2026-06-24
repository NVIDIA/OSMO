#!/usr/bin/env bash
set -euo pipefail

CONTROL_CONTEXT="${CONTROL_CONTEXT:-osmo-stg}"
BACKEND_CONTEXT="${BACKEND_CONTEXT:-osmo-backend}"
CONTROL_NAMESPACE="${CONTROL_NAMESPACE:-osmo-exp}"
BACKEND_NAMESPACE="${BACKEND_NAMESPACE:-osmo-phase1a-go}"
IMAGE="${IMAGE:-nvcr.io/nvstaging/osmo/osmo-go-spike:phase1-go-dev}"
CLUSTER_TOKEN="${CLUSTER_TOKEN:-osmo-go-spike-token}"
API_TOKEN="${API_TOKEN:-osmo-go-spike-api-token}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WF_RESOURCE="osmoworkflows.spikego.osmo.nvidia.com"
TG_RESOURCE="osmotaskgroups.spikego.osmo.nvidia.com"

api_authz_policy_file="$(mktemp)"
jq -n --arg token "${API_TOKEN}" '[{token: $token, subject: "e2e", pools: ["default"]}]' >"${api_authz_policy_file}"
cleanup_files() {
  rm -f "${api_authz_policy_file}"
}
trap cleanup_files EXIT

apply_with_image() {
  local context="$1"
  local namespace_flag="$2"
  local file="$3"
  sed "s|nvcr.io/nvstaging/osmo/osmo-go-spike:phase1-go-dev|${IMAGE}|g" "${file}" | kubectl --context "${context}" ${namespace_flag} apply -f -
}

kubectl --context "${CONTROL_CONTEXT}" create namespace "${CONTROL_NAMESPACE}" --dry-run=client -o yaml | kubectl --context "${CONTROL_CONTEXT}" apply -f -
kubectl --context "${BACKEND_CONTEXT}" create namespace osmo-exp --dry-run=client -o yaml | kubectl --context "${BACKEND_CONTEXT}" apply -f -
kubectl --context "${BACKEND_CONTEXT}" create namespace "${BACKEND_NAMESPACE}" --dry-run=client -o yaml | kubectl --context "${BACKEND_CONTEXT}" apply -f -
kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" create secret generic osmo-go-spike-cluster-token --from-literal=cluster-token="${CLUSTER_TOKEN}" --from-file=api-authz-policy-json="${api_authz_policy_file}" --dry-run=client -o yaml | kubectl --context "${CONTROL_CONTEXT}" apply -f -
kubectl --context "${BACKEND_CONTEXT}" -n osmo-exp create secret generic osmo-go-spike-cluster-token --from-literal=cluster-token="${CLUSTER_TOKEN}" --dry-run=client -o yaml | kubectl --context "${BACKEND_CONTEXT}" apply -f -

kubectl --context "${CONTROL_CONTEXT}" apply -f "${ROOT_DIR}/deploy/crds.yaml"
kubectl --context "${BACKEND_CONTEXT}" apply -f "${ROOT_DIR}/deploy/crds.yaml"
apply_with_image "${CONTROL_CONTEXT}" "-n ${CONTROL_NAMESPACE}" "${ROOT_DIR}/deploy/control.yaml"
apply_with_image "${BACKEND_CONTEXT}" "" "${ROOT_DIR}/deploy/backend.yaml"
kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" rollout restart deployment/osmo-go-spike-control
kubectl --context "${BACKEND_CONTEXT}" -n osmo-exp rollout restart deployment/osmo-go-spike-backend
kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" rollout status deployment/osmo-go-spike-control --timeout=180s
kubectl --context "${BACKEND_CONTEXT}" -n osmo-exp rollout status deployment/osmo-go-spike-backend --timeout=180s

pf_log="$(mktemp)"
kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" port-forward deployment/osmo-go-spike-control 18081:8080 >"${pf_log}" 2>&1 &
pf_pid="$!"
cleanup_port_forward() {
  kill "${pf_pid}" >/dev/null 2>&1 || true
  rm -f "${pf_log}"
  cleanup_files
}
trap cleanup_port_forward EXIT
for _ in $(seq 1 30); do
  http_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:18081/api/pool/default/workflow || true)"
  if [[ "${http_code}" == "405" ]]; then
    break
  fi
  sleep 1
done
[[ "${http_code}" == "405" ]]

cleanup_workflow() {
  local name="$1"
  kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" delete "${WF_RESOURCE}" "${name}" --ignore-not-found=true --wait=false
}

wait_absent() {
  local name="$1"
  local runtime_kind="$2"
  local runtime_name="$3"
  for _ in $(seq 1 48); do
    local wf desired mirror runtime
    wf="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${WF_RESOURCE}" "${name}" --ignore-not-found 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
    desired="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${TG_RESOURCE}" -l "spikego.osmo.nvidia.com/workflow=${name}" --no-headers 2>/dev/null | wc -l | tr -d ' ')"
    mirror="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get "${TG_RESOURCE}" -l "spikego.osmo.nvidia.com/workflow=${name}" --no-headers 2>/dev/null | wc -l | tr -d ' ')"
    runtime="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get "${runtime_kind}" "${runtime_name}" --ignore-not-found 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
    if [[ "${wf}" == "0" && "${desired}" == "0" && "${mirror}" == "0" && "${runtime}" == "0" ]]; then
      return 0
    fi
    sleep 5
  done
  return 1
}

wait_workflow_absent() {
  local name="$1"
  for _ in $(seq 1 48); do
    local wf desired mirror
    wf="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${WF_RESOURCE}" "${name}" --ignore-not-found 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
    desired="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${TG_RESOURCE}" -l "spikego.osmo.nvidia.com/workflow=${name}" --no-headers 2>/dev/null | wc -l | tr -d ' ')"
    mirror="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get "${TG_RESOURCE}" -l "spikego.osmo.nvidia.com/workflow=${name}" --no-headers 2>/dev/null | wc -l | tr -d ' ')"
    if [[ "${wf}" == "0" && "${desired}" == "0" && "${mirror}" == "0" ]]; then
      return 0
    fi
    sleep 5
  done
  return 1
}

wait_phase() {
  local name="$1"
  local expected="$2"
  for _ in $(seq 1 48); do
    phase="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${WF_RESOURCE}" "${name}" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
    if [[ "${phase}" == "${expected}" ]]; then
      return 0
    fi
    sleep 5
  done
  return 1
}

unauth_payload="$(mktemp)"
jq -n '{file: "workflow:\n  name: unauthorized\n  tasks:\n  - name: hello\n    image: ubuntu:24.04\n    command: [\"true\"]\n", set_variables: [], set_string_variables: []}' >"${unauth_payload}"
unauth_code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary @"${unauth_payload}" 'http://127.0.0.1:18081/api/pool/default/workflow' || true)"
rm -f "${unauth_payload}"
[[ "${unauth_code}" == "401" ]]

forbidden_payload="$(mktemp)"
jq -n '{file: "workflow:\n  name: forbidden\n  tasks:\n  - name: hello\n    image: ubuntu:24.04\n    command: [\"true\"]\n", set_variables: [], set_string_variables: []}' >"${forbidden_payload}"
forbidden_code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer ${API_TOKEN}" --data-binary @"${forbidden_payload}" 'http://127.0.0.1:18081/api/pool/private/workflow' || true)"
rm -f "${forbidden_payload}"
[[ "${forbidden_code}" == "403" ]]

cleanup_workflow osmo-go-spike-e2e
cleanup_workflow osmo-go-spike-ttl-e2e
cleanup_workflow osmo-go-spike-ray-e2e
cleanup_workflow osmo-go-spike-invalid-e2e
cleanup_workflow hello-osmo
cleanup_workflow hello-osmo-template
cleanup_workflow osmo-go-jinja-api-e2e
wait_workflow_absent osmo-go-spike-e2e
wait_workflow_absent osmo-go-spike-ttl-e2e
wait_workflow_absent osmo-go-spike-ray-e2e
wait_workflow_absent osmo-go-spike-invalid-e2e
wait_workflow_absent hello-osmo
wait_workflow_absent hello-osmo-template
wait_workflow_absent osmo-go-jinja-api-e2e
kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" delete configmap osmo-go-spike-e2e-hello osmo-go-spike-e2e-hello-v2 osmo-go-spike-ttl-e2e-hello --ignore-not-found=true
kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" delete rayjob osmo-go-spike-ray-hello --ignore-not-found=true
kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" delete job hello-osmo-hello hello-osmo-template-hello osmo-go-jinja-api-e2e-hello --ignore-not-found=true

kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" apply -f "${ROOT_DIR}/deploy/sample-workflow.yaml"
for _ in $(seq 1 48); do
  phase="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${WF_RESOURCE}" osmo-go-spike-e2e -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  cm_status="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get configmap osmo-go-spike-e2e-hello -o jsonpath='{.data.status}' 2>/dev/null || true)"
  if [[ "${phase}" == "Succeeded" && "${cm_status}" == "rendered-object-applied" ]]; then
    break
  fi
  sleep 5
done
[[ "${phase}" == "Succeeded" && "${cm_status}" == "rendered-object-applied" ]]
placement_cluster="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${TG_RESOURCE}" -l "spikego.osmo.nvidia.com/workflow=osmo-go-spike-e2e,spikego.osmo.nvidia.com/role=desired" -o jsonpath='{.items[0].spec.clusterID}')"
placement_namespace="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${TG_RESOURCE}" -l "spikego.osmo.nvidia.com/workflow=osmo-go-spike-e2e,spikego.osmo.nvidia.com/role=desired" -o jsonpath='{.items[0].spec.targetNamespace}')"
placement_pool="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${TG_RESOURCE}" -l "spikego.osmo.nvidia.com/workflow=osmo-go-spike-e2e,spikego.osmo.nvidia.com/role=desired" -o jsonpath='{.items[0].spec.poolRef}')"
[[ "${placement_cluster}" == "osmo-backend" && "${placement_namespace}" == "${BACKEND_NAMESPACE}" && "${placement_pool}" == "default" ]]

kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" patch "${WF_RESOURCE}" osmo-go-spike-e2e --type=merge -p '{"spec":{"taskGroups":[{"name":"hello","runtimeType":"kubernetesObjects","poolRef":"default","renderedObjects":[{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"osmo-go-spike-e2e-hello-v2"},"data":{"workflow":"osmo-go-spike-e2e","taskGroup":"hello","status":"rendered-object-applied-v2"}}]}]}}'
for _ in $(seq 1 48); do
  phase="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${WF_RESOURCE}" osmo-go-spike-e2e -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  cm_status="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get configmap osmo-go-spike-e2e-hello-v2 -o jsonpath='{.data.status}' 2>/dev/null || true)"
  old_cm="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get configmap osmo-go-spike-e2e-hello --ignore-not-found 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"
  if [[ "${phase}" == "Succeeded" && "${cm_status}" == "rendered-object-applied-v2" && "${old_cm}" == "0" ]]; then
    break
  fi
  sleep 5
done
[[ "${phase}" == "Succeeded" && "${cm_status}" == "rendered-object-applied-v2" && "${old_cm}" == "0" ]]
cleanup_workflow osmo-go-spike-e2e
wait_absent osmo-go-spike-e2e configmap osmo-go-spike-e2e-hello-v2

cat <<'EOF' | kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" apply -f -
apiVersion: spikego.osmo.nvidia.com/v1alpha1
kind: OSMOWorkflow
metadata:
  name: osmo-go-spike-ttl-e2e
spec:
  clusterID: fallback-cluster-not-used-when-pool-ref-is-set
  namespace: fallback-namespace-not-used-when-pool-ref-is-set
  ttlSecondsAfterFinished: 1
  taskGroups:
  - name: hello
    runtimeType: kubernetesObjects
    poolRef: default
    renderedObjects:
    - apiVersion: v1
      kind: ConfigMap
      metadata:
        name: osmo-go-spike-ttl-e2e-hello
      data:
        workflow: osmo-go-spike-ttl-e2e
        taskGroup: hello
        status: ttl-rendered-object-applied
EOF
wait_absent osmo-go-spike-ttl-e2e configmap osmo-go-spike-ttl-e2e-hello

if cat <<'EOF' | kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" apply -f -
apiVersion: spikego.osmo.nvidia.com/v1alpha1
kind: OSMOWorkflow
metadata:
  name: osmo-go-spike-unsupported-runtime-e2e
spec:
  clusterID: fallback-cluster-not-used-when-pool-ref-is-set
  namespace: fallback-namespace-not-used-when-pool-ref-is-set
  taskGroups:
  - name: unsupported
    runtimeType: typoRuntime
    poolRef: default
EOF
then
  echo "unsupported runtimeType was unexpectedly accepted" >&2
  exit 1
fi

cat <<'EOF' | kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" apply -f -
apiVersion: spikego.osmo.nvidia.com/v1alpha1
kind: OSMOWorkflow
metadata:
  name: osmo-go-spike-invalid-e2e
spec:
  clusterID: fallback-cluster-not-used-when-pool-ref-is-set
  namespace: fallback-namespace-not-used-when-pool-ref-is-set
  ttlSecondsAfterFinished: 300
  taskGroups:
  - name: invalid-rendered-object
    runtimeType: kubernetesObjects
    poolRef: default
    renderedObjects:
    - apiVersion: v1
      metadata:
        name: osmo-go-spike-invalid-object
EOF
wait_phase osmo-go-spike-invalid-e2e Failed
cleanup_workflow osmo-go-spike-invalid-e2e
wait_workflow_absent osmo-go-spike-invalid-e2e

existing_payload="$(mktemp)"
jq -Rs '{file: ., set_variables: [], set_string_variables: []}' "${ROOT_DIR}/../../cookbook/tutorials/hello_world.yaml" >"${existing_payload}"
curl -sS -f -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer ${API_TOKEN}" --data-binary @"${existing_payload}" 'http://127.0.0.1:18081/api/pool/default/workflow' >/dev/null
rm -f "${existing_payload}"
for _ in $(seq 1 48); do
  phase="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${WF_RESOURCE}" hello-osmo -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  job_status="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get job hello-osmo-hello -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
  if [[ "${phase}" == "Succeeded" && "${job_status}" == "1" ]]; then
    break
  fi
  sleep 5
done
[[ "${phase}" == "Succeeded" && "${job_status}" == "1" ]]
submitted_by="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${WF_RESOURCE}" hello-osmo -o json | jq -r '.metadata.annotations["spikego.osmo.nvidia.com/submitted-by"]')"
[[ "${submitted_by}" == "e2e" ]]
cleanup_workflow hello-osmo
wait_absent hello-osmo job hello-osmo-hello

template_payload="$(mktemp)"
jq -Rs '{file: ., set_variables: ["workflow_name=hello-osmo-template"], set_string_variables: []}' "${ROOT_DIR}/../../cookbook/tutorials/template_hello_world.yaml" >"${template_payload}"
curl -sS -f -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer ${API_TOKEN}" --data-binary @"${template_payload}" 'http://127.0.0.1:18081/api/pool/default/workflow' >/dev/null
rm -f "${template_payload}"
for _ in $(seq 1 48); do
  phase="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${WF_RESOURCE}" hello-osmo-template -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  job_status="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get job hello-osmo-template-hello -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
  if [[ "${phase}" == "Succeeded" && "${job_status}" == "1" ]]; then
    break
  fi
  sleep 5
done
[[ "${phase}" == "Succeeded" && "${job_status}" == "1" ]]
cleanup_workflow hello-osmo-template
wait_absent hello-osmo-template job hello-osmo-template-hello

jinja_payload="$(mktemp)"
jq -Rs '{file: ., set_variables: ["message=hello-from-api"], set_string_variables: []}' "${ROOT_DIR}/deploy/sample-osmo-jinja-workflow.yaml" >"${jinja_payload}"
curl -sS -f -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer ${API_TOKEN}" --data-binary @"${jinja_payload}" 'http://127.0.0.1:18081/api/pool/default/workflow' >/dev/null
rm -f "${jinja_payload}"
for _ in $(seq 1 48); do
  phase="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${WF_RESOURCE}" osmo-go-jinja-api-e2e -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  job_status="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get job osmo-go-jinja-api-e2e-hello -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
  env_value="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get job osmo-go-jinja-api-e2e-hello -o jsonpath='{.spec.template.spec.containers[0].env[0].value}' 2>/dev/null || true)"
  if [[ "${phase}" == "Succeeded" && "${job_status}" == "1" && "${env_value}" == "hello-from-api" ]]; then
    break
  fi
  sleep 5
done
[[ "${phase}" == "Succeeded" && "${job_status}" == "1" && "${env_value}" == "hello-from-api" ]]
cleanup_workflow osmo-go-jinja-api-e2e
wait_absent osmo-go-jinja-api-e2e job osmo-go-jinja-api-e2e-hello

kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" apply -f "${ROOT_DIR}/deploy/sample-ray-workflow.yaml"
for _ in $(seq 1 48); do
  phase="$(kubectl --context "${CONTROL_CONTEXT}" -n "${CONTROL_NAMESPACE}" get "${WF_RESOURCE}" osmo-go-spike-ray-e2e -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  ray_name="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get rayjob osmo-go-spike-ray-hello -o jsonpath='{.metadata.name}' 2>/dev/null || true)"
  if [[ "${phase}" == "Succeeded" && "${ray_name}" == "osmo-go-spike-ray-hello" ]]; then
    break
  fi
  sleep 5
done
[[ "${phase}" == "Succeeded" && "${ray_name}" == "osmo-go-spike-ray-hello" ]]
for _ in $(seq 1 24); do
  ray_status="$(kubectl --context "${BACKEND_CONTEXT}" -n "${BACKEND_NAMESPACE}" get rayjob osmo-go-spike-ray-hello -o jsonpath='{.status.jobStatus}' 2>/dev/null || true)"
  if [[ "${ray_status}" == "SUCCEEDED" ]]; then
    break
  fi
  sleep 10
done
[[ "${ray_status}" == "SUCCEEDED" ]]
cleanup_workflow osmo-go-spike-ray-e2e
wait_absent osmo-go-spike-ray-e2e rayjob osmo-go-spike-ray-hello

echo "OSMO Go spike E2E validation passed"
