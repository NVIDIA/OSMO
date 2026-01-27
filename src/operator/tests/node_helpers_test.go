/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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

package tests

import (
	"fmt"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

func TestGetNodeHostname(t *testing.T) {
	tests := []struct {
		name     string
		node     *corev1.Node
		expected string
	}{
		{
			name: "Node with hostname label",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Name: "test-node",
					Labels: map[string]string{
						"kubernetes.io/hostname": "worker-01",
					},
				},
			},
			expected: "worker-01",
		},
		{
			name: "Node without hostname label",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Name:   "test-node",
					Labels: map[string]string{},
				},
			},
			expected: "-",
		},
		{
			name: "Node with nil labels",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Name: "test-node",
				},
			},
			expected: "-",
		},
		{
			name: "Node with other labels but no hostname",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Name: "test-node",
					Labels: map[string]string{
						"node-role.kubernetes.io/worker": "true",
						"topology.kubernetes.io/zone":    "us-west-1a",
					},
				},
			},
			expected: "-",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := utils.GetNodeHostname(tt.node)
			if result != tt.expected {
				t.Errorf("GetNodeHostname() = %v, expected %v", result, tt.expected)
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
			name: "Ready node, not unschedulable",
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
			name: "Ready node, but unschedulable",
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
			name: "Not ready node",
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
			name: "Unknown ready status",
			node: &corev1.Node{
				Spec: corev1.NodeSpec{
					Unschedulable: false,
				},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{
						{
							Type:   corev1.NodeReady,
							Status: corev1.ConditionUnknown,
						},
					},
				},
			},
			expected: false,
		},
		{
			name: "No ready condition",
			node: &corev1.Node{
				Spec: corev1.NodeSpec{
					Unschedulable: false,
				},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{
						{
							Type:   corev1.NodeMemoryPressure,
							Status: corev1.ConditionFalse,
						},
					},
				},
			},
			expected: false,
		},
		{
			name: "Multiple conditions, ready is true",
			node: &corev1.Node{
				Spec: corev1.NodeSpec{
					Unschedulable: false,
				},
				Status: corev1.NodeStatus{
					Conditions: []corev1.NodeCondition{
						{
							Type:   corev1.NodeMemoryPressure,
							Status: corev1.ConditionFalse,
						},
						{
							Type:   corev1.NodeDiskPressure,
							Status: corev1.ConditionFalse,
						},
						{
							Type:   corev1.NodeReady,
							Status: corev1.ConditionTrue,
						},
					},
				},
			},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := utils.IsNodeAvailable(tt.node)
			if result != tt.expected {
				t.Errorf("IsNodeAvailable() = %v, expected %v", result, tt.expected)
			}
		})
	}
}

func TestToKi(t *testing.T) {
	tests := []struct {
		name     string
		quantity resource.Quantity
		expected int64
	}{
		{
			name:     "1024 bytes = 1 Ki",
			quantity: *resource.NewQuantity(1024, resource.BinarySI),
			expected: 1,
		},
		{
			name:     "2048 bytes = 2 Ki",
			quantity: *resource.NewQuantity(2048, resource.BinarySI),
			expected: 2,
		},
		{
			name:     "1 byte = 1 Ki (rounded up)",
			quantity: *resource.NewQuantity(1, resource.BinarySI),
			expected: 1,
		},
		{
			name:     "1025 bytes = 2 Ki (rounded up)",
			quantity: *resource.NewQuantity(1025, resource.BinarySI),
			expected: 2,
		},
		{
			name:     "1 MiB = 1024 Ki",
			quantity: *resource.NewQuantity(1024*1024, resource.BinarySI),
			expected: 1024,
		},
		{
			name:     "1 GiB = 1048576 Ki",
			quantity: *resource.NewQuantity(1024*1024*1024, resource.BinarySI),
			expected: 1048576,
		},
		{
			name:     "Zero bytes = 0 Ki",
			quantity: *resource.NewQuantity(0, resource.BinarySI),
			expected: 0,
		},
		{
			name:     "1500 bytes = 2 Ki (rounded up)",
			quantity: *resource.NewQuantity(1500, resource.BinarySI),
			expected: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := utils.ToKi(tt.quantity)
			if result != tt.expected {
				t.Errorf("ToKi(%v) = %v, expected %v", tt.quantity.Value(), result, tt.expected)
			}
		})
	}
}

