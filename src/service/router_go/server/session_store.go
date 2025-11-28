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
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Operation type constants for logging and metrics.
const (
	OperationExec        = "exec"
	OperationPortForward = "portforward"
	OperationRsync       = "rsync"
	OperationWebSocket   = "websocket"
)

// ErrSessionTerminated is the cause used when cancelling contexts due to session termination.
var ErrSessionTerminated = errors.New("session terminated")

// TunnelStream is the interface for gRPC bidirectional streams.
// Both user and agent streams implement this via their generated types.
type TunnelStream interface {
	Context() context.Context
	SendMsg(m any) error
	RecvMsg(m any) error
}

// Session represents an active tunnel session between a user and agent.
//
// DIRECT FORWARDING: After rendezvous, each handler reads from its own stream
// and writes to the peer's stream. gRPC's HTTP/2 flow control provides
// natural backpressure - no artificial timeouts needed.
//
// LIFECYCLE: First party creates session, second party joins via same key.
// Either party disconnecting (or TerminateSession) triggers cleanup via
// context cancellation.
type Session struct {
	Key        string
	WorkflowID string
	CreatedAt  time.Time

	// mu protects mutable fields
	mu            sync.Mutex
	operationType string
	userStream    TunnelStream
	agentStream   TunnelStream

	// Context cancellation for external termination.
	// When session is released/terminated, these are called to unblock streams.
	userCancel  context.CancelCauseFunc
	agentCancel context.CancelCauseFunc

	// Rendezvous signaling - closed when party arrives
	userReady  chan struct{}
	agentReady chan struct{}

	// Lifecycle management
	deleted atomic.Bool // CAS(false→true) ensures cleanup happens exactly once

	// Prevent double-close panics on channels
	closeUserReady  sync.Once
	closeAgentReady sync.Once

	// Prevent duplicate connections
	userConnected  atomic.Bool
	agentConnected atomic.Bool
}

// OperationType returns the operation type (exec, portforward, etc).
func (s *Session) OperationType() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.operationType
}

// SetOperationType sets the operation type if not already set.
func (s *Session) setOperationType(opType string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.operationType == "" && opType != "" {
		s.operationType = opType
	}
}

// UserStream returns the user's stream (nil if not yet connected).
func (s *Session) UserStream() TunnelStream {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.userStream
}

// AgentStream returns the agent's stream (nil if not yet connected).
func (s *Session) AgentStream() TunnelStream {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.agentStream
}

// RegisterUserStream stores the user's stream reference.
func (s *Session) RegisterUserStream(stream TunnelStream) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.userStream = stream
}

// RegisterAgentStream stores the agent's stream reference.
func (s *Session) RegisterAgentStream(stream TunnelStream) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agentStream = stream
}

// RegisterUserContext creates a cancellable context for the user handler.
// The returned context will be cancelled when the session is terminated.
func (s *Session) RegisterUserContext(ctx context.Context) context.Context {
	ctx, cancel := context.WithCancelCause(ctx)
	s.mu.Lock()
	s.userCancel = cancel
	s.mu.Unlock()
	return ctx
}

// RegisterAgentContext creates a cancellable context for the agent handler.
// The returned context will be cancelled when the session is terminated.
func (s *Session) RegisterAgentContext(ctx context.Context) context.Context {
	ctx, cancel := context.WithCancelCause(ctx)
	s.mu.Lock()
	s.agentCancel = cancel
	s.mu.Unlock()
	return ctx
}

// cancelAll cancels all registered stream contexts.
// Called by releaseSession to unblock any blocked RecvMsg/SendMsg calls.
func (s *Session) cancelAll(cause error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.userCancel != nil {
		s.userCancel(cause)
		s.userCancel = nil
	}
	if s.agentCancel != nil {
		s.agentCancel(cause)
		s.agentCancel = nil
	}
}

// signalUserReady marks user as ready (idempotent).
func (s *Session) signalUserReady() {
	s.closeUserReady.Do(func() { close(s.userReady) })
}

// signalAgentReady marks agent as ready (idempotent).
func (s *Session) signalAgentReady() {
	s.closeAgentReady.Do(func() { close(s.agentReady) })
}

// IsConnected returns true if both user and agent have connected (rendezvous complete).
func (s *Session) IsConnected() bool {
	return s.userConnected.Load() && s.agentConnected.Load()
}

// WaitForAgent signals user is ready and waits for agent to connect.
func (s *Session) WaitForAgent(ctx context.Context, timeout time.Duration) error {
	if !s.userConnected.CompareAndSwap(false, true) {
		return status.Error(codes.AlreadyExists, "user already connected")
	}
	s.signalUserReady()
	return s.waitForParty(ctx, timeout, s.agentReady, "agent")
}

// WaitForUser signals agent is ready and waits for user to connect.
func (s *Session) WaitForUser(ctx context.Context, timeout time.Duration) error {
	if !s.agentConnected.CompareAndSwap(false, true) {
		return status.Error(codes.AlreadyExists, "agent already connected")
	}
	s.signalAgentReady()
	return s.waitForParty(ctx, timeout, s.userReady, "user")
}

