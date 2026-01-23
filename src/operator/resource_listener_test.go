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
	"time"

	pb "go.corp.nvidia.com/osmo/proto/operator"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// Test buildResourceBody function
func TestBuildResourceBody_Basic(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: "test-node-1",
			Labels: map[string]string{
				"kubernetes.io/hostname":         "worker-node-1",
				"node-role.kubernetes.io/worker": "",
			},
		},
		Spec: corev1.NodeSpec{
			Unschedulable: false,
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:              resource.MustParse("8"),
				corev1.ResourceMemory:           resource.MustParse("16Gi"),
				corev1.ResourceEphemeralStorage: resource.MustParse("100Gi"),
			},
		},
	}

	body := buildResourceBody(node, false)

	if body.Hostname != "worker-node-1" {
		t.Errorf("Hostname = %s, expected worker-node-1", body.Hostname)
	}

	if !body.Available {
		t.Error("Expected node to be available")
	}

	if body.Delete {
		t.Error("Expected Delete to be false")
	}

	// Check allocatable fields
	if body.AllocatableFields["cpu"] != "8000" { // 8 cores = 8000 millicores
		t.Errorf("CPU allocatable = %s, expected 8000", body.AllocatableFields["cpu"])
	}

	// Check labels are present
	if _, ok := body.LabelFields["node-role.kubernetes.io/worker"]; !ok {
		t.Error("Expected worker role label to be present")
	}
}

func TestBuildResourceBody_Unschedulable(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"kubernetes.io/hostname": "cordoned-node",
			},
		},
		Spec: corev1.NodeSpec{
			Unschedulable: true,
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}

	body := buildResourceBody(node, false)

	if body.Available {
		t.Error("Expected unschedulable node to be unavailable")
	}
}

func TestBuildResourceBody_NotReady(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"kubernetes.io/hostname": "not-ready-node",
			},
		},
		Spec: corev1.NodeSpec{
			Unschedulable: false,
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionFalse,
				},
			},
		},
	}

	body := buildResourceBody(node, false)

	if body.Available {
		t.Error("Expected not-ready node to be unavailable")
	}
}

func TestBuildResourceBody_Conditions(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"kubernetes.io/hostname": "test-node",
			},
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
				{
					Type:   corev1.NodeMemoryPressure,
					Status: corev1.ConditionFalse,
				},
				{
					Type:   corev1.NodeDiskPressure,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}

	body := buildResourceBody(node, false)

	// Only conditions with Status=True should be included
	expectedConditions := map[string]bool{
		"Ready":        true,
		"DiskPressure": true,
	}

	if len(body.Conditions) != len(expectedConditions) {
		t.Errorf("Expected %d conditions, got %d", len(expectedConditions), len(body.Conditions))
	}

	for _, cond := range body.Conditions {
		if !expectedConditions[cond] {
			t.Errorf("Unexpected condition: %s", cond)
		}
	}
}

func TestBuildResourceBody_LabelFiltering(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"kubernetes.io/hostname":                "test-node",
				"node-role.kubernetes.io/worker":        "",
				"feature.node.kubernetes.io/cpu-cpuid":  "AVX512",
				"feature.node.kubernetes.io/gpu-vendor": "nvidia",
				"custom-label":                          "custom-value",
			},
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}

	body := buildResourceBody(node, false)

	// feature.node.kubernetes.io prefixed labels should be filtered out
	if _, ok := body.LabelFields["feature.node.kubernetes.io/cpu-cpuid"]; ok {
		t.Error("Expected feature.node.kubernetes.io labels to be filtered out")
	}

	if _, ok := body.LabelFields["feature.node.kubernetes.io/gpu-vendor"]; ok {
		t.Error("Expected feature.node.kubernetes.io labels to be filtered out")
	}

	// Other labels should be present
	if _, ok := body.LabelFields["node-role.kubernetes.io/worker"]; !ok {
		t.Error("Expected node-role label to be present")
	}

	if body.LabelFields["custom-label"] != "custom-value" {
		t.Error("Expected custom-label to be present")
	}
}

