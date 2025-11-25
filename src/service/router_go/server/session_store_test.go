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
)

const defaultTestTimeout = 60 * time.Second

func newTestStore(t *testing.T, timeout time.Duration) *SessionStore {
	t.Helper()
	if timeout == 0 {
		timeout = defaultTestTimeout
	}
	return NewSessionStore(SessionStoreConfig{
		RendezvousTimeout: timeout,
	}, nil)
}

func mustCreateSession(t *testing.T, store *SessionStore, key string) *Session {
	t.Helper()
	session, _, err := store.CreateSession(key, "cookie-"+key, key+"-workflow", OperationExec)
	if err != nil {
		t.Fatalf("CreateSession(%s) failed: %v", key, err)
	}
	return session
}

func waitAsync(t *testing.T, store *SessionStore, session *Session, isClient bool, ctx context.Context) <-chan error {
	t.Helper()
	if ctx == nil {
		ctx = context.Background()
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- store.WaitForRendezvous(ctx, session, isClient)
	}()
	return errCh
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

func TestSessionStore_CreateSession(t *testing.T) {
	store := newTestStore(t, defaultTestTimeout)

	session, existed, err := store.CreateSession("test-key", "test-cookie", "workflow-123", OperationExec)
	requireCode(t, err, codes.OK)

	if existed {
		t.Error("Session should not exist on first creation")
	}

	if session.Key != "test-key" {
		t.Errorf("Expected key 'test-key', got '%s'", session.Key)
	}

	// Try creating again - should get same session
	session2, existed2, err := store.CreateSession("test-key", "test-cookie", "workflow-123", OperationExec)
	requireCode(t, err, codes.OK)

	if !existed2 {
		t.Error("Session should exist on second creation")
	}

	if session != session2 {
		t.Error("Should return same session instance")
	}
}

func TestSessionStore_RendezvousTimeout(t *testing.T) {
	store := newTestStore(t, 100*time.Millisecond)
	session := mustCreateSession(t, store, "timeout")

	ctx := context.Background()
	err := store.WaitForRendezvous(ctx, session, true)
	requireCode(t, err, codes.DeadlineExceeded)
}

func TestSessionStore_SuccessfulRendezvous(t *testing.T) {
	store := newTestStore(t, 5*time.Second)
	session := mustCreateSession(t, store, "success")

	client := waitAsync(t, store, session, true, nil)
	time.Sleep(50 * time.Millisecond)
	agent := waitAsync(t, store, session, false, nil)

	requireCode(t, <-client, codes.OK)
	requireCode(t, <-agent, codes.OK)
}

func TestSessionStore_ActiveCount(t *testing.T) {
	store := newTestStore(t, 0)

	if count := store.ActiveCount(); count != 0 {
		t.Errorf("Expected 0 active sessions, got %d", count)
	}

	mustCreateSession(t, store, "key1")
	mustCreateSession(t, store, "key2")

	if count := store.ActiveCount(); count != 2 {
		t.Errorf("Expected 2 active sessions, got %d", count)
	}

	store.DeleteSession("key1")

	if count := store.ActiveCount(); count != 1 {
		t.Errorf("Expected 1 active session after delete, got %d", count)
	}
}

// Additional comprehensive tests

func TestSessionStore_DeleteNonExistent(t *testing.T) {
	store := newTestStore(t, 0)

	store.CreateSession("test-key", "test-cookie", "test-workflow", OperationExec)
	store.DeleteSession("test-key")

	_, err := store.GetSession("test-key")
	requireCode(t, err, codes.NotFound)
}

func TestSessionStore_RendezvousAgentFirst(t *testing.T) {
	store := newTestStore(t, 2*time.Second)
	session := mustCreateSession(t, store, "agent-first")

	agent := waitAsync(t, store, session, false, nil)
	time.Sleep(50 * time.Millisecond)
	client := waitAsync(t, store, session, true, nil)

	requireCode(t, <-agent, codes.OK)
	requireCode(t, <-client, codes.OK)
}

func TestSessionStore_ReceiveWithContext(t *testing.T) {
	store := newTestStore(t, 0)
	session := mustCreateSession(t, store, "receive-data")

	go func() {
		time.Sleep(100 * time.Millisecond)
		_ = session.ClientToAgent.Send(context.Background(), &SessionMessage{Data: []byte("test data")})
	}()

	msg, err := session.ClientToAgent.Receive(context.Background())
	requireCode(t, err, codes.OK)
	if string(msg.Data) != "test data" {
		t.Errorf("Expected 'test data', got '%s'", string(msg.Data))
	}
}

func TestSessionStore_ReceiveWithClosedChannel(t *testing.T) {
	store := newTestStore(t, 0)
	session := mustCreateSession(t, store, "closed-channel")

	session.ClientToAgent.CloseWriter()

	_, err := session.ClientToAgent.Receive(context.Background())
	if !errors.Is(err, errPipeClosed) {
		t.Errorf("Expected errPipeClosed, got %v", err)
	}
}

func TestSessionStore_ReceiveWithCanceledContext(t *testing.T) {
	store := newTestStore(t, 0)
	session := mustCreateSession(t, store, "cancel-context")

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := session.ClientToAgent.Receive(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("Expected canceled error, got %v", err)
	}
}

func TestSessionStore_ConcurrentOperations(t *testing.T) {
	store := newTestStore(t, 0)

	numSessions := 50
	var wg sync.WaitGroup

	for i := 0; i < numSessions; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			key := fmt.Sprintf("session-%02d", id)
			if _, _, err := store.CreateSession(key, "cookie", "workflow", OperationExec); err != nil {
				t.Errorf("Failed to create session %d: %v", id, err)
			}
		}(i)
	}

	wg.Wait()

	count := 0
	store.sessions.Range(func(key, value any) bool {
		count++
		return true
	})

	if count != numSessions {
		t.Errorf("Expected %d sessions, got %d", numSessions, count)
	}
}

