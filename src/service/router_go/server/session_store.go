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

	pb "go.corp.nvidia.com/osmo/proto/router"
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
// Unbuffered for zero-copy - messages pass directly from sender to receiver.
type Pipe struct {
	ch          chan *pb.TunnelMessage
	done        chan struct{} // closed when pipe is closed, for select
	closed      atomic.Bool
	once        sync.Once
	sendTimeout time.Duration
}

func newPipe(sendTimeout time.Duration) *Pipe {
	// Unbuffered channel for true zero-copy semantics
	return &Pipe{
		ch:          make(chan *pb.TunnelMessage),
		done:        make(chan struct{}),
		sendTimeout: sendTimeout,
	}
}

// Send sends a message through the pipe with timeout (zero-copy).
// Safe to call concurrently with Close - will not panic.
func (p *Pipe) Send(ctx context.Context, msg *pb.TunnelMessage) error {
	// Apply send timeout if configured
	sendCtx := ctx
	var cancel context.CancelFunc
	if p.sendTimeout > 0 {
		sendCtx, cancel = context.WithTimeout(ctx, p.sendTimeout)
		defer cancel()
	}

	// Select on done channel to safely detect close without risking panic.
	// The done channel is closed BEFORE ch is closed in Close().
	select {
	case p.ch <- msg:
		return nil
	case <-p.done:
		return errPipeClosed
	case <-sendCtx.Done():
		if p.sendTimeout > 0 && sendCtx.Err() == context.DeadlineExceeded {
			return status.Error(codes.DeadlineExceeded, "pipe send timeout")
		}
		return sendCtx.Err()
	}
}

// Receive receives a message from the pipe (zero-copy).
func (p *Pipe) Receive(ctx context.Context) (*pb.TunnelMessage, error) {
	select {
	case msg := <-p.ch:
		return msg, nil
	case <-p.done:
		return nil, errPipeClosed
	case <-ctx.Done():
		return nil, ctx.Err()
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

// Sender returns a send function bound to the given context.
func (p *Pipe) Sender(ctx context.Context) func(*pb.TunnelMessage) error {
	return func(msg *pb.TunnelMessage) error { return p.Send(ctx, msg) }
}

// Receiver returns a receive function bound to the given context.
func (p *Pipe) Receiver(ctx context.Context) func() (*pb.TunnelMessage, error) {
	return func() (*pb.TunnelMessage, error) { return p.Receive(ctx) }
}

// Session represents an active tunnel session between a client and agent.
type Session struct {
	Key           string
	Cookie        string
	WorkflowID    string
	OperationType string
	CreatedAt     time.Time

	// Bidirectional pipes
	clientToAgent *Pipe
	agentToClient *Pipe

	// Rendezvous signaling (closed when party arrives)
	clientReady chan struct{}
	agentReady  chan struct{}

	// Lifecycle management
	done    chan struct{}
	deleted atomic.Bool

	// Reference counting: session deleted only when both parties release
	refCount atomic.Int32

	// Ensure channels close exactly once
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

// ClientConnected returns true if the client has connected.
func (s *Session) ClientConnected() bool {
	return s.clientConnected.Load()
}

// AgentConnected returns true if the agent has connected.
func (s *Session) AgentConnected() bool {
	return s.agentConnected.Load()
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

// Validation constants
const (
	maxSessionKeyLen = 256
	maxCookieLen     = 1024
	maxWorkflowIDLen = 256
)

// GetOrCreateSession returns existing session or creates new one.
// If session exists, validates that cookie matches.
// Increments reference count - caller must call ReleaseSession when done.
// Returns (session, existed, error).
func (s *SessionStore) GetOrCreateSession(key, cookie, workflowID, opType string) (*Session, bool, error) {
	// Validate inputs
	if key == "" {
		return nil, false, status.Error(codes.InvalidArgument, "session key is required")
	}
	if len(key) > maxSessionKeyLen {
		return nil, false, status.Errorf(codes.InvalidArgument, "session key exceeds max length of %d", maxSessionKeyLen)
	}
	if len(cookie) > maxCookieLen {
		return nil, false, status.Errorf(codes.InvalidArgument, "cookie exceeds max length of %d", maxCookieLen)
	}
	if len(workflowID) > maxWorkflowIDLen {
		return nil, false, status.Errorf(codes.InvalidArgument, "workflow ID exceeds max length of %d", maxWorkflowIDLen)
	}

	newSession := &Session{
		Key:           key,
		Cookie:        cookie,
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

	// If session existed, validate cookie matches
	if loaded && session.Cookie != cookie {
		return nil, false, status.Error(codes.PermissionDenied, "cookie mismatch")
	}

	// Increment reference count (expect 2: one for client, one for agent)
	newCount := session.refCount.Add(1)
	if !loaded {
		s.logger.Debug("session created",
			slog.String("session_key", key),
			slog.String("operation", opType),
		)
	} else {
		s.logger.Debug("session joined",
			slog.String("session_key", key),
			slog.Int("ref_count", int(newCount)),
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

// ReleaseSession decrements reference count and deletes session when both parties have released.
// Safe to call multiple times (idempotent per caller due to refCount).
func (s *SessionStore) ReleaseSession(key string) {
	val, ok := s.sessions.Load(key)
	if !ok {
		return
	}

	session := val.(*Session)

	// Decrement reference count
	newCount := session.refCount.Add(-1)

	s.logger.Debug("session released",
		slog.String("session_key", key),
		slog.Int("ref_count", int(newCount)),
	)

	// Only delete when last reference is released
	if newCount > 0 {
		return
	}

	// Atomic check-and-set prevents duplicate cleanup
	if !session.deleted.CompareAndSwap(false, true) {
		return
	}

	s.sessions.Delete(key)
	session.signalDone()

	s.logger.Debug("session deleted",
		slog.String("session_key", key),
		slog.String("operation", session.OperationType),
		slog.Duration("duration", time.Since(session.CreatedAt)),
	)
}