func TestBuildResourceBody_Taints(t *testing.T) {
	timeAdded := metav1.Now()

	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"kubernetes.io/hostname": "tainted-node",
			},
		},
		Spec: corev1.NodeSpec{
			Taints: []corev1.Taint{
				{
					Key:       "node.kubernetes.io/not-ready",
					Value:     "true",
					Effect:    corev1.TaintEffectNoSchedule,
					TimeAdded: &timeAdded,
				},
				{
					Key:    "dedicated",
					Value:  "gpu-workload",
					Effect: corev1.TaintEffectNoExecute,
				},
			},
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}

	body := buildResourceBody(node, false)

	if len(body.Taints) != 2 {
		t.Errorf("Expected 2 taints, got %d", len(body.Taints))
	}

	// Check first taint
	found := false
	for _, taint := range body.Taints {
		if taint.Key == "node.kubernetes.io/not-ready" {
			found = true
			if taint.Value != "true" {
				t.Errorf("Taint value = %s, expected true", taint.Value)
			}
			if taint.Effect != string(corev1.TaintEffectNoSchedule) {
				t.Errorf("Taint effect = %s, expected NoSchedule", taint.Effect)
			}
			if taint.TimeAdded == "" {
				t.Error("Expected TimeAdded to be set")
			}
		}
	}

	if !found {
		t.Error("Expected to find not-ready taint")
	}
}

func TestBuildResourceBody_AllocatableFields(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"kubernetes.io/hostname": "gpu-node",
			},
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:                     resource.MustParse("16"),
				corev1.ResourceMemory:                  resource.MustParse("64Gi"),
				corev1.ResourceEphemeralStorage:        resource.MustParse("500Gi"),
				corev1.ResourceName("nvidia.com/gpu"): resource.MustParse("8"),
			},
		},
	}

	body := buildResourceBody(node, false)

	// CPU should be in millicores
	if body.AllocatableFields["cpu"] != "16000" {
		t.Errorf("CPU = %s, expected 16000", body.AllocatableFields["cpu"])
	}

	// Memory should be in Ki
	expectedMemKi := 64 * 1024 * 1024 // 64 GiB in Ki
	if body.AllocatableFields["memory"] != "67108864Ki" {
		t.Errorf("Memory = %s, expected %dKi", body.AllocatableFields["memory"], expectedMemKi)
	}

	// Storage should be in Ki
	expectedStorageKi := 500 * 1024 * 1024 // 500 GiB in Ki
	if body.AllocatableFields["ephemeral-storage"] != "524288000Ki" {
		t.Errorf("Storage = %s, expected %dKi", body.AllocatableFields["ephemeral-storage"], expectedStorageKi)
	}

	// GPU should be present
	if body.AllocatableFields["nvidia.com/gpu"] != "8" {
		t.Errorf("GPU = %s, expected 8", body.AllocatableFields["nvidia.com/gpu"])
	}
}

func TestBuildResourceBody_Delete(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"kubernetes.io/hostname": "deleted-node",
			},
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}

	body := buildResourceBody(node, true)

	if !body.Delete {
		t.Error("Expected Delete to be true")
	}
}

func TestBuildResourceBody_MissingHostnameLabel(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name:   "node-without-hostname-label",
			Labels: map[string]string{},
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}

	body := buildResourceBody(node, false)

	// Should fallback to "-" when hostname label is missing
	if body.Hostname != "-" {
		t.Errorf("Hostname = %s, expected -", body.Hostname)
	}
}

func TestGetNodeHostname(t *testing.T) {
	tests := []struct {
		name     string
		node     *corev1.Node
		expected string
	}{
		{
			name: "With hostname label",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"kubernetes.io/hostname": "my-node",
					},
				},
			},
			expected: "my-node",
		},
		{
			name: "Without hostname label",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{},
				},
			},
			expected: "-",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getNodeHostname(tt.node)
			if result != tt.expected {
				t.Errorf("getNodeHostname() = %s, expected %s", result, tt.expected)
			}
		})
	}
}

