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

// ResourceListener manages the bidirectional gRPC stream for resource (node) events
type ResourceListener struct {
	*utils.BaseListener
	args       utils.ListenerArgs
	aggregator *utils.ResourceUsageAggregator
}

// NewResourceListener creates a new resource listener instance
func NewResourceListener(args utils.ListenerArgs) *ResourceListener {
	return &ResourceListener{
		BaseListener: utils.NewBaseListener(args, "last_progress_resource_listener"),
		args:         args,
		aggregator:   utils.NewResourceUsageAggregator(args.Namespace),
	}
}

// Run manages the bidirectional streaming lifecycle
func (rl *ResourceListener) Run(ctx context.Context) error {
	return rl.BaseListener.Run(
		ctx,
		"Connected to operator service, resource stream established",
		rl.sendMessages,
		rl.BaseListener.CloseStream,
		"resource",
	)
}

// receiveMessages handles receiving ACK messages from the server
// sendMessages starts informers and processes resource events
func (rl *ResourceListener) sendMessages() {
	// Create channels for different message types
	// nodeChan: node resource messages (from watchNodes)
	// usageChan: pod resource usage messages (from watchPods)
	nodeChan := make(chan *pb.ListenerMessage, rl.args.NodeUpdateChanSize)
	usageChan := make(chan *pb.ListenerMessage, rl.args.UsageChanSize)

	// WaitGroup to track all goroutines
	var wg sync.WaitGroup

	// Channels to signal if watchers exit unexpectedly
	nodeWatcherDone := make(chan struct{})
	podWatcherDone := make(chan struct{})

	streamCtx := rl.GetStreamContext()
	streamCancel := rl.GetStreamCancel()

	// Start node resource watcher goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(nodeWatcherDone)
		rl.watchNodes(nodeChan)
	}()

	// Start pod watcher goroutine (handles resource aggregation)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(podWatcherDone)
		rl.watchPods(usageChan)
	}()

	// Start message sender goroutine (handles both resource and usage channels)
	wg.Add(1)
	go func() {
		defer wg.Done()
		rl.sendFromChannels(nodeChan, usageChan, nodeWatcherDone, podWatcherDone, streamCtx, streamCancel)
	}()

	// Wait for all goroutines to complete
	wg.Wait()
	log.Println("All message sender goroutines stopped")
}

// sendFromChannels sends messages from both resource and usage channels to the server
func (rl *ResourceListener) sendFromChannels(nodeChan <-chan *pb.ListenerMessage, usageChan <-chan *pb.ListenerMessage, nodeWatcherDone <-chan struct{}, podWatcherDone <-chan struct{}, streamCtx context.Context, streamCancel context.CancelCauseFunc) {
	log.Printf("Starting message sender for node and usage channels")
	defer log.Printf("Stopping message sender")

	// Ticker to report progress when idle
	progressTicker := time.NewTicker(time.Duration(rl.args.ProgressFrequencySec) * time.Second)
	defer progressTicker.Stop()

	for {
		select {
		case <-streamCtx.Done():
			return
		case <-nodeWatcherDone:
			log.Printf("node watcher stopped unexpectedly...")
			streamCancel(fmt.Errorf("node watcher stopped"))
			return
		case <-podWatcherDone:
			log.Printf("usage watcher stopped unexpectedly...")
			streamCancel(fmt.Errorf("usage watcher stopped"))
			return
		case <-progressTicker.C:
			// Report progress periodically even when idle
			progressWriter := rl.GetProgressWriter()
			if progressWriter != nil {
				if err := progressWriter.ReportProgress(); err != nil {
					log.Printf("Warning: failed to report progress: %v", err)
				}
			}
		case msg := <-nodeChan:
			if err := rl.sendResourceMessage(msg); err != nil {
				streamCancel(fmt.Errorf("failed to send resource message: %w", err))
				return
			}
		case msg := <-usageChan:
			if err := rl.sendResourceMessage(msg); err != nil {
				streamCancel(fmt.Errorf("failed to send usage message: %w", err))
				return
			}
		}
	}
}

