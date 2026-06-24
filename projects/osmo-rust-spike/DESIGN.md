# OSMO Rust Spike Design

## Executive Summary

This branch is a Phase 1A Rust spike for CRD-native OSMO workflow orchestration. It validates that OSMO can move live workflow execution state into Kubernetes CRDs, remove Redis from the execution path, and use a backend TaskGroup Controller connected through ClusterSession to reconcile runtime resources.

Phase 1A is not the full OSMO 7.0 product surface. It is the smallest deployable slice that proves the control path:

```text
OSMO YAML or native CRD
  -> OSMOWorkflow
  -> control-side desired OSMOTaskGroup
  -> ClusterSession
  -> backend mirrored OSMOTaskGroup
  -> runtime object
  -> status and cleanup ack back to control
```

The spike is production-ready for this scoped Phase 1A validation. It is not claiming full existing OSMO YAML parity, production identity integration, PostgreSQL history projection, Kueue/KAI scheduling, NIM Service support, or multi-cluster scheduling.

Validated artifact:

- Branch: `vpan/rust-osmo-spike`
- Implementation commit: `3b23b448d9701d6dd9439047035785e9caf68957`
- Image: `nvcr.io/nvstaging/osmo/osmo-rust-spike:phase1-hardened-20260624-0105`
- Control target: `osmo-stg`, namespace `osmo-exp`
- Backend target: `osmo-backend`, controller namespace `osmo-exp`, runtime namespace `osmo-phase1a`
- Ingress: existing ALB group `osmo2`, host `osmo-rust-spike.osmo.nvidia.com`

## Design Position

The spike keeps the intended OSMO 7.0 architecture direction:

- Kubernetes CRDs are the source of truth for active workflow state.
- Redis is not used for live workflow execution state.
- PostgreSQL is reserved for historical query projection after Kubernetes cleanup.
- The backend-side component is the TaskGroup Controller.
- The ClusterSession client is an internal TaskGroup Controller module, not a separate microservice.
- Pool placement is represented explicitly through `OSMOPool` and `OSMOCluster`.

The key design boundary is that ClusterSession is transport, not authority. The control cluster owns desired state. The backend reconciles a mirrored copy and reports status with enough identity to let control reject stale updates.

## Phase 1A Contract

Phase 1A proves these capabilities end to end:

- Native `OSMOWorkflow` CRDs can drive backend runtime reconciliation.
- Simple existing OSMO YAML can be submitted through an API adapter and converted into `OSMOWorkflow`.
- Jinja/default-values templating can work for the supported YAML subset.
- `OSMOPool` resolves placement through `OSMOCluster`.
- Desired task groups can sync from control to backend over ClusterSession.
- Backend runtime reconciliation can manage ConfigMaps, Jobs, RayJobs, and RayClusters.
- Workflow status, finalizers, TTL, cleanup acknowledgement, and stale status rejection work without Redis.

Phase 1A deliberately fails closed for unsupported behavior. If an OSMO YAML field or runtime type is outside the supported contract, the spike rejects it instead of silently dropping it.

## System Components

### API Server

The control deployment exposes:

```text
POST /api/pool/:pool/workflow
```

The API accepts an OSMO workflow YAML string plus template variables:

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

Authz is intentionally simple but explicit:

- Requests require `Authorization: Bearer <token>`.
- Tokens are configured by `API_AUTHZ_POLICY_JSON`.
- Each token maps to a subject and an allowed pool list.
- Submissions to unauthorized pools return HTTP 403.
- Submitted workflows are annotated with `spike.osmo.nvidia.com/submitted-by=<subject>`.

The authz policy is loaded at process startup. Token or pool authorization changes require a control-plane rollout in this spike.

### Workflow Controller

The control-side controller watches `OSMOWorkflow`. For each workflow generation it:

1. Ensures the workflow finalizer exists.
2. Resolves each task group's placement through `OSMOPool` and `OSMOCluster`.
3. Writes desired `OSMOTaskGroup` records in the control namespace.
4. Sends the assigned task group snapshot to the target backend cluster through ClusterSession.
5. Aggregates backend status into `OSMOWorkflow.status`.
6. On deletion or TTL expiry, sends prune targets and waits for backend cleanup acknowledgements before removing the finalizer.

The workflow controller drops backend status when the workflow UID, desired task group UID, generation, or cluster ID does not match current desired state.

