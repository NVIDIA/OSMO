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
	"math"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// ResourceListenerArgs holds configuration for the resource listener
type ResourceListenerArgs struct {
	utils.ListenerArgs
	UsageFlushIntervalSec int // Interval for flushing resource usage updates
	ReconcileIntervalMin  int // Interval for full reconciliation (safety net)
	NodeEventQueueSize    int // Buffer size for node event queue (prevents informer blocking)
}

// ResourceListener manages the bidirectional gRPC stream for resource (node) events
type ResourceListener struct {
	*utils.BaseListener
	args       ResourceListenerArgs
	stream     pb.ListenerService_ResourceListenerStreamClient
	closeOnce  sync.Once
	aggregator *ResourceUsageAggregator
}

// NewResourceListener creates a new resource listener instance
func NewResourceListener(args ResourceListenerArgs) *ResourceListener {
	return &ResourceListener{
		BaseListener: utils.NewBaseListener(args.ListenerArgs, "last_progress_resource_listener"),
		args:         args,
		aggregator:   NewResourceUsageAggregator(args.Namespace),
	}
}

// Connect establishes a gRPC connection and stream
func (rl *ResourceListener) Connect(ctx context.Context) error {
	// Initialize the base connection
	if err := rl.BaseListener.InitConnection(ctx, rl.args.ServiceURL); err != nil {
		return err
	}

	// Establish the bidirectional stream
	var err error
	rl.stream, err = rl.GetClient().ResourceListenerStream(ctx)
	if err != nil {
		return fmt.Errorf("failed to create stream: %w", err)
	}

	// Context for coordinated shutdown of goroutines with error cause
	rl.InitStreamContext(ctx)

	log.Printf("Connected to operator service, resource stream established")
	return nil
}

// Run manages the bidirectional streaming lifecycle
func (rl *ResourceListener) Run(ctx context.Context) error {
	if err := rl.Connect(ctx); err != nil {
		return err
	}
	defer rl.Close()

	// Resend all unacked messages from previous connection (if any)
	if err := rl.GetUnackedMessages().ResendAll(rl.stream); err != nil {
		return err
	}

	// Launch goroutines for send and receive
	rl.AddToWaitGroup(2)
	go func() {
		defer rl.WaitGroupDone()
		rl.BaseListener.ReceiveAcks(rl.stream, "resource")
	}()

	go func() {
		defer rl.WaitGroupDone()
		rl.sendMessages()
	}()

	// Wait for completion
	return rl.WaitForCompletion(ctx, rl.closeStream)
}

// receiveMessages handles receiving ACK messages from the server
// sendMessages starts informers and processes resource events
func (rl *ResourceListener) sendMessages() {
	// Create channels for different message types
	// resourceChan: node resource messages (from watchResources)
	// usageChan: pod resource usage messages (from watchPods)
	resourceChan := make(chan *pb.ListenerMessage, rl.args.PodUpdateChanSize)
	usageChan := make(chan *pb.ListenerMessage, rl.args.PodUpdateChanSize)

	// WaitGroup to track all goroutines
	var wg sync.WaitGroup

	// Channels to signal if watchers exit unexpectedly
	resourceWatcherDone := make(chan struct{})
	podWatcherDone := make(chan struct{})

	streamCtx := rl.GetStreamContext()
	streamCancel := rl.GetStreamCancel()

	// Start node resource watcher goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(resourceWatcherDone)
		rl.watchResources(resourceChan)
	}()

	// Start pod watcher goroutine (handles resource aggregation)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer close(podWatcherDone)
		rl.watchPods(usageChan)
	}()

	// Start resource message sender goroutine (dedicated to resourceChan)
	wg.Add(1)
	go func() {
		defer wg.Done()
		rl.sendFromChannel("resource", resourceChan, resourceWatcherDone, streamCtx, streamCancel)
	}()

	// Start usage message sender goroutine (dedicated to usageChan)
	wg.Add(1)
	go func() {
		defer wg.Done()
		rl.sendFromChannel("usage", usageChan, podWatcherDone, streamCtx, streamCancel)
	}()

	// Start progress reporter goroutine
	wg.Add(1)
	go func() {
		defer wg.Done()
		// Ticker to report progress when idle
		progressTicker := time.NewTicker(time.Duration(rl.args.ProgressFrequencySec) * time.Second)
		defer progressTicker.Stop()

		for {
			select {
			case <-streamCtx.Done():
				log.Println("Progress reporter stopped")
				return
			case <-progressTicker.C:
				// Report progress periodically even when idle
				progressWriter := rl.GetProgressWriter()
				if progressWriter != nil {
					if err := progressWriter.ReportProgress(); err != nil {
						log.Printf("Warning: failed to report progress: %v", err)
					}
				}
			}
		}
	}()

	// Wait for all goroutines to complete
	wg.Wait()
	log.Println("All message sender goroutines stopped")
}

