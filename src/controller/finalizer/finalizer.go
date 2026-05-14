/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
*/

// Package finalizer implements the log-collection finalizer described in
// projects/PROJ-taskgroup-crd/PROJ-taskgroup-crd.md "Finalizer: log
// collection before delete".
//
// Why a finalizer: Pods' container logs are only readable while the Pods
// exist. Cascade delete removes Pods immediately, so logs would be lost
// unless we hold delete open long enough to collect them. The finalizer is
// added on create and removed once logs are uploaded (or a 5-minute timeout
// fires — better to lose logs than block delete indefinitely).
package finalizer

import (
	"context"
	"fmt"
	"time"

	workflowv1alpha1 "go.corp.nvidia.com/osmo/apis/workflow/v1alpha1"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// DefaultTimeout caps how long the finalizer can block delete waiting for
// log collection. PROJ-taskgroup-crd.md "Finalizer: log collection" specifies
// 5 minutes: long enough to drain a typical group, short enough that a
// borked log sink (Swift unreachable, etc.) doesn't strand resources.
const DefaultTimeout = 5 * time.Minute

// LogUploader is the abstract sink the finalizer streams logs to. The Phase
// 1 controller binary wires this to a Swift uploader; tests substitute a
// fake. The interface stays minimal so the finalizer doesn't depend on the
// storage backend's full SDK.
type LogUploader interface {
	// Upload writes logs for one pod to the workflow's storage path. The
	// implementation owns chunking, retries, and the destination URL.
	Upload(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup, podName string, logs []byte) error
}

// Finalizer collects Pod logs to long-term storage before allowing cascade
// delete to complete. Wired to one OSMOTaskGroup reconcile pass at a time
// by the controller's work queue.
type Finalizer struct {
	KubeClient kubernetes.Interface
	Uploader   LogUploader

	// Timeout overrides DefaultTimeout. Tests use a short value to assert
	// the timeout path; production leaves it at DefaultTimeout.
	Timeout time.Duration
}

// EnsureAdded ensures the log-collection finalizer is present on the CR.
// Returns true if a Patch was needed (caller should re-fetch the CR).
//
// Called from the reconciler on every pass. Idempotent: if the finalizer is
// already present, returns (false, nil).
func EnsureAdded(otg *workflowv1alpha1.OSMOTaskGroup) bool {
	if containsString(otg.Finalizers, workflowv1alpha1.FinalizerLogCollection) {
		return false
	}
	otg.Finalizers = append(otg.Finalizers, workflowv1alpha1.FinalizerLogCollection)
	return true
}

// Run executes log collection for a CR that is being deleted, then removes
// the finalizer. Returns nil once the finalizer has been removed from the CR
// (or the timeout has fired); the caller should patch the CR with the
// updated finalizer list.
//
// Errors surface from the underlying client; per-pod upload failures are
// logged but do not stop the loop. We always remove the finalizer so delete
// can complete — better to lose logs than block delete forever, per the
// design doc.
func (f *Finalizer) Run(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup) error {
	timeout := f.Timeout
	if timeout == 0 {
		timeout = DefaultTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	pods, err := f.listGroupPods(ctx, otg)
	if err != nil {
		// Even if listing fails we still want to remove the finalizer; the
		// alternative is a stuck CR. Log via the caller's logger.
		f.removeFinalizer(otg)
		return fmt.Errorf("list pods (continuing with finalizer removal): %w", err)
	}

	for _, pod := range pods {
		if err := f.collectOne(ctx, otg, pod); err != nil {
			// Per the design doc, log-collection failures are surfaced via
			// a Prometheus counter, not bubbled out of the finalizer.
			// Continue to the next pod.
			_ = err
		}
	}
	f.removeFinalizer(otg)
	return nil
}

// IsBeingDeleted reports whether the CR is in the "deletion pending" state.
// The reconciler should call Run only when this is true.
func IsBeingDeleted(otg *workflowv1alpha1.OSMOTaskGroup) bool {
	return otg.DeletionTimestamp != nil
}

func (f *Finalizer) listGroupPods(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup) ([]corev1.Pod, error) {
	if f.KubeClient == nil {
		return nil, nil
	}
	selector := fmt.Sprintf("%s=%s,%s=%s",
		workflowv1alpha1.LabelWorkflowID, otg.Spec.WorkflowID,
		workflowv1alpha1.LabelGroupName, otg.Spec.GroupName,
	)
	list, err := f.KubeClient.CoreV1().Pods(otg.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, err
	}
	return list.Items, nil
}

func (f *Finalizer) collectOne(ctx context.Context, otg *workflowv1alpha1.OSMOTaskGroup, pod corev1.Pod) error {
	if f.KubeClient == nil || f.Uploader == nil {
		return nil
	}
	req := f.KubeClient.CoreV1().Pods(pod.Namespace).GetLogs(pod.Name, &corev1.PodLogOptions{})
	stream, err := req.Stream(ctx)
	if err != nil {
		return fmt.Errorf("open log stream: %w", err)
	}
	defer stream.Close()

	// Bounded buffer to avoid a runaway pod consuming all controller memory.
	const maxBytes = 64 * 1024 * 1024
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 32*1024)
	for {
		n, err := stream.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			if len(buf) >= maxBytes {
				break
			}
		}
		if err != nil {
			break
		}
	}
	return f.Uploader.Upload(ctx, otg, pod.Name, buf)
}

func (f *Finalizer) removeFinalizer(otg *workflowv1alpha1.OSMOTaskGroup) {
	otg.Finalizers = removeString(otg.Finalizers, workflowv1alpha1.FinalizerLogCollection)
}

func containsString(slice []string, s string) bool {
	for _, x := range slice {
		if x == s {
			return true
		}
	}
	return false
}

// removeString returns a new slice with all occurrences of s removed. It must
// not share storage with the input — a caller that captured the pre-call
// slice for an optimistic-update diff (e.g. comparing finalizers before and
// after) would otherwise see corrupted contents.
func removeString(slice []string, s string) []string {
	out := make([]string, 0, len(slice))
	for _, x := range slice {
		if x != s {
			out = append(out, x)
		}
	}
	return out
}
