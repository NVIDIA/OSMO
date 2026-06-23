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
- `Heartbeat`: cluster liveness signal.

On reconnect, control sends a full task group snapshot. Backend reconciles idempotently and prunes local mirrors that are no longer desired.

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