// TestSessionStore_RendezvousContextCancellation tests CASE 4: Client crashes during rendezvous wait
// This simulates a client that connects, starts waiting for agent, then context is cancelled (connection dies)
func TestSessionStore_RendezvousContextCancellation(t *testing.T) {
	store := newTestStore(t, 0)
	session := mustCreateSession(t, store, "cancelled-client")

	ctx, cancel := context.WithCancel(context.Background())

	client := waitAsync(t, store, session, true, ctx)
	time.Sleep(100 * time.Millisecond)
	cancel()

	requireCode(t, <-client, codes.Canceled)

	store.DeleteSession(session.Key)

	_, err := store.GetSession(session.Key)
	requireCode(t, err, codes.NotFound)
}

// TestSessionStore_DoubleDeleteRace tests CASE 8: Both client and agent try to delete simultaneously
// This verifies the atomic deletion flag prevents race conditions
func TestSessionStore_DoubleDeleteRace(t *testing.T) {
	store := newTestStore(t, 0)

	for iteration := range 100 {
		sessionKey := fmt.Sprintf("race-test-%02d", iteration)
		store.CreateSession(sessionKey, "cookie", "workflow", OperationExec)

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			store.DeleteSession(sessionKey)
		}()
		go func() {
			defer wg.Done()
			store.DeleteSession(sessionKey)
		}()
		wg.Wait()

		if _, err := store.GetSession(sessionKey); err == nil {
			t.Errorf("Session %s should be deleted", sessionKey)
		}
	}
}

// TestSessionStore_SessionDoneChannelClose tests that Done channel closes properly on deletion
// This is important for cleanup signaling
func TestSessionStore_SessionDoneChannelClose(t *testing.T) {
	store := newTestStore(t, 0)
	session := mustCreateSession(t, store, "done-close")

	select {
	case <-session.Done:
		t.Error("Done channel should not be closed yet")
	default:
	}

	store.DeleteSession(session.Key)

	select {
	case <-session.Done:
	case <-time.After(500 * time.Millisecond):
		t.Error("Done channel should be closed after deletion")
	}

	// Multiple deletes should be safe (idempotent)
	store.DeleteSession(session.Key)
	store.DeleteSession(session.Key)
}

// TestSessionStore_DuplicateClientConnection tests that only one client can connect
// This prevents multiple clients from connecting to the same session
func TestSessionStore_DuplicateClientConnection(t *testing.T) {
	store := newTestStore(t, time.Second)
	session := mustCreateSession(t, store, "dup-client")

	if err := store.WaitForRendezvous(context.Background(), session, true); err != nil && status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("unexpected first client error: %v", err)
	}

	requireCode(t, store.WaitForRendezvous(context.Background(), session, true), codes.AlreadyExists)
}

// TestSessionStore_DuplicateAgentConnection tests that only one agent can connect
// This prevents multiple agents from connecting to the same session
func TestSessionStore_DuplicateAgentConnection(t *testing.T) {
	store := newTestStore(t, time.Second)
	session := mustCreateSession(t, store, "dup-agent")

	if err := store.WaitForRendezvous(context.Background(), session, false); err != nil && status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("unexpected first agent error: %v", err)
	}

	requireCode(t, store.WaitForRendezvous(context.Background(), session, false), codes.AlreadyExists)
}
