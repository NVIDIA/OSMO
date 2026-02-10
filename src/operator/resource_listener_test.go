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
	"testing"

	"go.corp.nvidia.com/osmo/operator/utils"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// Test NodeUsageAggregator
func TestNodeUsageAggregator_UpdatePod(t *testing.T) {
	agg := utils.NewNodeUsageAggregator("osmo")

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-1",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("1000m"),
							corev1.ResourceMemory: resource.MustParse("1Gi"),
						},
					},
				},
			},
		},
	}

	agg.AddPod(pod)

	usageFields, nonWorkflowFields := agg.GetNodeUsage("node-1")

	if usageFields["cpu"] != "1" { // 1000m = 1 core
		t.Errorf("CPU = %s, expected 1", usageFields["cpu"])
	}
	if usageFields["memory"] != "1048576Ki" {
		t.Errorf("Memory = %s, expected 1048576Ki", usageFields["memory"])
	}
	if nonWorkflowFields["cpu"] != "0" {
		t.Errorf("Non-workflow CPU = %s, expected 0", nonWorkflowFields["cpu"])
	}
}

func TestNodeUsageAggregator_DeletePod(t *testing.T) {
	agg := utils.NewNodeUsageAggregator("osmo")

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-2",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("500m"),
							corev1.ResourceMemory: resource.MustParse("512Mi"),
						},
					},
				},
			},
		},
	}

	// Add then delete
	agg.AddPod(pod)
	agg.DeletePod(pod)

	usageFields, _ := agg.GetNodeUsage("node-1")

	if usageFields["cpu"] != "0" {
		t.Errorf("CPU after delete = %s, expected 0", usageFields["cpu"])
	}
	if usageFields["memory"] != "0Ki" {
		t.Errorf("Memory after delete = %s, expected 0Ki", usageFields["memory"])
	}
}

func TestNodeUsageAggregator_DuplicateUpdateIgnored(t *testing.T) {
	// In Kubernetes, pod spec.nodeName and resource requests are immutable after creation.
	// Therefore, duplicate UpdatePod calls for the same UID should be ignored.
	agg := utils.NewNodeUsageAggregator("osmo")

	// Create pod on node-1
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-3",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("1000m"),
						},
					},
				},
			},
		},
	}

	agg.AddPod(pod)

	// Attempt to "migrate" to node-2 (impossible in real K8s, but test that it's ignored)
	pod.Spec.NodeName = "node-2"
	agg.AddPod(pod)

	usageFields1, _ := agg.GetNodeUsage("node-1")
	usageFields2, _ := agg.GetNodeUsage("node-2")

	// Node-1 should still have the CPU since duplicate updates are ignored
	if usageFields1["cpu"] != "1" { // 1000m = 1 core
		t.Errorf("Node-1 CPU after duplicate update = %s, expected 1 (unchanged)", usageFields1["cpu"])
	}
	// Node-2 should have 0 since the second update was ignored
	if usageFields2["cpu"] != "0" {
		t.Errorf("Node-2 CPU after duplicate update = %s, expected 0 (ignored)", usageFields2["cpu"])
	}
}

func TestNodeUsageAggregator_NonWorkflowNamespace(t *testing.T) {
	agg := utils.NewNodeUsageAggregator("osmo")

	// Pod in workflow namespace
	workflowPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "workflow-pod",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("1000m"),
						},
					},
				},
			},
		},
	}

	// Pod in non-workflow namespace
	systemPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "system-pod",
			Namespace: "kube-system",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "system",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("500m"),
						},
					},
				},
			},
		},
	}

	agg.AddPod(workflowPod)
	agg.AddPod(systemPod)

	usageFields, nonWorkflowFields := agg.GetNodeUsage("node-1")

	if usageFields["cpu"] != "2" { // 1000m + 500m = 1500m = 2 cores (ceiling)
		t.Errorf("Total CPU = %s, expected 2", usageFields["cpu"])
	}
	if nonWorkflowFields["cpu"] != "1" { // 500m = 1 core (ceiling)
		t.Errorf("Non-workflow CPU = %s, expected 1", nonWorkflowFields["cpu"])
	}
}

