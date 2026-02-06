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
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
	"go.corp.nvidia.com/osmo/utils/metrics"
)

// EventListener manages the bidirectional gRPC stream connection for Kubernetes events
type EventListener struct {
	*utils.BaseListener
	args utils.ListenerArgs
}

// NewEventListener creates a new event listener instance
func NewEventListener(args utils.ListenerArgs) *EventListener {
	return &EventListener{
		BaseListener: utils.NewBaseListener(args, "last_progress_event_listener"),
		args:         args,
	}
}

// Run manages the bidirectional streaming lifecycle
func (el *EventListener) Run(ctx context.Context) error {
	return el.BaseListener.Run(
		ctx,
		"Connected to operator service, event stream established",
		el.sendMessages,
		"event",
	)
}

// eventKey represents semantic event identity (not object identity)
type eventKey struct {
	eventType string // "Warning", "Normal"
	reason    string // "FailedScheduling", "BackOff", etc.
	podName   string // Pod name from InvolvedObject
}

// eventSentTracker tracks Events we've already processed
type eventSentTracker struct {
	mu   sync.RWMutex
	sent map[eventKey]time.Time // key -> last sent timestamp
	ttl  time.Duration           // TTL for resends (e.g., 15 minutes)
}

// newEventSentTracker creates a new event sent tracker
func newEventSentTracker(ttl time.Duration) *eventSentTracker {
	return &eventSentTracker{
		sent: make(map[eventKey]time.Time),
		ttl:  ttl,
	}
}

// ShouldProcess checks if an event should be processed (not recently sent)
func (t *eventSentTracker) ShouldProcess(eventType, reason, podName string) bool {
	key := eventKey{eventType, reason, podName}
	now := time.Now()

	t.mu.Lock()
	defer t.mu.Unlock()

	if lastSent, exists := t.sent[key]; exists {
		if now.Sub(lastSent) < t.ttl {
			return false // Recently sent, skip
		}
	}

	t.sent[key] = now
	return true
}

// Cleanup removes stale entries (call periodically, e.g., every hour)
func (t *eventSentTracker) Cleanup() {
	t.mu.Lock()
	defer t.mu.Unlock()
	cutoff := time.Now().Add(-t.ttl)
	for k, v := range t.sent {
		if v.Before(cutoff) {
			delete(t.sent, k)
		}
	}
}

// sendMessages consumes event updates from a channel and sends them to the server
func (el *EventListener) sendMessages(ctx context.Context, cancel context.CancelCauseFunc) {
	// Capture done channel once for performance
	done := ctx.Done()

	// Create a channel to receive event updates from the watcher
	eventChan := make(chan *corev1.Event, el.args.EventChanSize)

	// Create a channel to signal if watchEvents exits unexpectedly
	watcherDone := make(chan struct{})

	// Start event watcher in a separate goroutine
	el.AddToWaitGroup(1)
	go func() {
		defer el.WaitGroupDone()
		defer close(watcherDone)
		defer close(eventChan)
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Panic in watchEvents goroutine: %v", r)
				cancel(fmt.Errorf("panic in event watcher: %v", r))
			}
		}()
		watchEvents(ctx, el.args, eventChan)
	}()

	// Ticker to report progress when idle
	progressTicker := time.NewTicker(time.Duration(el.args.ProgressFrequencySec) * time.Second)
	defer progressTicker.Stop()

	// Send event updates to the server
	for {
		select {
		case <-done:
			log.Println("Stopping message sender")
			return
		case <-watcherDone:
			// Check if this was due to context cancellation (expected) vs unexpected stop
			if ctx.Err() != nil {
				log.Println("Event watcher stopped due to context cancellation")
				return
			}
			log.Println("Event watcher stopped unexpectedly")
			cancel(fmt.Errorf("event watcher stopped"))
			return
		case <-progressTicker.C:
			// Report progress periodically even when idle
			progressWriter := el.GetProgressWriter()
			if progressWriter != nil {
				if err := progressWriter.ReportProgress(); err != nil {
					log.Printf("Warning: failed to report progress: %v", err)
				}
			}
		case event := <-eventChan:
			if err := el.sendEventMessage(ctx, event); err != nil {
				cancel(fmt.Errorf("failed to send message: %w", err))
				return
			}
		}
	}
}

// sendEventMessage sends a single event message
func (el *EventListener) sendEventMessage(ctx context.Context, event *corev1.Event) error {
	msg, err := createPodEventMessage(event)
	if err != nil {
		log.Printf("Failed to create pod event message: %v", err)
		return nil // Don't fail the stream for one message
	}

	unackedMessages := el.GetUnackedMessages()

	// Add message to unacked queue before sending
	if err := unackedMessages.AddMessage(ctx, msg); err != nil {
		log.Printf("Failed to add message to unacked queue: %v", err)
		return nil // Don't fail the stream
	}

	// Record backend_listener_queue_event_count metric
	if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
		metricCreator.RecordCounter(
			ctx,
			"backend_listener_queue_event_count",
			1,
			"count",
			"Number of messages queued for transmission to service",
			map[string]string{"type": "pod_event"},
		)
	}

	if err := el.GetStream().Send(msg); err != nil {
		return err
	}

	// Record backend_message_transmission_count metric
	if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
		metricCreator.RecordCounter(
			ctx,
			"backend_message_transmission_count",
			1,
			"count",
			"Number of messages successfully transmitted to service",
			map[string]string{"type": "pod_event"},
		)
	}

	return nil
}

