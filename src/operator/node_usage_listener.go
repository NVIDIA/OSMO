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
	"time"

	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// NodeUsageListener manages the bidirectional gRPC stream for pod resource usage
type NodeUsageListener struct {
	*utils.BaseListener
	args       utils.ListenerArgs
	aggregator *utils.NodeUsageAggregator
	inst       *utils.Instruments
}

// NewNodeUsageListener creates a new node usage listener instance
func NewNodeUsageListener(args utils.ListenerArgs, inst *utils.Instruments) *NodeUsageListener {
	nul := &NodeUsageListener{
		BaseListener: utils.NewBaseListener(
			args, "last_progress_node_usage_listener", utils.StreamNameNodeUsage, inst),
		args:       args,
		aggregator: utils.NewNodeUsageAggregator(args.Namespace),
		inst:       inst,
	}
	return nul
}

// Run manages the bidirectional streaming lifecycle
func (nul *NodeUsageListener) Run(ctx context.Context) error {
	ch := make(chan *pb.ListenerMessage, nul.args.UsageChanSize)
	return nul.BaseListener.Run(
		ctx,
		"Connected to the service, node usage listener stream established",
		ch,
		nul.watchPods,
		nul.sendMessages,
	)
}

// sendMessages reads from the channel and sends messages to the server.
func (nul *NodeUsageListener) sendMessages(
	ctx context.Context,
	ch <-chan *pb.ListenerMessage,
) error {
	progressTicker := time.NewTicker(time.Duration(nul.args.ProgressFrequencySec) * time.Second)
	defer progressTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-progressTicker.C:
			progressWriter := nul.GetProgressWriter()
			if progressWriter != nil {
				if err := progressWriter.ReportProgress(); err != nil {
					log.Printf("Warning: failed to report progress: %v", err)
				}
			}
		case msg, ok := <-ch:
			if !ok {
				nul.inst.MessageChannelClosedUnexpectedly.Add(ctx, 1, nul.Attrs.Stream)
				return fmt.Errorf("usage watcher stopped")
			}
			if err := nul.BaseListener.SendMessage(ctx, msg); err != nil {
				return fmt.Errorf("failed to send UpdateNodeUsageBody message: %w", err)
			}
		}
	}
}

// watchPods starts pod informer and handles resource aggregation
// This function focuses on pod events and resource usage messages
func (nul *NodeUsageListener) watchPods(
	ctx context.Context,
	ch chan<- *pb.ListenerMessage) error {

	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	log.Printf("Starting pod watcher for namespace: %s", nul.args.Namespace)

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
			nul.inst.KubeEventWatchCount.Add(ctx, 1, nul.Attrs.Stream)

			pod := obj.(*corev1.Pod)
			nul.aggregator.AddPod(pod)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			nul.inst.KubeEventWatchCount.Add(ctx, 1, nul.Attrs.Stream)

			pod := newObj.(*corev1.Pod)

			// Handle two cases:
			// Case 1: Pod transitioned TO Running state (Pending/Unknown → Running)
			// Case 2: Pod transitioned FROM Running to terminal state (Running → Succeeded/Failed)
			if pod.Status.Phase == corev1.PodRunning {
				nul.aggregator.AddPod(pod)
			}

			if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
				nul.aggregator.DeletePod(pod)
			}

		},
		DeleteFunc: func(obj interface{}) {
			nul.inst.KubeEventWatchCount.Add(ctx, 1, nul.Attrs.Stream)

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
			nul.aggregator.DeletePod(pod)
		},
	})
	if err != nil {
		return fmt.Errorf("failed to add pod event handler: %w", err)
	}

	// Set watch error handler for rebuild on watch gaps
	podInformer.SetWatchErrorHandler(func(r *cache.Reflector, err error) {
		log.Printf("Pod watch error, will rebuild from store: %v", err)
		nul.inst.EventWatchConnectionErrorCount.Add(ctx, 1, nul.Attrs.Stream)
		nul.rebuildPodsFromStore(podInformer)
	})

	// Start the informer
	podInformerFactory.Start(ctx.Done())

	// Wait for cache sync
	log.Println("Waiting for pod informer cache to sync...")
	if !cache.WaitForCacheSync(ctx.Done(), podInformer.HasSynced) {
		nul.inst.InformerCacheSyncFailure.Add(ctx, 1, nul.Attrs.Stream)
		return fmt.Errorf("failed to sync pod informer cache")
	}
	log.Println("Pod informer cache synced successfully")
	nul.inst.InformerCacheSyncSuccess.Add(ctx, 1, nul.Attrs.Stream)

	// Initial rebuild from store after sync
	nul.rebuildPodsFromStore(podInformer)

	// Start debounced flush loop for resource usage
	flushInterval := time.Duration(nul.args.UsageFlushIntervalSec) * time.Second
	flushTicker := time.NewTicker(flushInterval)
	defer flushTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Pod watcher stopped")
			return nil
		case <-flushTicker.C:
			// Debounced flush of dirty nodes - send usage messages
			start := time.Now()
			nul.flushDirtyNodes(ctx, ch)
			nul.inst.NodeUsageFlushDuration.Record(ctx, time.Since(start).Seconds())
		}
	}
}

// rebuildPodsFromStore rebuilds aggregator state from pod informer cache
func (nul *NodeUsageListener) rebuildPodsFromStore(podInformer cache.SharedIndexInformer) {
	log.Println("Rebuilding pod aggregator state from informer store...")

	nul.inst.InformerRebuildTotal.Add(context.Background(), 1, nul.Attrs.Stream)

	// Reset aggregator state
	nul.aggregator.Reset()

	// Rebuild from pod store
	pods := podInformer.GetStore().List()
	for _, obj := range pods {
		pod, ok := obj.(*corev1.Pod)
		if !ok {
			continue
		}
		if pod.Status.Phase == corev1.PodRunning {
			nul.aggregator.AddPod(pod)
		}
	}

	log.Printf("Pod rebuild complete: processed %d pods", len(pods))
}

// flushDirtyNodes sends resource usage updates for all dirty nodes
func (nul *NodeUsageListener) flushDirtyNodes(
	ctx context.Context,
	usageChan chan<- *pb.ListenerMessage) {
	dirtyNodes := nul.aggregator.GetAndClearDirtyNodes()
	if len(dirtyNodes) == 0 {
		return
	}

	nul.inst.NodeUsageFlushNodesCount.Record(ctx, float64(len(dirtyNodes)))

	sent := 0
	for _, hostname := range dirtyNodes {
		msg := nul.buildNodeUsageMessage(hostname)
		if msg != nil {
			select {
			case usageChan <- msg:
				sent++
				nul.inst.MessageQueuedTotal.Add(ctx, 1, nul.Attrs.Stream)
				nul.inst.MessageChannelPending.Record(ctx, float64(len(usageChan)), nul.Attrs.Stream)
			case <-ctx.Done():
				log.Printf("Flushed %d/%d resource usage messages before shutdown",
					sent, len(dirtyNodes))
				return
			}
		}
	}

	if sent > 0 {
		log.Printf("Flushed %d resource usage messages", sent)
	}
}

// buildNodeUsageMessage creates a UpdateNodeUsageBody message
func (nul *NodeUsageListener) buildNodeUsageMessage(hostname string) *pb.ListenerMessage {
	usageFields, nonWorkflowFields := nul.aggregator.GetNodeUsage(hostname)
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