// sendFromChannel sends messages from a channel to the server
// Each channel has its own dedicated sender to avoid starvation
func (rl *ResourceListener) sendFromChannel(name string, msgChan <-chan *pb.ListenerMessage, watcherDone <-chan struct{}, streamCtx context.Context, streamCancel context.CancelCauseFunc) {
	log.Printf("Starting %s message sender", name)
	defer log.Printf("Stopping %s message sender", name)

	for {
		select {
		case <-streamCtx.Done():
			log.Printf("Context done, draining %s channel...", name)
			rl.drainChannel(msgChan)
			return
		case <-watcherDone:
			log.Printf("%s watcher stopped unexpectedly, draining channel...", name)
			rl.drainChannel(msgChan)
			streamCancel(fmt.Errorf("%s watcher stopped", name))
			return
		case msg := <-msgChan:
			if err := rl.sendResourceMessage(msg); err != nil {
				streamCancel(fmt.Errorf("failed to send %s message: %w", name, err))
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

	if err := rl.stream.Send(msg); err != nil {
		return err
	}

	return nil
}

// drainChannel saves any remaining messages in the channel to unacked queue
func (rl *ResourceListener) drainChannel(resourceChan <-chan *pb.ListenerMessage) {
	drained := 0
	unackedMessages := rl.GetUnackedMessages()
	for {
		select {
		case msg := <-resourceChan:
			unackedMessages.AddMessageForced(msg)
			drained++
		default:
			if drained > 0 {
				log.Printf("Drained %d resource messages from channel to unacked queue", drained)
			}
			return
		}
	}
}

// closeStream ensures stream is closed only once
func (rl *ResourceListener) closeStream() {
	rl.closeOnce.Do(func() {
		if rl.stream != nil {
			if err := rl.stream.CloseSend(); err != nil {
				log.Printf("Error closing resource stream: %v", err)
			}
		}
	})
}

// Close cleans up resources
func (rl *ResourceListener) Close() {
	rl.closeStream()
	rl.BaseListener.CloseConnection()
}

// watchResources starts node informer and processes node events
// This function focuses only on node resource messages
func (rl *ResourceListener) watchResources(resourceChan chan<- *pb.ListenerMessage) {
	// Create Kubernetes client
	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		log.Printf("Failed to create kubernetes client: %v", err)
		return
	}

	log.Println("Starting node resource watcher")

	// State tracker for node deduplication
	nodeStateTracker := NewNodeStateTracker(time.Duration(rl.args.StateCacheTTLMin) * time.Minute)

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
			case resourceChan <- msg:
			case <-rl.GetStreamContext().Done():
				return
			}
		}
		if isDelete {
			nodeStateTracker.Remove(getNodeHostname(node))
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
		rl.rebuildNodesFromStore(nodeInformer, nodeStateTracker, resourceChan)
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
	rl.rebuildNodesFromStore(nodeInformer, nodeStateTracker, resourceChan)

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
			rl.rebuildNodesFromStore(nodeInformer, nodeStateTracker, resourceChan)
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

	// Handler for pod events - updates aggregator
	handlePodEvent := func(pod *corev1.Pod, eventType string) {
		// Only process pods with a node assignment
		if pod.Spec.NodeName == "" {
			return
		}

		// For non-delete events, only process Running or Pending pods
		if eventType != "delete" && pod.Status.Phase != corev1.PodRunning {
			if pod.Status.Phase != corev1.PodPending {
				return
			}
		}

		// Update aggregator based on event type
		switch eventType {
		case "add", "update":
			rl.aggregator.UpdatePod(pod)
		case "delete":
			rl.aggregator.DeletePod(pod)
		}
	}

	// Add pod event handler
	_, err = podInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			pod := obj.(*corev1.Pod)
			handlePodEvent(pod, "add")
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			pod := newObj.(*corev1.Pod)
			handlePodEvent(pod, "update")
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
			handlePodEvent(pod, "delete")
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
	nodeStateTracker *NodeStateTracker,
	resourceChan chan<- *pb.ListenerMessage,
) {
	log.Println("Rebuilding node resource state from informer store...")

	// Process all nodes and send resource messages
	nodes := nodeInformer.GetStore().List()
	for _, obj := range nodes {
		node, ok := obj.(*corev1.Node)
		if !ok {
			continue
		}
		// Force send for all nodes after rebuild
		msg := rl.buildResourceMessageForced(node, nodeStateTracker)
		if msg != nil {
			select {
			case resourceChan <- msg:
			case <-rl.GetStreamContext().Done():
				return
			}
		}
	}

	log.Printf("Node rebuild complete: processed %d nodes", len(nodes))
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
		// Only include Running or Pending pods with a node assignment
		if pod.Spec.NodeName != "" && (pod.Status.Phase == corev1.PodRunning || pod.Status.Phase == corev1.PodPending) {
			rl.aggregator.UpdatePod(pod)
		}
	}

	log.Printf("Pod rebuild complete: processed %d pods", len(pods))
}

