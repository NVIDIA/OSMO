// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

// Package barrier holds the contract for the Phase 4 workflow-wide barrier service.
//
// Workflow-wide barriers replace the Redis-backed cross-group synchronization in current
// OSMO. The gRPC surface is defined in operator/proto/operator.proto. Persistent state
// (one row per barrier with expected count, current arrivals, participants, TTL) lives
// in Postgres.
//
// Phase 1: the gRPC server returns Unimplemented. The Store interface is defined here so
// future implementations have a stable target.
//
// Note: in-group task barriers (osmo_barrier.py in workflow YAMLs) are TCP between Pods and
// have no Redis dependency. They are not part of this package.
package barrier

import (
	"context"
	"time"
)

// Handle uniquely identifies a barrier instance.
type Handle struct {
	WorkflowID string
	BarrierID  string
}

// State is the persistent representation of a single barrier.
type State struct {
	Handle       Handle
	Expected     int
	Arrived      int
	Participants []string
	CreatedAt    time.Time
	ExpiresAt    time.Time
}

// Event is emitted on every state-changing operation. Streaming subscribers consume these
// to learn about arrivals and completion.
type Event struct {
	Kind        EventKind
	Participant string
	Remaining   int
}

// EventKind enumerates what kind of state transition this event represents.
type EventKind int

const (
	EventArrival EventKind = iota + 1
	EventComplete
	EventTimeout
)

// Store is the persistence contract for barrier state. Phase 4 implements this against
// Postgres; tests can use an in-memory mock. All methods must be safe for concurrent use.
type Store interface {
	// Register inserts a new barrier. Idempotent on Handle: a second Register with the
	// same handle is a no-op if the existing state is compatible (same Expected count
	// and not yet completed), or an error otherwise.
	Register(ctx context.Context, h Handle, expected int, ttl time.Duration) error

	// Arrive records that a participant has reached the barrier. Returns the number of
	// arrivals still outstanding (0 means complete). Idempotent on (handle, participant).
	Arrive(ctx context.Context, h Handle, participant string) (remaining int, err error)

	// Watch returns a channel that receives events for the given barrier until ctx is
	// cancelled, the barrier completes, or its TTL expires.
	Watch(ctx context.Context, h Handle) (<-chan Event, error)
}
