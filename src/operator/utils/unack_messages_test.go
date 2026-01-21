/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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

package utils

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// Mock MessageSender for testing
type mockMessageSender struct {
	messages []*pb.ListenerMessage
	mu       sync.Mutex
	failNext bool
}

func (m *mockMessageSender) Send(msg *pb.ListenerMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.failNext {
		m.failNext = false
		return fmt.Errorf("mock send error")
	}

	m.messages = append(m.messages, msg)
	return nil
}

func (m *mockMessageSender) GetMessages() []*pb.ListenerMessage {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]*pb.ListenerMessage{}, m.messages...)
}

func (m *mockMessageSender) SetFailNext(fail bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.failNext = fail
}

func TestNewUnackMessages(t *testing.T) {
	tests := []struct {
		name     string
		maxSize  int
		expected int
	}{
		{"Positive max", 100, 100},
		{"Zero max (unlimited)", 0, 0},
		{"Negative max (converted to 0)", -5, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			um := NewUnackMessages(tt.maxSize)
			if um.maxUnackedMessages != tt.expected {
				t.Errorf("maxUnackedMessages = %v, expected %v", um.maxUnackedMessages, tt.expected)
			}
			if um.Qsize() != 0 {
				t.Errorf("Initial queue size should be 0, got %d", um.Qsize())
			}
		})
	}
}

func TestUnackMessages_AddAndRemove(t *testing.T) {
	um := NewUnackMessages(10)
	ctx := context.Background()

	msg1 := &pb.ListenerMessage{Uuid: "msg-1"}
	msg2 := &pb.ListenerMessage{Uuid: "msg-2"}

	// Add messages
	err := um.AddMessage(ctx, msg1)
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}

	err = um.AddMessage(ctx, msg2)
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}

	if um.Qsize() != 2 {
		t.Errorf("Qsize() = %d, expected 2", um.Qsize())
	}

	// Remove message
	um.RemoveMessage("msg-1")
	if um.Qsize() != 1 {
		t.Errorf("Qsize() after remove = %d, expected 1", um.Qsize())
	}

	// Remove non-existent message (should not error)
	um.RemoveMessage("non-existent")
	if um.Qsize() != 1 {
		t.Errorf("Qsize() after removing non-existent = %d, expected 1", um.Qsize())
	}

	// Remove remaining message
	um.RemoveMessage("msg-2")
	if um.Qsize() != 0 {
		t.Errorf("Qsize() after removing all = %d, expected 0", um.Qsize())
	}
}

func TestUnackMessages_AddMessageForced(t *testing.T) {
	um := NewUnackMessages(2)
	ctx := context.Background()

	// Fill to capacity
	um.AddMessage(ctx, &pb.ListenerMessage{Uuid: "msg-1"})
	um.AddMessage(ctx, &pb.ListenerMessage{Uuid: "msg-2"})

	// Try to add normally (should block if we didn't use forced)
	// Instead use forced to bypass limit
	um.AddMessageForced(&pb.ListenerMessage{Uuid: "msg-3"})

	if um.Qsize() != 3 {
		t.Errorf("Qsize() = %d, expected 3", um.Qsize())
	}
}

func TestUnackMessages_ListMessages(t *testing.T) {
	um := NewUnackMessages(10)
	ctx := context.Background()

	msg1 := &pb.ListenerMessage{Uuid: "msg-1"}
	msg2 := &pb.ListenerMessage{Uuid: "msg-2"}
	msg3 := &pb.ListenerMessage{Uuid: "msg-3"}

	um.AddMessage(ctx, msg1)
	um.AddMessage(ctx, msg2)
	um.AddMessage(ctx, msg3)

	messages := um.ListMessages()
	if len(messages) != 3 {
		t.Errorf("len(ListMessages()) = %d, expected 3", len(messages))
	}

	// Check that all UUIDs are present
	uuids := make(map[string]bool)
	for _, msg := range messages {
		uuids[msg.Uuid] = true
	}

	if !uuids["msg-1"] || !uuids["msg-2"] || !uuids["msg-3"] {
		t.Error("Not all messages found in ListMessages()")
	}
}

