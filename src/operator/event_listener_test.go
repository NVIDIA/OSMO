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
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// TestEventSentTracker tests the event deduplication logic
func TestEventSentTracker(t *testing.T) {
	ttl := 1 * time.Second
	tracker := newEventSentTracker(ttl)

	// First call should process
	if !tracker.ShouldProcess("Warning", "FailedScheduling", "pod1") {
		t.Error("First call should return true")
	}

	// Immediate second call should skip (within TTL)
	if tracker.ShouldProcess("Warning", "FailedScheduling", "pod1") {
		t.Error("Second call within TTL should return false")
	}

	// Different event type should process
	if !tracker.ShouldProcess("Normal", "FailedScheduling", "pod1") {
		t.Error("Different event type should return true")
	}

	// Different reason should process
	if !tracker.ShouldProcess("Warning", "BackOff", "pod1") {
		t.Error("Different reason should return true")
	}

	// Different pod should process
	if !tracker.ShouldProcess("Warning", "FailedScheduling", "pod2") {
		t.Error("Different pod should return true")
	}

	// Wait for TTL to expire
	time.Sleep(ttl + 100*time.Millisecond)

	// After TTL, should process again
	if !tracker.ShouldProcess("Warning", "FailedScheduling", "pod1") {
		t.Error("After TTL expiry, should return true")
	}
}

// TestEventSentTrackerCleanup tests the cleanup functionality
func TestEventSentTrackerCleanup(t *testing.T) {
	ttl := 100 * time.Millisecond
	tracker := newEventSentTracker(ttl)

	// Add some entries
	tracker.ShouldProcess("Warning", "FailedScheduling", "pod1")
	tracker.ShouldProcess("Warning", "BackOff", "pod2")

	// Wait for TTL to expire
	time.Sleep(ttl + 50*time.Millisecond)

	// Add a new entry (should not be cleaned up)
	tracker.ShouldProcess("Normal", "Scheduled", "pod3")

	// Cleanup should remove stale entries
	tracker.Cleanup()

	// Old entries should be gone (can process again)
	if !tracker.ShouldProcess("Warning", "FailedScheduling", "pod1") {
		t.Error("After cleanup, old entry should be processable again")
	}

	// Recent entry should still be blocked
	if tracker.ShouldProcess("Normal", "Scheduled", "pod3") {
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

	msg, err := createPodEventMessage(event)
	if err != nil {
		t.Fatalf("Failed to create message: %v", err)
	}

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

	msg, err := createPodEventMessage(event)
	if err != nil {
		t.Fatalf("Failed to create message: %v", err)
	}

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

	msg, err := createPodEventMessage(event)
	if err != nil {
		t.Fatalf("Failed to create message: %v", err)
	}

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

	msg, err := createPodEventMessage(event)
	if err != nil {
		t.Fatalf("Failed to create message: %v", err)
	}

	// Verify message body is PodEvent variant
	switch msg.Body.(type) {
	case *pb.ListenerMessage_PodEvent:
		// Expected case
	default:
		t.Error("Message body should be of type *pb.ListenerMessage_PodEvent")
	}
}
