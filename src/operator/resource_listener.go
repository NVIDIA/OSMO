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
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// ResourceListener manages the bidirectional gRPC stream for pod resource usage
type ResourceListener struct {
	*utils.BaseListener
	args       utils.ListenerArgs
	aggregator *utils.NodeUsageAggregator
}

// NewResourceListener creates a new resource listener instance
func NewResourceListener(args utils.ListenerArgs) *ResourceListener {
	return &ResourceListener{
		BaseListener: utils.NewBaseListener(args, "last_progress_resource_listener"),
		args:         args,
		aggregator:   utils.NewNodeUsageAggregator(args.Namespace),
	}
}

// Run manages the bidirectional streaming lifecycle
func (rl *ResourceListener) Run(ctx context.Context) error {
	return rl.BaseListener.Run(
		ctx,
		"Connected to operator service, resource stream established",
		rl.sendMessages,
		"resource",
	)
}

// sendMessages starts the pod informer and sends resource usage events
func (rl *ResourceListener) sendMessages(ctx context.Context, cancel context.CancelCauseFunc) {
	usageChan := make(chan *pb.ListenerMessage, rl.args.UsageChanSize)

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(usageChan)
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Panic in watchPods goroutine: %v", r)
				cancel(fmt.Errorf("panic in pod watcher: %v", r))
			}
		}()
		rl.watchPods(ctx, cancel, usageChan)
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Panic in sendFromChannels goroutine: %v", r)
				cancel(fmt.Errorf("panic in message sender: %v", r))
			}
		}()
		rl.sendFromChannels(usageChan, ctx, cancel)
	}()

	wg.Wait()
	log.Println("Resource listener goroutines stopped")
}

// sendFromChannels sends messages from usage channel to the server
func (rl *ResourceListener) sendFromChannels(
	usageChan <-chan *pb.ListenerMessage,
	ctx context.Context,
	cancel context.CancelCauseFunc,
) {
	log.Printf("Starting message sender for usage channel")
	defer log.Printf("Stopping usage message sender")

	done := ctx.Done()
	progressTicker := time.NewTicker(
		time.Duration(rl.args.ProgressFrequencySec) * time.Second)
	defer progressTicker.Stop()

	for {
		select {
		case <-done:
			return
		case <-progressTicker.C:
			progressWriter := rl.GetProgressWriter()
			if progressWriter != nil {
				if err := progressWriter.ReportProgress(); err != nil {
					log.Printf("Warning: failed to report progress: %v", err)
				}
			}
		case msg, ok := <-usageChan:
			if !ok {
				if ctx.Err() != nil {
					log.Printf("usage watcher stopped due to context cancellation")
					return
				}
				log.Printf("usage watcher stopped unexpectedly...")
				cancel(fmt.Errorf("usage watcher stopped"))
				return
			}
			if err := rl.sendResourceMessage(ctx, msg); err != nil {
				cancel(fmt.Errorf("failed to send UpdateNodeUsageBody message: %w", err))
				return
			}
		}
	}
}

// sendResourceMessage sends a single resource message
func (rl *ResourceListener) sendResourceMessage(ctx context.Context, msg *pb.ListenerMessage) error {
	// Add message to unacked queue before sending
	if err := rl.GetUnackedMessages().AddMessage(ctx, msg); err != nil {
		log.Printf("Failed to add message to unacked queue: %v", err)
		return nil // Don't fail the stream
	}

	if err := rl.GetStream().Send(msg); err != nil {
		return err
	}

	return nil
}

