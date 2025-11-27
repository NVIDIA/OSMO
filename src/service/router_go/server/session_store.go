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
	OperationUnknown     = "unknown"
)

var errPipeClosed = status.Error(codes.Unavailable, "pipe closed")

// Pipe is a zero-copy channel-based unidirectional pipe.
//
// ZERO-COPY DESIGN:
// The pipe carries RawFrame by value. RawFrame is small (~32 bytes) and
// contains a slice header pointing to the actual payload bytes. Passing by
// value avoids heap allocation while the payload itself is never copied.
//
// The channel is unbuffered so messages pass directly from sender to
// receiver without any intermediate buffering.
type Pipe struct {
	ch          chan RawFrame
	done        chan struct{} // closed when pipe is closed, for select
	closed      atomic.Bool
	once        sync.Once
	sendTimeout time.Duration
}

func newPipe(sendTimeout time.Duration) *Pipe {
	// Unbuffered channel - messages go directly from sender to receiver
	return &Pipe{
		ch:          make(chan RawFrame),
		done:        make(chan struct{}),
		sendTimeout: sendTimeout,
	}
}

// Send sends a message through the pipe with timeout.
func (p *Pipe) Send(ctx context.Context, msg RawFrame) error {
	// Fast path: no timeout configured
	if p.sendTimeout == 0 {
		select {
		case p.ch <- msg:
			return nil
		case <-p.done:
			return errPipeClosed
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	// Send with timeout
	timer := time.NewTimer(p.sendTimeout)
	defer timer.Stop()

	select {
	case p.ch <- msg:
		return nil
	case <-p.done:
		return errPipeClosed
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return status.Error(codes.DeadlineExceeded, "pipe send timeout")
	}
}

// Receive receives a message from the pipe.
func (p *Pipe) Receive(ctx context.Context) (RawFrame, error) {
	select {
	case msg := <-p.ch:
		return msg, nil
	case <-p.done:
		return RawFrame{}, errPipeClosed
	case <-ctx.Done():
		return RawFrame{}, ctx.Err()
	}
}

// Close closes the pipe (idempotent).
// Only closes the done channel to signal. The data channel is NOT closed
// to avoid panics from concurrent senders.
func (p *Pipe) Close() {
	p.once.Do(func() {
		p.closed.Store(true)
		close(p.done)
	})
}

// Session represents an active tunnel session between a client and agent.
//
// SESSION LIFECYCLE
// =================
//
//	CLIENT                           SESSION STORE                          AGENT
//	  │                                   │                                   │
//	  │  GetOrCreateSession(key)          │                                   │
//	  │──────────────────────────────────>│  (session created, in map)        │
//	  │                                   │                                   │
//	  │  WaitForAgent()                   │                                   │
//	  │──────────────────────────────────>│  (clientReady closed)             │
//	  │                 ╔═════════════════╧═══════════════════╗               │
//	  │                 ║     WAITING FOR RENDEZVOUS          ║               │
//	  │                 ╚═════════════════╤═══════════════════╝               │
//	  │                                   │   GetOrCreateSession(key)         │
//	  │                                   │<──────────────────────────────────│
//	  │                                   │                                   │
//	  │                                   │          WaitForClient()          │
//	  │                                   │<──────────────────────────────────│
//	  │                                   │  (agentReady closed)              │
//	  │                 ╔═════════════════╧═══════════════════╗               │
//	  │                 ║        RENDEZVOUS COMPLETE          ║               │
//	  │                 ║   (both clientReady & agentReady)   ║               │
//	  │                 ╚═════════════════╤═══════════════════╝               │
//	  │                                   │                                   │
//	  │  ←──────── clientToAgent Pipe ────┼───────────────────────────────────│
//	  │  ───────── agentToClient Pipe ────┼──────────────────────────────────>│
//	  │                                   │                                   │
//	  │                 ╔═════════════════╧═══════════════════╗               │
//	  │                 ║          DATA STREAMING             ║               │
//	  │                 ╚═════════════════╤═══════════════════╝               │
//	  │                                   │                                   │
//	  │                                   │                                   │
//	  ├── EITHER PARTY DISCONNECTS ───────┼───────────────────────────────────┤
//	  │   OR TerminateSession() called    │                                   │
//	  │                                   │                                   │
//	  │                                   ▼                                   │
//	  │                 ╔═════════════════════════════════════╗               │
//	  │                 ║          CLEANUP (first wins)       ║               │
//	  │                 ║  1. deleted.CAS(false→true)         ║               │
//	  │                 ║  2. Remove from map                 ║               │
//	  │                 ║  3. Close done channel              ║───────────────│
//	  │                 ║  4. Close pipes                     ║  (other party │
//	  │                 ╚═════════════════════════════════════╝   sees done,  │
//	  │                                                           exits)      │
type Session struct {
	Key           string
	WorkflowID    string
	OperationType string
	CreatedAt     time.Time

	// Bidirectional pipes
	clientToAgent *Pipe
	agentToClient *Pipe

	// Rendezvous signaling - closed when party arrives
	clientReady chan struct{}
	agentReady  chan struct{}

	// Lifecycle management
	done    chan struct{} // closed on cleanup - signals all handlers to exit
	deleted atomic.Bool   // CAS(false→true) ensures cleanup happens exactly once

	// Prevent double-close panics on channels
	closeClientReady sync.Once
	closeAgentReady  sync.Once
	closeDone        sync.Once

	// Prevent duplicate connections
	clientConnected atomic.Bool
	agentConnected  atomic.Bool
}

// ClientToAgent returns the pipe for client → agent data flow.
func (s *Session) ClientToAgent() *Pipe { return s.clientToAgent }

// AgentToClient returns the pipe for agent → client data flow.
func (s *Session) AgentToClient() *Pipe { return s.agentToClient }

// signalClientReady marks client as ready (idempotent).
func (s *Session) signalClientReady() {
	s.closeClientReady.Do(func() { close(s.clientReady) })
}

// signalAgentReady marks agent as ready (idempotent).
func (s *Session) signalAgentReady() {
	s.closeAgentReady.Do(func() { close(s.agentReady) })
}

// signalDone closes the done channel (idempotent).
func (s *Session) signalDone() {
	s.closeDone.Do(func() { close(s.done) })
}

// Done returns a channel that's closed when the session is terminated.
func (s *Session) Done() <-chan struct{} {
	return s.done
}

// IsConnected returns true if both client and agent have connected (rendezvous complete).
func (s *Session) IsConnected() bool {
	return s.clientConnected.Load() && s.agentConnected.Load()
}

// WaitForAgent signals client is ready and waits for agent to connect.
func (s *Session) WaitForAgent(ctx context.Context, timeout time.Duration) error {
	if !s.clientConnected.CompareAndSwap(false, true) {
		return status.Error(codes.AlreadyExists, "client already connected")
	}
	s.signalClientReady()
	return s.waitForParty(ctx, timeout, s.agentReady, "agent")
}

// WaitForClient signals agent is ready and waits for client to connect.
func (s *Session) WaitForClient(ctx context.Context, timeout time.Duration) error {
	if !s.agentConnected.CompareAndSwap(false, true) {
		return status.Error(codes.AlreadyExists, "agent already connected")
	}
	s.signalAgentReady()
	return s.waitForParty(ctx, timeout, s.clientReady, "client")
}

// waitForParty waits for the specified party to signal ready.
func (s *Session) waitForParty(ctx context.Context, timeout time.Duration, ready <-chan struct{}, party string) error {
	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case <-ready:
		return nil
	case <-s.done:
		return status.Error(codes.Aborted, "session closed")
	case <-timeoutCtx.Done():
		// Check once more in case they arrived just in time
		select {
		case <-ready:
			return nil
		default:
		}
		if ctx.Err() != nil {
			return status.Error(codes.Canceled, "context cancelled")
		}
		return status.Errorf(codes.DeadlineExceeded, "rendezvous timeout: %s did not connect", party)
	}
}

// SessionStoreConfig holds configuration for session management.
type SessionStoreConfig struct {
	RendezvousTimeout time.Duration
	StreamSendTimeout time.Duration
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
		OperationType: opType,
		CreatedAt:     time.Now(),
		clientToAgent: newPipe(s.config.StreamSendTimeout),
		agentToClient: newPipe(s.config.StreamSendTimeout),
		clientReady:   make(chan struct{}),
		agentReady:    make(chan struct{}),
		done:          make(chan struct{}),
	}

	actual, loaded := s.sessions.LoadOrStore(key, newSession)
	session := actual.(*Session)

	if loaded {
		// Joining existing session - validate workflow ID matches
		if session.WorkflowID != workflowID {
			return nil, false, status.Errorf(codes.PermissionDenied,
				"workflow ID mismatch: expected %q, got %q", session.WorkflowID, workflowID)
		}

		// If session was created by agent (empty operation type), fill in from user
		if session.OperationType == "" && opType != "" {
			session.OperationType = opType
		}

		s.logger.Debug("session joined",
			slog.String("session_key", key),
		)
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
// This signals all handlers to exit immediately via the done channel.
func (s *SessionStore) ReleaseSession(key string) {
	if session := s.releaseSession(key); session != nil {
		s.logger.Debug("session released",
			slog.String("session_key", key),
			slog.String("operation", session.OperationType),
			slog.Duration("duration", time.Since(session.CreatedAt)),
		)
	}
}

// TerminateSession forcibly terminates a session regardless of reference count.
// Returns true if the session was found and terminated.
func (s *SessionStore) TerminateSession(key, reason string) bool {
	session := s.releaseSession(key)
	if session == nil {
		return false
	}

	s.logger.Info("session terminated",
		slog.String("session_key", key),
		slog.String("reason", reason),
		slog.String("operation", session.OperationType),
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
	session.signalDone()
	session.clientToAgent.Close()
	session.agentToClient.Close()

	return session
}