// flushDirtyNodes sends resource usage updates for all dirty nodes
func (rl *ResourceListener) flushDirtyNodes(resourceChan chan<- *pb.ListenerMessage) {
	dirtyNodes := rl.aggregator.GetAndClearDirtyNodes()
	if len(dirtyNodes) == 0 {
		return
	}

	for _, hostname := range dirtyNodes {
		msg := rl.buildResourceUsageMessage(hostname)
		if msg != nil {
			select {
			case resourceChan <- msg:
				log.Printf("Sent resource_usage for node: %s", hostname)
			case <-rl.GetStreamContext().Done():
				return
			}
		}
	}
}

// buildResourceMessage creates a ResourceBody message from a node
func (rl *ResourceListener) buildResourceMessage(
	node *corev1.Node,
	tracker *NodeStateTracker,
	isDelete bool,
) *pb.ListenerMessage {
	hostname := getNodeHostname(node)

	// Build resource body
	body := buildResourceBody(node, isDelete)

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

// buildResourceMessageForced creates a ResourceBody message bypassing deduplication
func (rl *ResourceListener) buildResourceMessageForced(
	node *corev1.Node,
	tracker *NodeStateTracker,
) *pb.ListenerMessage {
	hostname := getNodeHostname(node)
	body := buildResourceBody(node, false)

	// Update tracker
	tracker.Update(hostname, body)

	// Generate message UUID
	messageUUID := strings.ReplaceAll(uuid.New().String(), "-", "")

	msg := &pb.ListenerMessage{
		Uuid:      messageUUID,
		Timestamp: time.Now().UTC().Format("2006-01-02T15:04:05.999999"),
		Body: &pb.ListenerMessage_Resource{
			Resource: body,
		},
	}

	log.Printf("Sent resource (forced): hostname=%s, available=%v", hostname, body.Available)

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
			ResourceUsage: &pb.ResourceUsageBody{
				Hostname:               hostname,
				UsageFields:            usageFields,
				NonWorkflowUsageFields: nonWorkflowFields,
			},
		},
	}

	return msg
}

