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
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestSessionStore_CreateSession(t *testing.T) {
	store := NewSessionStore(SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}, nil)

	session, existed, err := store.CreateSession("test-key", "test-cookie", "workflow-123", OperationExec)
	if err != nil {
		t.Fatalf("CreateSession failed: %v", err)
	}

	if existed {
		t.Error("Session should not exist on first creation")
	}

	if session.Key != "test-key" {
		t.Errorf("Expected key 'test-key', got '%s'", session.Key)
	}

	// Try creating again - should get same session
	session2, existed2, err := store.CreateSession("test-key", "test-cookie", "workflow-123", OperationExec)
	if err != nil {
		t.Fatalf("Second CreateSession failed: %v", err)
	}

	if !existed2 {
		t.Error("Session should exist on second creation")
	}

	if session != session2 {
		t.Error("Should return same session instance")
	}
}

func TestSessionStore_RendezvousTimeout(t *testing.T) {
	store := NewSessionStore(SessionStoreConfig{
		RendezvousTimeout:  100 * time.Millisecond,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "workflow-123", OperationExec)

	ctx := context.Background()
	err := store.WaitForRendezvous(ctx, session, true)

	if err == nil {
		t.Error("Expected timeout error")
	}

	if status.Code(err) != codes.DeadlineExceeded {
		t.Errorf("Expected DeadlineExceeded, got %v", status.Code(err))
	}
}

func TestSessionStore_SuccessfulRendezvous(t *testing.T) {
	store := NewSessionStore(SessionStoreConfig{
		RendezvousTimeout:  5 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "workflow-123", OperationExec)

	errChan := make(chan error, 2)

	// Client waits
	go func() {
		ctx := context.Background()
		errChan <- store.WaitForRendezvous(ctx, session, true)
	}()

	// Agent connects shortly after
	go func() {
		time.Sleep(100 * time.Millisecond)
		ctx := context.Background()
		errChan <- store.WaitForRendezvous(ctx, session, false)
	}()

	// Both should succeed
	for i := 0; i < 2; i++ {
		if err := <-errChan; err != nil {
			t.Errorf("Rendezvous failed: %v", err)
		}
	}
}

func TestSessionStore_FlowControl(t *testing.T) {
	store := NewSessionStore(SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  2, // Small buffer for testing
		FlowControlTimeout: 100 * time.Millisecond,
	}, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "workflow-123", OperationExec)
	ctx := context.Background()

	// Fill the buffer
	for i := 0; i < 2; i++ {
		msg := &SessionMessage{Data: []byte("data")}
		if err := store.SendWithFlowControl(ctx, session.ClientToAgent, msg); err != nil {
			t.Errorf("Send %d failed: %v", i, err)
		}
	}

	// Next send should timeout (buffer is full and no consumer)
	msg := &SessionMessage{Data: []byte("data")}
	err := store.SendWithFlowControl(ctx, session.ClientToAgent, msg)
	if err == nil {
		t.Error("Expected flow control timeout")
	}

	if status.Code(err) != codes.ResourceExhausted {
		t.Errorf("Expected ResourceExhausted, got %v", status.Code(err))
	}
}

func TestSessionStore_ActiveCount(t *testing.T) {
	store := NewSessionStore(SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}, nil)

	if count := store.ActiveCount(); count != 0 {
		t.Errorf("Expected 0 active sessions, got %d", count)
	}

	store.CreateSession("key1", "cookie", "wf1", OperationExec)
	store.CreateSession("key2", "cookie", "wf2", OperationExec)

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
	config := SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	// Create and delete
	store.CreateSession("test-key", "test-cookie", "test-workflow", "exec")
	store.DeleteSession("test-key")

	// Should not exist
	_, err := store.GetSession("test-key")
	if err == nil {
		t.Error("Expected error for deleted session, got nil")
	}
	if status.Code(err) != codes.NotFound {
		t.Errorf("Expected NotFound error, got %v", status.Code(err))
	}
}