func TestUnackMessages_FlowControl(t *testing.T) {
	um := NewUnackMessages(2)
	ctx := context.Background()

	// Add up to limit
	err := um.AddMessage(ctx, &pb.ListenerMessage{Uuid: "msg-1"})
	if err != nil {
		t.Fatalf("First AddMessage failed: %v", err)
	}

	err = um.AddMessage(ctx, &pb.ListenerMessage{Uuid: "msg-2"})
	if err != nil {
		t.Fatalf("Second AddMessage failed: %v", err)
	}

	// Try to add one more - should block
	ctx2, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()

	err = um.AddMessage(ctx2, &pb.ListenerMessage{Uuid: "msg-3"})
	if err == nil {
		t.Error("Expected context timeout error when exceeding limit")
	}

	// Remove one message to unblock
	um.RemoveMessage("msg-1")

	// Now we should be able to add
	err = um.AddMessage(context.Background(), &pb.ListenerMessage{Uuid: "msg-3"})
	if err != nil {
		t.Errorf("AddMessage after remove failed: %v", err)
	}
}

func TestUnackMessages_ResendAll(t *testing.T) {
	um := NewUnackMessages(10)
	ctx := context.Background()

	msg1 := &pb.ListenerMessage{Uuid: "msg-1"}
	msg2 := &pb.ListenerMessage{Uuid: "msg-2"}
	msg3 := &pb.ListenerMessage{Uuid: "msg-3"}

	um.AddMessage(ctx, msg1)
	um.AddMessage(ctx, msg2)
	um.AddMessage(ctx, msg3)

	// Create mock sender
	sender := &mockMessageSender{}

	// Resend all
	err := um.ResendAll(sender)
	if err != nil {
		t.Fatalf("ResendAll failed: %v", err)
	}

	// Check that all messages were sent
	sentMessages := sender.GetMessages()
	if len(sentMessages) != 3 {
		t.Errorf("len(sentMessages) = %d, expected 3", len(sentMessages))
	}
}

func TestUnackMessages_ResendAll_Error(t *testing.T) {
	um := NewUnackMessages(10)
	ctx := context.Background()

	msg1 := &pb.ListenerMessage{Uuid: "msg-1"}
	um.AddMessage(ctx, msg1)

	// Create mock sender that fails
	sender := &mockMessageSender{}
	sender.SetFailNext(true)

	// Resend should fail
	err := um.ResendAll(sender)
	if err == nil {
		t.Error("Expected error from ResendAll when sender fails")
	}
}

func TestUnackMessages_ResendAll_Empty(t *testing.T) {
	um := NewUnackMessages(10)

	// Create mock sender
	sender := &mockMessageSender{}

	// Resend with no messages
	err := um.ResendAll(sender)
	if err != nil {
		t.Errorf("ResendAll on empty queue failed: %v", err)
	}

	// No messages should be sent
	sentMessages := sender.GetMessages()
	if len(sentMessages) != 0 {
		t.Errorf("len(sentMessages) = %d, expected 0", len(sentMessages))
	}
}