// NodeStateTracker tracks the last sent state for each node to avoid duplicate messages
type NodeStateTracker struct {
	mu     sync.RWMutex
	states map[string]nodeStateEntry
	ttl    time.Duration
}

type nodeStateEntry struct {
	body      *pb.ResourceBody
	timestamp time.Time
}

// NewNodeStateTracker creates a new node state tracker
func NewNodeStateTracker(ttl time.Duration) *NodeStateTracker {
	return &NodeStateTracker{
		states: make(map[string]nodeStateEntry),
		ttl:    ttl,
	}
}

// HasChanged checks if the node's state has changed since last sent
func (nst *NodeStateTracker) HasChanged(hostname string, body *pb.ResourceBody) bool {
	nst.mu.RLock()
	entry, exists := nst.states[hostname]
	nst.mu.RUnlock()

	if !exists {
		return true
	}

	// Check TTL
	if time.Since(entry.timestamp) > nst.ttl {
		return true
	}

	// Compare resource bodies
	return !resourceBodiesEqual(entry.body, body)
}

// Update updates the tracker with the new state
func (nst *NodeStateTracker) Update(hostname string, body *pb.ResourceBody) {
	nst.mu.Lock()
	defer nst.mu.Unlock()
	nst.states[hostname] = nodeStateEntry{
		body:      body,
		timestamp: time.Now(),
	}
}

// Remove removes a node from the tracker
func (nst *NodeStateTracker) Remove(hostname string) {
	nst.mu.Lock()
	defer nst.mu.Unlock()
	delete(nst.states, hostname)
}

// resourceBodiesEqual compares two ResourceBody messages for equality
func resourceBodiesEqual(a, b *pb.ResourceBody) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Hostname != b.Hostname || a.Available != b.Available || a.Delete != b.Delete {
		return false
	}
	if len(a.Conditions) != len(b.Conditions) {
		return false
	}
	// Simple comparison - could be more sophisticated
	for i, c := range a.Conditions {
		if i >= len(b.Conditions) || c != b.Conditions[i] {
			return false
		}
	}
	if !mapsEqual(a.AllocatableFields, b.AllocatableFields) {
		return false
	}
	if !mapsEqual(a.LabelFields, b.LabelFields) {
		return false
	}
	if len(a.Taints) != len(b.Taints) {
		return false
	}
	return true
}

func mapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// ResourceUsageAggregator tracks per-node resource usage from pods
type ResourceUsageAggregator struct {
	mu sync.RWMutex

	// Workflow namespace for distinguishing workflow vs non-workflow pods
	workflowNamespace string

	// Pod contributions by UID
	podContributions map[types.UID]*podContribution

	// Per-node totals
	nodeTotals map[string]*resourceTotals

	// Per-node non-workflow totals
	nodeNonWorkflowTotals map[string]*resourceTotals

	// Set of dirty nodes (modified since last flush)
	dirtyNodes map[string]struct{}

	// Last sent totals for deduplication
	lastSentTotals map[string]*resourceTotals
}

type resourceTotals struct {
	cpu     int64 // millicores
	memory  int64 // Ki
	storage int64 // Ki
	gpu     int64
}

type podContribution struct {
	resourceTotals // embedded struct
	nodeName       string
	namespace      string
}

