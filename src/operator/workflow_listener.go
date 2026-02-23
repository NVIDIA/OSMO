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

// WorkflowListener manages the bidirectional gRPC stream connection to the operator service
type WorkflowListener struct {
	*utils.BaseListener
	args utils.ListenerArgs
	inst *utils.Instruments

	// Pre-computed attribute sets for task status values
	statusAttrs utils.StatusAttrs
}

// NewWorkflowListener creates a new workflow listener instance
func NewWorkflowListener(args utils.ListenerArgs, inst *utils.Instruments) *WorkflowListener {
	wl := &WorkflowListener{
		BaseListener: utils.NewBaseListener(
			args, "last_progress_workflow_listener", utils.StreamNameWorkflow, inst),
		args: args,
		inst: inst,
		statusAttrs: utils.NewStatusAttrs([]string{
			utils.StatusScheduling,
			utils.StatusInitializing,
			utils.StatusRunning,
			utils.StatusCompleted,
			utils.StatusFailed,
			utils.StatusFailedPreempted,
			utils.StatusFailedEvicted,
			utils.StatusFailedStartError,
			utils.StatusFailedBackendError,
			utils.StatusFailedImagePull,
			utils.StatusUnknown,
		}),
	}
	return wl
}

// Run manages the bidirectional streaming lifecycle
func (wl *WorkflowListener) Run(ctx context.Context) error {
	ch := make(chan *pb.ListenerMessage, wl.args.PodUpdateChanSize)
	return wl.BaseListener.Run(
		ctx,
		"Connected to the service, workflow listener stream established",
		ch,
		wl.watchPods,
		wl.sendMessages,
	)
}

// sendMessages reads from the channel and sends messages to the server.
func (wl *WorkflowListener) sendMessages(
	ctx context.Context,
	ch <-chan *pb.ListenerMessage,
) error {
	log.Printf("Starting message sender for workflow channel")
	defer log.Printf("Stopping workflow message sender")

	progressTicker := time.NewTicker(time.Duration(wl.args.ProgressFrequencySec) * time.Second)
	defer progressTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Stopping message sender, draining channel...")
			wl.drainMessageChannel(ch)
			return nil
		case <-progressTicker.C:
			progressWriter := wl.GetProgressWriter()
			if progressWriter != nil {
				if err := progressWriter.ReportProgress(); err != nil {
					log.Printf("Warning: failed to report progress: %v", err)
				}
			}
		case msg, ok := <-ch:
			if !ok {
				log.Println("Pod watcher stopped, draining channel...")
				wl.inst.MessageChannelClosedUnexpectedly.Add(ctx, 1, wl.MetricAttrs)
				wl.drainMessageChannel(ch)
				return fmt.Errorf("pod watcher stopped")
			}
			if err := wl.BaseListener.SendMessage(ctx, msg); err != nil {
				return fmt.Errorf("failed to send message: %w", err)
			}
		}
	}
}

// drainMessageChannel reads remaining messages from ch and adds them to unacked queue.
// This prevents message loss during connection breaks
func (wl *WorkflowListener) drainMessageChannel(ch <-chan *pb.ListenerMessage) {
	drained := 0
	unackedMessages := wl.GetUnackedMessages()
	for {
		select {
		case msg := <-ch:
			unackedMessages.AddMessageForced(msg)
			drained++
		default:
			if drained > 0 {
				log.Printf("Drained %d messages from channel to unacked queue", drained)
			}
			return
		}
	}
}

