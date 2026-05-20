// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

package operator

import (
	"errors"
	"sync"

	operatorpb "github.com/nvidia/osmo/taskgroup/operator/proto"
)

// ErrClusterNotConnected is returned when a caller tries to send a command to a cluster
// that doesn't currently have a live session.
var ErrClusterNotConnected = errors.New("cluster has no live session")

// Session represents one connected backend cluster's bidi stream.
type Session struct {
	ClusterID string

	// send pushes one envelope onto the stream toward the controller. Bounded buffer
	// — if the controller can't keep up the send blocks, which back-pressures the
	// caller (typically the Workflow Controller's RemoteDispatcher).
	send chan<- *operatorpb.OperatorEnvelope
}

// SessionRegistry tracks live cluster sessions and demultiplexes commands to the right
// stream. Safe for concurrent use. One Session per cluster_id at a time — a second Hello
// from the same cluster_id replaces the existing session (and signals the previous to
// close).
type SessionRegistry struct {
	mu       sync.RWMutex
	sessions map[string]*registryEntry
}

type registryEntry struct {
	session *Session
	cancel  chan struct{} // closed by the new owner when replacing
}

// NewSessionRegistry returns an empty registry.
func NewSessionRegistry() *SessionRegistry {
	return &SessionRegistry{sessions: make(map[string]*registryEntry)}
}

// Register installs a new session for the given clusterID. Returns a `cancel` channel
// that is closed when a future Register replaces this session — the caller's stream
// goroutine should watch this channel and shut down when it fires. The send channel
// becomes the path to push OperatorEnvelopes toward the controller.
func (r *SessionRegistry) Register(clusterID string, send chan<- *operatorpb.OperatorEnvelope) (cancel <-chan struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// If a previous session exists for this cluster_id, signal it to exit.
	if prev, ok := r.sessions[clusterID]; ok {
		close(prev.cancel)
	}

	entry := &registryEntry{
		session: &Session{ClusterID: clusterID, send: send},
		cancel:  make(chan struct{}),
	}
	r.sessions[clusterID] = entry
	return entry.cancel
}

// Unregister removes the cluster's session if (and only if) it's still the one indicated
// by the cancel channel. Called by the stream handler on Connect return.
func (r *SessionRegistry) Unregister(clusterID string, cancel <-chan struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, ok := r.sessions[clusterID]
	if !ok {
		return
	}
	if entry.cancel == cancel {
		delete(r.sessions, clusterID)
	}
}

// Send delivers an OperatorEnvelope to the named cluster's stream. Blocks until the
// underlying buffered channel can accept the message; the caller controls timeouts via
// the provided ctx.
//
// Returns ErrClusterNotConnected if no session is live for the cluster_id.
func (r *SessionRegistry) Send(clusterID string, env *operatorpb.OperatorEnvelope) error {
	r.mu.RLock()
	entry, ok := r.sessions[clusterID]
	r.mu.RUnlock()
	if !ok {
		return ErrClusterNotConnected
	}
	entry.session.send <- env
	return nil
}

// Connected reports whether a given cluster has a live session right now. Used by the
// Workflow Controller to decide whether to dispatch or back off.
func (r *SessionRegistry) Connected(clusterID string) bool {
	r.mu.RLock()
	_, ok := r.sessions[clusterID]
	r.mu.RUnlock()
	return ok
}

// List returns the currently connected cluster IDs. Used by metrics and the OSMOCluster
// status reconciler.
func (r *SessionRegistry) List() []string {
	r.mu.RLock()
	out := make([]string, 0, len(r.sessions))
	for id := range r.sessions {
		out = append(out, id)
	}
	r.mu.RUnlock()
	return out
}
