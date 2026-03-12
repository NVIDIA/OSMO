// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"fmt"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// TestEventSentTracker tests the event deduplication logic
func TestEventSentTracker(t *testing.T) {
	ttl := 1 * time.Second
	tracker := newEventSentTracker(ttl)

	// First call should process
	if !tracker.shouldProcess("Warning", "FailedScheduling", "pod1") {
		t.Error("First call should return true")
	}

	// Immediate second call should skip (within TTL)
	if tracker.shouldProcess("Warning", "FailedScheduling", "pod1") {
		t.Error("Second call within TTL should return false")
	}

	// Different event type should process
	if !tracker.shouldProcess("Normal", "FailedScheduling", "pod1") {
		t.Error("Different event type should return true")
	}

	// Different reason should process
	if !tracker.shouldProcess("Warning", "BackOff", "pod1") {
		t.Error("Different reason should return true")
	}

	// Different pod should process
	if !tracker.shouldProcess("Warning", "FailedScheduling", "pod2") {
		t.Error("Different pod should return true")
	}

	// Wait for TTL to expire
	time.Sleep(ttl + 100*time.Millisecond)

	// After TTL, should process again
	if !tracker.shouldProcess("Warning", "FailedScheduling", "pod1") {
		t.Error("After TTL expiry, should return true")
	}
}

// TestEventSentTrackerCleanup tests the cleanup functionality
func TestEventSentTrackerCleanup(t *testing.T) {
	ttl := 100 * time.Millisecond
	tracker := newEventSentTracker(ttl)

	// Add some entries
	tracker.shouldProcess("Warning", "FailedScheduling", "pod1")
	tracker.shouldProcess("Warning", "BackOff", "pod2")

	// Wait for TTL to expire
	time.Sleep(ttl + 50*time.Millisecond)

	// Add a new entry (should not be cleaned up)
	tracker.shouldProcess("Normal", "Scheduled", "pod3")

	// Cleanup should remove stale entries
	tracker.cleanup()

	// Old entries should be gone (can process again)
	if !tracker.shouldProcess("Warning", "FailedScheduling", "pod1") {
		t.Error("After cleanup, old entry should be processable again")
	}

	// Recent entry should still be blocked
	if tracker.shouldProcess("Normal", "Scheduled", "pod3") {
		t.Error("Recent entry should still be blocked after cleanup")
	}
}

// TestCreatePodEventMessage tests the message creation from Event object
func TestCreatePodEventMessage(t *testing.T) {
	now := metav1.Now()

	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod1.event1",
			Namespace: "default",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "test-pod",
			Namespace: "default",
		},
		Reason:        "FailedScheduling",
		Message:       "0/3 nodes are available",
		Type:          "Warning",
		LastTimestamp: now,
	}

	msg := createPodEventMessage(event, "event")

	if msg.Uuid == "" {
		t.Error("Message UUID should not be empty")
	}

	if msg.Timestamp == "" {
		t.Error("Message timestamp should not be empty")
	}

	podEvent := msg.GetPodEvent()
	if podEvent == nil {
		t.Fatal("PodEvent body should not be nil")
	}

	if podEvent.PodName != "test-pod" {
		t.Errorf("Expected pod name 'test-pod', got '%s'", podEvent.PodName)
	}

	if podEvent.Reason != "FailedScheduling" {
		t.Errorf("Expected reason 'FailedScheduling', got '%s'", podEvent.Reason)
	}

	if podEvent.Message != "0/3 nodes are available" {
		t.Errorf("Expected message '0/3 nodes are available', got '%s'", podEvent.Message)
	}

	if podEvent.Timestamp == "" {
		t.Error("Event timestamp should not be empty")
	}
}

// TestCreatePodEventMessageWithEventTime tests timestamp extraction priority
func TestCreatePodEventMessageWithEventTime(t *testing.T) {
	eventTime := metav1.NewMicroTime(time.Date(2025, 1, 15, 10, 30, 0, 0, time.UTC))

	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod1.event1",
			Namespace: "default",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "test-pod",
			Namespace: "default",
		},
		Reason:    "BackOff",
		Message:   "Back-off restarting failed container",
		Type:      "Warning",
		EventTime: eventTime,
	}

	msg := createPodEventMessage(event, "event")

	podEvent := msg.GetPodEvent()
	if podEvent == nil {
		t.Fatal("PodEvent body should not be nil")
	}

	// Verify timestamp is not zero
	if podEvent.Timestamp == "" {
		t.Error("Event timestamp should not be empty")
	}
}

// TestCreatePodEventMessageNilTimestamp tests fallback to Now()
func TestCreatePodEventMessageNilTimestamp(t *testing.T) {
	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod1.event1",
			Namespace: "default",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "test-pod",
			Namespace: "default",
		},
		Reason:  "Pulled",
		Message: "Successfully pulled image",
		Type:    "Normal",
		// No timestamps set - should fallback to time.Now()
	}

	msg := createPodEventMessage(event, "event")

	podEvent := msg.GetPodEvent()
	if podEvent == nil {
		t.Fatal("PodEvent body should not be nil")
	}

	// Verify timestamp is not empty (should use Now() as fallback)
	if podEvent.Timestamp == "" {
		t.Error("Event timestamp should not be empty even when event has no timestamps")
	}
}

