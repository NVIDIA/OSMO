/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/

package server

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Operation type constants for session management
const (
	OperationExec        = "exec"
	OperationPortForward = "portforward"
	OperationRsync       = "rsync"
)

// SessionMessage wraps messages that flow through session channels
// This allows forwarding data, metadata, and close information
type SessionMessage struct {
	Data      []byte // Payload data
	CloseInfo []byte // Serialized close information (TunnelClose proto), nil if not a close message
}

// Session represents an active router session
type Session struct {
	Key           string // Unique session identifier
	Cookie        string // Sticky load balancer cookie
	WorkflowID    string // Workflow identifier
	OperationType string // Operation type: exec, portforward, rsync
	CreatedAt     time.Time

	// deleted tracks if this session has been deleted (1 = deleted, 0 = active)
	// Use atomic operations to access this field
	deleted atomic.Int32

	// clientConnected tracks if a client has connected (1 = connected, 0 = not connected)
	// Use atomic operations to access this field
	clientConnected atomic.Int32

	// agentConnected tracks if an agent has connected (1 = connected, 0 = not connected)
	// Use atomic operations to access this field
	agentConnected atomic.Int32

	// Channels for bidirectional communication
	ClientToAgent chan *SessionMessage
	AgentToClient chan *SessionMessage

	// Synchronization
	ClientReady chan struct{}
	AgentReady  chan struct{}
	Done        chan struct{}

	// Safe channel closing with sync.Once
	closeClientReady sync.Once
	closeAgentReady  sync.Once
	closeDone        sync.Once
}

// CloseClientReady safely closes the ClientReady channel (idempotent)
func (s *Session) CloseClientReady() {
	s.closeClientReady.Do(func() {
		close(s.ClientReady)
	})
}

// CloseAgentReady safely closes the AgentReady channel (idempotent)
func (s *Session) CloseAgentReady() {
	s.closeAgentReady.Do(func() {
		close(s.AgentReady)
	})
}

// CloseDone safely closes the Done channel (idempotent)
func (s *Session) CloseDone() {
	s.closeDone.Do(func() {
		close(s.Done)
	})
}

// SessionStore manages active sessions with thread-safe operations
type SessionStore struct {
	sessions sync.Map // map[string]*Session
	config   SessionStoreConfig
	logger   *slog.Logger
}

// SessionStoreConfig holds configuration for the session store
type SessionStoreConfig struct {
	RendezvousTimeout  time.Duration
	FlowControlBuffer  int
	FlowControlTimeout time.Duration
}

// SessionStoreOption is a functional option for configuring SessionStore
type SessionStoreOption func(*SessionStore)

// WithLogger sets a custom logger for the session store
func WithLogger(logger *slog.Logger) SessionStoreOption {
	return func(s *SessionStore) {
		if logger != nil {
			s.logger = logger
		}
	}
}

// WithRendezvousTimeout sets the timeout for client-agent rendezvous
func WithRendezvousTimeout(timeout time.Duration) SessionStoreOption {
	return func(s *SessionStore) {
		s.config.RendezvousTimeout = timeout
	}
}

// WithFlowControlBuffer sets the buffer size for flow control channels
func WithFlowControlBuffer(size int) SessionStoreOption {
	return func(s *SessionStore) {
		s.config.FlowControlBuffer = size
	}
}

// WithFlowControlTimeout sets the timeout for flow control operations
func WithFlowControlTimeout(timeout time.Duration) SessionStoreOption {
	return func(s *SessionStore) {
		s.config.FlowControlTimeout = timeout
	}
}

// NewSessionStore creates a new session store
func NewSessionStore(config SessionStoreConfig, logger *slog.Logger) *SessionStore {
	if logger == nil {
		logger = slog.Default()
	}
	return &SessionStore{
		config: config,
		logger: logger,
	}
}

// NewSessionStoreWithOptions creates a new session store using functional options.
// This is the preferred idiomatic way to create a SessionStore with sensible defaults.
func NewSessionStoreWithOptions(opts ...SessionStoreOption) *SessionStore {
	// Set sensible defaults
	store := &SessionStore{
		config: SessionStoreConfig{
			RendezvousTimeout:  30 * time.Second,
			FlowControlBuffer:  100,
			FlowControlTimeout: 30 * time.Second,
		},
		logger: slog.Default(),
	}

	// Apply options
	for _, opt := range opts {
		opt(store)
	}

	return store
}

// CreateSession creates a new session or returns an existing one.
// sessionKey uniquely identifies the session across client and agent.
// cookie is used for sticky load balancer routing.
// workflowID identifies the workflow this session belongs to.
// operationType indicates the type of operation (exec, portforward, rsync).
func (s *SessionStore) CreateSession(
	sessionKey string,
	cookie string,
	workflowID string,
	operationType string,
) (session *Session, existed bool, err error) {
	now := time.Now()
	newSession := &Session{
		Key:           sessionKey,
		Cookie:        cookie,
		WorkflowID:    workflowID,
		OperationType: operationType,
		CreatedAt:     now,
		ClientToAgent: make(chan *SessionMessage, s.config.FlowControlBuffer),
		AgentToClient: make(chan *SessionMessage, s.config.FlowControlBuffer),
		ClientReady:   make(chan struct{}),
		AgentReady:    make(chan struct{}),
		Done:          make(chan struct{}),
	}

	actual, loaded := s.sessions.LoadOrStore(sessionKey, newSession)

	session = actual.(*Session)
	return session, loaded, nil
}