// waitForParty waits for the specified party to signal ready.
func (s *Session) waitForParty(ctx context.Context, timeout time.Duration, ready <-chan struct{}, party string) error {
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case <-ready:
		return nil
	case <-timeoutCtx.Done():
		// Check once more in case they arrived just in time
		select {
		case <-ready:
			return nil
		default:
		}
		// Distinguish between parent ctx cancel (session terminated) vs timeout
		if ctx.Err() != nil {
			if context.Cause(ctx) == ErrSessionTerminated {
				return status.Error(codes.Aborted, "session terminated")
			}
			return status.Error(codes.Canceled, "context cancelled")
		}
		return status.Errorf(codes.DeadlineExceeded, "rendezvous timeout: %s did not connect", party)
	}
}

// SessionStoreConfig holds configuration for session management.
type SessionStoreConfig struct {
	RendezvousTimeout time.Duration
	MaxSessionKeyLen  int
	MaxWorkflowIDLen  int
}

// SessionStore manages active sessions with thread-safe operations.
type SessionStore struct {
	sessions sync.Map // map[string]*Session
	config   SessionStoreConfig
	logger   *slog.Logger
}

// NewSessionStore creates a new session store.
func NewSessionStore(config SessionStoreConfig, logger *slog.Logger) *SessionStore {
	if logger == nil {
		logger = slog.Default()
	}
	return &SessionStore{
		config: config,
		logger: logger,
	}
}

// RendezvousTimeout returns the configured rendezvous timeout.
func (s *SessionStore) RendezvousTimeout() time.Duration {
	return s.config.RendezvousTimeout
}

// GetOrCreateSession returns existing session or creates new one.
// Caller should call ReleaseSession when done to trigger cleanup.
// Returns (session, existed, error).
func (s *SessionStore) GetOrCreateSession(key, workflowID, opType string) (*Session, bool, error) {
	// Validate inputs
	if key == "" {
		return nil, false, status.Error(codes.InvalidArgument, "session key is required")
	}
	if len(key) > s.config.MaxSessionKeyLen {
		return nil, false, status.Errorf(codes.InvalidArgument, "session key exceeds max length of %d", s.config.MaxSessionKeyLen)
	}
	if len(workflowID) > s.config.MaxWorkflowIDLen {
		return nil, false, status.Errorf(codes.InvalidArgument, "workflow ID exceeds max length of %d", s.config.MaxWorkflowIDLen)
	}

	newSession := &Session{
		Key:           key,
		WorkflowID:    workflowID,
		operationType: opType,
		CreatedAt:     time.Now(),
		userReady:     make(chan struct{}),
		agentReady:    make(chan struct{}),
	}

	actual, loaded := s.sessions.LoadOrStore(key, newSession)
	session := actual.(*Session)

	if loaded {
		// Joining existing session - validate workflow ID matches
		if session.WorkflowID != workflowID {
			return nil, false, status.Errorf(codes.PermissionDenied,
				"workflow ID mismatch: expected %q, got %q", session.WorkflowID, workflowID)
		}

		// Fill in operation type if empty (agent created session first)
		session.setOperationType(opType)

		s.logger.Debug("session joined", slog.String("session_key", key))
	} else {
		s.logger.Debug("session created",
			slog.String("session_key", key),
			slog.String("operation", opType),
		)
	}

	return session, loaded, nil
}

// GetSession retrieves a session by key.
func (s *SessionStore) GetSession(key string) (*Session, error) {
	val, ok := s.sessions.Load(key)
	if !ok {
		return nil, status.Error(codes.NotFound, "session not found")
	}
	return val.(*Session), nil
}

// ReleaseSession releases the session and triggers cleanup.
// First caller wins - subsequent calls are no-ops.
func (s *SessionStore) ReleaseSession(key string) {
	if session := s.releaseSession(key); session != nil {
		s.logger.Debug("session released",
			slog.String("session_key", key),
			slog.String("operation", session.OperationType()),
			slog.Duration("duration", time.Since(session.CreatedAt)),
		)
	}
}

// TerminateSession forcibly terminates a session.
// Returns true if the session was found and terminated.
func (s *SessionStore) TerminateSession(key, reason string) bool {
	session := s.releaseSession(key)
	if session == nil {
		return false
	}

	s.logger.Info("session terminated",
		slog.String("session_key", key),
		slog.String("reason", reason),
		slog.String("operation", session.OperationType()),
		slog.Duration("duration", time.Since(session.CreatedAt)),
	)

	return true
}

// releaseSession performs the actual session cleanup.
// Returns the session if it was released, nil if not found or already released.
func (s *SessionStore) releaseSession(key string) *Session {
	val, ok := s.sessions.Load(key)
	if !ok {
		return nil
	}

	session := val.(*Session)

	// First releaser wins - atomic check-and-set prevents duplicate cleanup
	if !session.deleted.CompareAndSwap(false, true) {
		return nil
	}

	s.sessions.Delete(key)

	// Cancel all stream contexts - this unblocks any blocked RecvMsg/SendMsg
	session.cancelAll(ErrSessionTerminated)

	return session
}