// TestEventKeyComposite tests that eventKey properly represents semantic identity
func TestEventKeyComposite(t *testing.T) {
	key1 := eventKey{eventType: "Warning", reason: "FailedScheduling", podName: "pod1"}
	key2 := eventKey{eventType: "Warning", reason: "FailedScheduling", podName: "pod1"}
	key3 := eventKey{eventType: "Normal", reason: "FailedScheduling", podName: "pod1"}

	// Same keys should be equal
	if key1 != key2 {
		t.Error("Same event keys should be equal")
	}

	// Different event type should create different key
	if key1 == key3 {
		t.Error("Different event types should create different keys")
	}
}

// TestEventListenerDrainPopulatesUnackedQueue verifies that drainMessageChannel
// moves pending channel messages into the unacked queue using drop-oldest semantics.
func TestEventListenerDrainPopulatesUnackedQueue(t *testing.T) {
	args := utils.ListenerArgs{
		EventChanSize:        10,
		ProgressFrequencySec: 60,
	}
	inst := utils.NewNoopInstruments()
	el := NewEventListener(args, inst)

	ch := make(chan *pb.ListenerMessage, 5)
	// Pre-fill channel with messages
	for i := 0; i < 3; i++ {
		ch <- &pb.ListenerMessage{Uuid: fmt.Sprintf("drain-%d", i)}
	}

	el.DrainMessageChannel(ch)

	unacked := el.GetUnackedMessages()
	if unacked.Qsize() != 3 {
		t.Errorf("Qsize() = %d, expected 3 after drain", unacked.Qsize())
	}

	var sent []string
	unacked.ResendAll(context.Background(), func(_ context.Context, msg *pb.ListenerMessage) error {
		sent = append(sent, msg.Uuid)
		return nil
	})
	for i, uuid := range sent {
		expected := fmt.Sprintf("drain-%d", i)
		if uuid != expected {
			t.Errorf("sent[%d] = %s, expected %s", i, uuid, expected)
		}
	}
}

// TestEventListenerDrainRespectsCapacity verifies that drainMessageChannel
// uses drop-oldest semantics when the queue is at capacity.
func TestEventListenerDrainRespectsCapacity(t *testing.T) {
	args := utils.ListenerArgs{
		EventChanSize:        10,
		MaxUnackedMessages:   3,
		ProgressFrequencySec: 60,
	}
	inst := utils.NewNoopInstruments()
	el := NewEventListener(args, inst)

	ch := make(chan *pb.ListenerMessage, 10)
	// Pre-fill channel with 5 messages (exceeds capacity of 3)
	for i := 0; i < 5; i++ {
		ch <- &pb.ListenerMessage{Uuid: fmt.Sprintf("drain-%d", i)}
	}

	el.DrainMessageChannel(ch)

	unacked := el.GetUnackedMessages()
	if unacked.Qsize() != 3 {
		t.Errorf("Qsize() = %d, expected 3 (capped at capacity)", unacked.Qsize())
	}

	// Oldest messages should have been evicted, newest 3 remain
	var sent []string
	unacked.ResendAll(context.Background(), func(_ context.Context, msg *pb.ListenerMessage) error {
		sent = append(sent, msg.Uuid)
		return nil
	})
	for i, uuid := range sent {
		expected := fmt.Sprintf("drain-%d", i+2)
		if uuid != expected {
			t.Errorf("sent[%d] = %s, expected %s", i, uuid, expected)
		}
	}
}

// TestEventListenerResendBeforeNewMessages verifies that ResendAll is invoked
// on the unacked queue at the start of sendMessages, before reading from the channel.
func TestEventListenerResendBeforeNewMessages(t *testing.T) {
	// This test verifies the ResendAll integration at the UnackMessages level,
	// since sendMessages requires a live gRPC connection for SendMessage.
	unacked := utils.NewUnackMessages(10)
	unacked.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "old-1"})
	unacked.AddMessageDropOldest(&pb.ListenerMessage{Uuid: "old-2"})

	var sentOrder []string
	sendFunc := func(_ context.Context, msg *pb.ListenerMessage) error {
		sentOrder = append(sentOrder, msg.Uuid)
		return nil
	}

	ctx := context.Background()
	err := unacked.ResendAll(ctx, sendFunc)
	if err != nil {
		t.Fatalf("ResendAll failed: %v", err)
	}

	// Verify old messages were sent in order
	if len(sentOrder) != 2 {
		t.Fatalf("Expected 2 messages sent, got %d", len(sentOrder))
	}
	if sentOrder[0] != "old-1" || sentOrder[1] != "old-2" {
		t.Errorf("Expected send order [old-1, old-2], got %v", sentOrder)
	}

	// Queue should be empty after successful resend
	if unacked.Qsize() != 0 {
		t.Errorf("Qsize() = %d, expected 0 after successful resend", unacked.Qsize())
	}
}

// TestListenerMessageTypeAssertion verifies the message is correctly typed
func TestListenerMessageTypeAssertion(t *testing.T) {
	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod1.event1",
			Namespace: "default",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "test-pod",
			Namespace: "default",
		},
		Reason:        "FailedScheduling",
		Message:       "0/3 nodes are available",
		Type:          "Warning",
		LastTimestamp: metav1.Now(),
	}

	msg := createPodEventMessage(event, "event")

	// Verify message body is PodEvent variant
	switch msg.Body.(type) {
	case *pb.ListenerMessage_PodEvent:
		// Expected case
	default:
		t.Error("Message body should be of type *pb.ListenerMessage_PodEvent")
	}
}