### Operator Service and ClusterSession

The control plane exposes a gRPC Operator Service. Backend TaskGroup Controllers connect to it with a ClusterSession stream.

Control sends:

- `TaskGroupSync`: current assigned task group snapshot.
- `ResyncRequest`: request for backend status.
- `Heartbeat`: optional transport heartbeat.

Backend sends:

- `TaskGroupAck`: desired generation acknowledgement.
- `TaskGroupStatus`: runtime status.
- `CleanupAck`: confirmation that mirrored/runtime resources were pruned.
- `Heartbeat`: backend liveness signal.

On reconnect, control sends a full snapshot. Backend reconciliation is idempotent and prunes local mirrors that are no longer desired.

### TaskGroup Controller

The backend deployment is the TaskGroup Controller. It contains:

- ClusterSession client loop.
- Local `OSMOTaskGroup` mirror reconciliation.
- Runtime object reconciliation.
- Runtime status monitoring.
- Cleanup acknowledgement.
- Heartbeat and reconnect loop.

There is no separate Backend Session Client service.

## CRD Model

The spike uses four CRDs:

- `OSMOWorkflow`: workflow intent, TTL, finalizer, and aggregate status.
- `OSMOTaskGroup`: durable per-group desired work and backend status.
- `OSMOCluster`: backend target identity and heartbeat/liveness status.
- `OSMOPool`: pool-to-cluster mapping.

It intentionally does not add `OSMOBarrier` or `OSMOTaskAction` CRDs. Barrier/action state should remain inside task group spec/status or runtime-specific state rather than becoming top-level API resources.

### OSMOWorkflow

`OSMOWorkflow.spec` contains:

- `clusterID`: fallback backend cluster when no pool is used.
- `namespace`: fallback backend namespace when no pool is used.
- `ttlSecondsAfterFinished`: optional TTL after terminal workflow status.
- `taskGroups[]`: desired task groups.

Each task group contains:

- `name`
- `runtimeType`
- `runtimeConfig`
- `poolRef`
- `renderedObjects`

`runtimeType` is schema-constrained to:

- `osmoContainerGroup`
- `osmoWorkflow`
- `kubernetesObjects`
- `rayJob`
- `rayCluster`

Unknown runtime types are rejected by CRD validation and fail closed in the backend if they bypass schema validation.

### OSMOTaskGroup

The control side writes desired `OSMOTaskGroup` records. The backend mirrors them into the runtime namespace.

Mirrored task groups carry:

- workflow name and workflow UID
- desired task group UID
- desired generation
- group name
- resolved cluster ID
- target namespace
- runtime type/config/rendered objects
- pool reference

Those fields are part of the correctness model. They let the control plane distinguish current status from stale reconnects, replaced task groups, deleted workflows, and old workflow instances with the same name.

### OSMOPool and OSMOCluster

`OSMOPool` is the bridge to the existing OSMO pool concept. A task group with `poolRef: default` resolves as:

```text
OSMOPool/default
  -> spec.clusterRef
  -> OSMOCluster/<clusterRef>.spec.clusterID
  -> spec.namespace
```

The resolved cluster and namespace are written to the desired `OSMOTaskGroup`. If a task group has no `poolRef` and the default pool is absent, the workflow-level `clusterID` and `namespace` are used as fallback.

## Runtime Model

`OSMOTaskGroup.spec.runtimeType` selects backend reconciliation.

Supported runtime types:

- `kubernetesObjects`: applies rendered Kubernetes objects from `renderedObjects`.
- `osmoContainerGroup`: treated as rendered Kubernetes objects for this spike.
- `osmoWorkflow`: treated as rendered Kubernetes objects for this spike.
- `rayJob`: applies a KubeRay `RayJob` from `runtimeConfig.spec`.
- `rayCluster`: applies a KubeRay `RayCluster` from `runtimeConfig.spec`.

### Runtime Allowlist

Phase 1A keeps backend RBAC narrow. Rendered Kubernetes objects may create only:

- `v1/ConfigMap`
- `batch/v1/Job`

Ray objects are created only through first-class runtime types:

- `rayJob` -> `ray.io/v1 RayJob`
- `rayCluster` -> `ray.io/v1 RayCluster`

The backend Role is namespace-scoped and does not grant generic write access to Secrets, Services, PVCs, Pods, Deployments, or StatefulSets.

