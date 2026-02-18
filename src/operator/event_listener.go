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

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// EventListener manages the bidirectional gRPC stream connection for Kubernetes events
type EventListener struct {
	*utils.BaseListener
	args utils.ListenerArgs
	inst *utils.Instruments

	// Pre-computed attribute sets (constant label values)
	attrListener  metric.MeasurementOption // {listener: "event"}
	attrTypeEvent metric.MeasurementOption // {type: "event"}
}

// NewEventListener creates a new event listener instance
func NewEventListener(args utils.ListenerArgs, inst *utils.Instruments) *EventListener {
	el := &EventListener{
		BaseListener: utils.NewBaseListener(
			args, "last_progress_event_listener", utils.StreamNameEvent, inst),
		args: args,
		inst: inst,
	}
	el.attrListener = metric.WithAttributeSet(attribute.NewSet(attribute.String("listener", "event")))
	el.attrTypeEvent = metric.WithAttributeSet(attribute.NewSet(attribute.String("type", "event")))
	return el
}

// Run manages the bidirectional streaming lifecycle
func (el *EventListener) Run(ctx context.Context) error {
	ch := make(chan *pb.ListenerMessage, el.args.EventChanSize)
	return el.BaseListener.Run(
		ctx,
		"Connected to the service, event listener stream established",
		ch,
		el.watchEvents,
		el.sendMessages,
	)
}

// sendMessages reads from the channel and sends messages to the server.
func (el *EventListener) sendMessages(
	ctx context.Context,
	cancel context.CancelCauseFunc,
	ch <-chan *pb.ListenerMessage,
) {
	log.Printf("Starting message sender for event channel")
	defer log.Printf("Stopping event message sender")

	progressTicker := time.NewTicker(time.Duration(el.args.ProgressFrequencySec) * time.Second)
	defer progressTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-progressTicker.C:
			progressWriter := el.GetProgressWriter()
			if progressWriter != nil {
				if err := progressWriter.ReportProgress(); err != nil {
					log.Printf("Warning: failed to report progress: %v", err)
				}
			}
		case msg, ok := <-ch:
			if !ok {
				if ctx.Err() != nil {
					log.Println("Event watcher stopped due to context cancellation")
					return
				}
				log.Println("Event watcher stopped unexpectedly")
				el.inst.MessageChannelClosedUnexpectedly.Add(ctx, 1, el.attrListener)
				cancel(fmt.Errorf("event watcher stopped"))
				return
			}
			if err := el.BaseListener.SendMessage(ctx, msg); err != nil {
				cancel(fmt.Errorf("failed to send message: %w", err))
				return
			}
		}
	}
}

// watchEvents watches for Kubernetes events and sends them to a channel
func (el *EventListener) watchEvents(
	ctx context.Context,
	cancel context.CancelCauseFunc,
	ch chan<- *pb.ListenerMessage,
) {
	// Event sent tracker to avoid sending duplicate events
	tracker := newEventSentTracker(time.Duration(el.args.EventCacheTTLMin) * time.Minute)

	// Start periodic cleanup goroutine for the tracker
	cleanupTicker := time.NewTicker(1 * time.Hour)
	defer cleanupTicker.Stop()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-cleanupTicker.C:
				tracker.cleanup()
				// Record event_tracker_size after cleanup
				tracker.mu.RLock()
				size := len(tracker.sent)
				tracker.mu.RUnlock()
				el.inst.EventTrackerSize.Record(ctx, float64(size))
				log.Println("Event tracker cleanup completed")
			}
		}
	}()

	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		log.Printf("Failed to create kubernetes client: %v", err)
		el.inst.KubernetesClientCreationErrorTotal.Add(ctx, 1, el.attrListener)
		return
	}

	// Create informer factory for the specific namespace
	eventInformerFactory := informers.NewSharedInformerFactoryWithOptions(
		clientset,
		0, // No automatic resync
		informers.WithNamespace(el.args.Namespace),
	)

	// Get event informer
	eventInformer := eventInformerFactory.Core().V1().Events().Informer()

	// Helper function to handle event updates
	handleEventUpdate := func(event *corev1.Event) {
		el.inst.KBEventWatchCount.Add(ctx, 1, el.attrTypeEvent)

		// Only process Pod events
		if event.InvolvedObject.Kind != "Pod" {
			return
		}

		// Check if we should process this event (deduplication)
		if !tracker.shouldProcess(event.Type, event.Reason, event.InvolvedObject.Name) {
			el.inst.EventDeduplicatedTotal.Add(ctx, 1)
			return
		}

		msg := createPodEventMessage(event)
		select {
		case ch <- msg:
			el.inst.MessageQueuedTotal.Add(ctx, 1, el.attrListener)
			el.inst.MessageChannelPending.Record(ctx, float64(len(ch)), el.attrListener)
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
		el.inst.EventWatchConnectionErrorCount.Add(ctx, 1, el.attrTypeEvent)
	})

	// Start the informer
	eventInformerFactory.Start(ctx.Done())
	log.Printf("Starting event informer for namespace: %s", el.args.Namespace)

	// Wait for cache sync
	if !cache.WaitForCacheSync(ctx.Done(), eventInformer.HasSynced) {
		log.Println("Failed to sync event informer cache")
		el.inst.InformerCacheSyncFailure.Add(ctx, 1, el.attrListener)
		return
	}
	log.Println("Event informer cache synced successfully")
	el.inst.InformerCacheSyncSuccess.Add(ctx, 1, el.attrListener)

	// Keep the watcher running
	<-ctx.Done()
	log.Println("Event watcher stopped")
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
	ttl  time.Duration          // TTL for resends (e.g., 15 minutes)
}

// newEventSentTracker creates a new event sent tracker
func newEventSentTracker(ttl time.Duration) *eventSentTracker {
	return &eventSentTracker{
		sent: make(map[eventKey]time.Time),
		ttl:  ttl,
	}
}

// shouldProcess checks if an event should be processed (not recently sent)
func (t *eventSentTracker) shouldProcess(eventType, reason, podName string) bool {
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

// cleanup removes stale entries (call periodically, e.g., every hour)
func (t *eventSentTracker) cleanup() {
	t.mu.Lock()
	defer t.mu.Unlock()
	cutoff := time.Now().Add(-t.ttl)
	for k, v := range t.sent {
		if v.Before(cutoff) {
			delete(t.sent, k)
		}
	}
}

// createPodEventMessage creates a ListenerMessage from an Event object
func createPodEventMessage(event *corev1.Event) *pb.ListenerMessage {
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

	return msg
}
