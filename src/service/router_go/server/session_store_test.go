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
		StreamSendTimeout: 30 * time.Second,
	}, nil)
}

func requireCode(t *testing.T, err error, code codes.Code) {
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

	session, existed, err := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)
	requireCode(t, err, codes.OK)
	if existed {
		t.Error("session should not exist on first creation")
	}
	if session.Key != "key1" {
		t.Errorf("expected key 'key1', got '%s'", session.Key)
	}

	// Second call with SAME cookie returns same session
	session2, existed2, err := store.GetOrCreateSession("key1", "cookie", "workflow2", OperationExec)
	requireCode(t, err, codes.OK)
	if !existed2 {
		t.Error("session should exist on second creation")
	}
	if session != session2 {
		t.Error("should return same session instance")
	}
}

func TestSessionStore_CookieMismatch(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	// First call creates session
	_, _, err := store.GetOrCreateSession("key1", "cookie-a", "workflow", OperationExec)
	requireCode(t, err, codes.OK)

	// Second call with different cookie should fail
	_, _, err = store.GetOrCreateSession("key1", "cookie-b", "workflow", OperationExec)
	requireCode(t, err, codes.PermissionDenied)
}

func TestSessionStore_InputValidation(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	// Empty session key
	_, _, err := store.GetOrCreateSession("", "cookie", "workflow", OperationExec)
	requireCode(t, err, codes.InvalidArgument)

	// Session key too long
	longKey := string(make([]byte, 300))
	_, _, err = store.GetOrCreateSession(longKey, "cookie", "workflow", OperationExec)
	requireCode(t, err, codes.InvalidArgument)
}

func TestSessionStore_GetSession(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	// Non-existent
	_, err := store.GetSession("nonexistent")
	requireCode(t, err, codes.NotFound)

	// Create and get
	store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)
	session, err := store.GetSession("key1")
	requireCode(t, err, codes.OK)
	if session.Key != "key1" {
		t.Errorf("expected key 'key1', got '%s'", session.Key)
	}
}

func TestSessionStore_ReleaseSession(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	session, _, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)

	// Verify done channel is open
	select {
	case <-session.Done():
		t.Error("done channel should not be closed yet")
	default:
	}

	// Release should trigger cleanup
	store.ReleaseSession("key1")

	// Verify done channel is closed
	select {
	case <-session.Done():
		// Expected
	case <-time.After(100 * time.Millisecond):
		t.Error("done channel should be closed after release")
	}

	// Session should be gone
	_, err := store.GetSession("key1")
	requireCode(t, err, codes.NotFound)

	// Multiple releases should be safe (no-op)
	store.ReleaseSession("key1")
	store.ReleaseSession("key1")
}

func TestSessionStore_FirstReleaseWins(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	// First party creates session
	session, existed, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)
	if existed {
		t.Error("session should not exist on first creation")
	}

	// Second party joins session
	session2, existed2, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)
	if !existed2 {
		t.Error("session should exist on second creation")
	}
	if session != session2 {
		t.Error("should return same session instance")
	}

	// Verify done channel is open before release
	select {
	case <-session.Done():
		t.Error("done channel should not be closed yet")
	default:
	}

	// First release triggers immediate cleanup
	store.ReleaseSession("key1")

	// Session should be deleted immediately
	_, err := store.GetSession("key1")
	requireCode(t, err, codes.NotFound)

	// Verify done channel is closed (signals other party to exit)
	select {
	case <-session.Done():
		// Expected - done channel signals all handlers to exit
	case <-time.After(100 * time.Millisecond):
		t.Error("done channel should be closed after first release")
	}

	// Second release is a no-op (session already gone)
	store.ReleaseSession("key1")
}

func TestSessionStore_RendezvousSuccess(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(5 * time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)

	clientDone := make(chan error, 1)
	agentDone := make(chan error, 1)

	go func() {
		clientDone <- session.WaitForAgent(context.Background(), timeout)
	}()

	go func() {
		time.Sleep(50 * time.Millisecond)
		agentDone <- session.WaitForClient(context.Background(), timeout)
	}()

	requireCode(t, <-clientDone, codes.OK)
	requireCode(t, <-agentDone, codes.OK)
}

func TestSessionStore_RendezvousAgentFirst(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(5 * time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)

	agentDone := make(chan error, 1)
	clientDone := make(chan error, 1)

	go func() {
		agentDone <- session.WaitForClient(context.Background(), timeout)
	}()

	go func() {
		time.Sleep(50 * time.Millisecond)
		clientDone <- session.WaitForAgent(context.Background(), timeout)
	}()

	requireCode(t, <-agentDone, codes.OK)
	requireCode(t, <-clientDone, codes.OK)
}

