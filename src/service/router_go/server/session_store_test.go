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
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"

	pb "go.corp.nvidia.com/osmo/proto/router"
)

func setupTestSessionStore(timeout time.Duration) *SessionStore {
	if timeout == 0 {
		timeout = 60 * time.Second
	}
	return NewSessionStore(SessionStoreConfig{
		RendezvousTimeout: timeout,
		MaxSessionKeyLen:  256,
		MaxWorkflowIDLen:  256,
	}, nil)
}

func assertResponse(t *testing.T, err error, code codes.Code) {
	t.Helper()
	if code == codes.OK {
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		return
	}
	if status.Code(err) != code {
		t.Fatalf("expected code %v, got %v (err: %v)", code, status.Code(err), err)
	}
}

func TestSessionStore_GetOrCreateSession(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	session, existed, err := store.GetOrCreateSession("key1", "workflow", OperationExec)
	assertResponse(t, err, codes.OK)
	if existed {
		t.Error("session should not exist on first creation")
	}
	if session.Key != "key1" {
		t.Errorf("expected key 'key1', got '%s'", session.Key)
	}

	// Second call with same workflow ID returns same session
	session2, existed2, err := store.GetOrCreateSession("key1", "workflow", OperationExec)
	assertResponse(t, err, codes.OK)
	if !existed2 {
		t.Error("session should exist on second creation")
	}
	if session != session2 {
		t.Error("should return same session instance")
	}
}

func TestSessionStore_InputValidation(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	// Empty session key
	_, _, err := store.GetOrCreateSession("", "workflow", OperationExec)
	assertResponse(t, err, codes.InvalidArgument)

	// Session key too long
	longKey := string(make([]byte, 300))
	_, _, err = store.GetOrCreateSession(longKey, "workflow", OperationExec)
	assertResponse(t, err, codes.InvalidArgument)
}

func TestSessionStore_WorkflowIDMismatch(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	// First party creates session with workflow-a
	_, _, err := store.GetOrCreateSession("key1", "workflow-a", OperationExec)
	assertResponse(t, err, codes.OK)

	// Second party with different workflow ID should fail
	_, _, err = store.GetOrCreateSession("key1", "workflow-b", OperationExec)
	assertResponse(t, err, codes.PermissionDenied)

	// Same workflow ID should succeed
	_, _, err = store.GetOrCreateSession("key1", "workflow-a", OperationExec)
	assertResponse(t, err, codes.OK)
}

func TestSessionStore_GetSession(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	// Non-existent
	_, err := store.GetSession("nonexistent")
	assertResponse(t, err, codes.NotFound)

	// Create and get
	store.GetOrCreateSession("key1", "workflow", OperationExec)
	session, err := store.GetSession("key1")
	assertResponse(t, err, codes.OK)
	if session.Key != "key1" {
		t.Errorf("expected key 'key1', got '%s'", session.Key)
	}
}

func TestSessionStore_ReleaseSession(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	session, _, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)

	// Register a context to detect cancellation
	ctx := session.RegisterUserContext(context.Background())

	// Verify context is not cancelled yet
	select {
	case <-ctx.Done():
		t.Error("context should not be cancelled yet")
	default:
	}

	// Release should trigger cleanup and cancel context
	store.ReleaseSession("key1")

	// Verify context is cancelled
	select {
	case <-ctx.Done():
		// Expected - check cause
		if context.Cause(ctx) != ErrSessionTerminated {
			t.Errorf("expected cause ErrSessionTerminated, got %v", context.Cause(ctx))
		}
	case <-time.After(100 * time.Millisecond):
		t.Error("context should be cancelled after release")
	}

	// Session should be gone
	_, err := store.GetSession("key1")
	assertResponse(t, err, codes.NotFound)

	// Multiple releases should be safe (no-op)
	store.ReleaseSession("key1")
	store.ReleaseSession("key1")
}

func TestSessionStore_FirstReleaseWins(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	// First party creates session
	session, existed, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)
	if existed {
		t.Error("session should not exist on first creation")
	}

	// Second party joins session
	session2, existed2, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)
	if !existed2 {
		t.Error("session should exist on second creation")
	}
	if session != session2 {
		t.Error("should return same session instance")
	}

	// Register contexts to detect cancellation
	userCtx := session.RegisterUserContext(context.Background())
	agentCtx := session.RegisterAgentContext(context.Background())

	// Verify contexts are not cancelled yet
	select {
	case <-userCtx.Done():
		t.Error("user context should not be cancelled yet")
	default:
	}
	select {
	case <-agentCtx.Done():
		t.Error("agent context should not be cancelled yet")
	default:
	}

	// First release triggers immediate cleanup
	store.ReleaseSession("key1")

	// Session should be deleted immediately
	_, err := store.GetSession("key1")
	assertResponse(t, err, codes.NotFound)

	// Verify both contexts are cancelled (signals all handlers to exit)
	select {
	case <-userCtx.Done():
		// Expected
	case <-time.After(100 * time.Millisecond):
		t.Error("user context should be cancelled after first release")
	}
	select {
	case <-agentCtx.Done():
		// Expected
	case <-time.After(100 * time.Millisecond):
		t.Error("agent context should be cancelled after first release")
	}

	// Second release is a no-op (session already gone)
	store.ReleaseSession("key1")
}

func TestSessionStore_RendezvousSuccess(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(5 * time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)

	userDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	go func() {
		userDone <- session.WaitForAgent(context.Background(), timeout)
	}()

	go func() {
		time.Sleep(50 * time.Millisecond)
		agentDone <- session.WaitForUser(context.Background(), timeout)
	}()

	assertResponse(t, <-userDone, codes.OK)
	assertResponse(t, <-agentDone, codes.OK)
}