// Test pod lifecycle transitions for event handler logic
func TestPodLifecycle_PendingToRunning(t *testing.T) {
	agg := utils.NewNodeUsageAggregator("osmo")

	// Create a pod in Pending state
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-lifecycle-1",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("1000m"),
						},
					},
				},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPending,
		},
	}

	// Simulate AddFunc during cache sync - pod is Pending, should not be tracked
	if pod.Status.Phase == corev1.PodRunning {
		agg.AddPod(pod)
	}

	usageFields, _ := agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "0" {
		t.Errorf("CPU for Pending pod = %s, expected 0", usageFields["cpu"])
	}

	// Simulate UpdateFunc: Pending → Running
	oldPod := pod.DeepCopy()
	pod.Status.Phase = corev1.PodRunning

	wasRunning := oldPod.Status.Phase == corev1.PodRunning
	isRunning := pod.Status.Phase == corev1.PodRunning

	if !wasRunning && isRunning && pod.Spec.NodeName != "" {
		agg.AddPod(pod)
	}

	usageFields, _ = agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "1" { // 1000m = 1 core
		t.Errorf("CPU after Running = %s, expected 1", usageFields["cpu"])
	}
}

func TestPodLifecycle_RunningToSucceeded(t *testing.T) {
	agg := utils.NewNodeUsageAggregator("osmo")

	// Create a Running pod
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-lifecycle-2",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("2000m"),
						},
					},
				},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	agg.AddPod(pod)

	usageFields, _ := agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "2" { // 2000m = 2 cores
		t.Errorf("CPU for Running pod = %s, expected 2", usageFields["cpu"])
	}

	// Simulate UpdateFunc: Running → Succeeded
	oldPod := pod.DeepCopy()
	pod.Status.Phase = corev1.PodSucceeded

	wasRunning := oldPod.Status.Phase == corev1.PodRunning
	if wasRunning {
		isTerminal := pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed
		if isTerminal {
			agg.DeletePod(pod)
		}
	}

	usageFields, _ = agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "0" {
		t.Errorf("CPU after Succeeded = %s, expected 0", usageFields["cpu"])
	}
}

func TestPodLifecycle_RunningToFailed(t *testing.T) {
	agg := utils.NewNodeUsageAggregator("osmo")

	// Create a Running pod
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-lifecycle-3",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("1500m"),
						},
					},
				},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	agg.AddPod(pod)

	usageFields, _ := agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "2" { // 1500m = 2 cores (ceiling)
		t.Errorf("CPU for Running pod = %s, expected 2", usageFields["cpu"])
	}

	// Simulate UpdateFunc: Running → Failed
	oldPod := pod.DeepCopy()
	pod.Status.Phase = corev1.PodFailed

	wasRunning := oldPod.Status.Phase == corev1.PodRunning
	if wasRunning {
		isTerminal := pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed
		if isTerminal {
			agg.DeletePod(pod)
		}
	}

	usageFields, _ = agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "0" {
		t.Errorf("CPU after Failed = %s, expected 0", usageFields["cpu"])
	}
}

func TestPodLifecycle_DeletionTimestamp(t *testing.T) {
	agg := utils.NewNodeUsageAggregator("osmo")

	// Create a Running pod
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-lifecycle-4",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("3000m"),
						},
					},
				},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	agg.AddPod(pod)

	usageFields, _ := agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "3" { // 3000m = 3 cores
		t.Errorf("CPU for Running pod = %s, expected 3", usageFields["cpu"])
	}

	// Simulate UpdateFunc: DeletionTimestamp set (pod being evicted/preempted)
	oldPod := pod.DeepCopy()
	now := metav1.Now()
	pod.ObjectMeta.DeletionTimestamp = &now

	wasRunning := oldPod.Status.Phase == corev1.PodRunning
	if wasRunning {
		isTerminal := pod.ObjectMeta.DeletionTimestamp != nil && oldPod.ObjectMeta.DeletionTimestamp == nil
		if isTerminal {
			agg.DeletePod(pod)
		}
	}

	usageFields, _ = agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "0" {
		t.Errorf("CPU after DeletionTimestamp set = %s, expected 0", usageFields["cpu"])
	}
}