func TestSessionStore_RendezvousTimeout(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(100 * time.Millisecond)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)

	err := session.WaitForAgent(context.Background(), timeout)
	requireCode(t, err, codes.DeadlineExceeded)
}

func TestSessionStore_RendezvousContextCancel(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(60 * time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)

	go func() {
		done <- session.WaitForAgent(ctx, timeout)
	}()

	time.Sleep(50 * time.Millisecond)
	cancel()

	requireCode(t, <-done, codes.Canceled)
}

func TestSessionStore_DuplicateClient(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)

	// First client
	done1 := make(chan error, 1)
	go func() {
		done1 <- session.WaitForAgent(context.Background(), timeout)
	}()

	time.Sleep(50 * time.Millisecond)

	// Second client should fail
	err := session.WaitForAgent(context.Background(), timeout)
	requireCode(t, err, codes.AlreadyExists)
}

func TestSessionStore_DuplicateAgent(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)

	// First agent
	done1 := make(chan error, 1)
	go func() {
		done1 <- session.WaitForClient(context.Background(), timeout)
	}()

	time.Sleep(50 * time.Millisecond)

	// Second agent should fail
	err := session.WaitForClient(context.Background(), timeout)
	requireCode(t, err, codes.AlreadyExists)
}

func TestSessionStore_SessionClosed(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(5 * time.Second)
	timeout := store.RendezvousTimeout()

	session, _, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)

	done := make(chan error, 1)
	go func() {
		done <- session.WaitForAgent(context.Background(), timeout)
	}()

	time.Sleep(50 * time.Millisecond)
	store.ReleaseSession("key1")

	requireCode(t, <-done, codes.Aborted)
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
			_, _, err := store.GetOrCreateSession(key, "cookie", "workflow", OperationExec)
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
		store.GetOrCreateSession(key, "cookie", "workflow", OperationExec)

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

// Helper to create a RawMessage with data payload.
// This marshals the protobuf to bytes, simulating what gRPC does.
func tunnelDataMsg(data []byte) *RawMessage {
	msg := &pb.TunnelMessage{
		Message: &pb.TunnelMessage_Data{
			Data: &pb.TunnelData{Payload: data},
		},
	}
	raw, _ := proto.Marshal(msg)
	return &RawMessage{Raw: raw}
}

func TestPipe_SendReceive(t *testing.T) {
	t.Parallel()
	pipe := newPipe(30 * time.Second)

	go func() {
		time.Sleep(50 * time.Millisecond)
		pipe.Send(context.Background(), tunnelDataMsg([]byte("hello")))
	}()

	msg, err := pipe.Receive(context.Background())
	if err != nil {
		t.Fatalf("receive error: %v", err)
	}
	// Parse the raw message to verify contents
	data := msg.GetData()
	if data == nil {
		t.Fatal("expected data message")
	}
	if string(data.Payload) != "hello" {
		t.Errorf("expected 'hello', got '%s'", string(data.Payload))
	}
}

func TestPipe_Close(t *testing.T) {
	t.Parallel()
	pipe := newPipe(30 * time.Second)
	pipe.Close()

	_, err := pipe.Receive(context.Background())
	if !errors.Is(err, errPipeClosed) {
		t.Errorf("expected errPipeClosed, got %v", err)
	}

	err = pipe.Send(context.Background(), tunnelDataMsg([]byte("test")))
	if !errors.Is(err, errPipeClosed) {
		t.Errorf("expected errPipeClosed, got %v", err)
	}

	// Multiple closes should be safe
	pipe.Close()
	pipe.Close()
}

func TestPipe_ContextCancel(t *testing.T) {
	t.Parallel()
	pipe := newPipe(30 * time.Second)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// Receive with canceled context should fail
	_, err := pipe.Receive(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled, got %v", err)
	}

	// Send with canceled context should fail (unbuffered, no receiver)
	err = pipe.Send(ctx, tunnelDataMsg([]byte("test")))
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

func TestPipe_SendTimeout(t *testing.T) {
	t.Parallel()
	// Very short timeout
	pipe := newPipe(50 * time.Millisecond)

	// No receiver, should timeout
	err := pipe.Send(context.Background(), tunnelDataMsg([]byte("test")))
	if err == nil {
		t.Error("expected timeout error, got nil")
	}
	if status.Code(err) != codes.DeadlineExceeded {
		t.Errorf("expected DeadlineExceeded, got %v", status.Code(err))
	}
}
