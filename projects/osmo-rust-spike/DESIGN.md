# OSMO Rust Spike Design

## Goal

This spike validates a CRD-native OSMO workflow orchestration shape in Rust. The goal is to compare a Rust implementation against the Go/controller-runtime implementation while keeping the same product architecture:

- Kubernetes CRDs are the source of truth.
- Redis is not in the live workflow execution path.
- PostgreSQL is only a projection target for historical queries.
- The backend-side component is the TaskGroup Controller.
- The ClusterSession client is an internal TaskGroup Controller module, not a separate microservice.

## Phase 1A Scope

Phase 1A is a deployable Rust spike for the CRD workflow control path, not a full OSMO 7.0 product implementation. It is intentionally scoped to prove:

- OSMO workflow intent can be represented as Kubernetes CRDs.
- Existing simple OSMO YAML workflows can enter through an API adapter.
- Pool placement can resolve through `OSMOPool` and `OSMOCluster`.
- Control and backend clusters can sync desired task groups over ClusterSession.
- Backend runtime reconciliation can apply Kubernetes Jobs/ConfigMaps and KubeRay RayJobs/RayClusters.
- Workflow status, cleanup, finalizers, TTL, and stale status protection can work without Redis.

Validated artifact:

- Branch: `vpan/rust-osmo-spike`
- Commit: `3b23b448d9701d6dd9439047035785e9caf68957`
- Image: `nvcr.io/nvstaging/osmo/osmo-rust-spike:phase1-hardened-20260624-0105`
- Control deployment target: `osmo-stg`, namespace `osmo-exp`
- Backend deployment target: `osmo-backend`, controller namespace `osmo-exp`, runtime namespace `osmo-phase1a`
- Ingress: existing ALB group `osmo2`, host `osmo-rust-spike.osmo.nvidia.com`

## Architecture

```text
API server / CLI
  -> OSMOWorkflow
  -> Workflow Controller
  -> OSMOTaskGroup desired records on the control cluster
  -> Operator Service ClusterSession sync
  -> backend TaskGroup Controller
  -> local OSMOTaskGroup mirrors
  -> runtime resources
  -> status back to control OSMOTaskGroup and OSMOWorkflow
```

## CRDs

- `OSMOWorkflow`: user workflow intent, finalizer, TTL, and aggregate group status.
- `OSMOTaskGroup`: durable per-group desired work and backend-reported status.
- `OSMOCluster`: registered backend target and heartbeat/liveness status.
- `OSMOPool`: minimal pool-to-cluster mapping for parity with the existing pool model.

This spike intentionally does not add `OSMOBarrier` or `OSMOTaskAction` CRDs. Barrier/action state should remain part of task group runtime status or spec, not top-level resources.

### OSMOWorkflow Shape

`OSMOWorkflow.spec` contains:

- `clusterID`: fallback backend cluster when no pool is used.
- `namespace`: fallback backend namespace when no pool is used.
- `ttlSecondsAfterFinished`: optional TTL after terminal workflow status.
- `taskGroups[]`: desired task group list.

Each task group contains:

- `name`
- `runtimeType`
- `runtimeConfig`
- `poolRef`
- `renderedObjects`

The CRD constrains `runtimeType` to:

- `osmoContainerGroup`
- `osmoWorkflow`
- `kubernetesObjects`
- `rayJob`
- `rayCluster`

Unknown runtime types are rejected by CRD validation and also fail closed in the backend if they somehow bypass schema validation.

### OSMOTaskGroup Shape

The control side writes desired `OSMOTaskGroup` records in the control namespace. The backend mirrors those into the runtime namespace.

The mirrored task group carries:

- workflow name and workflow UID
- desired task group UID
- desired generation
- group name
- resolved cluster ID
- target namespace
- runtime type/config/rendered objects
- pool reference

These identity fields are required for stale status rejection, cleanup ack matching, and spec replacement.

### OSMOPool and OSMOCluster

`OSMOPool` is the Phase 1A bridge to the existing OSMO pool model. A task group with `poolRef: default` resolves:

```text
OSMOPool/default
  -> spec.clusterRef
  -> OSMOCluster/<clusterRef>.spec.clusterID
  -> spec.namespace
```

The resolved cluster/namespace are written into the desired `OSMOTaskGroup`. If a task group has no `poolRef` and the default pool is absent, the workflow-level `clusterID` and `namespace` are used as fallback.

## ClusterSession

The session is a sync transport, not the correctness boundary.

Control sends:

- `TaskGroupSync`: current assigned task group snapshot.
- `ResyncRequest`: request backend to report local status.
- `Heartbeat`: optional transport-level heartbeat.

Backend sends:

- `TaskGroupAck`: observed generation acknowledgement.
- `TaskGroupStatus`: runtime/task group status.
- `CleanupAck`: backend confirmation that mirrored/runtime resources were pruned.
- `Heartbeat`: cluster liveness signal.

On reconnect, control sends a full task group snapshot. Backend reconciles idempotently and prunes local mirrors that are no longer desired.

Status and cleanup messages carry workflow UID, task group UID, generation, and cluster ID. The control side drops stale status from old sessions or old workflow/task group instances.

### Session Semantics

The control side owns desired state. Backend sessions are disposable:

- On backend connect, control sends a full assigned task group snapshot.
- On workflow change, control sends the current assigned snapshot for the target cluster.
- Backend creates or patches local mirrored `OSMOTaskGroup` objects.
- Backend prunes mirrored task groups not present in a full sync.
- Backend sends status updates; control accepts them only when workflow UID, task group UID, generation, and cluster ID match current desired state.

The backend ClusterSession client is part of the TaskGroup Controller process. There is no separate session microservice.

## Runtime Types

`OSMOTaskGroup.spec.runtimeType` selects the backend runtime reconciler:

- `kubernetesObjects` / `osmoContainerGroup`: applies rendered Kubernetes objects carried in `renderedObjects`.
- `rayJob`: applies a KubeRay `RayJob` from `runtimeConfig.spec`.
- `rayCluster`: applies a KubeRay `RayCluster` from `runtimeConfig.spec`.

The workflow controller preserves `runtimeType`, `runtimeConfig`, `poolRef`, and `renderedObjects` from `OSMOWorkflow.spec.taskGroups[]` into the control-side desired `OSMOTaskGroup`. The ClusterSession transport serializes those payloads to the backend TaskGroup Controller, which applies or deletes runtime resources before reporting success or cleanup ack.

### Backend Runtime Allowlist

Phase 1A intentionally narrows backend RBAC and runtime object support. Rendered Kubernetes objects are allowed only for:

- `v1/ConfigMap`
- `batch/v1/Job`

Ray runtimes are allowed only through first-class runtime types:

- `rayJob` -> `ray.io/v1 RayJob`
- `rayCluster` -> `ray.io/v1 RayCluster`

Objects outside that allowlist are rejected. The backend Role is namespace-scoped and does not grant generic write access to Secrets, Services, PVCs, Pods, Deployments, or StatefulSets.

### Runtime Status Mapping

Phase 1A status mapping is:

- `ConfigMap`: succeeded when it exists.
- `Job`: succeeded on terminal `Complete=True` or successful completion count; failed on terminal `Failed=True`; otherwise running.
- `RayJob`: succeeded on `status.jobStatus=SUCCEEDED`, failed on `FAILED`, otherwise running.
- `RayCluster`: succeeded on ready/running states, failed on failed states, otherwise running.

Runtime monitors are keyed by mirrored task group namespace/name. A new sync replaces and aborts the previous monitor for that key, and prune paths abort monitors before deleting runtime resources.

## API Server

The control deployment includes a minimal workflow API:

```text
POST /api/pool/:pool/workflow
```

Request body:

```json
{
  "file": "<OSMO workflow YAML string>",
  "set_variables": ["key=value"],
  "set_string_variables": ["key=value"]
}
```

Supported query flags:

- `dry_run=true`: render the template and return it without creating a CRD.
- `validation_only=true`: convert to `OSMOWorkflow.spec` and return the generated spec without creating a CRD.

Authentication and authorization:

- The API requires `Authorization: Bearer <token>`.
- Tokens are configured through `API_AUTHZ_POLICY_JSON`.
- Each token maps to a `subject` and allowed `pools`.
- Submissions to unauthorized pools return HTTP 403.
- Submitted workflows are annotated with `spike.osmo.nvidia.com/submitted-by=<subject>`.

The policy is loaded at process startup. Token or pool changes require a control deployment rollout in this spike.

## OSMO YAML Adapter

The API adapter supports a Phase 1A subset of existing OSMO workflow YAML:

- top-level `default-values`
- `workflow.default-values`
- Jinja rendering with `set_variables` and `set_string_variables`
- `workflow.name`
- `workflow.resources.default.cpu`
- `workflow.resources.default.memory`
- `workflow.resources.default.gpu`
- `workflow.resources.default.storage`
- `workflow.tasks[]`
- `workflow.groups[].tasks[]`
- task `name`
- task `image`
- task `command`
- task `args`
- task `environment`
- task `resources`
- task `files[].path`
- task `files[].contents`

Converted tasks become Kubernetes Jobs. Inline files become ConfigMaps mounted into the Job pod. CPU, memory, GPU, and storage are mapped to Kubernetes resource requests/limits where applicable.

Unsupported fields fail closed instead of being silently ignored. This is intentional so Phase 1A does not pretend to provide full OSMO YAML parity.

