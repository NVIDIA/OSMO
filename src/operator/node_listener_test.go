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

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

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

	body := utils.BuildUpdateNodeBody(node, false)

	if body.Hostname != "worker-node-1" {
		t.Errorf("Hostname = %s, expected worker-node-1", body.Hostname)
	}

	if !body.Available {
		t.Error("Expected node to be available")
	}

	if body.Delete {
		t.Error("Expected Delete to be false")
	}

	if body.AllocatableFields["cpu"] != "8" {
		t.Errorf("CPU allocatable = %s, expected 8", body.AllocatableFields["cpu"])
	}

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

	body := utils.BuildUpdateNodeBody(node, false)

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

	body := utils.BuildUpdateNodeBody(node, false)

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

	body := utils.BuildUpdateNodeBody(node, false)

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

	body := utils.BuildUpdateNodeBody(node, false)

	if body.LabelFields["feature.node.kubernetes.io/cpu-cpuid"] != "AVX512" {
		t.Error("Expected feature.node.kubernetes.io/cpu-cpuid label to be present")
	}

	if body.LabelFields["feature.node.kubernetes.io/gpu-vendor"] != "nvidia" {
		t.Error("Expected feature.node.kubernetes.io/gpu-vendor label to be present")
	}

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

	body := utils.BuildUpdateNodeBody(node, false)

	if len(body.Taints) != 2 {
		t.Errorf("Expected 2 taints, got %d", len(body.Taints))
	}

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
				corev1.ResourceCPU:                    resource.MustParse("16"),
				corev1.ResourceMemory:                 resource.MustParse("64Gi"),
				corev1.ResourceEphemeralStorage:       resource.MustParse("500Gi"),
				corev1.ResourceName("nvidia.com/gpu"): resource.MustParse("8"),
			},
		},
	}

	body := utils.BuildUpdateNodeBody(node, false)

	if body.AllocatableFields["cpu"] != "16" {
		t.Errorf("CPU = %s, expected 16", body.AllocatableFields["cpu"])
	}

	if body.AllocatableFields["memory"] != "67108864Ki" {
		t.Errorf("Memory = %s, expected 67108864Ki", body.AllocatableFields["memory"])
	}

	if body.AllocatableFields["ephemeral-storage"] != "524288000Ki" {
		t.Errorf("Storage = %s, expected 524288000Ki",
			body.AllocatableFields["ephemeral-storage"])
	}

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

	body := utils.BuildUpdateNodeBody(node, true)

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

	body := utils.BuildUpdateNodeBody(node, false)

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
			result := utils.GetNodeHostname(tt.node)
			if result != tt.expected {
				t.Errorf("GetNodeHostname() = %s, expected %s", result, tt.expected)
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
			result := utils.IsNodeAvailable(tt.node)
			if result != tt.expected {
				t.Errorf("IsNodeAvailable() = %v, expected %v", result, tt.expected)
			}
		})
	}
}

func TestResourceBodiesEqual(t *testing.T) {
	body1 := &pb.UpdateNodeBody{
		Hostname:   "node-1",
		Available:  true,
		Conditions: []string{"Ready"},
		AllocatableFields: map[string]string{
			"cpu":    "8000",
			"memory": "16Gi",
		},
		LabelFields: map[string]string{
			"role": "worker",
		},
	}

	body2 := &pb.UpdateNodeBody{
		Hostname:   "node-1",
		Available:  true,
		Conditions: []string{"Ready"},
		AllocatableFields: map[string]string{
			"cpu":    "8000",
			"memory": "16Gi",
		},
		LabelFields: map[string]string{
			"role": "worker",
		},
	}

	body3 := &pb.UpdateNodeBody{
		Hostname:   "node-1",
		Available:  false,
		Conditions: []string{"Ready"},
		AllocatableFields: map[string]string{
			"cpu":    "8000",
			"memory": "16Gi",
		},
		LabelFields: map[string]string{
			"role": "worker",
		},
	}

	if !utils.ResourceBodiesEqual(body1, body2) {
		t.Error("Expected identical bodies to be equal")
	}

	if utils.ResourceBodiesEqual(body1, body3) {
		t.Error("Expected different bodies to be unequal")
	}
}

func TestNodeStateTracker(t *testing.T) {
	tracker := utils.NewNodeStateTracker(1 * time.Minute)

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

	body := utils.BuildUpdateNodeBody(node, false)

	if !tracker.HasChanged("test-node", body) {
		t.Error("Expected first check to indicate change")
	}

	tracker.Update("test-node", body)

	if tracker.HasChanged("test-node", body) {
		t.Error("Expected no change for identical body")
	}

	node.Spec.Unschedulable = true
	body2 := utils.BuildUpdateNodeBody(node, false)

	if !tracker.HasChanged("test-node", body2) {
		t.Error("Expected change after modifying node")
	}
}

func TestNewNodeListener(t *testing.T) {
	args := utils.ListenerArgs{
		ServiceURL:          "http://localhost:8000",
		Backend:             "test-backend",
		Namespace:           "osmo",
		NodeUpdateChanSize:  100,
		StateCacheTTLMin:    15,
		MaxUnackedMessages:  100,
		NodeConditionPrefix: "osmo.nvidia.com/",
		ProgressDir:         "/tmp/osmo/operator/",
		ProgressFrequencySec: 15,
	}

	listener := NewNodeListener(args, utils.NewNoopInstruments())

	if listener == nil {
		t.Fatal("Expected non-nil listener")
	}

	if listener.args.ServiceURL != "http://localhost:8000" {
		t.Errorf("ServiceURL = %s, expected http://localhost:8000", listener.args.ServiceURL)
	}

	if listener.GetUnackedMessages() == nil {
		t.Error("Expected unackedMessages to be initialized")
	}
}

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
				corev1.ResourceCPU:                    resource.MustParse("16"),
				corev1.ResourceMemory:                 resource.MustParse("64Gi"),
				corev1.ResourceEphemeralStorage:       resource.MustParse("500Gi"),
				corev1.ResourceName("nvidia.com/gpu"): resource.MustParse("8"),
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.BuildUpdateNodeBody(node, false)
	}
}