// NewResourceUsageAggregator creates a new resource usage aggregator
func NewResourceUsageAggregator(workflowNamespace string) *ResourceUsageAggregator {
	return &ResourceUsageAggregator{
		workflowNamespace:     workflowNamespace,
		podContributions:      make(map[types.UID]*podContribution),
		nodeTotals:            make(map[string]*resourceTotals),
		nodeNonWorkflowTotals: make(map[string]*resourceTotals),
		dirtyNodes:            make(map[string]struct{}),
		lastSentTotals:        make(map[string]*resourceTotals),
	}
}

// Reset clears all aggregator state
func (rua *ResourceUsageAggregator) Reset() {
	rua.mu.Lock()
	defer rua.mu.Unlock()

	rua.podContributions = make(map[types.UID]*podContribution)
	rua.nodeTotals = make(map[string]*resourceTotals)
	rua.nodeNonWorkflowTotals = make(map[string]*resourceTotals)
	rua.dirtyNodes = make(map[string]struct{})
}

// UpdatePod updates the aggregator with a pod's resource requests
func (rua *ResourceUsageAggregator) UpdatePod(pod *corev1.Pod) {
	rua.mu.Lock()
	defer rua.mu.Unlock()

	uid := pod.UID
	nodeName := pod.Spec.NodeName
	namespace := pod.Namespace

	// Calculate new contribution
	newContrib := calculatePodContribution(pod)
	newContrib.nodeName = nodeName
	newContrib.namespace = namespace

	// Get old contribution if exists
	oldContrib := rua.podContributions[uid]

	// If pod moved nodes, handle node migration
	if oldContrib != nil && oldContrib.nodeName != nodeName {
		// Subtract from old node
		rua.subtractContribution(oldContrib.nodeName, oldContrib)
		rua.dirtyNodes[oldContrib.nodeName] = struct{}{}
	}

	// Subtract old contribution from current node (if same node)
	if oldContrib != nil && oldContrib.nodeName == nodeName {
		rua.subtractContribution(nodeName, oldContrib)
	}

	// Add new contribution
	rua.addContribution(nodeName, newContrib)
	rua.dirtyNodes[nodeName] = struct{}{}

	// Update stored contribution
	rua.podContributions[uid] = newContrib
}

// DeletePod removes a pod's contribution from the aggregator
func (rua *ResourceUsageAggregator) DeletePod(pod *corev1.Pod) {
	rua.mu.Lock()
	defer rua.mu.Unlock()

	uid := pod.UID
	oldContrib := rua.podContributions[uid]
	if oldContrib == nil {
		return
	}

	// Subtract contribution
	rua.subtractContribution(oldContrib.nodeName, oldContrib)
	rua.dirtyNodes[oldContrib.nodeName] = struct{}{}

	// Remove from tracking
	delete(rua.podContributions, uid)
}

// MarkDirty marks a node as dirty for the next flush
func (rua *ResourceUsageAggregator) MarkDirty(hostname string) {
	rua.mu.Lock()
	defer rua.mu.Unlock()
	rua.dirtyNodes[hostname] = struct{}{}
}

// GetAndClearDirtyNodes returns and clears the set of dirty nodes
func (rua *ResourceUsageAggregator) GetAndClearDirtyNodes() []string {
	rua.mu.Lock()
	defer rua.mu.Unlock()

	nodes := make([]string, 0, len(rua.dirtyNodes))
	for node := range rua.dirtyNodes {
		nodes = append(nodes, node)
	}
	rua.dirtyNodes = make(map[string]struct{})
	return nodes
}

// GetNodeUsage returns the resource usage for a node
func (rua *ResourceUsageAggregator) GetNodeUsage(hostname string) (map[string]string, map[string]string) {
	rua.mu.RLock()
	defer rua.mu.RUnlock()

	totals := rua.nodeTotals[hostname]
	if totals == nil {
		totals = &resourceTotals{}
	}

	nonWfTotals := rua.nodeNonWorkflowTotals[hostname]
	if nonWfTotals == nil {
		nonWfTotals = &resourceTotals{}
	}

	usageFields := formatResourceUsage(totals)
	nonWorkflowFields := formatResourceUsage(nonWfTotals)

	return usageFields, nonWorkflowFields
}