func TestSessionStore_RendezvousAgentFirst(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(5 * time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)

	agentDone := make(chan error, 1)
	userDone := make(chan error, 1)

	go func() {
		agentDone <- session.WaitForUser(context.Background(), timeout)
	}()

	go func() {
		time.Sleep(50 * time.Millisecond)
		userDone <- session.WaitForAgent(context.Background(), timeout)
	}()

	assertResponse(t, <-agentDone, codes.OK)
	assertResponse(t, <-userDone, codes.OK)
}

func TestSessionStore_RendezvousTimeout(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(100 * time.Millisecond)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)

	err := session.WaitForAgent(context.Background(), timeout)
	assertResponse(t, err, codes.DeadlineExceeded)
}

func TestSessionStore_RendezvousContextCancel(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(60 * time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)

	go func() {
		done <- session.WaitForAgent(ctx, timeout)
	}()

	time.Sleep(50 * time.Millisecond)
	cancel()

	assertResponse(t, <-done, codes.Canceled)
}

func TestSessionStore_DuplicateUser(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)

	// First user
	done1 := make(chan error, 1)
	go func() {
		done1 <- session.WaitForAgent(context.Background(), timeout)
	}()

	time.Sleep(50 * time.Millisecond)

	// Second user should fail
	err := session.WaitForAgent(context.Background(), timeout)
	assertResponse(t, err, codes.AlreadyExists)
}

func TestSessionStore_DuplicateAgent(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)

	// First agent
	done1 := make(chan error, 1)
	go func() {
		done1 <- session.WaitForUser(context.Background(), timeout)
	}()

	time.Sleep(50 * time.Millisecond)

	// Second agent should fail
	err := session.WaitForUser(context.Background(), timeout)
	assertResponse(t, err, codes.AlreadyExists)
}

func TestSessionStore_SessionTerminated(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(5 * time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)

	// Register context first so rendezvous can detect termination
	ctx := session.RegisterUserContext(context.Background())

	done := make(chan error, 1)
	go func() {
		done <- session.WaitForAgent(ctx, timeout)
	}()

	time.Sleep(50 * time.Millisecond)
	store.ReleaseSession("key1")

	assertResponse(t, <-done, codes.Aborted)
}

func TestSessionStore_ConcurrentOperations(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	numSessions := 50
	var wg sync.WaitGroup
	errs := make(chan error, numSessions)

	for i := range numSessions {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			key := fmt.Sprintf("session-%d", id)
			_, _, err := store.GetOrCreateSession(key, "workflow", OperationExec)
			if err != nil {
				errs <- err
			}
		}(i)
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Errorf("concurrent creation error: %v", err)
		}
	}

	// Verify all sessions exist
	count := 0
	for i := range numSessions {
		key := fmt.Sprintf("session-%d", i)
		if _, err := store.GetSession(key); err == nil {
			count++
		}
	}
	if count != numSessions {
		t.Errorf("expected %d sessions, got %d", numSessions, count)
	}
}

func TestSessionStore_DoubleReleaseRace(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	for i := range 100 {
		key := fmt.Sprintf("race-session-%d", i)
		store.GetOrCreateSession(key, "workflow", OperationExec)

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			store.ReleaseSession(key)
		}()
		go func() {
			defer wg.Done()
			store.ReleaseSession(key)
		}()
		wg.Wait()

		// Verify session is deleted (first release triggers cleanup)
		_, err := store.GetSession(key)
		if err == nil {
			t.Errorf("session %s should be deleted", key)
		}
	}
}

func TestSession_StreamRegistration(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	session, _, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)

	// Initially nil
	if session.UserStream() != nil {
		t.Error("user stream should be nil initially")
	}
	if session.AgentStream() != nil {
		t.Error("agent stream should be nil initially")
	}

	// Register streams (using nil for now, real tests use mock streams)
	mockUserStream := &mockStream{}
	mockAgentStream := &mockStream{}

	session.RegisterUserStream(mockUserStream)
	session.RegisterAgentStream(mockAgentStream)

	if session.UserStream() != mockUserStream {
		t.Error("user stream not stored correctly")
	}
	if session.AgentStream() != mockAgentStream {
		t.Error("agent stream not stored correctly")
	}
}

func TestSession_ContextCancellation(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	session, _, _ := store.GetOrCreateSession("key1", "workflow", OperationExec)

	// Register both contexts
	userCtx := session.RegisterUserContext(context.Background())
	agentCtx := session.RegisterAgentContext(context.Background())

	// Verify both are active
	if userCtx.Err() != nil {
		t.Error("user context should not be cancelled initially")
	}
	if agentCtx.Err() != nil {
		t.Error("agent context should not be cancelled initially")
	}

	// Terminate session
	store.TerminateSession("key1", "test termination")

	// Both should be cancelled with ErrSessionTerminated
	if context.Cause(userCtx) != ErrSessionTerminated {
		t.Errorf("user context cause = %v, want ErrSessionTerminated", context.Cause(userCtx))
	}
	if context.Cause(agentCtx) != ErrSessionTerminated {
		t.Errorf("agent context cause = %v, want ErrSessionTerminated", context.Cause(agentCtx))
	}
}

// mockStream implements TunnelStream for testing stream registration
type mockStream struct{}

func (m *mockStream) Context() context.Context { return context.Background() }
func (m *mockStream) SendMsg(msg any) error    { return nil }
func (m *mockStream) RecvMsg(msg any) error    { return nil }

// payloadFrame creates a RawFrame with the given payload bytes.
func payloadFrame(data []byte) RawFrame {
	raw, _ := proto.Marshal(&pb.UserFrame{Frame: &pb.UserFrame_Payload{Payload: data}})
	return RawFrame{Raw: raw}
}
