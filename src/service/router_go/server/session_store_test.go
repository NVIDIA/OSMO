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

	// Second call returns same session
	session2, existed2, err := store.GetOrCreateSession("key1", "cookie2", "workflow2", OperationExec)
	requireCode(t, err, codes.OK)
	if !existed2 {
		t.Error("session should exist on second creation")
	}
	if session != session2 {
		t.Error("should return same session instance")
	}
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

func TestSessionStore_DeleteSession(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	session, _, _ := store.GetOrCreateSession("key1", "cookie", "workflow", OperationExec)

	// Verify done channel is open
	select {
	case <-session.Done():
		t.Error("done channel should not be closed yet")
	default:
	}

	store.DeleteSession("key1")

	// Verify done channel is closed
	select {
	case <-session.Done():
		// Expected
	case <-time.After(100 * time.Millisecond):
		t.Error("done channel should be closed after deletion")
	}

	// Session should be gone
	_, err := store.GetSession("key1")
	requireCode(t, err, codes.NotFound)

	// Multiple deletes should be safe
	store.DeleteSession("key1")
	store.DeleteSession("key1")
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
	store.DeleteSession("key1")

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

func TestSessionStore_DoubleDeleteRace(t *testing.T) {
	t.Parallel()
	store := setupTestSessionStore(0)

	for i := range 100 {
		key := fmt.Sprintf("race-session-%d", i)
		store.GetOrCreateSession(key, "cookie", "workflow", OperationExec)

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			store.DeleteSession(key)
		}()
		go func() {
			defer wg.Done()
			store.DeleteSession(key)
		}()
		wg.Wait()

		// Verify session is deleted
		_, err := store.GetSession(key)
		if err == nil {
			t.Errorf("session %s should be deleted", key)
		}
	}
}

// Helper to create a TunnelMessage with data payload
func tunnelDataMsg(data []byte) *pb.TunnelMessage {
	return &pb.TunnelMessage{
		Message: &pb.TunnelMessage_Data{
			Data: &pb.TunnelData{Payload: data},
		},
	}
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
	if string(msg.GetData().Payload) != "hello" {
		t.Errorf("expected 'hello', got '%s'", string(msg.GetData().Payload))
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

func TestPipe_TrySend(t *testing.T) {
	t.Parallel()
	pipe := newPipe(30 * time.Second)

	// TrySend on unbuffered channel with no receiver should fail
	if pipe.TrySend(tunnelDataMsg([]byte("test"))) {
		t.Error("TrySend should fail with no receiver on unbuffered channel")
	}

	// TrySend with receiver waiting should succeed
	done := make(chan struct{})
	go func() {
		pipe.Receive(context.Background())
		close(done)
	}()

	time.Sleep(50 * time.Millisecond)
	if !pipe.TrySend(tunnelDataMsg([]byte("test"))) {
		t.Error("TrySend should succeed with receiver waiting")
	}
	<-done

	// TrySend to closed pipe should fail
	pipe.Close()
	if pipe.TrySend(tunnelDataMsg([]byte("test"))) {
		t.Error("TrySend to closed pipe should fail")
	}
}