// GetSession retrieves a session by its unique key
func (s *SessionStore) GetSession(sessionKey string) (session *Session, err error) {
	val, ok := s.sessions.Load(sessionKey)
	if !ok {
		return nil, status.Error(codes.NotFound, "session not found")
	}
	return val.(*Session), nil
}

// DeleteSession removes a session and safely closes its channels
// Uses atomic flag to ensure single deletion even if called concurrently
func (s *SessionStore) DeleteSession(sessionKey string) {
	if val, ok := s.sessions.Load(sessionKey); ok {
		session := val.(*Session)

		// Atomically check and set deleted flag (compare-and-swap)
		if !session.deleted.CompareAndSwap(0, 1) {
			// Already deleted by another goroutine
			return
		}

		// Now remove from map
		s.sessions.Delete(sessionKey)

		// Close Done channel to signal session deletion (idempotent via sync.Once)
		session.CloseDone()

		// Note: Data channels (ClientToAgent, AgentToClient) are closed by their respective
		// writer goroutines (via defer close in Tunnel/RegisterTunnel handlers).
		// We don't close them here to avoid double-close panics.
	}
}

// ActiveCount returns the number of active sessions
func (s *SessionStore) ActiveCount() int {
	count := 0
	s.sessions.Range(func(_, _ interface{}) bool {
		count++
		return true
	})
	return count
}

// WaitForRendezvous waits for both client and agent to connect.
// Returns an error if the rendezvous times out or the session is closed.
// Ensures only one client and one agent can connect to a session.
func (s *SessionStore) WaitForRendezvous(ctx context.Context, session *Session, isClient bool) (err error) {
	// Check if this party type has already connected
	if isClient {
		if !session.clientConnected.CompareAndSwap(0, 1) {
			return status.Error(codes.AlreadyExists, "client already connected to this session")
		}
	} else {
		if !session.agentConnected.CompareAndSwap(0, 1) {
			return status.Error(codes.AlreadyExists, "agent already connected to this session")
		}
	}

	// Signal that this party is ready (idempotent with sync.Once)
	if isClient {
		session.CloseClientReady()
	} else {
		session.CloseAgentReady()
	}

	// Wait for the other party with timeout
	timeoutCtx, cancel := context.WithTimeout(ctx, s.config.RendezvousTimeout)
	defer cancel()

	if isClient {
		select {
		case <-session.AgentReady:
			return nil
		case <-timeoutCtx.Done():
			// Final non-blocking check before returning error
			select {
			case <-session.AgentReady:
				return nil // Agent arrived just in time
			default:
				// Check if parent context was cancelled or if timeout occurred
				if ctx.Err() != nil {
					return status.Error(codes.Canceled, "context cancelled")
				}
				return status.Error(codes.DeadlineExceeded, "rendezvous timeout: agent did not connect")
			}
		case <-session.Done:
			return status.Error(codes.Aborted, "session closed")
		}
	} else {
		select {
		case <-session.ClientReady:
			return nil
		case <-timeoutCtx.Done():
			// Final non-blocking check before returning error
			select {
			case <-session.ClientReady:
				return nil // Client arrived just in time
			default:
				// Check if parent context was cancelled or if timeout occurred
				if ctx.Err() != nil {
					return status.Error(codes.Canceled, "context cancelled")
				}
				return status.Error(codes.DeadlineExceeded, "rendezvous timeout: client did not connect")
			}
		case <-session.Done:
			return status.Error(codes.Aborted, "session closed")
		}
	}
}

// SendWithFlowControl sends a message with flow control and timeout to prevent unbounded buffering.
// Returns an error if the send times out or the context is canceled.
func (s *SessionStore) SendWithFlowControl(ctx context.Context, ch chan *SessionMessage, msg *SessionMessage) (err error) {
	ctx, cancel := context.WithTimeout(ctx, s.config.FlowControlTimeout)
	defer cancel()

	select {
	case ch <- msg:
		return nil
	case <-ctx.Done():
		return status.Error(codes.ResourceExhausted, "flow control timeout: consumer too slow")
	}
}

// ReceiveWithContext receives a message with context cancellation support
func (s *SessionStore) ReceiveWithContext(ctx context.Context, ch chan *SessionMessage) (msg *SessionMessage, err error) {
	select {
	case msg, ok := <-ch:
		if !ok {
			return nil, status.Error(codes.Unavailable, "channel closed")
		}
		return msg, nil
	case <-ctx.Done():
		return nil, status.Error(codes.Canceled, "operation canceled")
	}
}

// FormatSessionStats returns formatted statistics for a session (thread-safe)
func (session *Session) FormatSessionStats() string {
	return fmt.Sprintf(
		"Session{key=%s, workflow=%s, op=%s, age=%v}",
		session.Key,
		session.WorkflowID,
		session.OperationType,
		time.Since(session.CreatedAt),
	)
}
