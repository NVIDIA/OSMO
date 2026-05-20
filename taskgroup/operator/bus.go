// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package operator

import (
	"context"
	"sync"

	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

// StatusBus is the in-process fan-out for OTGStatusEvent messages received from any
// connected cluster's stream. The Workflow Controller subscribes to learn about remote
// task group status changes; the Operator Service publishes whenever a controller pushes
// a ClusterMessage{OTGStatusEvent}.
//
// This is a simple broadcast bus — every subscriber sees every event. Subscribers filter
// by labels / namespace / name themselves. For Phase 2 MVP this is fine; if subscriber
// count grows, swap to keyed delivery.
type StatusBus struct {
	mu      sync.RWMutex
	subs    map[uint64]chan<- StatusEvent
	nextSub uint64
}

// StatusEvent is the bus-internal representation of an OTGStatusEvent. The ClusterID is
// added by the Operator Service so subscribers know which cluster the event came from.
type StatusEvent struct {
	ClusterID string
	Event     *operatorpb.OTGStatusEvent
}

// NewStatusBus returns an empty bus.
func NewStatusBus() *StatusBus {
	return &StatusBus{subs: make(map[uint64]chan<- StatusEvent)}
}

// Subscribe registers a channel that will receive every event. The returned cancel
// function unsubscribes. Buffered channels are recommended (~16+) so slow subscribers
// don't back-pressure the Operator Service's stream handler.
func (b *StatusBus) Subscribe(ch chan<- StatusEvent) (cancel func()) {
	b.mu.Lock()
	id := b.nextSub
	b.nextSub++
	b.subs[id] = ch
	b.mu.Unlock()
	return func() {
		b.mu.Lock()
		delete(b.subs, id)
		b.mu.Unlock()
	}
}

// Publish fans an event out to all current subscribers. If a subscriber's channel is
// full, the event is dropped for that subscriber (the controller will eventually pick
// up the state via the periodic reconcile loop, so this is a safe degradation).
func (b *StatusBus) Publish(ctx context.Context, ev StatusEvent) {
	b.mu.RLock()
	subs := make([]chan<- StatusEvent, 0, len(b.subs))
	for _, c := range b.subs {
		subs = append(subs, c)
	}
	b.mu.RUnlock()
	for _, c := range subs {
		select {
		case c <- ev:
		case <-ctx.Done():
			return
		default:
			// slow subscriber — drop
		}
	}
}
