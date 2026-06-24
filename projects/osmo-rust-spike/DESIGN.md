# OSMO Rust Spike Design

## Goal

This spike validates a CRD-native OSMO workflow orchestration shape in Rust. The goal is to compare a Rust implementation against the Go/controller-runtime implementation while keeping the same product architecture:

- Kubernetes CRDs are the source of truth.
- Redis is not in the live workflow execution path.
- PostgreSQL is only a projection target for historical queries.
- The backend-side component is the TaskGroup Controller.
- The ClusterSession client is an internal TaskGroup Controller module, not a separate microservice.

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

## Runtime Types

`OSMOTaskGroup.spec.runtimeType` selects the backend runtime reconciler:

- `kubernetesObjects` / `osmoContainerGroup`: applies rendered Kubernetes objects carried in `renderedObjects`.
- `rayJob`: applies a KubeRay `RayJob` from `runtimeConfig.spec`.
- `rayCluster`: applies a KubeRay `RayCluster` from `runtimeConfig.spec`.

The workflow controller preserves `runtimeType`, `runtimeConfig`, `poolRef`, and `renderedObjects` from `OSMOWorkflow.spec.taskGroups[]` into the control-side desired `OSMOTaskGroup`. The ClusterSession transport serializes those payloads to the backend TaskGroup Controller, which applies or deletes runtime resources before reporting success or cleanup ack.

## Cleanup and TTL

`OSMOWorkflow` finalizers are removed only after backend cleanup acknowledgement. Deletion sends an explicit prune target containing workflow name, workflow UID, and backend namespace. TTL uses the same deletion path, so runtime resources are cleaned by the backend before the workflow disappears.

## Backend Shape

The backend deployment is the TaskGroup Controller. Internally it contains:

- ClusterSession client loop.
- Local OSMOTaskGroup mirror reconciler.
- Runtime reconciler boundary.
- Status reporter.
- Heartbeat/reconnect loop.

There is no separate Backend Session Client service in this spike.

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

`deploy/e2e-validate.sh` applies CRDs/deployments, validates rendered Kubernetes object orchestration, validates RayJob orchestration through KubeRay, checks Ray job completion, and validates finalizer cleanup for both runtime paths.
