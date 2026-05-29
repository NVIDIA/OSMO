<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# 02 — Multi-cluster transport: phone-home gRPC ClusterSession

Sub-doc of [`PROJ-osmo-workflow-orchestration.md`](./PROJ-osmo-workflow-orchestration.md).
Status: Phase 2 implemented and live on staging.

## Goal

Carry every cross-cluster interaction over a single bidirectional gRPC stream
that the **backend** opens to the **control plane**. The control plane never
holds a credential that authenticates to a backend's K8s API. This unblocks
on-prem, NAT'd, edge, and customer-managed backend clusters that can't accept
inbound credentials.

## Detailed design

### Components

- **Operator Service** (control plane): gRPC server. Accepts `Connect`
  streams; runs `ClusterRegistry`, `CommandBus`, `StatusBus`. Lives in
  `operator/`.
- **Backend Session Client** (each backend): dials home with `Hello` +
  plaintext bearer token, runs the bidi stream, executes commands, streams
  status. Lives in `controller/session/`.

### Wire protocol

One bidi stream per backend. Two envelope types, one per direction.

| Backend → Control (`ControllerEnvelope`) | Control → Backend (`OperatorEnvelope`) |
|---|---|
| `Hello` | `HelloAck` |
| `Heartbeat` | `CreateOTG` |
| `StatusEvent` (OTG phase/message/conditions) | `DeleteOTG` |
| `WorkflowTaskEventBatch` (Phase 4 — Postgres-bound curated events) | (Phase 8) `PreemptOTG` |
| `CapacityReport` (Phase 5) | |
| `ResyncRequest` | |
| `Ack` | |

Each new envelope variant is a new oneof case in the existing
`ControllerEnvelope.Body` (or `OperatorEnvelope.Body`) message, registered
via `handleControllerEnvelope` (`operator/service.go:151`) on the control
side and the symmetric handler on the backend side.

### Auth

```
backend cluster                       control plane
  K8s Secret with                       K8s Secret with
   plaintext token                       SHA-256 hash of token

  Hello { token: <plaintext> }  ───►   constant-time compare → accept/reject
```

A compromised control plane secret store reveals only hashes — no path to
authenticate against any backend. Token rotation: replace the token on the
backend, hash on the control plane; backend reconnects with the new token.

### Failure modes

- **Reconnect**: backend client exponential backoff; resets to base on
  successful `Hello`.
- **Resync**: on reconnect, backend sends `ResyncRequest`; control plane
  replays commands the backend may have missed.
- **Stale session**: control plane marks the cluster `Disconnected` after
  60s without heartbeat. Workflow controller's eligibility filter treats
  disconnected clusters as ineligible until the next successful `Hello`.
- **Bus full / send drop**: command/status events sent in a select with
  `default` to avoid blocking the stream goroutine; dropped events are
  logged and recovered via `ResyncRequest`.

### Event delivery to Postgres (Phase 4)

OSMO surfaces per-task events (Pod lifecycle, OOMKilled, ImagePullBackOff,
FailedScheduling, etc.) to UI/CLI via the workflow history store. These do
*not* ride OSMOTaskGroup.status — they go directly from the runtime-side
EventCurator to a Postgres table that survives OTG TTL. See
[`01-crd-model.md`](./01-crd-model.md) for the schema and
[`03-runtime-plugins.md`](./03-runtime-plugins.md) for the per-runtime
curator.

**Events live only in Postgres** — they never touch etcd. There's no dual-write
problem: the backend's event delivery is a single linear path (curator →
batch envelope → operator-service ingest → COPY into `osmo_workflow_events`),
with the backend's retry buffer providing durability across session
reconnects. The FK to `osmo_workflows.id` is satisfied because the projector
(see [`01-crd-model.md`](./01-crd-model.md)) has already inserted the
workflow row by the time the first event for it lands.

**Envelope shape** (new `ControllerEnvelope.Body` oneof variant):

```protobuf
message WorkflowTaskEvent {
  string workflow_uid    = 1;   // OSMOWorkflow UID → FK to osmo_workflows.id
  string group_name      = 2;
  string pod_name        = 3;
  string container_name  = 4;
  string event_type      = 5;   // 'Normal' | 'Warning'
  string reason          = 6;   // curated allow-list per runtime
  string message         = 7;
  google.protobuf.Timestamp first_timestamp = 8;
  google.protobuf.Timestamp last_timestamp  = 9;
  int32  count           = 10;  // aggregated occurrence count
}

message WorkflowTaskEventBatch {
  string cluster_id            = 1;
  repeated WorkflowTaskEvent events = 2;
}
```

**Backend behavior**:

- EventCurator buffers curated events for a configurable window (default
  5s) or up to a configurable count (default 50 events), whichever fires
  first.
- Sends the batch as one `WorkflowTaskEventBatch` envelope. Single network
  round-trip per batch.
- On reconnect after a disconnect: queued batches are re-sent;
  deterministic event IDs (composed from
  `(workflow_uid, group, pod, container, reason, last_timestamp)`) let the
  control plane dedupe on insert.

**Control plane ingest pipeline** (`WorkflowEventIngest`):

- Receives `WorkflowTaskEventBatch` envelopes via the operator service.
- Buffers briefly (e.g. up to 1s or 5000 events).
- Batched `COPY` into `osmo_workflow_events`.
- Independent of the OTG status fan-out path — slow Postgres does not
  backpressure OTG state propagation.

**Backpressure**:

- If Postgres ingest can't keep up, `WorkflowEventIngest` holds events in
  a bounded buffer and signals back via `DropNotice` (see general
  backpressure SLA below).
- Backend's EventCurator coarsens its batching window or drops
  low-severity aggregated events first. Terminal Warning events are
  never dropped.

**Volume targets**: at 100K active OTGs, ~10 curated events/OTG over
lifetime, average 1h lifetime → ~300 events/sec sustained, with 5K/sec
bursts during failure modes. Batching keeps envelope count to ~5/sec/backend
× 200 backends = 1000 envelopes/sec on the wire. Postgres COPY rate stays
well under its ceiling.

### Open follow-ups

_To be filled in. Topics to cover:_

- **Multiplexed streams per backend**: today's design is one stream per
  backend. If we ever need parallel ordered channels (e.g., commands vs
  events), revisit.
- **Backpressure SLA**: define the SLA the control plane guarantees for
  command delivery vs status ingestion vs event ingest rate. `DropNotice`
  envelope spec.
- **Protocol versioning**: strategy for evolving envelope types
  forward-compatibly. Backends and control plane may run mismatched
  versions during rolling upgrades.

## Implementation plan

Phase 2 already shipped. Phase 5 adds `CapacityReport` as a new
`ControllerEnvelope.Body` variant — see [`04-scheduling.md`](./04-scheduling.md)
step 2. Phase 8 adds `PreemptOTG` as a new `OperatorEnvelope.Body` variant —
see [`08-future-scheduling.md`](./08-future-scheduling.md).

## Risks / open questions

- **Token rotation tooling.** Today's rotation is manual K8s Secret edits on
  both sides. Should we ship a small CLI or controller that automates
  rotation with a grace window?
- **Multi-region control plane.** A single Operator Service is the
  rendezvous; if it goes down, all backends disconnect. HA pair with shared
  registry state via etcd is straightforward but not yet designed.

## Out of scope

- Auth migration paths (mTLS, OIDC, etc.). Token+hash is what we ship; other
  schemes are future work if needed.
- OCM adoption (see [`08-future-scheduling.md`](./08-future-scheduling.md)).
