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
//
// The session holds:
//   - send: bounded channel pushed by callers, drained by the gRPC writer goroutine
//   - done: closed by the session owner (the stream goroutine) when the session is
//     ending. Send() consults this to avoid pushing onto a closed-or-stale channel.
type Session struct {
	ClusterID string

	mu   sync.RWMutex
	send chan *operatorpb.OperatorEnvelope
	done chan struct{}
}

// send-side helpers (used by SessionRegistry.Send below).
//
// SendEnvelope returns ErrClusterNotConnected if the session has already been torn down,
// avoiding the classic "send on closed channel" panic. Concurrent callers + concurrent
// teardown are safe.
func (s *Session) sendEnvelope(env *operatorpb.OperatorEnvelope) error {
	s.mu.RLock()
	done := s.done
	out := s.send
	s.mu.RUnlock()
	if done == nil {
		return ErrClusterNotConnected
	}
	select {
	case <-done:
		return ErrClusterNotConnected
	case out <- env:
		return nil
	}
}

// shutdown is called by the session's owner goroutine to signal "no more sends past this
// point." After shutdown returns, sendEnvelope will return ErrClusterNotConnected for any
// subsequent call. The owner is responsible for draining any remaining envelopes from
// `send` if needed (typically not — the gRPC stream is also closing).
func (s *Session) shutdown() {
	s.mu.Lock()
	if s.done != nil {
		select {
		case <-s.done:
			// already closed
		default:
			close(s.done)
		}
	}
	s.mu.Unlock()
}

// Drain returns a receive-only view of the send channel, used by the gRPC writer
// goroutine to read pending envelopes. Reading until the channel is closed is the
// owner's natural shutdown signal.
func (s *Session) Drain() <-chan *operatorpb.OperatorEnvelope { return s.send }

// SessionRegistry tracks live cluster sessions and demultiplexes commands to the right
// stream. Safe for concurrent use. One Session per cluster_id at a time — a second Hello
// from the same cluster_id replaces the existing session (the previous one is signalled
// via its done channel).
type SessionRegistry struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewSessionRegistry returns an empty registry.
func NewSessionRegistry() *SessionRegistry {
	return &SessionRegistry{sessions: make(map[string]*Session)}
}

// Register installs a new session for the given clusterID. Returns the session (caller
// uses .drain() to read envelopes for the gRPC writer, and .shutdown() to signal end-of-
// life from the reader path). A second Register for the same cluster_id replaces the
// previous session — the previous session's `done` channel is closed, which both
// signals its goroutines to stop and immediately makes `Send` to that session return
// ErrClusterNotConnected.
//
// `bufferSize` bounds the outbound queue; recommended 64+.
func (r *SessionRegistry) Register(clusterID string, bufferSize int) *Session {
	r.mu.Lock()
	defer r.mu.Unlock()

	if prev, ok := r.sessions[clusterID]; ok {
		// Signal the previous session to exit. The owner goroutine will return from
		// its read loop; new Sends already see ErrClusterNotConnected.
		prev.shutdown()
	}

	sess := &Session{
		ClusterID: clusterID,
		send:      make(chan *operatorpb.OperatorEnvelope, bufferSize),
		done:      make(chan struct{}),
	}
	r.sessions[clusterID] = sess
	return sess
}

// Unregister removes the cluster's session if (and only if) it's still the one indicated
// by the passed Session pointer. Called by the stream handler on Connect return.
func (r *SessionRegistry) Unregister(clusterID string, sess *Session) {
	r.mu.Lock()
	defer r.mu.Unlock()
	current, ok := r.sessions[clusterID]
	if !ok {
		return
	}
	if current == sess {
		delete(r.sessions, clusterID)
	}
	// In either case make sure the session's done is closed so any blocked sender
	// unsticks immediately.
	sess.shutdown()
}

// Send delivers an OperatorEnvelope to the named cluster's stream. Returns
// ErrClusterNotConnected if there is no live session, OR if the session is in the middle
// of being torn down. Safe under any concurrent register/unregister.
func (r *SessionRegistry) Send(clusterID string, env *operatorpb.OperatorEnvelope) error {
	r.mu.RLock()
	sess, ok := r.sessions[clusterID]
	r.mu.RUnlock()
	if !ok {
		return ErrClusterNotConnected
	}
	return sess.sendEnvelope(env)
}

// Connected reports whether a given cluster has a live session right now.
func (r *SessionRegistry) Connected(clusterID string) bool {
	r.mu.RLock()
	_, ok := r.sessions[clusterID]
	r.mu.RUnlock()
	return ok
}

// List returns the currently connected cluster IDs. Used for metrics and the
// OSMOCluster status reconciler.
func (r *SessionRegistry) List() []string {
	r.mu.RLock()
	out := make([]string, 0, len(r.sessions))
	for id := range r.sessions {
		out = append(out, id)
	}
	r.mu.RUnlock()
	return out
}
