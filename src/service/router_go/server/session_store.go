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

// Session represents an active router session
type Session struct {
	Key           string // Unique session identifier
	Cookie        string // Sticky load balancer cookie
	WorkflowID    string // Workflow identifier
	OperationType string // Operation type: exec, portforward, rsync
	CreatedAt     time.Time

	// lastActivityNanos stores the last activity timestamp as Unix nanoseconds
	// Use atomic operations to access this field
	lastActivityNanos atomic.Int64

	// Channels for bidirectional communication
	ClientToAgent chan []byte
	AgentToClient chan []byte

	// Synchronization
	ClientReady chan struct{}
	AgentReady  chan struct{}
	Done        chan struct{}

	// Safe channel closing with sync.Once
	closeClientReady sync.Once
	closeAgentReady  sync.Once
	closeDone        sync.Once
}

// LastActivity returns the last activity time for this session (thread-safe)
func (s *Session) LastActivity() time.Time {
	nanos := s.lastActivityNanos.Load()
	return time.Unix(0, nanos)
}

// UpdateLastActivity updates the last activity timestamp (thread-safe)
func (s *Session) UpdateLastActivity(t time.Time) {
	s.lastActivityNanos.Store(t.UnixNano())
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
	TTL                time.Duration
	RendezvousTimeout  time.Duration
	FlowControlBuffer  int
	FlowControlTimeout time.Duration
	CleanupInterval    time.Duration // How often to check for expired sessions (default: 30s)
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

// WithTTL sets the session time-to-live duration
func WithTTL(ttl time.Duration) SessionStoreOption {
	return func(s *SessionStore) {
		s.config.TTL = ttl
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

// WithCleanupInterval sets how often expired sessions are cleaned up
func WithCleanupInterval(interval time.Duration) SessionStoreOption {
	return func(s *SessionStore) {
		s.config.CleanupInterval = interval
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
			TTL:                5 * time.Minute,
			RendezvousTimeout:  30 * time.Second,
			FlowControlBuffer:  100,
			FlowControlTimeout: 30 * time.Second,
			CleanupInterval:    30 * time.Second,
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
		ClientToAgent: make(chan []byte, s.config.FlowControlBuffer),
		AgentToClient: make(chan []byte, s.config.FlowControlBuffer),
		ClientReady:   make(chan struct{}),
		AgentReady:    make(chan struct{}),
		Done:          make(chan struct{}),
	}
	newSession.UpdateLastActivity(now)

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
func (s *SessionStore) DeleteSession(sessionKey string) {
	if val, ok := s.sessions.LoadAndDelete(sessionKey); ok {
		session := val.(*Session)

		// Use sync.Once to safely close channels (idempotent)
		session.CloseDone()

		// Don't close the data channels as they might still have consumers
		// They will be garbage collected when no longer referenced
	}
}

// UpdateActivity updates the last activity timestamp for a session (thread-safe)
func (s *SessionStore) UpdateActivity(sessionKey string) {
	if val, ok := s.sessions.Load(sessionKey); ok {
		session := val.(*Session)
		session.UpdateLastActivity(time.Now())
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

// CleanupExpiredSessions periodically removes expired sessions
func (s *SessionStore) CleanupExpiredSessions(ctx context.Context) {
	interval := s.config.CleanupInterval
	if interval == 0 {
		interval = 30 * time.Second // Default to 30s if not configured
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			now := time.Now()
			toDelete := []string{}

			s.sessions.Range(func(key, value interface{}) bool {
				session := value.(*Session)
				lastActivity := session.LastActivity()
				expired := now.Sub(lastActivity) > s.config.TTL

				if expired {
					toDelete = append(toDelete, key.(string))
				}
				return true
			})

			for _, key := range toDelete {
				// Check if context was canceled before each deletion
				select {
				case <-ctx.Done():
					return
				default:
				}
				s.logger.Info("cleaning up expired session",
					slog.String("session_key", key),
				)
				s.DeleteSession(key)
			}
		}
	}
}

// WaitForRendezvous waits for both client and agent to connect.
// Returns an error if the rendezvous times out or the session is closed.
func (s *SessionStore) WaitForRendezvous(ctx context.Context, session *Session, isClient bool) (err error) {
	// Signal that this party is ready (idempotent with sync.Once)
	if isClient {
		session.CloseClientReady()
	} else {
		session.CloseAgentReady()
	}

	// Wait for the other party with timeout
	ctx, cancel := context.WithTimeout(ctx, s.config.RendezvousTimeout)
	defer cancel()

	if isClient {
		select {
		case <-session.AgentReady:
			return nil
		case <-ctx.Done():
			// Final non-blocking check before returning timeout error
			select {
			case <-session.AgentReady:
				return nil // Agent arrived just in time
			default:
				return status.Error(codes.DeadlineExceeded, "rendezvous timeout: agent did not connect")
			}
		case <-session.Done:
			return status.Error(codes.Aborted, "session closed")
		}
	} else {
		select {
		case <-session.ClientReady:
			return nil
		case <-ctx.Done():
			// Final non-blocking check before returning timeout error
			select {
			case <-session.ClientReady:
				return nil // Client arrived just in time
			default:
				return status.Error(codes.DeadlineExceeded, "rendezvous timeout: client did not connect")
			}
		case <-session.Done:
			return status.Error(codes.Aborted, "session closed")
		}
	}
}

// SendWithFlowControl sends data with flow control and timeout to prevent unbounded buffering.
// Returns an error if the send times out or the context is canceled.
func (s *SessionStore) SendWithFlowControl(ctx context.Context, ch chan []byte, data []byte, sessionKey string) (err error) {
	s.UpdateActivity(sessionKey)

	ctx, cancel := context.WithTimeout(ctx, s.config.FlowControlTimeout)
	defer cancel()

	select {
	case ch <- data:
		return nil
	case <-ctx.Done():
		return status.Error(codes.ResourceExhausted, "flow control timeout: consumer too slow")
	}
}

// ReceiveWithContext receives data with context cancellation support
func (s *SessionStore) ReceiveWithContext(ctx context.Context, ch chan []byte, sessionKey string) (data []byte, err error) {
	s.UpdateActivity(sessionKey)

	select {
	case data, ok := <-ch:
		if !ok {
			return nil, status.Error(codes.Unavailable, "channel closed")
		}
		return data, nil
	case <-ctx.Done():
		return nil, status.Error(codes.Canceled, "operation canceled")
	}
}

// FormatSessionStats returns formatted statistics for a session (thread-safe)
func (session *Session) FormatSessionStats() string {
	lastActivity := session.LastActivity()
	return fmt.Sprintf(
		"Session{key=%s, workflow=%s, op=%s, age=%v, idle=%v}",
		session.Key,
		session.WorkflowID,
		session.OperationType,
		time.Since(session.CreatedAt),
		time.Since(lastActivity),
	)
}