Explicitly not included in Phase 1A:

- datasets, inputs, and outputs
- credentials and ExternalSecrets integration
- existing pod template/pool execution semantics beyond simple `poolRef`
- retry policy parity beyond Kubernetes Job defaults
- dependency/barrier semantics beyond grouping into task groups
- NIM Service runtime
- Kueue/KAI scheduling integration
- multi-cluster scheduling
- PostgreSQL history projection
- UI

## Cleanup and TTL

`OSMOWorkflow` finalizers are removed only after backend cleanup acknowledgement. Deletion sends an explicit prune target containing workflow name, workflow UID, and backend namespace. TTL uses the same deletion path, so runtime resources are cleaned by the backend before the workflow disappears.

Cleanup flow:

1. User or TTL deletes `OSMOWorkflow`.
2. Control records pending cleanup targets in an annotation.
3. Control sends prune targets through ClusterSession.
4. Backend aborts active monitors, deletes mirrored task groups, deletes runtime resources, and waits for runtime objects to disappear.
5. Backend sends `CleanupAck`.
6. Control removes the pending target.
7. Control removes the workflow finalizer only after all cleanup targets have acknowledged.

## Backend Shape

The backend deployment is the TaskGroup Controller. Internally it contains:

- ClusterSession client loop.
- Local OSMOTaskGroup mirror reconciler.
- Runtime reconciler boundary.
- Status reporter.
- Heartbeat/reconnect loop.

There is no separate Backend Session Client service in this spike.

## Deployment Manifests

`deploy/control.yaml` installs:

- namespace-scoped ServiceAccount, Role, and RoleBinding in `osmo-exp`
- control deployment
- combined gRPC/HTTP Service
- ALB Ingress using existing ALB group `osmo2`

`deploy/backend.yaml` installs:

- backend ServiceAccount in `osmo-exp`
- namespace-scoped Role and RoleBinding for runtime namespace `osmo-phase1a`
- backend deployment with ClusterSession client

Secrets:

- `cluster-token`: shared backend ClusterSession token.
- `api-authz-policy-json`: JSON policy for workflow API subjects and pool authorization.

## Build Notes

The Rust build foundation is intentionally pinned and cache-friendly:

- `Cargo.lock` is checked in.
- Dockerfile sets `/usr/local/cargo/bin` explicitly in `PATH`.
- Dockerfile separates dependency build from source build.
- `.dockerignore` excludes `target` and git metadata from image context.

The first build after dependency/proto changes is still expensive. Source-only changes should reuse the dependency layer.

Apple `container` is supported for local amd64 image builds:

```bash
container build --platform linux/amd64 -t nvcr.io/nvstaging/osmo/osmo-rust-spike:<tag> .
container image push nvcr.io/nvstaging/osmo/osmo-rust-spike:<tag>
```

## Validation

`deploy/e2e-validate.sh` applies CRDs/deployments and validates the Phase 1A contract end to end.

Validated cases:

- API rejects unauthenticated submission with HTTP 401.
- API rejects submission to an unauthorized pool with HTTP 403.
- CRD rejects unsupported `runtimeType`.
- Native `OSMOWorkflow` with rendered ConfigMap succeeds.
- Patching rendered objects prunes replaced runtime objects.
- Invalid rendered object fails closed and still cleans up.
- Existing `cookbook/tutorials/hello_world.yaml` submits through the API and succeeds.
- Existing `cookbook/tutorials/template_hello_world.yaml` submits through the API with top-level `default-values` and succeeds.
- Custom Jinja workflow submits through the API with variable overrides and succeeds.
- Native RayJob workflow creates a KubeRay `RayJob` and reaches `SUCCEEDED`.
- Workflow deletion removes control desired task groups, backend mirrors, and runtime objects.

Latest validated command:

```bash
export KUBECONFIG="$HOME/.kube/clusters/aws-prod:$HOME/.kube/clusters/aws-stg:$HOME/.kube/clusters/isaac:$HOME/.kube/clusters/h100-test:$HOME/.kube/clusters/groot-02"
./deploy/e2e-validate.sh
```

Reviewer verdict for commit `3b23b448d9701d6dd9439047035785e9caf68957`: production-ready for the scoped Phase 1A Rust spike.

## Known Follow-Ups

These are not blockers for the scoped spike but should be addressed before release promotion:

- Replace startup-only API authz policy with dynamic reload or real identity provider integration.
- Pin production manifests by image digest instead of mutable tag.
- Replace polling runtime monitors with watch-backed reconcilers if this code path graduates beyond spike scope.
- Expand OSMO YAML compatibility only after an explicit support contract is agreed.
- Add PostgreSQL projection for historical workflow query after live CRD cleanup semantics are finalized.
