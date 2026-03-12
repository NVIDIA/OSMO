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
	"testing"

	pb "go.corp.nvidia.com/osmo/proto/operator"
)

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

func TestAddMessageDropOldest_Basic(t *testing.T) {
	um := NewUnackMessages(3)

	um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "msg-1"})
	um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "msg-2"})
	um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "msg-3"})

	// Add one more — should evict msg-1
	um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "msg-4"})

	if um.Qsize() != 3 {
		t.Errorf("Qsize() = %d, expected 3", um.Qsize())
	}

	// Verify contents via ResendAll
	var sent []string
	um.ResendAll(context.Background(), func(_ context.Context, msg *pb.ListenerMessage) error {
		sent = append(sent, msg.Uuid)
		return nil
	})

	if len(sent) != 3 {
		t.Fatalf("len(sent) = %d, expected 3", len(sent))
	}
	if sent[0] != "msg-2" {
		t.Errorf("Expected oldest to be msg-2 after eviction, got %s", sent[0])
	}
	if sent[2] != "msg-4" {
		t.Errorf("Expected newest to be msg-4, got %s", sent[2])
	}
}

func TestAddMessageDropOldest_OrderPreserved(t *testing.T) {
	um := NewUnackMessages(10)

	for i := 0; i < 5; i++ {
		um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: fmt.Sprintf("msg-%d", i)})
	}

	// Verify order via ResendAll
	var sent []string
	um.ResendAll(context.Background(), func(_ context.Context, msg *pb.ListenerMessage) error {
		sent = append(sent, msg.Uuid)
		return nil
	})

	if len(sent) != 5 {
		t.Fatalf("len(sent) = %d, expected 5", len(sent))
	}

	for i, uuid := range sent {
		expected := fmt.Sprintf("msg-%d", i)
		if uuid != expected {
			t.Errorf("sent[%d] = %s, expected %s", i, uuid, expected)
		}
	}
}

func TestResendAll_Success(t *testing.T) {
	um := NewUnackMessages(10)
	ctx := context.Background()

	um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "msg-1"})
	um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "msg-2"})
	um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "msg-3"})

	var sent []*pb.ListenerMessage
	sendFunc := func(_ context.Context, msg *pb.ListenerMessage) error {
		sent = append(sent, msg)
		return nil
	}

	err := um.ResendAll(ctx, sendFunc)
	if err != nil {
		t.Fatalf("ResendAll failed: %v", err)
	}

	if len(sent) != 3 {
		t.Errorf("len(sent) = %d, expected 3", len(sent))
	}
	if um.Qsize() != 0 {
		t.Errorf("Qsize() = %d, expected 0 after successful resend", um.Qsize())
	}
}

func TestResendAll_PartialFailure(t *testing.T) {
	um := NewUnackMessages(10)
	ctx := context.Background()

	um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "msg-1"})
	um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "msg-2"})
	um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "msg-3"})

	callCount := 0
	sendFunc := func(_ context.Context, msg *pb.ListenerMessage) error {
		callCount++
		if callCount == 2 {
			return fmt.Errorf("send error on second message")
		}
		return nil
	}

	err := um.ResendAll(ctx, sendFunc)
	if err == nil {
		t.Fatal("Expected error from ResendAll on partial failure")
	}

	// msg-1 was sent successfully, msg-2 failed — msg-2 and msg-3 should remain
	if um.Qsize() != 2 {
		t.Errorf("Qsize() = %d, expected 2 after partial failure", um.Qsize())
	}

	// Verify remaining messages via a second ResendAll
	var remaining []string
	um.ResendAll(ctx, func(_ context.Context, msg *pb.ListenerMessage) error {
		remaining = append(remaining, msg.Uuid)
		return nil
	})

	if len(remaining) != 2 {
		t.Fatalf("len(remaining) = %d, expected 2", len(remaining))
	}
	if remaining[0] != "msg-2" {
		t.Errorf("Expected first remaining message to be msg-2, got %s", remaining[0])
	}
	if remaining[1] != "msg-3" {
		t.Errorf("Expected second remaining message to be msg-3, got %s", remaining[1])
	}
}

func TestResendAll_Empty(t *testing.T) {
	um := NewUnackMessages(10)
	ctx := context.Background()

	callCount := 0
	sendFunc := func(_ context.Context, msg *pb.ListenerMessage) error {
		callCount++
		return nil
	}

	err := um.ResendAll(ctx, sendFunc)
	if err != nil {
		t.Errorf("ResendAll on empty queue failed: %v", err)
	}
	if callCount != 0 {
		t.Errorf("callCount = %d, expected 0 (callback should not be called)", callCount)
	}
}

func BenchmarkUnackMessages_Qsize(b *testing.B) {
	um := NewUnackMessages(0)

	for i := 0; i < 50; i++ {
		um.AddMessageDropOldest(&pb.ListenerMessage{Uuid: fmt.Sprintf("msg-%d", i)})
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		um.Qsize()
	}
}