func TestIsNodeAvailable(t *testing.T) {
	tests := []struct {
		name     string
		node     *corev1.Node
		expected bool
	}{
		{
			name: "Ready and schedulable",
			node: &corev1.Node{
				Spec: corev1.NodeSpec{
					Unschedulable: false,
				},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{
						{
							Type:   corev1.NodeReady,
							Status: corev1.ConditionTrue,
						},
					},
				},
			},
			expected: true,
		},
		{
			name: "Ready but unschedulable",
			node: &corev1.Node{
				Spec: corev1.NodeSpec{
					Unschedulable: true,
				},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{
						{
							Type:   corev1.NodeReady,
							Status: corev1.ConditionTrue,
						},
					},
				},
			},
			expected: false,
		},
		{
			name: "Not ready but schedulable",
			node: &corev1.Node{
				Spec: corev1.NodeSpec{
					Unschedulable: false,
				},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{
						{
							Type:   corev1.NodeReady,
							Status: corev1.ConditionFalse,
						},
					},
				},
			},
			expected: false,
		},
		{
			name: "No Ready condition",
			node: &corev1.Node{
				Spec: corev1.NodeSpec{
					Unschedulable: false,
				},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{},
				},
			},
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isNodeAvailable(tt.node)
			if result != tt.expected {
				t.Errorf("isNodeAvailable() = %v, expected %v", result, tt.expected)
			}
		})
	}
}

func TestResourceBodiesEqual(t *testing.T) {
	body1 := &pb.ResourceBody{
		Hostname:  "node-1",
		Available: true,
		Conditions: []string{"Ready"},
		AllocatableFields: map[string]string{
			"cpu":    "8000",
			"memory": "16Gi",
		},
		LabelFields: map[string]string{
			"role": "worker",
		},
	}

	body2 := &pb.ResourceBody{
		Hostname:  "node-1",
		Available: true,
		Conditions: []string{"Ready"},
		AllocatableFields: map[string]string{
			"cpu":    "8000",
			"memory": "16Gi",
		},
		LabelFields: map[string]string{
			"role": "worker",
		},
	}

	body3 := &pb.ResourceBody{
		Hostname:  "node-1",
		Available: false, // Different
		Conditions: []string{"Ready"},
		AllocatableFields: map[string]string{
			"cpu":    "8000",
			"memory": "16Gi",
		},
		LabelFields: map[string]string{
			"role": "worker",
		},
	}

	if !resourceBodiesEqual(body1, body2) {
		t.Error("Expected identical bodies to be equal")
	}

	if resourceBodiesEqual(body1, body3) {
		t.Error("Expected different bodies to be unequal")
	}
}

// Test ResourceUsageAggregator
func TestResourceUsageAggregator_UpdatePod(t *testing.T) {
	agg := NewResourceUsageAggregator("osmo")

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

	agg.UpdatePod(pod)

	usageFields, nonWorkflowFields := agg.GetNodeUsage("node-1")

	if usageFields["cpu"] != "1000" {
		t.Errorf("CPU = %s, expected 1000", usageFields["cpu"])
	}
	if usageFields["memory"] != "1048576Ki" {
		t.Errorf("Memory = %s, expected 1048576Ki", usageFields["memory"])
	}
	if nonWorkflowFields["cpu"] != "0" {
		t.Errorf("Non-workflow CPU = %s, expected 0", nonWorkflowFields["cpu"])
	}
}

func TestResourceUsageAggregator_DeletePod(t *testing.T) {
	agg := NewResourceUsageAggregator("osmo")

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
	agg.UpdatePod(pod)
	agg.DeletePod(pod)

	usageFields, _ := agg.GetNodeUsage("node-1")

	if usageFields["cpu"] != "0" {
		t.Errorf("CPU after delete = %s, expected 0", usageFields["cpu"])
	}
	if usageFields["memory"] != "0Ki" {
		t.Errorf("Memory after delete = %s, expected 0Ki", usageFields["memory"])
	}
}