// watchEvents watches for Kubernetes events and sends them to a channel
func watchEvents(
	ctx context.Context,
	args utils.ListenerArgs,
	eventChan chan<- *corev1.Event,
) {
	// Create Kubernetes client
	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		log.Printf("Failed to create kubernetes client: %v", err)
		return
	}

	log.Printf("Starting event watcher for namespace: %s", args.Namespace)

	// Event sent tracker to avoid sending duplicate events
	tracker := newEventSentTracker(time.Duration(args.EventCacheTTLMin) * time.Minute)

	// Start periodic cleanup goroutine for the tracker
	cleanupTicker := time.NewTicker(1 * time.Hour)
	defer cleanupTicker.Stop()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-cleanupTicker.C:
				tracker.Cleanup()
				log.Println("Event tracker cleanup completed")
			}
		}
	}()

	// Create informer factory for the specific namespace
	eventInformerFactory := informers.NewSharedInformerFactoryWithOptions(
		clientset,
		0, // No automatic resync
		informers.WithNamespace(args.Namespace),
	)

	// Get event informer
	eventInformer := eventInformerFactory.Core().V1().Events().Informer()

	// Helper function to handle event updates
	handleEventUpdate := func(event *corev1.Event) {
		// Record kb_event_watch_count metric
		if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
			metricCreator.RecordCounter(
				ctx,
				"kb_event_watch_count",
				1,
				"count",
				"Number of Kubernetes events received from informer watches",
				map[string]string{"type": "event"},
			)
		}

		// Only process Pod events
		if event.InvolvedObject.Kind != "Pod" {
			return
		}

		// Check if we should process this event (deduplication)
		if !tracker.ShouldProcess(event.Type, event.Reason, event.InvolvedObject.Name) {
			return
		}

		select {
		case eventChan <- event:
		case <-ctx.Done():
			return
		}
	}

	_, err = eventInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			event := obj.(*corev1.Event)
			handleEventUpdate(event)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			event := newObj.(*corev1.Event)
			handleEventUpdate(event)
		},
	})
	if err != nil {
		log.Printf("Failed to add event handler: %v", err)
		return
	}

	// Set watch error handler
	eventInformer.SetWatchErrorHandler(func(r *cache.Reflector, err error) {
		log.Printf("Event watch error: %v", err)

		// Record event_watch_connection_error_count metric
		if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
			metricCreator.RecordCounter(
				ctx,
				"event_watch_connection_error_count",
				1,
				"count",
				"Count of connection errors when watching Kubernetes resources",
				map[string]string{"type": "event"},
			)
		}
	})

	// Start the informer
	eventInformerFactory.Start(ctx.Done())

	// Wait for cache sync
	log.Println("Waiting for event informer cache to sync...")
	if !cache.WaitForCacheSync(ctx.Done(), eventInformer.HasSynced) {
		log.Println("Failed to sync event informer cache")
		return
	}
	log.Println("Event informer cache synced successfully")

	// Keep the watcher running
	<-ctx.Done()
	log.Println("Event watcher stopped")
}

// createPodEventMessage creates a ListenerMessage from an Event object
func createPodEventMessage(event *corev1.Event) (*pb.ListenerMessage, error) {
	// Extract timestamp (priority: LastTimestamp > EventTime > Now)
	var timestamp time.Time
	if !event.LastTimestamp.IsZero() {
		timestamp = event.LastTimestamp.Time
	} else if !event.EventTime.IsZero() {
		timestamp = event.EventTime.Time
	} else {
		timestamp = time.Now()
	}

	// Build pod event structure using proto-generated type
	podEvent := &pb.PodEventBody{
		PodName:   event.InvolvedObject.Name,
		Reason:    event.Reason,
		Message:   event.Message,
		Timestamp: timestamp.UTC().Format("2006-01-02T15:04:05.999999"),
	}

	// Generate random UUID (matching Python's uuid.uuid4().hex format)
	messageUUID := strings.ReplaceAll(uuid.New().String(), "-", "")

	msg := &pb.ListenerMessage{
		Uuid:      messageUUID,
		Timestamp: time.Now().UTC().Format("2006-01-02T15:04:05.999999"),
		Body: &pb.ListenerMessage_PodEvent{
			PodEvent: podEvent,
		},
	}

	log.Printf(
		"Sent pod_event: (pod=%s, reason=%s, type=%s)",
		event.InvolvedObject.Name, event.Reason, event.Type,
	)

	return msg, nil
}