func TestBuildResourceBody(t *testing.T) {
	timeNow := metav1.NewTime(time.Now())

	tests := []struct {
		name     string
		node     *corev1.Node
		isDelete bool
		validate func(*testing.T, interface{})
	}{
		{
			name: "Basic node with hostname and available",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Name: "test-node",
					Labels: map[string]string{
						"kubernetes.io/hostname": "worker-01",
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
						corev1.ResourceCPU:              *resource.NewMilliQuantity(4000, resource.DecimalSI),
						corev1.ResourceMemory:           *resource.NewQuantity(8*1024*1024*1024, resource.BinarySI),
						corev1.ResourceEphemeralStorage: *resource.NewQuantity(100*1024*1024*1024, resource.BinarySI),
					},
				},
			},
			isDelete: false,
			validate: func(t *testing.T, result interface{}) {
				body := result.(*pb.UpdateNodeBody)
				if body.Hostname != "worker-01" {
					t.Errorf("Hostname = %v, expected worker-01", body.Hostname)
				}
				if !body.Available {
					t.Error("Expected node to be available")
				}
				if body.Delete {
					t.Error("Expected Delete to be false")
				}
				if len(body.Conditions) != 1 || body.Conditions[0] != "Ready" {
					t.Errorf("Conditions = %v, expected [Ready]", body.Conditions)
				}
				if body.AllocatableFields["cpu"] != "4000" {
					t.Errorf("CPU allocatable = %v, expected 4000", body.AllocatableFields["cpu"])
				}
			},
		},
		{
			name: "Node with multiple conditions (only True included)",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"kubernetes.io/hostname": "worker-02",
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
						{
							Type:   corev1.NodePIDPressure,
							Status: corev1.ConditionFalse,
						},
					},
				},
			},
			isDelete: false,
			validate: func(t *testing.T, result interface{}) {
				body := result.(*pb.UpdateNodeBody)
				expectedConditions := map[string]bool{"Ready": true, "DiskPressure": true}
				if len(body.Conditions) != 2 {
					t.Errorf("Expected 2 conditions, got %d: %v", len(body.Conditions), body.Conditions)
				}
				for _, cond := range body.Conditions {
					if !expectedConditions[cond] {
						t.Errorf("Unexpected condition: %s", cond)
					}
				}
			},
		},
		{
			name: "Node with labels (feature.node.kubernetes.io filtered out)",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"kubernetes.io/hostname":                   "worker-03",
						"node-role.kubernetes.io/worker":           "true",
						"feature.node.kubernetes.io/cpu-model.id":  "6",
						"feature.node.kubernetes.io/system-os_release.ID": "ubuntu",
						"topology.kubernetes.io/zone":              "us-west-1a",
						"custom-label":                             "custom-value",
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
			},
			isDelete: false,
			validate: func(t *testing.T, result interface{}) {
				body := result.(*pb.UpdateNodeBody)
				// Should not contain feature.node.kubernetes.io labels
				for key := range body.LabelFields {
					if key == "feature.node.kubernetes.io/cpu-model.id" ||
						key == "feature.node.kubernetes.io/system-os_release.ID" {
						t.Errorf("Label %s should have been filtered out", key)
					}
				}
				// Should contain other labels
				if body.LabelFields["kubernetes.io/hostname"] != "worker-03" {
					t.Error("Expected hostname label")
				}
				if body.LabelFields["node-role.kubernetes.io/worker"] != "true" {
					t.Error("Expected worker role label")
				}
				if body.LabelFields["custom-label"] != "custom-value" {
					t.Error("Expected custom label")
				}
			},
		},
		{
			name: "Node with taints",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"kubernetes.io/hostname": "worker-04",
					},
				},
				Spec: corev1.NodeSpec{
					Taints: []corev1.Taint{
						{
							Key:       "nvidia.com/gpu",
							Value:     "true",
							Effect:    corev1.TaintEffectNoSchedule,
							TimeAdded: &timeNow,
						},
						{
							Key:    "node.kubernetes.io/disk-pressure",
							Value:  "",
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
			},
			isDelete: false,
			validate: func(t *testing.T, result interface{}) {
				body := result.(*pb.UpdateNodeBody)
				if len(body.Taints) != 2 {
					t.Errorf("Expected 2 taints, got %d", len(body.Taints))
				}
				// Check first taint
				found := false
				for _, taint := range body.Taints {
					if taint.Key == "nvidia.com/gpu" {
						found = true
						if taint.Value != "true" {
							t.Errorf("Taint value = %v, expected true", taint.Value)
						}
						if taint.Effect != string(corev1.TaintEffectNoSchedule) {
							t.Errorf("Taint effect = %v, expected NoSchedule", taint.Effect)
						}
						if taint.TimeAdded == "" {
							t.Error("Expected TimeAdded to be set")
						}
					}
				}
				if !found {
					t.Error("Expected to find nvidia.com/gpu taint")
				}
			},
		},
		{
			name: "Node marked for deletion",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"kubernetes.io/hostname": "worker-05",
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
			},
			isDelete: true,
			validate: func(t *testing.T, result interface{}) {
				body := result.(*pb.UpdateNodeBody)
				if !body.Delete {
					t.Error("Expected Delete to be true")
				}
			},
		},
		{
			name: "Node with custom resources",
			node: &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"kubernetes.io/hostname": "gpu-worker-01",
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
						corev1.ResourceCPU:    *resource.NewMilliQuantity(8000, resource.DecimalSI),
						corev1.ResourceMemory: *resource.NewQuantity(16*1024*1024*1024, resource.BinarySI),
						corev1.ResourceName("nvidia.com/gpu"): *resource.NewQuantity(2, resource.DecimalSI),
						corev1.ResourceName("hugepages-2Mi"):  *resource.NewQuantity(1024*1024*1024, resource.BinarySI),
					},
				},
			},
			isDelete: false,
			validate: func(t *testing.T, result interface{}) {
				body := result.(*pb.UpdateNodeBody)
				// CPU should be in millicores
				if body.AllocatableFields["cpu"] != "8000" {
					t.Errorf("CPU = %v, expected 8000", body.AllocatableFields["cpu"])
				}
				// Memory should be in Ki
				expectedMemKi := int64(16 * 1024 * 1024)
				expectedMemStr := fmt.Sprintf("%dKi", expectedMemKi)
				if body.AllocatableFields["memory"] != expectedMemStr {
					t.Errorf("Memory = %v, expected %s", body.AllocatableFields["memory"], expectedMemStr)
				}
				// Custom resources should be in their native format
				if body.AllocatableFields["nvidia.com/gpu"] != "2" {
					t.Errorf("GPU = %v, expected 2", body.AllocatableFields["nvidia.com/gpu"])
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := utils.BuildResourceBody(tt.node, tt.isDelete)
			tt.validate(t, result)
		})
	}
}

