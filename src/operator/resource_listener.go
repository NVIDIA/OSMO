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
	"go.corp.nvidia.com/osmo/utils/metrics"
)

// ResourceListener manages the bidirectional gRPC stream for resource (node) events
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

// receiveMessages handles receiving ACK messages from the server
// sendMessages starts informers and processes resource events
func (rl *ResourceListener) sendMessages(ctx context.Context, cancel context.CancelCauseFunc) {
	// Create channels for different message types
	// nodeChan: node resource messages (from watchNodes)
	// usageChan: pod resource usage messages (from watchPods)
	nodeChan := make(chan *pb.ListenerMessage, rl.args.NodeUpdateChanSize)
	usageChan := make(chan *pb.ListenerMessage, rl.args.UsageChanSize)

	// WaitGroup to track all goroutines
	var wg sync.WaitGroup

	// Start node watcher goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(nodeChan)
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Panic in watchNodes goroutine: %v", r)
				cancel(fmt.Errorf("panic in node watcher: %v", r))
			}
		}()
		rl.watchNodes(ctx, cancel, nodeChan)
	}()

	// Start pod watcher goroutine (handles node usage aggregation)
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

	// Start message sender goroutine (handles both node and usage channels)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Panic in sendFromChannels goroutine: %v", r)
				cancel(fmt.Errorf("panic in message sender: %v", r))
			}
		}()
		rl.sendFromChannels(nodeChan, usageChan, ctx, cancel)
	}()

	// Wait for all goroutines to complete
	wg.Wait()
	log.Println("All message sender goroutines stopped")
}

