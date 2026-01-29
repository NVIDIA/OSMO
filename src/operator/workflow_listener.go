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
	pb "go.corp.nvidia.com/osmo/proto/compute_connector"
)

// WorkflowListener manages the bidirectional gRPC stream connection to the service
type WorkflowListener struct {
	*utils.BaseListener
	args      utils.ListenerArgs
	stream    pb.ListenerService_ListenerStreamClient
	closeOnce sync.Once
}

// NewWorkflowListener creates a new workflow listener instance
func NewWorkflowListener(args utils.ListenerArgs) *WorkflowListener {
	return &WorkflowListener{
		BaseListener: utils.NewBaseListener(args, "last_progress_workflow_listener"),
		args:         args,
	}
}

// Connect establishes a gRPC connection and stream
func (wl *WorkflowListener) Connect(ctx context.Context) error {
	// Initialize the base connection
	if err := wl.BaseListener.InitConnection(ctx, wl.args.ServiceURL); err != nil {
		return err
	}

	// Establish the bidirectional stream
	var err error
	wl.stream, err = wl.GetClient().ListenerStream(ctx)
	if err != nil {
		return fmt.Errorf("failed to create stream: %w", err)
	}

	// Context for coordinated shutdown of goroutines with error cause
	wl.InitStreamContext(ctx)

	log.Printf("Connected to compute service, stream established")
	return nil
}

// Run manages the bidirectional streaming lifecycle
func (wl *WorkflowListener) Run(ctx context.Context) error {
	if err := wl.Connect(ctx); err != nil {
		return err
	}
	defer wl.Close()

	// Resend all unacked messages from previous connection (if any)
	if err := wl.GetUnackedMessages().ResendAll(wl.stream); err != nil {
		return err
	}

	// Launch goroutines for send and receive
	wl.AddToWaitGroup(2)
	go func() {
		defer wl.WaitGroupDone()
		wl.BaseListener.ReceiveAcks(wl.stream, "workflow")
	}()

	go func() {
		defer wl.WaitGroupDone()
		wl.sendMessages()
	}()

	// Wait for completion
	return wl.WaitForCompletion(ctx, wl.closeStream)
}

// receiveMessages handles receiving ACK messages from the server
// sendMessages consumes pod updates from a channel and sends them to the server
func (wl *WorkflowListener) sendMessages() {
	// Create a channel to receive pod updates (with pre-calculated status) from the watcher
	podUpdateChan := make(chan podWithStatus, wl.args.PodUpdateChanSize)

	// Create a channel to signal if watchPod exits unexpectedly
	watcherDone := make(chan struct{})

	streamCtx := wl.GetStreamContext()
	streamCancel := wl.GetStreamCancel()

	// Start pod watcher in a separate goroutine
	go func() {
		defer close(watcherDone)
		watchPod(streamCtx, wl.args, podUpdateChan)
	}()

	// Ticker to report progress when idle
	progressTicker := time.NewTicker(time.Duration(wl.args.ProgressFrequencySec) * time.Second)
	defer progressTicker.Stop()

	// Send pod updates to the server
	for {
		select {
		case <-streamCtx.Done():
			log.Println("Stopping message sender, draining channel...")
			wl.drainChannel(podUpdateChan)
			return
		case <-watcherDone:
			log.Println("Pod watcher stopped unexpectedly, draining channel...")
			wl.drainChannel(podUpdateChan)
			streamCancel(fmt.Errorf("pod watcher stopped"))
			return
		case <-progressTicker.C:
			// Report progress periodically even when idle
			progressWriter := wl.GetProgressWriter()
			if progressWriter != nil {
				if err := progressWriter.ReportProgress(); err != nil {
					log.Printf("Warning: failed to report progress: %v", err)
				}
			}
		case update := <-podUpdateChan:
			if err := wl.sendPodUpdate(update); err != nil {
				streamCancel(fmt.Errorf("failed to send message: %w", err))
				return
			}
		}
	}
}

// sendPodUpdate sends a single pod update message
func (wl *WorkflowListener) sendPodUpdate(update podWithStatus) error {
	// Use pre-calculated status result from the channel to avoid duplicate calculation
	msg, err := createPodUpdateMessage(update.pod, update.statusResult, wl.args.Backend)
	if err != nil {
		log.Printf("Failed to create pod update message: %v", err)
		return nil // Don't fail the stream for one message
	}

	streamCtx := wl.GetStreamContext()
	unackedMessages := wl.GetUnackedMessages()

	// Add message to unacked queue before sending
	if err := unackedMessages.AddMessage(streamCtx, msg); err != nil {
		log.Printf("Failed to add message to unacked queue: %v", err)
		return nil // Don't fail the stream
	}

	if err := wl.stream.Send(msg); err != nil {
		return err
	}

	return nil
}