// watchPods watches for pod changes and writes ListenerMessages to ch.
func (wl *WorkflowListener) watchPods(
	ctx context.Context,
	ch chan<- *pb.ListenerMessage,
) error {
	// Create Kubernetes client
	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	log.Printf("Starting pod watcher for namespace: %s", wl.args.Namespace)

	// State tracker to avoid sending duplicate updates
	stateTracker := newPodStateTracker(time.Duration(wl.args.StateCacheTTLMin) * time.Minute)

	// Create informer factory for the specific namespace
	informerFactory := informers.NewSharedInformerFactoryWithOptions(
		clientset,
		time.Duration(wl.args.ResyncPeriodSec)*time.Second,
		informers.WithNamespace(wl.args.Namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			opts.LabelSelector = "osmo.task_uuid,osmo.workflow_uuid"
		}),
	)

	// Get pod informer (this provides the built-in caching)
	podInformer := informerFactory.Core().V1().Pods().Informer()

	// Helper function to handle pod updates
	handlePodUpdate := func(pod *corev1.Pod) {
		wl.inst.KubeEventWatchCount.Add(ctx, 1, wl.MetricAttrs)

		// Ignore pods with Unknown phase (usually due to temporary connection issues)
		if pod.Status.Phase == corev1.PodUnknown {
			return
		}

		// shouldProcess calculates status once and returns it to avoid duplicate calculation
		if changed, statusResult := stateTracker.shouldProcess(pod); changed {
			msg := createPodUpdateMessage(pod, statusResult, wl.args.Backend, wl.inst)
			select {
			case ch <- msg:
				wl.inst.WorkflowPodStateChangeTotal.Add(ctx, 1, wl.statusAttrs.Get(statusResult.Status))
				wl.inst.MessageQueuedTotal.Add(ctx, 1, wl.MetricAttrs)
				wl.inst.MessageChannelPending.Record(ctx, float64(len(ch)), wl.MetricAttrs)
			case <-ctx.Done():
				return
			}
		}
	}

	_, err = podInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			pod := obj.(*corev1.Pod)
			handlePodUpdate(pod)
		},
		UpdateFunc: func(oldObj, newObj interface{}) {
			pod := newObj.(*corev1.Pod)
			handlePodUpdate(pod)
		},
		DeleteFunc: func(obj interface{}) {
			// Handle tombstone objects (pods deleted during cache resync)
			pod, ok := obj.(*corev1.Pod)
			if !ok {
				tombstone, ok := obj.(cache.DeletedFinalStateUnknown)
				if !ok {
					log.Printf("Error: unexpected object type in DeleteFunc: %T", obj)
					return
				}
				pod, ok = tombstone.Obj.(*corev1.Pod)
				if !ok {
					log.Printf("Error: tombstone contained unexpected object: %T", tombstone.Obj)
					return
				}
			}

			// Ignore pods with Unknown phase (usually due to temporary connection issues)
			if pod.Status.Phase == corev1.PodUnknown {
				return
			}

			if changed, statusResult := stateTracker.shouldProcess(pod); changed {
				msg := createPodUpdateMessage(pod, statusResult, wl.args.Backend, wl.inst)
				select {
				case ch <- msg:
					wl.inst.WorkflowPodStateChangeTotal.Add(ctx, 1, wl.statusAttrs.Get(statusResult.Status))
					wl.inst.MessageQueuedTotal.Add(ctx, 1, wl.MetricAttrs)
					wl.inst.MessageChannelPending.Record(ctx, float64(len(ch)), wl.MetricAttrs)
				case <-ctx.Done():
					return
				}
			}
			// Remove from tracker after checking (in case we need to send one final update)
			stateTracker.remove(pod)
		},
	})
	if err != nil {
		return fmt.Errorf("failed to add event handler: %w", err)
	}

	// Set watch error handler
	// No act because OSMO pod has finializers
	podInformer.SetWatchErrorHandler(func(r *cache.Reflector, err error) {
		log.Printf("Pod watch error: %v", err)
		wl.inst.EventWatchConnectionErrorCount.Add(ctx, 1, wl.MetricAttrs)
	})

	// Start the informer
	informerFactory.Start(ctx.Done())

	// Wait for cache sync
	log.Println("Waiting for pod informer cache to sync...")
	if !cache.WaitForCacheSync(ctx.Done(), podInformer.HasSynced) {
		wl.inst.InformerCacheSyncFailure.Add(ctx, 1, wl.MetricAttrs)
		return fmt.Errorf("failed to sync pod informer cache")
	}
	log.Println("Pod informer cache synced successfully")
	wl.inst.InformerCacheSyncSuccess.Add(ctx, 1, wl.MetricAttrs)

	// Keep the watcher running
	<-ctx.Done()
	log.Println("Pod watcher stopped")
	return nil
}

// parseRetryID parses the retry_id label string to int32, defaulting to 0
func parseRetryID(retryIDStr string) int32 {
	retryID := int32(0)
	if retryIDStr != "" {
		fmt.Sscanf(retryIDStr, "%d", &retryID)
	}
	return retryID
}

// podStateKey identifies a pod for state tracking (workflow_uuid, task_uuid, retry_id).
type podStateKey struct {
	workflowUUID string
	taskUUID     string
	retryID      string
}

// podStateEntry represents a tracked pod state with timestamp
type podStateEntry struct {
	status    string
	timestamp time.Time
}