// sendFromChannels sends messages from both node and usage channels to the server
func (rl *ResourceListener) sendFromChannels(nodeChan <-chan *pb.ListenerMessage, usageChan <-chan *pb.ListenerMessage, ctx context.Context, cancel context.CancelCauseFunc) {
	log.Printf("Starting message sender for node and usage channels")
	defer log.Printf("Stopping message sender")

	// Capture done channel once for performance
	done := ctx.Done()

	// Ticker to report progress when idle
	progressTicker := time.NewTicker(time.Duration(rl.args.ProgressFrequencySec) * time.Second)
	defer progressTicker.Stop()

	for {
		select {
		case <-done:
			return
		case <-progressTicker.C:
			// Report progress periodically even when idle
			progressWriter := rl.GetProgressWriter()
			if progressWriter != nil {
				if err := progressWriter.ReportProgress(); err != nil {
					log.Printf("Warning: failed to report progress: %v", err)
				}
			}
		case msg, ok := <-nodeChan:
			if !ok {
				// Check if this was due to context cancellation (expected) vs unexpected stop
				if ctx.Err() != nil {
					log.Printf("node watcher stopped due to context cancellation")
					return
				}
				log.Printf("node watcher stopped unexpectedly...")
				cancel(fmt.Errorf("node watcher stopped"))
				return
			}
			if err := rl.sendResourceMessage(ctx, msg); err != nil {
				cancel(fmt.Errorf("failed to send UpdateNodeBody message: %w", err))
				return
			}
		case msg, ok := <-usageChan:
			if !ok {
				// Check if this was due to context cancellation (expected) vs unexpected stop
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
	// Determine message type for metrics
	messageType := "unknown"
	switch msg.Body.(type) {
	case *pb.ListenerMessage_UpdateNode:
		messageType = "update_node"
	case *pb.ListenerMessage_UpdateNodeUsage:
		messageType = "update_node_usage"
	case *pb.ListenerMessage_NodeInventory:
		messageType = "node_inventory"
	}

	// Add message to unacked queue before sending
	if err := rl.GetUnackedMessages().AddMessage(ctx, msg); err != nil {
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
			map[string]string{"type": messageType},
		)
	}

	if err := rl.GetStream().Send(msg); err != nil {
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
			map[string]string{"type": messageType},
		)
	}

	return nil
}

// watchNodes starts node informer and processes node events
// This function focuses only on node resource messages
func (rl *ResourceListener) watchNodes(
	ctx context.Context,
	cancel context.CancelCauseFunc,
	nodeChan chan<- *pb.ListenerMessage,
) {
	// Capture done channel once for performance
	done := ctx.Done()

	// Create Kubernetes client
	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		log.Printf("Failed to create kubernetes client: %v", err)
		cancel(fmt.Errorf("failed to create kubernetes client: %w", err))
		return
	}

	log.Println("Starting node resource watcher")

	// State tracker for node deduplication
	nodeStateTracker := utils.NewNodeStateTracker(time.Duration(rl.args.StateCacheTTLMin) * time.Minute)

	// Create informer factory for nodes (cluster-scoped)
	// Disable informer resync - rely on watch + error handlers
	nodeInformerFactory := informers.NewSharedInformerFactory(
		clientset,
		0, // No automatic resync
	)

	// Get node informer
	nodeInformer := nodeInformerFactory.Core().V1().Nodes().Informer()

	// Handler for node events - builds and sends resource messages
	handleNodeEvent := func(node *corev1.Node, isDelete bool) {
		// Record kb_event_watch_count metric for nodes
		if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
			metricCreator.RecordCounter(
				ctx,
				"kb_event_watch_count",
				1,
				"count",
				"Number of Kubernetes events received from informer watches",
				map[string]string{"type": "node"},
			)
		}

		msg := rl.buildResourceMessage(node, nodeStateTracker, isDelete)
		if msg != nil {
			select {
			case nodeChan <- msg:
			case <-done:
				return
			}
		}
		if isDelete {
			nodeStateTracker.Remove(utils.GetNodeHostname(node))
		}
	}

	// Add node event handler
	_, err = nodeInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			node := obj.(*corev1.Node)
			handleNodeEvent(node, false)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			node := newObj.(*corev1.Node)
			handleNodeEvent(node, false)
		},
		DeleteFunc: func(obj interface{}) {
			node, ok := obj.(*corev1.Node)
			if !ok {
				tombstone, ok := obj.(cache.DeletedFinalStateUnknown)
				if !ok {
					log.Printf("Error: unexpected object type in node DeleteFunc: %T", obj)
					return
				}
				node, ok = tombstone.Obj.(*corev1.Node)
				if !ok {
					log.Printf("Error: tombstone contained unexpected object: %T", tombstone.Obj)
					return
				}
			}
			handleNodeEvent(node, true)
		},
	})
	if err != nil {
		log.Printf("Failed to add node event handler: %v", err)
		return
	}

	// Set watch error handler for rebuild on watch gaps
	nodeInformer.SetWatchErrorHandler(func(r *cache.Reflector, err error) {
		log.Printf("Node watch error, will rebuild from store: %v", err)

		// Record event_watch_connection_error_count metric
		if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
			metricCreator.RecordCounter(
				ctx,
				"event_watch_connection_error_count",
				1,
				"count",
				"Count of connection errors when watching Kubernetes resources",
				map[string]string{"type": "node"},
			)
		}

		rl.rebuildNodesFromStore(ctx, nodeInformer, nodeStateTracker, nodeChan)

		// Send NodeInventory after rebuilding from watch gap
		log.Println("Sending NODE_INVENTORY after watch gap recovery")
		rl.sendNodeInventory(ctx, nodeInformer, nodeChan)
	})

	// Start the informer
	nodeInformerFactory.Start(done)

	// Wait for cache sync
	log.Println("Waiting for node informer cache to sync...")
	if !cache.WaitForCacheSync(done, nodeInformer.HasSynced) {
		log.Println("Failed to sync node informer cache")
		return
	}
	log.Println("Node informer cache synced successfully")

	// Initial rebuild from store after sync
	rl.rebuildNodesFromStore(ctx, nodeInformer, nodeStateTracker, nodeChan)

	// Send initial NodeInventory after all nodes are rebuilt
	log.Println("Sending initial NODE_INVENTORY after cache sync")
	rl.sendNodeInventory(ctx, nodeInformer, nodeChan)

	// Wait for context cancellation
	<-done
	log.Println("Node resource watcher stopped")
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

			// Record kb_event_watch_count metric for pod events (node resource usage)
			if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
				metricCreator.RecordCounter(
					ctx,
					"kb_event_watch_count",
					1,
					"count",
					"Number of Kubernetes events received from informer watches",
					map[string]string{"type": "pod"},
				)
			}

			rl.aggregator.AddPod(pod)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			pod := newObj.(*corev1.Pod)

			// Record kb_event_watch_count metric for pod events (node resource usage)
			if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
				metricCreator.RecordCounter(
					ctx,
					"kb_event_watch_count",
					1,
					"count",
					"Number of Kubernetes events received from informer watches",
					map[string]string{"type": "pod"},
				)
			}

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

			// Record kb_event_watch_count metric for pod events (node resource usage)
			if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
				metricCreator.RecordCounter(
					ctx,
					"kb_event_watch_count",
					1,
					"count",
					"Number of Kubernetes events received from informer watches",
					map[string]string{"type": "pod"},
				)
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

		// Record event_watch_connection_error_count metric
		if metricCreator := metrics.GetMetricCreator(); metricCreator != nil {
			metricCreator.RecordCounter(
				ctx,
				"event_watch_connection_error_count",
				1,
				"count",
				"Count of connection errors when watching Kubernetes resources",
				map[string]string{"type": "pod"},
			)
		}

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