func TestResourceUsageAggregator_NodeMigration(t *testing.T) {
	agg := NewResourceUsageAggregator("osmo")

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

	agg.UpdatePod(pod)

	// Migrate to node-2
	pod.Spec.NodeName = "node-2"
	agg.UpdatePod(pod)

	usageFields1, _ := agg.GetNodeUsage("node-1")
	usageFields2, _ := agg.GetNodeUsage("node-2")

	if usageFields1["cpu"] != "0" {
		t.Errorf("Node-1 CPU after migration = %s, expected 0", usageFields1["cpu"])
	}
	if usageFields2["cpu"] != "1000" {
		t.Errorf("Node-2 CPU after migration = %s, expected 1000", usageFields2["cpu"])
	}
}

func TestResourceUsageAggregator_NonWorkflowNamespace(t *testing.T) {
	agg := NewResourceUsageAggregator("osmo")

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

	agg.UpdatePod(workflowPod)
	agg.UpdatePod(systemPod)

	usageFields, nonWorkflowFields := agg.GetNodeUsage("node-1")

	if usageFields["cpu"] != "1500" {
		t.Errorf("Total CPU = %s, expected 1500", usageFields["cpu"])
	}
	if nonWorkflowFields["cpu"] != "500" {
		t.Errorf("Non-workflow CPU = %s, expected 500", nonWorkflowFields["cpu"])
	}
}

func TestNodeStateTracker(t *testing.T) {
	tracker := NewNodeStateTracker(1 * time.Minute)

	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"kubernetes.io/hostname": "test-node",
			},
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}

	body := buildResourceBody(node, false)

	// First time should indicate change
	if !tracker.HasChanged("test-node", body) {
		t.Error("Expected first check to indicate change")
	}

	// Update tracker
	tracker.Update("test-node", body)

	// Second check with same body should not indicate change
	if tracker.HasChanged("test-node", body) {
		t.Error("Expected no change for identical body")
	}

	// Change availability
	node.Spec.Unschedulable = true
	body2 := buildResourceBody(node, false)

	// Should indicate change
	if !tracker.HasChanged("test-node", body2) {
		t.Error("Expected change after modifying node")
	}
}

func TestNewResourceListener(t *testing.T) {
	args := DefaultResourceListenerArgs()
	args.ServiceURL = "http://localhost:8000"
	args.Backend = "test-backend"

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

	if listener.unackedMessages == nil {
		t.Error("Expected unackedMessages to be initialized")
	}
}

// Benchmark tests
func BenchmarkBuildResourceBody(b *testing.B) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: "bench-node",
			Labels: map[string]string{
				"kubernetes.io/hostname":         "bench-node",
				"node-role.kubernetes.io/worker": "",
				"feature.node.kubernetes.io/cpu": "avx",
			},
		},
		Spec: corev1.NodeSpec{
			Taints: []corev1.Taint{
				{
					Key:    "dedicated",
					Value:  "gpu",
					Effect: corev1.TaintEffectNoSchedule,
				},
			},
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
				{
					Type:   corev1.NodeMemoryPressure,
					Status: corev1.ConditionFalse,
				},
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:                     resource.MustParse("16"),
				corev1.ResourceMemory:                  resource.MustParse("64Gi"),
				corev1.ResourceEphemeralStorage:        resource.MustParse("500Gi"),
				corev1.ResourceName("nvidia.com/gpu"): resource.MustParse("8"),
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		buildResourceBody(node, false)
	}
}

func BenchmarkResourceUsageAggregator_UpdatePod(b *testing.B) {
	agg := NewResourceUsageAggregator("osmo")

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
		agg.UpdatePod(pod)
	}
}