func TestUnackMessages_Concurrent(t *testing.T) {
	um := NewUnackMessages(100)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	numGoroutines := 20 // Reduced to avoid overwhelming the system
	messagesPerRoutine := 10

	var wg sync.WaitGroup
	var addedCount, removedCount int64

	// Add messages concurrently
	wg.Add(numGoroutines)
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			for j := 0; j < messagesPerRoutine; j++ {
				msg := &pb.ListenerMessage{
					Uuid: fmt.Sprintf("msg-%d-%d", id, j),
				}
				if err := um.AddMessage(ctx, msg); err == nil {
					atomic.AddInt64(&addedCount, 1)
				}
			}
		}(i)
	}

	// Remove messages concurrently - remove whatever actually exists
	wg.Add(numGoroutines)
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			for j := 0; j < messagesPerRoutine; j++ {
				// Keep trying until we successfully remove or context times out
				for {
					select {
					case <-ctx.Done():
						return
					default:
					}

					messages := um.ListMessages()
					if len(messages) > 0 {
						um.RemoveMessage(messages[0].Uuid)
						atomic.AddInt64(&removedCount, 1)
						break
					}
					// No messages available, wait a bit
					time.Sleep(time.Millisecond)
				}
			}
		}(i)
	}

	wg.Wait()

	// Check that we added and removed messages successfully
	t.Logf("Added: %d, Removed: %d, Final queue size: %d", addedCount, removedCount, um.Qsize())

	// Final queue size should be small (most removes should have succeeded)
	finalSize := um.Qsize()
	if finalSize > messagesPerRoutine*numGoroutines/2 {
		t.Errorf("Unexpected queue size after concurrent ops: %d (added: %d, removed: %d)", finalSize, addedCount, removedCount)
	}
}

func TestUnackMessages_UnlimitedCapacity(t *testing.T) {
	um := NewUnackMessages(0) // 0 means unlimited
	ctx := context.Background()

	// Add many messages
	for i := 0; i < 1000; i++ {
		msg := &pb.ListenerMessage{Uuid: fmt.Sprintf("msg-%d", i)}
		err := um.AddMessage(ctx, msg)
		if err != nil {
			t.Fatalf("AddMessage failed at %d: %v", i, err)
		}
	}

	if um.Qsize() != 1000 {
		t.Errorf("Qsize() = %d, expected 1000", um.Qsize())
	}
}

func TestUnackMessages_ContextCancellation(t *testing.T) {
	um := NewUnackMessages(1)
	ctx := context.Background()

	// Fill to capacity
	um.AddMessage(ctx, &pb.ListenerMessage{Uuid: "msg-1"})

	// Create cancelled context
	ctx2, cancel := context.WithCancel(context.Background())
	cancel()

	// Try to add with cancelled context
	err := um.AddMessage(ctx2, &pb.ListenerMessage{Uuid: "msg-2"})
	if err == nil {
		t.Error("Expected error when adding with cancelled context")
	}
	if err != context.Canceled {
		t.Errorf("Expected context.Canceled error, got %v", err)
	}
}

// Benchmark tests
func BenchmarkUnackMessages_AddMessage(b *testing.B) {
	um := NewUnackMessages(0) // Unlimited
	ctx := context.Background()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		msg := &pb.ListenerMessage{Uuid: fmt.Sprintf("msg-%d", i)}
		um.AddMessage(ctx, msg)
	}
}

func BenchmarkUnackMessages_RemoveMessage(b *testing.B) {
	um := NewUnackMessages(0)
	ctx := context.Background()

	// Pre-populate
	for i := 0; i < b.N; i++ {
		msg := &pb.ListenerMessage{Uuid: fmt.Sprintf("msg-%d", i)}
		um.AddMessage(ctx, msg)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		um.RemoveMessage(fmt.Sprintf("msg-%d", i))
	}
}

func BenchmarkUnackMessages_ListMessages(b *testing.B) {
	um := NewUnackMessages(0)
	ctx := context.Background()

	// Add 100 messages
	for i := 0; i < 100; i++ {
		msg := &pb.ListenerMessage{Uuid: fmt.Sprintf("msg-%d", i)}
		um.AddMessage(ctx, msg)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		um.ListMessages()
	}
}

func BenchmarkUnackMessages_Qsize(b *testing.B) {
	um := NewUnackMessages(0)
	ctx := context.Background()

	// Add some messages
	for i := 0; i < 50; i++ {
		msg := &pb.ListenerMessage{Uuid: fmt.Sprintf("msg-%d", i)}
		um.AddMessage(ctx, msg)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		um.Qsize()
	}
}
