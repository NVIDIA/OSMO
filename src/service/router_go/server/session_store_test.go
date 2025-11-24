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
		TTL:                30 * time.Minute,
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
		TTL:                30 * time.Minute,
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
		TTL:                30 * time.Minute,
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
		TTL:                30 * time.Minute,
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  2, // Small buffer for testing
		FlowControlTimeout: 100 * time.Millisecond,
	}, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "workflow-123", OperationExec)
	ctx := context.Background()

	// Fill the buffer
	for i := 0; i < 2; i++ {
		if err := store.SendWithFlowControl(ctx, session.ClientToAgent, []byte("data"), "test-key"); err != nil {
			t.Errorf("Send %d failed: %v", i, err)
		}
	}

	// Next send should timeout (buffer is full and no consumer)
	err := store.SendWithFlowControl(ctx, session.ClientToAgent, []byte("data"), "test-key")
	if err == nil {
		t.Error("Expected flow control timeout")
	}

	if status.Code(err) != codes.ResourceExhausted {
		t.Errorf("Expected ResourceExhausted, got %v", status.Code(err))
	}
}

func TestSessionStore_ActiveCount(t *testing.T) {
	store := NewSessionStore(SessionStoreConfig{
		TTL:                30 * time.Minute,
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
		TTL:                5 * time.Minute,
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
		TTL:                5 * time.Minute,
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
		TTL:                5 * time.Minute,
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", "exec")

	// Send data
	go func() {
		time.Sleep(100 * time.Millisecond)
		session.ClientToAgent <- []byte("test data")
	}()

	// Receive data
	ctx := context.Background()
	data, err := store.ReceiveWithContext(ctx, session.ClientToAgent, "test-key")
	if err != nil {
		t.Fatalf("Receive failed: %v", err)
	}
	if string(data) != "test data" {
		t.Errorf("Expected 'test data', got '%s'", string(data))
	}
}

func TestSessionStore_ReceiveWithClosedChannel(t *testing.T) {
	config := SessionStoreConfig{
		TTL:                5 * time.Minute,
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
	_, err := store.ReceiveWithContext(ctx, session.ClientToAgent, "test-key")
	if err == nil {
		t.Error("Expected error for closed channel, got nil")
	}
}

func TestSessionStore_ReceiveWithCanceledContext(t *testing.T) {
	config := SessionStoreConfig{
		TTL:                5 * time.Minute,
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
	_, err := store.ReceiveWithContext(ctx, session.ClientToAgent, "test-key")
	if err == nil {
		t.Error("Expected error for canceled context, got nil")
	}
}

func TestSessionStore_LastActivityUpdate(t *testing.T) {
	config := SessionStoreConfig{
		TTL:                5 * time.Minute,
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	session, _, _ := store.CreateSession("test-key", "test-cookie", "test-workflow", "exec")

	initialActivity := session.LastActivity()
	time.Sleep(100 * time.Millisecond)

	// Send should update last activity
	ctx := context.Background()
	store.SendWithFlowControl(ctx, session.ClientToAgent, []byte("data"), "test-key")

	// Drain the channel
	<-session.ClientToAgent

	if !session.LastActivity().After(initialActivity) {
		t.Error("LastActivity was not updated after send")
	}
}

func TestSessionStore_ConcurrentOperations(t *testing.T) {
	config := SessionStoreConfig{
		TTL:                5 * time.Minute,
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	// Create multiple sessions concurrently
	numSessions := 50
	done := make(chan bool, numSessions)

	for i := 0; i < numSessions; i++ {
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
	for i := 0; i < numSessions; i++ {
		<-done
	}

	// Verify all sessions exist
	count := 0
	store.sessions.Range(func(key, value interface{}) bool {
		count++
		return true
	})

	if count != numSessions {
		t.Errorf("Expected %d sessions, got %d", numSessions, count)
	}
}

func TestSessionStore_CleanupExpiredSessions(t *testing.T) {
	config := SessionStoreConfig{
		TTL:                500 * time.Millisecond, // Short TTL for testing
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
		CleanupInterval:    200 * time.Millisecond, // Fast cleanup for testing
	}
	store := NewSessionStore(config, nil)

	// Create some sessions
	store.CreateSession("session-1", "cookie", "workflow-1", OperationExec)
	store.CreateSession("session-2", "cookie", "workflow-2", OperationExec)
	store.CreateSession("session-3", "cookie", "workflow-3", OperationExec)

	if count := store.ActiveCount(); count != 3 {
		t.Fatalf("Expected 3 sessions, got %d", count)
	}

	// Start cleanup loop
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go store.CleanupExpiredSessions(ctx)

	// Wait for sessions to expire (TTL 500ms) + cleanup interval (200ms) + buffer
	time.Sleep(900 * time.Millisecond)

	// All sessions should be cleaned up
	if count := store.ActiveCount(); count != 0 {
		t.Errorf("Expected 0 sessions after cleanup, got %d", count)
	}
}

func TestSessionStore_CleanupPreservesActiveSessions(t *testing.T) {
	config := SessionStoreConfig{
		TTL:                600 * time.Millisecond,
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
		CleanupInterval:    200 * time.Millisecond, // Fast cleanup for testing
	}
	store := NewSessionStore(config, nil)

	// Create sessions
	store.CreateSession("session-1", "cookie", "workflow-1", OperationExec)
	store.CreateSession("session-2", "cookie", "workflow-2", OperationExec)

	// Start cleanup loop
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go store.CleanupExpiredSessions(ctx)

	// Keep updating activity for session-1
	stopKeepAlive := make(chan bool)
	go func() {
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopKeepAlive:
				return
			case <-ticker.C:
				store.UpdateActivity("session-1")
			}
		}
	}()

	// Wait longer than TTL for session-2 to expire, but session-1 stays active
	time.Sleep(1 * time.Second)
	close(stopKeepAlive)

	// session-1 should still exist (active), session-2 should be gone (expired)
	_, err1 := store.GetSession("session-1")
	_, err2 := store.GetSession("session-2")

	if err1 != nil {
		t.Error("session-1 should still exist (was kept active)")
	}

	if err2 == nil {
		t.Error("session-2 should be cleaned up (expired)")
	} else if status.Code(err2) != codes.NotFound {
		t.Errorf("Expected NotFound for session-2, got %v", status.Code(err2))
	}
}

func TestSessionStore_CleanupContextCancellation(t *testing.T) {
	config := SessionStoreConfig{
		TTL:                1 * time.Hour, // Long TTL so cleanup doesn't naturally occur
		RendezvousTimeout:  60 * time.Second,
		FlowControlBuffer:  16,
		FlowControlTimeout: 30 * time.Second,
	}
	store := NewSessionStore(config, nil)

	// Create a session
	store.CreateSession("session-1", "cookie", "workflow-1", OperationExec)

	// Start cleanup loop
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan bool)
	go func() {
		store.CleanupExpiredSessions(ctx)
		done <- true
	}()

	// Cancel context after a short delay
	time.Sleep(100 * time.Millisecond)
	cancel()

	// Cleanup should exit promptly
	select {
	case <-done:
		// Success - cleanup loop exited
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Cleanup loop did not exit after context cancellation")
	}

	// Session should still exist (wasn't expired)
	if count := store.ActiveCount(); count != 1 {
		t.Errorf("Expected 1 session after cleanup cancellation, got %d", count)
	}
}