### Runtime Status

Runtime status maps to task group status:

- `ConfigMap`: succeeded when it exists.
- `Job`: succeeded on terminal `Complete=True` or successful completion count; failed on terminal `Failed=True`; otherwise running.
- `RayJob`: succeeded on `status.jobStatus=SUCCEEDED`, failed on `FAILED`, otherwise running.
- `RayCluster`: succeeded on ready/running states, failed on failed states, otherwise running.

Runtime monitors are keyed by mirrored task group namespace/name. A new sync replaces and aborts the previous monitor for that key. Prune paths abort monitors before deleting runtime resources.

## OSMO YAML Support

The API adapter supports a Phase 1A subset of existing OSMO YAML:

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

Converted tasks become Kubernetes Jobs. Inline files become ConfigMaps mounted into the Job pod. CPU, memory, GPU, and storage map to Kubernetes resource requests/limits where applicable.

Unsupported fields fail closed. The spike does not silently ignore unsupported OSMO YAML fields.

Not included in Phase 1A:

- datasets, inputs, and outputs
- credentials and ExternalSecrets integration
- full existing pod template behavior
- full existing pool execution behavior beyond simple `poolRef`
- retry policy parity beyond Kubernetes Job behavior
- dependency/barrier semantics beyond grouping into task groups
- NIM Service runtime
- Kueue/KAI integration
- multi-cluster scheduling
- PostgreSQL history projection
- UI

## Cleanup, TTL, and History

Active workflow state lives in Kubernetes. Completed workflow history is expected to be projected to PostgreSQL later; PostgreSQL is not part of the live execution path in this spike.

Cleanup flow:

1. User or TTL deletes `OSMOWorkflow`.
2. Control records pending cleanup targets in an annotation.
3. Control sends prune targets through ClusterSession.
4. Backend aborts active monitors.
5. Backend deletes mirrored task groups and runtime objects.
6. Backend waits for runtime objects to disappear.
7. Backend sends `CleanupAck`.
8. Control removes the acknowledged target.
9. Control removes the workflow finalizer after all targets have acknowledged.

TTL uses the same deletion path, so runtime resources are cleaned by the backend before the workflow disappears.

## Deployment

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

## Build

The Rust build is cache-friendly:

- `Cargo.lock` is checked in.
- Dockerfile sets `/usr/local/cargo/bin` explicitly in `PATH`.
- Dockerfile separates dependency build from source build.
- `.dockerignore` excludes `target` and git metadata from image context.

Apple `container` is the preferred local amd64 image build path:

```bash
container build --arch amd64 -t nvcr.io/nvstaging/osmo/osmo-rust-spike:<tag> projects/osmo-rust-spike
container image push nvcr.io/nvstaging/osmo/osmo-rust-spike:<tag>
```

With dependency layers warm, source-only rebuilds have been about 30 seconds.

## Validation

`deploy/e2e-validate.sh` validates the Phase 1A contract against `osmo-stg/osmo-exp` and `osmo-backend/osmo-phase1a`.

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

Independent reviewer verdict for implementation commit `3b23b448d9701d6dd9439047035785e9caf68957`: production-ready for the scoped Phase 1A Rust spike.

## Decision Points After Phase 1A

The spike answers whether the Rust CRD-native path can work. The next decision is whether to promote this into a Phase 1B implementation track or freeze it as a comparison artifact against the Go/controller-runtime implementation.

Before promotion, decide:

- How much existing OSMO YAML parity is required for initial 7.0.
- Whether the API auth path moves to real identity now or after the control plane/API design is finalized.
- Whether runtime status should move from polling monitors to watch-backed reconcilers before productization.
- Whether image promotion requires digest-pinned manifests.
- Where PostgreSQL history projection is introduced.
- How credentials and ExternalSecrets integration enter the design.
- Where Kueue/KAI scheduling support belongs for Ray and future runtimes.

## Known Follow-Ups

These are not blockers for the scoped spike but should be addressed before release promotion:

- Replace startup-only API authz policy with dynamic reload or real identity provider integration.
- Pin production manifests by image digest instead of mutable tag.
- Replace polling runtime monitors with watch-backed reconcilers if this code path graduates beyond spike scope.
- Expand OSMO YAML compatibility only after an explicit support contract is agreed.
- Add PostgreSQL projection for historical workflow query after live CRD cleanup semantics are finalized.