// watchPods starts pod informer and handles resource aggregation
// This function focuses on pod events and resource usage messages
func (rl *ResourceListener) watchPods(ctx context.Context, cancel context.CancelCauseFunc, usageChan chan<- *pb.ListenerMessage) {
	// Capture done channel once for performance
	done := ctx.Done()

	// Create Kubernetes client
	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		log.Printf("Failed to create kubernetes client: %v", err)
		cancel(fmt.Errorf("failed to create kubernetes client: %w", err))
		return
	}

	log.Printf("Starting pod watcher for namespace: %s", rl.args.Namespace)

	// Create informer factory for pods (all namespaces)
	// Disable informer resync - rely on watch + error handlers
	// Field selector for Running pods only to reduce memory footprint
	podInformerFactory := informers.NewSharedInformerFactoryWithOptions(
		clientset,
		0, // No automatic resync
		informers.WithTweakListOptions(func(options *metav1.ListOptions) {
			options.FieldSelector = "status.phase=Running"
		}),
	)

	// Get pod informer (all namespaces)
	podInformer := podInformerFactory.Core().V1().Pods().Informer()

	// Add pod event handler with early filtering to minimize processing
	// We only care about:
	// 1. Pods transitioning INTO Running state (to add resources)
	// 2. Pods transitioning FROM Running state to terminal state (to subtract resources)
	// All other updates (labels, annotations, status changes) are ignored since
	// pod resources and node assignment are immutable after creation.
	_, err = podInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			pod := obj.(*corev1.Pod)
			rl.aggregator.AddPod(pod)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			pod := newObj.(*corev1.Pod)

			// Handle two cases:
			// Case 1: Pod transitioned TO Running state (Pending/Unknown → Running)
			// Case 2: Pod transitioned FROM Running to terminal state (Running → Succeeded/Failed)
			if pod.Status.Phase == corev1.PodRunning {
				rl.aggregator.AddPod(pod)
			}

			if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
				rl.aggregator.DeletePod(pod)
			}

		},
		DeleteFunc: func(obj interface{}) {
			pod, ok := obj.(*corev1.Pod)
			if !ok {
				tombstone, ok := obj.(cache.DeletedFinalStateUnknown)
				if !ok {
					log.Printf("Error: unexpected object type in pod DeleteFunc: %T", obj)
					return
				}
				pod, ok = tombstone.Obj.(*corev1.Pod)
				if !ok {
					log.Printf("Error: tombstone contained unexpected object: %T", tombstone.Obj)
					return
				}
			}
			// Always remove pod from aggregator on delete
			rl.aggregator.DeletePod(pod)
		},
	})
	if err != nil {
		log.Printf("Failed to add pod event handler: %v", err)
		return
	}

	// Set watch error handler for rebuild on watch gaps
	podInformer.SetWatchErrorHandler(func(r *cache.Reflector, err error) {
		log.Printf("Pod watch error, will rebuild from store: %v", err)
		rl.rebuildPodsFromStore(podInformer)
	})

	// Start the informer
	podInformerFactory.Start(done)

	// Wait for cache sync
	log.Println("Waiting for pod informer cache to sync...")
	if !cache.WaitForCacheSync(done, podInformer.HasSynced) {
		log.Println("Failed to sync pod informer cache")
		return
	}
	log.Println("Pod informer cache synced successfully")

	// Initial rebuild from store after sync
	rl.rebuildPodsFromStore(podInformer)

	// Start debounced flush loop for resource usage
	flushInterval := time.Duration(rl.args.UsageFlushIntervalSec) * time.Second
	flushTicker := time.NewTicker(flushInterval)
	defer flushTicker.Stop()

	for {
		select {
		case <-done:
			log.Println("Pod watcher stopped")
			return
		case <-flushTicker.C:
			// Debounced flush of dirty nodes - send usage messages
			rl.flushDirtyNodes(ctx, usageChan)
		}
	}
}

// rebuildPodsFromStore rebuilds aggregator state from pod informer cache
func (rl *ResourceListener) rebuildPodsFromStore(podInformer cache.SharedIndexInformer) {
	log.Println("Rebuilding pod aggregator state from informer store...")

	// Reset aggregator state
	rl.aggregator.Reset()

	// Rebuild from pod store
	pods := podInformer.GetStore().List()
	for _, obj := range pods {
		pod, ok := obj.(*corev1.Pod)
		if !ok {
			continue
		}
		if pod.Status.Phase == corev1.PodRunning {
			rl.aggregator.AddPod(pod)
		}
	}

	log.Printf("Pod rebuild complete: processed %d pods", len(pods))
}

// flushDirtyNodes sends resource usage updates for all dirty nodes
func (rl *ResourceListener) flushDirtyNodes(ctx context.Context, usageChan chan<- *pb.ListenerMessage) {
	dirtyNodes := rl.aggregator.GetAndClearDirtyNodes()
	if len(dirtyNodes) == 0 {
		return
	}

	sent := 0
	for _, hostname := range dirtyNodes {
		msg := rl.buildNodeUsageMessage(hostname)
		if msg != nil {
			select {
			case usageChan <- msg:
				sent++
			case <-ctx.Done():
				log.Printf("Flushed %d/%d resource usage messages before shutdown", sent, len(dirtyNodes))
				return
			}
		}
	}

	if sent > 0 {
		log.Printf("Flushed %d resource usage messages", sent)
	}
}

// buildNodeUsageMessage creates a UpdateNodeUsageBody message
func (rl *ResourceListener) buildNodeUsageMessage(hostname string) *pb.ListenerMessage {
	usageFields, nonWorkflowFields := rl.aggregator.GetNodeUsage(hostname)
	if usageFields == nil {
		return nil
	}

	// Generate message UUID
	messageUUID := strings.ReplaceAll(uuid.New().String(), "-", "")

	msg := &pb.ListenerMessage{
		Uuid:      messageUUID,
		Timestamp: time.Now().UTC().Format("2006-01-02T15:04:05.999999"),
		Body: &pb.ListenerMessage_UpdateNodeUsage{
			UpdateNodeUsage: &pb.UpdateNodeUsageBody{
				Hostname:               hostname,
				UsageFields:            usageFields,
				NonWorkflowUsageFields: nonWorkflowFields,
			},
		},
	}

	return msg
}