// Benchmark tests
func BenchmarkGetNodeHostname(b *testing.B) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Labels: map[string]string{
				"kubernetes.io/hostname": "worker-01",
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.GetNodeHostname(node)
	}
}

func BenchmarkIsNodeAvailable(b *testing.B) {
	node := &corev1.Node{
		Spec: corev1.NodeSpec{
			Unschedulable: false,
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeMemoryPressure, Status: corev1.ConditionFalse},
				{Type: corev1.NodeDiskPressure, Status: corev1.ConditionFalse},
				{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.IsNodeAvailable(node)
	}
}

func BenchmarkToKi(b *testing.B) {
	quantity := *resource.NewQuantity(1024*1024*1024, resource.BinarySI)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.ToKi(quantity)
	}
}

func BenchmarkBuildResourceBody(b *testing.B) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: "test-node",
			Labels: map[string]string{
				"kubernetes.io/hostname":         "worker-01",
				"node-role.kubernetes.io/worker": "true",
				"topology.kubernetes.io/zone":    "us-west-1a",
			},
		},
		Spec: corev1.NodeSpec{
			Unschedulable: false,
			Taints: []corev1.Taint{
				{
					Key:    "nvidia.com/gpu",
					Value:  "true",
					Effect: corev1.TaintEffectNoSchedule,
				},
			},
		},
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{Type: corev1.NodeMemoryPressure, Status: corev1.ConditionFalse},
				{Type: corev1.NodeDiskPressure, Status: corev1.ConditionFalse},
				{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:              *resource.NewMilliQuantity(8000, resource.DecimalSI),
				corev1.ResourceMemory:           *resource.NewQuantity(16*1024*1024*1024, resource.BinarySI),
				corev1.ResourceEphemeralStorage: *resource.NewQuantity(100*1024*1024*1024, resource.BinarySI),
				corev1.ResourceName("nvidia.com/gpu"): *resource.NewQuantity(2, resource.DecimalSI),
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.BuildResourceBody(node, false)
	}
}