// drainChannel saves any remaining messages in the channel to unacked queue
// This prevents message loss during connection breaks
func (wl *WorkflowListener) drainChannel(podUpdateChan <-chan podWithStatus) {
	drained := 0
	unackedMessages := wl.GetUnackedMessages()
	for {
		select {
		case update := <-podUpdateChan:
			msg, err := createPodUpdateMessage(update.pod, update.statusResult, wl.args.Backend)
			if err != nil {
				log.Printf("Failed to create message during drain: %v", err)
				continue
			}
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

// closeStream ensures stream is closed only once
func (wl *WorkflowListener) closeStream() {
	wl.closeOnce.Do(func() {
		if wl.stream != nil {
			if err := wl.stream.CloseSend(); err != nil {
				log.Printf("Error closing stream: %v", err)
			}
		}
	})
}

// Close cleans up resources
func (wl *WorkflowListener) Close() {
	wl.closeStream()
	wl.BaseListener.CloseConnection()
}

// podWithStatus bundles a pod with its calculated status to avoid duplicate computation
type podWithStatus struct {
	pod          *corev1.Pod
	statusResult utils.TaskStatusResult
}

// podStateEntry represents a tracked pod state with timestamp
type podStateEntry struct {
	status    string
	timestamp time.Time
}

// podStateTracker tracks the last sent state for each pod to avoid duplicate messages
type podStateTracker struct {
	mu     sync.RWMutex
	states map[string]podStateEntry // key: workflow_uuid-task_uuid-retry_id
	ttl    time.Duration            // time after which entries are considered stale
}

// getPodKey creates a composite key from pod labels
func getPodKey(pod *corev1.Pod) string {
	workflowUUID := pod.Labels["osmo.workflow_uuid"]
	taskUUID := pod.Labels["osmo.task_uuid"]
	retryID := pod.Labels["osmo.retry_id"]
	return fmt.Sprintf("%s-%s-%s", workflowUUID, taskUUID, retryID)
}

// hasChanged checks if the pod's status has changed since last sent, or if the TTL has expired
// Returns (changed bool, statusResult TaskStatusResult) to avoid duplicate status calculation
func (pst *podStateTracker) hasChanged(pod *corev1.Pod) (bool, utils.TaskStatusResult) {
	key := getPodKey(pod)

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
	key := getPodKey(pod)
	pst.mu.Lock()
	defer pst.mu.Unlock()
	delete(pst.states, key)
}

// watchPod watches for pod changes and sends them to a channel using
// the Kubernetes informer pattern with native caching support.
// It filters for OSMO-managed pods and sends updates through the channel.
func watchPod(
	ctx context.Context,
	args utils.ListenerArgs,
	podUpdateChan chan<- podWithStatus,
) {
	// Create Kubernetes client
	clientset, err := utils.CreateKubernetesClient()
	if err != nil {
		log.Printf("Failed to create kubernetes client: %v", err)
		return
	}

	log.Printf("Starting pod watcher for namespace: %s", args.Namespace)

	// State tracker to avoid sending duplicate updates
	// TTL matches Python backend_listener behavior for consistency
	stateTracker := &podStateTracker{
		states: make(map[string]podStateEntry),
		ttl:    time.Duration(args.StateCacheTTLMin) * time.Minute,
	}

	// Create informer factory for the specific namespace
	// Filter for OSMO-managed pods at the API server level
	informerFactory := informers.NewSharedInformerFactoryWithOptions(
		clientset,
		time.Duration(args.ResyncPeriodSec)*time.Second,
		informers.WithNamespace(args.Namespace),
		informers.WithTweakListOptions(func(opts *metav1.ListOptions) {
			// Only watch pods with both OSMO labels
			opts.LabelSelector = "osmo.task_uuid,osmo.workflow_uuid"
		}),
	)

	// Get pod informer (this provides the built-in caching)
	podInformer := informerFactory.Core().V1().Pods().Informer()

	// Helper function to handle pod updates
	handlePodUpdate := func(pod *corev1.Pod) {
		// Ignore pods with Unknown phase (usually due to temporary connection issues)
		if pod.Status.Phase == corev1.PodUnknown {
			return
		}

		// hasChanged calculates status once and returns it to avoid duplicate calculation
		if changed, statusResult := stateTracker.hasChanged(pod); changed {
			select {
			case podUpdateChan <- podWithStatus{pod: pod, statusResult: statusResult}:
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

			// Check if status has changed before sending (same as UpdateFunc)
			// This prevents duplicate messages when pods are deleted shortly after reaching final state
			if changed, statusResult := stateTracker.hasChanged(pod); changed {
				select {
				case podUpdateChan <- podWithStatus{pod: pod, statusResult: statusResult}:
				case <-ctx.Done():
					return
				}
			}
			// Remove from tracker after checking (in case we need to send one final update)
			stateTracker.remove(pod)
		},
	})
	if err != nil {
		log.Printf("Failed to add event handler: %v", err)
		return
	}

	// Start the informer
	informerFactory.Start(ctx.Done())

	// Wait for cache sync
	log.Println("Waiting for pod informer cache to sync...")
	if !cache.WaitForCacheSync(ctx.Done(), podInformer.HasSynced) {
		log.Println("Failed to sync pod informer cache")
		return
	}
	log.Println("Pod informer cache synced successfully")

	// Keep the watcher running
	<-ctx.Done()
	log.Println("Pod watcher stopped")
}

// parseRetryID parses the retry_id label string to int32, defaulting to 0
func parseRetryID(retryIDStr string) int32 {
	retryID := int32(0)
	if retryIDStr != "" {
		fmt.Sscanf(retryIDStr, "%d", &retryID)
	}
	return retryID
}

// createPodUpdateMessage creates a ListenerMessage from a pod object
func createPodUpdateMessage(
	pod *corev1.Pod,
	statusResult utils.TaskStatusResult,
	backend string,
) (*pb.ListenerMessage, error) {
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

	// Add conditions
	for _, cond := range pod.Status.Conditions {
		podUpdate.Conditions = append(podUpdate.Conditions, &pb.ConditionMessage{
			Reason:    cond.Reason,
			Message:   cond.Message,
			Timestamp: cond.LastTransitionTime.Time.UTC().Format("2006-01-02T15:04:05.999999"),
			Status:    cond.Status == corev1.ConditionTrue,
			Type:      string(cond.Type),
		})
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

	return msg, nil
}