// podStateTracker tracks the last sent state for each pod to avoid duplicate messages
type podStateTracker struct {
	mu     sync.RWMutex
	states map[podStateKey]podStateEntry
	ttl    time.Duration // time after which entries are considered stale
}

// newPodStateTracker creates a pod state tracker with the given TTL.
func newPodStateTracker(ttl time.Duration) *podStateTracker {
	return &podStateTracker{
		states: make(map[podStateKey]podStateEntry),
		ttl:    ttl,
	}
}

// shouldProcess reports whether the pod should be processed (status changed or TTL expired)
// and returns the computed status to avoid duplicate calculation.
func (pst *podStateTracker) shouldProcess(pod *corev1.Pod) (bool, utils.TaskStatusResult) {
	key := podStateKey{
		workflowUUID: pod.Labels["osmo.workflow_uuid"],
		taskUUID:     pod.Labels["osmo.task_uuid"],
		retryID:      pod.Labels["osmo.retry_id"],
	}

	statusResult := utils.CalculateTaskStatus(pod)
	if statusResult.Status == utils.StatusUnknown {
		return false, utils.TaskStatusResult{}
	}

	now := time.Now()

	pst.mu.Lock()
	defer pst.mu.Unlock()

	entry, exists := pst.states[key]

	// Return false if status unchanged and TTL not expired
	if exists && entry.status == statusResult.Status && now.Sub(entry.timestamp) <= pst.ttl {
		return false, utils.TaskStatusResult{}
	}

	// Send if: new pod, status changed, or TTL expired
	pst.states[key] = podStateEntry{
		status:    statusResult.Status,
		timestamp: now,
	}
	return true, statusResult
}

// remove removes a pod from the state tracker
func (pst *podStateTracker) remove(pod *corev1.Pod) {
	key := podStateKey{
		workflowUUID: pod.Labels["osmo.workflow_uuid"],
		taskUUID:     pod.Labels["osmo.task_uuid"],
		retryID:      pod.Labels["osmo.retry_id"],
	}
	pst.mu.Lock()
	defer pst.mu.Unlock()
	delete(pst.states, key)
}

// createPodUpdateMessage creates a ListenerMessage from a pod object
func createPodUpdateMessage(
	pod *corev1.Pod,
	statusResult utils.TaskStatusResult,
	backend string,
	inst *utils.Instruments,
) *pb.ListenerMessage {
	// Build pod update structure using proto-generated type
	podUpdate := &pb.UpdatePodBody{
		WorkflowUuid: pod.Labels["osmo.workflow_uuid"],
		TaskUuid:     pod.Labels["osmo.task_uuid"],
		RetryId:      parseRetryID(pod.Labels["osmo.retry_id"]),
		Container:    pod.Spec.Containers[0].Name,
		Node:         pod.Spec.NodeName,
		PodIp:        pod.Status.PodIP,
		Message:      statusResult.Message,
		Status:       statusResult.Status,
		ExitCode:     statusResult.ExitCode,
		Backend:      backend,
	}

	// Add conditions and calculate processing time metric
	for _, cond := range pod.Status.Conditions {
		podUpdate.Conditions = append(podUpdate.Conditions, &pb.ConditionMessage{
			Reason:    cond.Reason,
			Message:   cond.Message,
			Timestamp: cond.LastTransitionTime.Time.UTC().Format("2006-01-02T15:04:05.999999"),
			Status:    cond.Status == corev1.ConditionTrue,
			Type:      string(cond.Type),
		})

		// Record event_processing_times metric for significant condition changes
		if cond.Status == corev1.ConditionTrue && !cond.LastTransitionTime.IsZero() {
			processingDelay := time.Since(cond.LastTransitionTime.Time).Seconds()
			inst.EventProcessingTimes.Record(context.Background(), processingDelay)
		}
	}

	// Generate random UUID (matching Python's uuid.uuid4().hex format)
	messageUUID := strings.ReplaceAll(uuid.New().String(), "-", "")

	msg := &pb.ListenerMessage{
		Uuid:      messageUUID,
		Timestamp: time.Now().UTC().Format("2006-01-02T15:04:05.999999"),
		Body: &pb.ListenerMessage_UpdatePod{
			UpdatePod: podUpdate,
		},
	}

	log.Printf(
		"Sent update_pod: (pod=%s, status=%s)",
		pod.Name, podUpdate.Status,
	)

	return msg
}