func (rua *ResourceUsageAggregator) addContribution(nodeName string, contrib *podContribution) {
	// Initialize totals if needed
	if rua.nodeTotals[nodeName] == nil {
		rua.nodeTotals[nodeName] = &resourceTotals{}
	}
	if rua.nodeNonWorkflowTotals[nodeName] == nil {
		rua.nodeNonWorkflowTotals[nodeName] = &resourceTotals{}
	}

	// Add to totals
	rua.nodeTotals[nodeName].cpu += contrib.cpu
	rua.nodeTotals[nodeName].memory += contrib.memory
	rua.nodeTotals[nodeName].storage += contrib.storage
	rua.nodeTotals[nodeName].gpu += contrib.gpu

	// Add to non-workflow totals if not in workflow namespace
	if contrib.namespace != rua.workflowNamespace {
		rua.nodeNonWorkflowTotals[nodeName].cpu += contrib.cpu
		rua.nodeNonWorkflowTotals[nodeName].memory += contrib.memory
		rua.nodeNonWorkflowTotals[nodeName].storage += contrib.storage
		rua.nodeNonWorkflowTotals[nodeName].gpu += contrib.gpu
	}
}

func (rua *ResourceUsageAggregator) subtractContribution(nodeName string, contrib *podContribution) {
	if rua.nodeTotals[nodeName] == nil {
		return
	}

	// Subtract from totals
	rua.nodeTotals[nodeName].cpu -= contrib.cpu
	rua.nodeTotals[nodeName].memory -= contrib.memory
	rua.nodeTotals[nodeName].storage -= contrib.storage
	rua.nodeTotals[nodeName].gpu -= contrib.gpu

	// Subtract from non-workflow totals if not in workflow namespace
	if contrib.namespace != rua.workflowNamespace && rua.nodeNonWorkflowTotals[nodeName] != nil {
		rua.nodeNonWorkflowTotals[nodeName].cpu -= contrib.cpu
		rua.nodeNonWorkflowTotals[nodeName].memory -= contrib.memory
		rua.nodeNonWorkflowTotals[nodeName].storage -= contrib.storage
		rua.nodeNonWorkflowTotals[nodeName].gpu -= contrib.gpu
	}
}

// calculatePodContribution calculates resource requests for a pod
func calculatePodContribution(pod *corev1.Pod) *podContribution {
	contrib := &podContribution{}

	for _, container := range pod.Spec.Containers {
		if container.Resources.Requests == nil {
			continue
		}

		requests := container.Resources.Requests

		// CPU in millicores
		if cpu, ok := requests[corev1.ResourceCPU]; ok {
			contrib.cpu += cpu.MilliValue()
		}

		// Memory in Ki
		if mem, ok := requests[corev1.ResourceMemory]; ok {
			contrib.memory += toKi(mem)
		}

		// Ephemeral storage in Ki
		if storage, ok := requests[corev1.ResourceEphemeralStorage]; ok {
			contrib.storage += toKi(storage)
		}

		// GPU
		gpuResource := corev1.ResourceName("nvidia.com/gpu")
		if gpu, ok := requests[gpuResource]; ok {
			contrib.gpu += gpu.Value()
		}
	}

	return contrib
}

// toKi converts a resource.Quantity to Ki (kibibytes)
func toKi(q resource.Quantity) int64 {
	// Get value in bytes and convert to Ki
	bytes := q.Value()
	return int64(math.Ceil(float64(bytes) / 1024))
}

// formatResourceUsage formats resource totals as a map for the proto message
func formatResourceUsage(totals *resourceTotals) map[string]string {
	return map[string]string{
		"cpu":               fmt.Sprintf("%d", int64(math.Ceil(float64(totals.cpu)))),
		"memory":            fmt.Sprintf("%dKi", int64(math.Ceil(float64(totals.memory)))),
		"ephemeral-storage": fmt.Sprintf("%dKi", int64(math.Ceil(float64(totals.storage)))),
		"nvidia.com/gpu":    fmt.Sprintf("%d", totals.gpu),
	}
}