// sendResourceMessage sends a single resource message
func (rl *ResourceListener) sendResourceMessage(msg *pb.ListenerMessage) error {
	// Add message to unacked queue before sending
	streamCtx := rl.GetStreamContext()
	if err := rl.GetUnackedMessages().AddMessage(streamCtx, msg); err != nil {
		log.Printf("Failed to add message to unacked queue: %v", err)
		return nil // Don't fail the stream
	}

	if err := rl.GetStream().Send(msg); err != nil {
		return err
	}

	return nil
}

// watchNodes starts node informer and processes node events
// This function focuses only on node resource messages
func (rl *ResourceListener) watchNodes(nodeChan chan<- *pb.ListenerMessage) {
	// Create Kubernetes client
	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		log.Printf("Failed to create kubernetes client: %v", err)
		return
	}

	log.Println("Starting node resource watcher")

	// State tracker for node deduplication
	nodeStateTracker := utils.NewNodeStateTracker(time.Duration(rl.args.StateCacheTTLMin) * time.Minute)

	// Create informer factory for nodes (cluster-scoped)
	// Disable informer resync - rely on watch + manual ReconcileIntervalMin instead
	nodeInformerFactory := informers.NewSharedInformerFactory(
		clientset,
		0, // No automatic resync
	)

	// Get node informer
	nodeInformer := nodeInformerFactory.Core().V1().Nodes().Informer()

	// Handler for node events - builds and sends resource messages
	handleNodeEvent := func(node *corev1.Node, isDelete bool) {
		msg := rl.buildResourceMessage(node, nodeStateTracker, isDelete)
		if msg != nil {
			select {
			case nodeChan <- msg:
			case <-rl.GetStreamContext().Done():
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
		rl.rebuildNodesFromStore(nodeInformer, nodeStateTracker, nodeChan)
	})

	// Start the informer
	nodeInformerFactory.Start(rl.GetStreamContext().Done())

	// Wait for cache sync
	log.Println("Waiting for node informer cache to sync...")
	if !cache.WaitForCacheSync(rl.GetStreamContext().Done(), nodeInformer.HasSynced) {
		log.Println("Failed to sync node informer cache")
		return
	}
	log.Println("Node informer cache synced successfully")

	// Initial rebuild from store after sync
	rl.rebuildNodesFromStore(nodeInformer, nodeStateTracker, nodeChan)

	// Periodic reconciliation (safety net) - can be disabled by setting ReconcileIntervalMin to 0
	var reconcileTicker *time.Ticker
	if rl.args.ReconcileIntervalMin > 0 {
		reconcileInterval := time.Duration(rl.args.ReconcileIntervalMin) * time.Minute
		reconcileTicker = time.NewTicker(reconcileInterval)
		defer reconcileTicker.Stop()
	}

	for {
		select {
		case <-rl.GetStreamContext().Done():
			log.Println("Node resource watcher stopped")
			return
		case <-func() <-chan time.Time {
			if reconcileTicker != nil {
				return reconcileTicker.C
			}
			return nil
		}():
			// Periodic full reconcile as safety net (only if enabled)
			log.Println("Performing periodic node reconciliation...")
			rl.rebuildNodesFromStore(nodeInformer, nodeStateTracker, nodeChan)
		}
	}
}