// rebuildNodesFromStore rebuilds node state from informer cache
func (rl *ResourceListener) rebuildNodesFromStore(
	ctx context.Context,
	nodeInformer cache.SharedIndexInformer,
	nodeStateTracker *utils.NodeStateTracker,
	nodeChan chan<- *pb.ListenerMessage,
) {
	log.Println("Rebuilding node resource state from informer store...")

	sent := 0
	skipped := 0
	nodes := nodeInformer.GetStore().List()
	for _, obj := range nodes {
		node, ok := obj.(*corev1.Node)
		if !ok {
			continue
		}

		msg := rl.buildResourceMessage(node, nodeStateTracker, false)

		if msg != nil {
			select {
			case nodeChan <- msg:
				sent++
			case <-ctx.Done():
				log.Printf("Node rebuild interrupted: sent=%d, skipped=%d", sent, skipped)
				return
			}
		} else {
			skipped++
		}
	}

	log.Printf("Node rebuild complete: sent=%d, skipped=%d", sent, skipped)
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

// buildResourceMessage creates a ResourceBody message from a node
func (rl *ResourceListener) buildResourceMessage(
	node *corev1.Node,
	tracker *utils.NodeStateTracker,
	isDelete bool,
) *pb.ListenerMessage {
	hostname := utils.GetNodeHostname(node)

	// Build UpdateNodeBody object
	body := utils.BuildUpdateNodeBody(node, isDelete)

	// Check if we should send (deduplication)
	if !isDelete && !tracker.HasChanged(hostname, body) {
		return nil
	}

	// Update tracker
	if !isDelete {
		tracker.Update(hostname, body)
	}

	// Generate message UUID
	messageUUID := strings.ReplaceAll(uuid.New().String(), "-", "")

	msg := &pb.ListenerMessage{
		Uuid:      messageUUID,
		Timestamp: time.Now().UTC().Format("2006-01-02T15:04:05.999999"),
		Body: &pb.ListenerMessage_UpdateNode{
			UpdateNode: body,
		},
	}

	action := "update"
	if isDelete {
		action = "delete"
	}
	log.Printf("Sent Node (%s): hostname=%s, available=%v", action, hostname, body.Available)

	return msg
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

// sendNodeInventory builds and sends a NODE_INVENTORY message with all current node hostnames.
func (rl *ResourceListener) sendNodeInventory(
	ctx context.Context,
	nodeInformer cache.SharedIndexInformer,
	nodeChan chan<- *pb.ListenerMessage,
) {
	if nodeInformer == nil {
		log.Println("sendNodeInventory: informer is nil, skipping")
		return
	}

	// Collect all node hostnames from the informer store
	nodes := nodeInformer.GetStore().List()
	hostnames := make([]string, 0, len(nodes))

	for _, obj := range nodes {
		node, ok := obj.(*corev1.Node)
		if !ok {
			continue
		}
		hostname := utils.GetNodeHostname(node)
		hostnames = append(hostnames, hostname)
	}

	// Build NODE_INVENTORY message
	messageUUID := strings.ReplaceAll(uuid.New().String(), "-", "")
	msg := &pb.ListenerMessage{
		Uuid:      messageUUID,
		Timestamp: time.Now().UTC().Format("2006-01-02T15:04:05.999999"),
		Body: &pb.ListenerMessage_NodeInventory{
			NodeInventory: &pb.NodeInventoryBody{
				Hostnames: hostnames,
			},
		},
	}

	// Send through nodeChan with proper shutdown coordination
	select {
	case nodeChan <- msg:
		log.Printf("Sent NODE_INVENTORY with %d hostnames", len(hostnames))
	case <-ctx.Done():
		log.Println("sendNodeInventory: context cancelled while sending")
		return
	}
}