// getNodeHostname extracts the hostname from a node
func getNodeHostname(node *corev1.Node) string {
	if hostname, ok := node.Labels["kubernetes.io/hostname"]; ok {
		return hostname
	}
	return "-"
}

// buildResourceBody creates a ResourceBody from a node
func buildResourceBody(node *corev1.Node, isDelete bool) *pb.ResourceBody {
	hostname := getNodeHostname(node)

	// Build conditions list (types with status True)
	var conditions []string
	for _, cond := range node.Status.Conditions {
		if cond.Status == corev1.ConditionTrue {
			conditions = append(conditions, string(cond.Type))
		}
	}

	// Calculate availability: Ready==True && !Unschedulable
	available := isNodeAvailable(node)

	// Build allocatable fields
	allocatableFields := make(map[string]string)
	for name, qty := range node.Status.Allocatable {
		switch name {
		case corev1.ResourceCPU:
			// CPU in millicores
			allocatableFields[string(name)] = fmt.Sprintf("%d", qty.MilliValue())
		case corev1.ResourceMemory, corev1.ResourceEphemeralStorage:
			// Memory/Storage in Ki
			allocatableFields[string(name)] = fmt.Sprintf("%dKi", toKi(qty))
		default:
			allocatableFields[string(name)] = qty.String()
		}
	}

	// Build label fields (filter out feature.node.kubernetes.io prefixed keys)
	labelFields := make(map[string]string)
	for key, value := range node.Labels {
		if !strings.HasPrefix(key, "feature.node.kubernetes.io") {
			labelFields[key] = value
		}
	}

	// Build taints
	var taints []*pb.Taint
	for _, taint := range node.Spec.Taints {
		t := &pb.Taint{
			Key:    taint.Key,
			Value:  taint.Value,
			Effect: string(taint.Effect),
		}
		if taint.TimeAdded != nil {
			t.TimeAdded = taint.TimeAdded.UTC().Format("2006-01-02T15:04:05.999999")
		}
		taints = append(taints, t)
	}

	return &pb.ResourceBody{
		Hostname:          hostname,
		Available:         available,
		Conditions:        conditions,
		AllocatableFields: allocatableFields,
		LabelFields:       labelFields,
		Taints:            taints,
		Delete:            isDelete,
	}
}

// isNodeAvailable checks if a node is available (Ready==True && !Unschedulable)
func isNodeAvailable(node *corev1.Node) bool {
	if node.Spec.Unschedulable {
		return false
	}

	for _, cond := range node.Status.Conditions {
		if cond.Type == corev1.NodeReady {
			return cond.Status == corev1.ConditionTrue
		}
	}

	return false
}

// DefaultResourceListenerArgs returns default configuration values
func DefaultResourceListenerArgs() ResourceListenerArgs {
	return ResourceListenerArgs{
		ListenerArgs: utils.ListenerArgs{
			ServiceURL:           "http://127.0.0.1:8001",
			Backend:              "default",
			Namespace:            "osmo",
			PodUpdateChanSize:    500,
			ResyncPeriodSec:      300,
			StateCacheTTLMin:     15,
			MaxUnackedMessages:   100,
			NodeConditionPrefix:  "osmo.nvidia.com/",
			ProgressDir:          "/tmp/osmo/operator/",
			ProgressFrequencySec: 15,
		},
		UsageFlushIntervalSec: 5,   // Flush every 5 seconds
		ReconcileIntervalMin:  10,  // Full reconcile every 10 minutes (set to 0 to disable)
		NodeEventQueueSize:    100, // Buffer for node events (prevents informer blocking)
	}
}