func TestPodLifecycle_AllContainersTerminated(t *testing.T) {
	agg := utils.NewNodeUsageAggregator("osmo")

	// Create a Running pod
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-lifecycle-5",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("2500m"),
						},
					},
				},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name: "main",
					State: corev1.ContainerState{
						Running: &corev1.ContainerStateRunning{},
					},
				},
			},
		},
	}

	agg.AddPod(pod)

	usageFields, _ := agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "3" { // 2500m = 3 cores (ceiling)
		t.Errorf("CPU for Running pod = %s, expected 3", usageFields["cpu"])
	}

	// Simulate UpdateFunc: All containers terminated (phase might lag behind)
	oldPod := pod.DeepCopy()
	pod.Status.ContainerStatuses[0].State = corev1.ContainerState{
		Terminated: &corev1.ContainerStateTerminated{
			ExitCode: 0,
		},
	}

	wasRunning := oldPod.Status.Phase == corev1.PodRunning
	if wasRunning {
		// Check if all containers terminated
		allTerminated := true
		for _, cs := range pod.Status.ContainerStatuses {
			if cs.State.Terminated == nil {
				allTerminated = false
				break
			}
		}
		if allTerminated {
			agg.DeletePod(pod)
		}
	}

	usageFields, _ = agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "0" {
		t.Errorf("CPU after all containers terminated = %s, expected 0", usageFields["cpu"])
	}
}

func TestPodLifecycle_MultiplePodsConcurrent(t *testing.T) {
	agg := utils.NewNodeUsageAggregator("osmo")

	// Create three pods
	pod1 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-multi-1",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("1000m"),
						},
					},
				},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	pod2 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-multi-2",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("2000m"),
						},
					},
				},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	pod3 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       "test-pod-multi-3",
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU: resource.MustParse("500m"),
						},
					},
				},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	// All three pods running
	agg.AddPod(pod1)
	agg.AddPod(pod2)
	agg.AddPod(pod3)

	usageFields, _ := agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "4" { // 1000m + 2000m + 500m = 3500m = 4 cores (ceiling)
		t.Errorf("Total CPU = %s, expected 4", usageFields["cpu"])
	}

	// Pod2 completes successfully
	pod2.Status.Phase = corev1.PodSucceeded
	agg.DeletePod(pod2)

	usageFields, _ = agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "2" { // 1000m + 500m = 1500m = 2 cores (ceiling)
		t.Errorf("CPU after pod2 succeeded = %s, expected 2", usageFields["cpu"])
	}

	// Pod3 deleted
	agg.DeletePod(pod3)

	usageFields, _ = agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "1" { // 1000m = 1 core
		t.Errorf("CPU after pod3 deleted = %s, expected 1", usageFields["cpu"])
	}

	// Pod1 still running - duplicate update should be ignored
	agg.AddPod(pod1)

	usageFields, _ = agg.GetNodeUsage("node-1")
	if usageFields["cpu"] != "1" { // 1000m = 1 core
		t.Errorf("CPU after duplicate update = %s, expected 1", usageFields["cpu"])
	}
}

func TestNewResourceListener(t *testing.T) {
	args := utils.ListenerArgs{
		ServiceURL:            "http://localhost:8000",
		Backend:               "test-backend",
		Namespace:             "osmo",
		PodUpdateChanSize:     500,
		ResyncPeriodSec:       300,
		StateCacheTTLMin:      15,
		MaxUnackedMessages:    100,
		NodeConditionPrefix:   "osmo.nvidia.com/",
		ProgressDir:           "/tmp/osmo/operator/",
		ProgressFrequencySec:  15,
		UsageFlushIntervalSec: 5,
	}

	listener := NewResourceListener(args)

	if listener == nil {
		t.Fatal("Expected non-nil listener")
	}

	if listener.args.ServiceURL != "http://localhost:8000" {
		t.Errorf("ServiceURL = %s, expected http://localhost:8000", listener.args.ServiceURL)
	}

	if listener.aggregator == nil {
		t.Error("Expected aggregator to be initialized")
	}

	if listener.GetUnackedMessages() == nil {
		t.Error("Expected unackedMessages to be initialized")
	}
}

func BenchmarkNodeUsageAggregator_UpdatePod(b *testing.B) {
	agg := utils.NewNodeUsageAggregator("osmo")

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       types.UID("bench-pod"),
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{
				{
					Name: "main",
					Resources: corev1.ResourceRequirements{
						Requests: corev1.ResourceList{
							corev1.ResourceCPU:    resource.MustParse("1000m"),
							corev1.ResourceMemory: resource.MustParse("1Gi"),
						},
					},
				},
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		agg.AddPod(pod)
	}
}