// watchPods starts pod informer and handles resource aggregation
// This function focuses on pod events and resource usage messages
func (rl *ResourceListener) watchPods(usageChan chan<- *pb.ListenerMessage) {
	// Create Kubernetes client
	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		log.Printf("Failed to create kubernetes client: %v", err)
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
			// Only track if pod is already Running and has a node assignment
			if pod.Spec.NodeName == "" || pod.Status.Phase != corev1.PodRunning {
				return
			}
			rl.aggregator.UpdatePod(pod)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			oldPod := oldObj.(*corev1.Pod)
			newPod := newObj.(*corev1.Pod)

			// Handle two cases:
			// Case 1: Pod transitioned TO Running state (Pending/Unknown → Running)
			// Case 2: Pod transitioned FROM Running to terminal state (Running → Succeeded/Failed)
			wasRunning := oldPod.Status.Phase == corev1.PodRunning
			isRunning := newPod.Status.Phase == corev1.PodRunning

			// Case 1: Pod just transitioned TO Running - track its resources
			if !wasRunning && isRunning {
				rl.aggregator.UpdatePod(newPod)
				return
			}

			// Case 2: Pod transitioned FROM Running to terminal state
			// Terminal states: Succeeded, Failed (not Pending, Unknown)
			if wasRunning && !isRunning {
				isTerminal := newPod.Status.Phase == corev1.PodSucceeded || newPod.Status.Phase == corev1.PodFailed
				if isTerminal {
					// Pod finished - release its resources
					rl.aggregator.DeletePod(newPod)
					return
				}
			}

			// All other transitions (e.g., Running → Running, Pending → Pending) are ignored
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
	podInformerFactory.Start(rl.GetStreamContext().Done())

	// Wait for cache sync
	log.Println("Waiting for pod informer cache to sync...")
	if !cache.WaitForCacheSync(rl.GetStreamContext().Done(), podInformer.HasSynced) {
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
		case <-rl.GetStreamContext().Done():
			log.Println("Pod watcher stopped")
			return
		case <-flushTicker.C:
			// Debounced flush of dirty nodes - send usage messages
			rl.flushDirtyNodes(usageChan)
		}
	}
}

// rebuildNodesFromStore rebuilds node state from informer cache
func (rl *ResourceListener) rebuildNodesFromStore(
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
			case <-rl.GetStreamContext().Done():
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
		// Only include Running pods with a node assignment
		// Note: Store only contains Running pods due to field selector in informer factory
		if pod.Spec.NodeName != "" && pod.Status.Phase == corev1.PodRunning {
			rl.aggregator.UpdatePod(pod)
		}
	}

	log.Printf("Pod rebuild complete: processed %d pods", len(pods))
}

// flushDirtyNodes sends resource usage updates for all dirty nodes
func (rl *ResourceListener) flushDirtyNodes(usageChan chan<- *pb.ListenerMessage) {
	dirtyNodes := rl.aggregator.GetAndClearDirtyNodes()
	if len(dirtyNodes) == 0 {
		return
	}

	sent := 0
	for _, hostname := range dirtyNodes {
		msg := rl.buildResourceUsageMessage(hostname)
		if msg != nil {
			select {
			case usageChan <- msg:
				sent++
			case <-rl.GetStreamContext().Done():
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

	// Build resource body
	body := utils.BuildResourceBody(node, isDelete)

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
		Body: &pb.ListenerMessage_Resource{
			Resource: body,
		},
	}

	action := "update"
	if isDelete {
		action = "delete"
	}
	log.Printf("Sent resource (%s): hostname=%s, available=%v", action, hostname, body.Available)

	return msg
}

// buildResourceUsageMessage creates a ResourceUsageBody message
func (rl *ResourceListener) buildResourceUsageMessage(hostname string) *pb.ListenerMessage {
	usageFields, nonWorkflowFields := rl.aggregator.GetNodeUsage(hostname)
	if usageFields == nil {
		return nil
	}

	// Generate message UUID
	messageUUID := strings.ReplaceAll(uuid.New().String(), "-", "")

	msg := &pb.ListenerMessage{
		Uuid:      messageUUID,
		Timestamp: time.Now().UTC().Format("2006-01-02T15:04:05.999999"),
		Body: &pb.ListenerMessage_ResourceUsage{
			ResourceUsage: &pb.UpdateNodeUsageBody{
				Hostname:               hostname,
				UsageFields:            usageFields,
				NonWorkflowUsageFields: nonWorkflowFields,
			},
		},
	}

	return msg
}
