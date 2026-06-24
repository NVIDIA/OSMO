# OSMO Go Spike Design

## Scope

This directory now contains a Go implementation of the same Phase 1A workflow-orchestration spike validated by the Rust path. The goal is a side-by-side comparison point for Go versus Rust, not a second product surface.

Validated image:

- `nvcr.io/nvstaging/osmo/osmo-go-spike:phase1-go-20260624-011`

Validated deployment:

- Control: `osmo-stg`, namespace `osmo-exp`
- Backend controller: `osmo-backend`, namespace `osmo-exp`
- Backend runtime namespaces: `osmo-phase1a-go`, `osmo-phase1a-go-alt`
- Ingress: existing ALB group `osmo2`, host `osmo-rust-spike.osmo.nvidia.com`, gRPC path `/osmo.spikego.v1.ClusterSession`

## Architecture

The Go spike adds a new binary, `cmd/osmo-spike`, with two roles selected by `OSMO_SPIKE_ROLE`:

- `control`: API server, workflow reconciler, pool resolver, status aggregator, finalizer/TTL owner, and gRPC Operator Service.
- `backend`: TaskGroup Controller role with ClusterSession client, local mirror reconciliation, runtime apply/prune, status reports, and cleanup acknowledgements.

The active execution path is:

```text
OSMO YAML or native CRD
  -> OSMOWorkflow
  -> control-side desired OSMOTaskGroup
  -> gRPC ClusterSession
  -> backend mirrored OSMOTaskGroup
  -> runtime object
  -> status and cleanup ack back to control
```

Redis is not used. Kubernetes CRDs hold active workflow state. PostgreSQL history projection is out of scope for this spike.

## CRD Surface

The Go spike uses a collision-free API group so it can run next to the Rust spike:

- `spikego.osmo.nvidia.com/v1alpha1`

It defines the same Phase 1A resources:

- `OSMOWorkflow`
- `OSMOTaskGroup`
- `OSMOCluster`
- `OSMOPool`

It does not define `OSMOBarrier` or `OSMOTaskAction`.

`runtimeType` is schema-constrained to:

- `kubernetesObjects`
- `osmoContainerGroup`
- `osmoWorkflow`
- `rayJob`
- `rayCluster`

## API Adapter

The control role exposes:

```text
POST /api/pool/:pool/workflow
```

The request shape matches the Rust spike:

```json
{
  "file": "<OSMO workflow YAML>",
  "set_variables": ["key=value"],
  "set_string_variables": ["key=value"]
}
```

The adapter supports the existing simple OSMO YAML subset used by the validation suite:

- `workflow.name`
- `workflow.tasks[]`
- task `name`, `image`, `command`, `args`, and `environment`
- top-level `default-values`
- workflow-level `default-values`
- simple `{{ variable }}` substitution

Unsupported OSMO YAML behavior remains fail-closed for the spike.

## Pool Placement

The control role creates the default placement records on startup:

```text
OSMOPool/default
  -> spec.clusterRef: osmo-backend
  -> OSMOCluster/osmo-backend.spec.clusterID: osmo-backend
  -> spec.namespace: osmo-phase1a-go

OSMOPool/alt
  -> spec.clusterRef: osmo-backend
  -> OSMOCluster/osmo-backend.spec.clusterID: osmo-backend
  -> spec.namespace: osmo-phase1a-go-alt
```

Resolved placement is written into desired `OSMOTaskGroup.spec.clusterID` and `spec.targetNamespace`.

## ClusterSession

The Go implementation uses a real bidirectional gRPC stream. The service is manually bound with a JSON codec to keep the spike self-contained and avoid generated protobuf plumbing.

Control sends:

- full desired task group snapshots
- cleanup targets

Backend sends:

- runtime status reports
- cleanup acknowledgements

Correctness identities include workflow name/UID, desired task group UID, desired generation, cluster ID, and namespace. Control drops stale task group status when UID or generation does not match current desired state.

## Runtime Reconciliation

The backend role supports:

- `kubernetesObjects`: allowlisted rendered objects
- `osmoContainerGroup`: treated as rendered objects for Phase 1A
- `osmoWorkflow`: treated as rendered objects for Phase 1A
- `rayJob`: KubeRay `RayJob`
- `rayCluster`: KubeRay `RayCluster`

Rendered object allowlist:

- `v1/ConfigMap`
- `batch/v1/Job`

Jobs are treated as controller-owned immutable resources after create because Kubernetes mutates job status and job pod templates are effectively immutable. Ray resources are reconciled through the CRD update path so Ray runtime config changes are visible to KubeRay.

## Cleanup

`OSMOWorkflow` uses the finalizer:

```text
spikego.osmo.nvidia.com/cleanup
```

On deletion, control computes cleanup targets from resolved placement and sends them over ClusterSession. Backend deletes mirrors and runtime resources, waits for absence, and returns `CleanupAck`. Control removes the workflow finalizer only after all cleanup acknowledgements are received.

## Validated Matrix

`deploy/e2e-validate.sh` passed against staging/backend with image `phase1-go-20260624-011`.

The validation covers:

- API 401 without token
- API 403 for unauthorized pool
- CRD rejection of unsupported `runtimeType`
- native `OSMOWorkflow` rendered ConfigMap success
- patch/prune of rendered runtime objects
- invalid rendered object failure and cleanup
- existing `cookbook/tutorials/hello_world.yaml` through API
- existing `cookbook/tutorials/template_hello_world.yaml` with top-level `default-values`
- custom Jinja-style OSMO YAML with variable override
- RayJob runtime with KubeRay `HTTPMode`
- finalizer cleanup and absence of desired/mirror/runtime leftovers
- pool resolution through `OSMOPool -> OSMOCluster`
- non-default `OSMOPool.spec.namespace` placement
- same-name Kubernetes Job mutation with delete/recreate of immutable runtime objects
- TTL cleanup only after status observes the current workflow generation

## Production Gaps

This is production-ready only for scoped Phase 1A spike validation. Remaining hardening before productization:

- Replace the manual JSON gRPC binding with generated protobufs and compatibility tests.
- Add leader election and controller-runtime style watches instead of polling loops.
- Add durable projection for historical workflow query after TTL cleanup.
- Expand OSMO YAML compatibility beyond the validated subset.
- Integrate production identity, audit, quota, and pool policy.
- Add Kueue/KAI scheduling integration.
- Add metrics, structured events, and alerting for ClusterSession health.
- Add multi-cluster scheduling only after the single-cluster control path is hardened.