func TestSessionStore_RendezvousAgentFirst(t *testing.T) {
	config := SessionStoreConfig{
		RendezvousTimeout:  2 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", "exec")

	ctx := context.Background()

	// Agent arrives first
	errChan := make(chan error, 1)
	go func() {
		errChan <- store.WaitForRendezvous(ctx, session, false)
	}()

	// Give agent time to start waiting
	time.Sleep(100 * time.Millisecond)

	// Client arrives second
	err := store.WaitForRendezvous(ctx, session, true)
	if err != nil {
		t.Errorf("Client rendezvous failed: %v", err)
	}

	// Check agent succeeded
	agentErr := <-errChan
	if agentErr != nil {
		t.Errorf("Agent rendezvous failed: %v", agentErr)
	}
}

func TestSessionStore_ReceiveWithContext(t *testing.T) {
	config := SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", "exec")

	// Send data
	go func() {
		time.Sleep(100 * time.Millisecond)
		session.ClientToAgent <- &SessionMessage{Data: []byte("test data")}
	}()

	// Receive data
	ctx := context.Background()
	msg, err := store.ReceiveWithContext(ctx, session.ClientToAgent)
	if err != nil {
		t.Fatalf("Receive failed: %v", err)
	}
	if string(msg.Data) != "test data" {
		t.Errorf("Expected 'test data', got '%s'", string(msg.Data))
	}
}

func TestSessionStore_ReceiveWithClosedChannel(t *testing.T) {
	config := SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", "exec")

	// Close channel
	close(session.ClientToAgent)

	// Receive should return error
	ctx := context.Background()
	_, err := store.ReceiveWithContext(ctx, session.ClientToAgent)
	if err == nil {
		t.Error("Expected error for closed channel, got nil")
	}
}

func TestSessionStore_ReceiveWithCanceledContext(t *testing.T) {
	config := SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", "exec")

	// Cancel context immediately
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// Receive should return error
	_, err := store.ReceiveWithContext(ctx, session.ClientToAgent)
	if err == nil {
		t.Error("Expected error for canceled context, got nil")
	}
}

func TestSessionStore_SendReceiveWithFlowControl(t *testing.T) {
	config := SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", "exec")

	// Test send with flow control
	ctx := context.Background()
	msg := &SessionMessage{Data: []byte("test-data")}
	err := store.SendWithFlowControl(ctx, session.ClientToAgent, msg)
	if err != nil {
		t.Errorf("SendWithFlowControl failed: %v", err)
	}

	// Drain the channel
	receivedMsg := <-session.ClientToAgent
	if string(receivedMsg.Data) != "test-data" {
		t.Errorf("Expected 'test-data', got '%s'", string(receivedMsg.Data))
	}
}

func TestSessionStore_ConcurrentOperations(t *testing.T) {
	config := SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	// Create multiple sessions concurrently
	numSessions := 50
	done := make(chan bool, numSessions)

	for i := range numSessions {
		go func(id int) {
			key := "session-" + string(rune('a'+id%26)) + string(rune('0'+id/26))
			_, _, err := store.CreateSession(key, "cookie", "workflow", OperationExec)
			if err != nil {
				t.Errorf("Failed to create session %d: %v", id, err)
			}
			done <- true
		}(i)
	}

	// Wait for all to complete
	for range numSessions {
		<-done
	}

	// Verify all sessions exist
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
	config := SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", OperationExec)

	// Create a cancellable context
	ctx, cancel := context.WithCancel(context.Background())

	// Start waiting for rendezvous
	errChan := make(chan error, 1)
	go func() {
		errChan <- store.WaitForRendezvous(ctx, session, true)
	}()

	// Cancel context after short delay (simulates connection drop)
	time.Sleep(100 * time.Millisecond)
	cancel()

	// Should return context cancelled error
	err := <-errChan
	if err == nil {
		t.Error("Expected error when context cancelled")
	}

	if status.Code(err) != codes.Canceled {
		t.Errorf("Expected Canceled error, got %v (error: %v)", status.Code(err), err)
	}

	// In real code, defer DeleteSession() would execute here
	store.DeleteSession("test-key")

	// Verify session is gone
	_, err = store.GetSession("test-key")
	if status.Code(err) != codes.NotFound {
		t.Errorf("Expected session to be deleted, got %v", err)
	}
}

// TestSessionStore_DoubleDeleteRace tests CASE 8: Both client and agent try to delete simultaneously
// This verifies the atomic deletion flag prevents race conditions
func TestSessionStore_DoubleDeleteRace(t *testing.T) {
	config := SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	// Run many iterations to increase chance of race
	for iteration := range 100 {
		sessionKey := "race-test-" + string(rune('a'+iteration%26)) + string(rune('0'+iteration/26))
		store.CreateSession(sessionKey, "cookie", "workflow", OperationExec)

		// Simulate both client and agent trying to delete simultaneously
		done := make(chan bool, 2)
		go func() {
			store.DeleteSession(sessionKey)
			done <- true
		}()
		go func() {
			store.DeleteSession(sessionKey)
			done <- true
		}()

		// Wait for both to complete
		<-done
		<-done

		// Verify session is gone (and no panic occurred)
		_, err := store.GetSession(sessionKey)
		if err == nil {
			t.Errorf("Session %s should be deleted", sessionKey)
		}
	}
}

// TestSessionStore_SessionDoneChannelClose tests that Done channel closes properly on deletion
// This is important for cleanup signaling
func TestSessionStore_SessionDoneChannelClose(t *testing.T) {
	config := SessionStoreConfig{
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", OperationExec)

	// Verify Done channel is open
	select {
	case <-session.Done:
		t.Error("Done channel should not be closed yet")
	default:
		// Good - channel is open
	}

	// Delete session
	store.DeleteSession("test-key")

	// Verify Done channel is closed
	select {
	case <-session.Done:
		// Good - channel is closed
	case <-time.After(100 * time.Millisecond):
		t.Error("Done channel should be closed after deletion")
	}

	// Multiple deletes should be safe (idempotent)
	store.DeleteSession("test-key")
	store.DeleteSession("test-key")
}

// TestSessionStore_DuplicateClientConnection tests that only one client can connect
// This prevents multiple clients from connecting to the same session
func TestSessionStore_DuplicateClientConnection(t *testing.T) {
	config := SessionStoreConfig{
		RendezvousTimeout:  1 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", OperationExec)

	ctx := context.Background()

	// First client connects
	err1 := store.WaitForRendezvous(ctx, session, true)
	if err1 != nil && status.Code(err1) != codes.DeadlineExceeded {
		// It's ok if it times out waiting for agent
		t.Logf("First client got: %v", err1)
	}

	// Second client tries to connect - should fail with AlreadyExists
	err2 := store.WaitForRendezvous(ctx, session, true)
	if err2 == nil {
		t.Error("Expected error for duplicate client connection")
	}
	if status.Code(err2) != codes.AlreadyExists {
		t.Errorf("Expected AlreadyExists for duplicate client, got %v", status.Code(err2))
	}
}

// TestSessionStore_DuplicateAgentConnection tests that only one agent can connect
// This prevents multiple agents from connecting to the same session
func TestSessionStore_DuplicateAgentConnection(t *testing.T) {
	config := SessionStoreConfig{
		RendezvousTimeout:  1 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", OperationExec)

	ctx := context.Background()

	// First agent connects
	err1 := store.WaitForRendezvous(ctx, session, false)
	if err1 != nil && status.Code(err1) != codes.DeadlineExceeded {
		// It's ok if it times out waiting for client
		t.Logf("First agent got: %v", err1)
	}

	// Second agent tries to connect - should fail with AlreadyExists
	err2 := store.WaitForRendezvous(ctx, session, false)
	if err2 == nil {
		t.Error("Expected error for duplicate agent connection")
	}
	if status.Code(err2) != codes.AlreadyExists {
		t.Errorf("Expected AlreadyExists for duplicate agent, got %v", status.Code(err2))
	}
}
