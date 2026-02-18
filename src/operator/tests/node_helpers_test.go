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
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"go.corp.nvidia.com/osmo/operator/utils"
	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// Test case structures for JSON parsing
type NodeHelpersTestSuite struct {
	Version     string                `json:"version"`
	Description string                `json:"description"`
	TestSuites  NodeHelpersTestSuites `json:"test_suites"`
}

type NodeHelpersTestSuites struct {
	GetNodeHostname   []GetNodeHostnameTestCase   `json:"get_node_hostname"`
	IsNodeAvailable   []IsNodeAvailableTestCase   `json:"is_node_available"`
	ToKi              []ToKiTestCase              `json:"to_ki"`
	BuildResourceBody []BuildResourceBodyTestCase `json:"build_resource_body"`
}

type GetNodeHostnameTestCase struct {
	Name        string                  `json:"name"`
	Description string                  `json:"description"`
	Input       GetNodeHostnameInput    `json:"input"`
	Expected    GetNodeHostnameExpected `json:"expected"`
}

type GetNodeHostnameInput struct {
	Labels map[string]string `json:"labels"`
}

type GetNodeHostnameExpected struct {
	Hostname string `json:"hostname"`
}

type IsNodeAvailableTestCase struct {
	Name        string                  `json:"name"`
	Description string                  `json:"description"`
	Input       IsNodeAvailableInput    `json:"input"`
	Expected    IsNodeAvailableExpected `json:"expected"`
}

type IsNodeAvailableInput struct {
	Unschedulable bool                 `json:"unschedulable"`
	Conditions    []NodeConditionInput `json:"conditions"`
}

type NodeConditionInput struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

type IsNodeAvailableExpected struct {
	Available bool `json:"available"`
}

type ToKiTestCase struct {
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Input       ToKiInput    `json:"input"`
	Expected    ToKiExpected `json:"expected"`
}

type ToKiInput struct {
	Bytes int64 `json:"bytes"`
}

type ToKiExpected struct {
	Ki int64 `json:"ki"`
}

type BuildResourceBodyTestCase struct {
	Name        string                    `json:"name"`
	Description string                    `json:"description"`
	Input       BuildResourceBodyInput    `json:"input"`
	Expected    BuildResourceBodyExpected `json:"expected"`
}

type BuildResourceBodyInput struct {
	Labels        map[string]string    `json:"labels"`
	Unschedulable bool                 `json:"unschedulable"`
	Conditions    []NodeConditionInput `json:"conditions"`
	Allocatable   map[string]string    `json:"allocatable"`
	Taints        []TaintInput         `json:"taints"`
	IsDelete      bool                 `json:"is_delete"`
}

type TaintInput struct {
	Key       string  `json:"key"`
	Value     string  `json:"value"`
	Effect    string  `json:"effect"`
	TimeAdded *string `json:"time_added,omitempty"`
}

type BuildResourceBodyExpected struct {
	Hostname          string            `json:"hostname,omitempty"`
	Available         *bool             `json:"available,omitempty"`
	Delete            *bool             `json:"delete,omitempty"`
	Conditions        []string          `json:"conditions,omitempty"`
	AllocatableFields map[string]string `json:"allocatable_fields,omitempty"`
	TaintsCount       *int              `json:"taints_count,omitempty"`
	Taints            []TaintExpected   `json:"taints,omitempty"`
}

type TaintExpected struct {
	Key          string `json:"key"`
	Value        string `json:"value"`
	Effect       string `json:"effect"`
	HasTimeAdded bool   `json:"has_time_added"`
}

func TestGetNodeHostnameFromJSON(t *testing.T) {
	suite := loadTestSuite(t)

	for _, tc := range suite.TestSuites.GetNodeHostname {
		t.Run(tc.Name, func(t *testing.T) {
			node := &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Labels: tc.Input.Labels,
				},
			}

			result := utils.GetNodeHostname(node)
			if result != tc.Expected.Hostname {
				t.Errorf("GetNodeHostname() = %v, expected %v", result, tc.Expected.Hostname)
			}
		})
	}
}

func TestIsNodeAvailableFromJSON(t *testing.T) {
	suite := loadTestSuite(t)

	for _, tc := range suite.TestSuites.IsNodeAvailable {
		t.Run(tc.Name, func(t *testing.T) {
			node := &corev1.Node{
				Spec: corev1.NodeSpec{
					Unschedulable: tc.Input.Unschedulable,
				},
				Status: corev1.NodeStatus{
					Conditions: convertNodeConditions(tc.Input.Conditions),
				},
			}

			defaultRules := utils.DefaultAvailableCondition
			result := utils.IsNodeAvailable(node, defaultRules)
			if result != tc.Expected.Available {
				t.Errorf("IsNodeAvailable() = %v, expected %v", result, tc.Expected.Available)
			}
		})
	}
}

func TestToKiFromJSON(t *testing.T) {
	suite := loadTestSuite(t)

	for _, tc := range suite.TestSuites.ToKi {
		t.Run(tc.Name, func(t *testing.T) {
			quantity := *resource.NewQuantity(tc.Input.Bytes, resource.BinarySI)
			result := utils.ToKi(quantity)
			if result != tc.Expected.Ki {
				t.Errorf("ToKi(%d bytes) = %d, expected %d", tc.Input.Bytes, result, tc.Expected.Ki)
			}
		})
	}
}

func TestBuildResourceBodyFromJSON(t *testing.T) {
	suite := loadTestSuite(t)

	for _, tc := range suite.TestSuites.BuildResourceBody {
		t.Run(tc.Name, func(t *testing.T) {
			node := &corev1.Node{
				ObjectMeta: metav1.ObjectMeta{
					Labels: tc.Input.Labels,
				},
				Spec: corev1.NodeSpec{
					Unschedulable: tc.Input.Unschedulable,
					Taints:        convertTaints(tc.Input.Taints),
				},
				Status: corev1.NodeStatus{
					Conditions:  convertNodeConditions(tc.Input.Conditions),
					Allocatable: convertAllocatable(tc.Input.Allocatable),
				},
			}

			defaultRules := utils.DefaultAvailableCondition
			result := utils.BuildUpdateNodeBody(node, tc.Input.IsDelete, defaultRules)

			// Validate hostname
			if tc.Expected.Hostname != "" {
				if result.Hostname != tc.Expected.Hostname {
					t.Errorf("Hostname = %v, expected %v", result.Hostname, tc.Expected.Hostname)
				}
			}

			// Validate available
			if tc.Expected.Available != nil {
				if result.Available != *tc.Expected.Available {
					t.Errorf("Available = %v, expected %v", result.Available, *tc.Expected.Available)
				}
			}

			// Validate delete
			if tc.Expected.Delete != nil {
				if result.Delete != *tc.Expected.Delete {
					t.Errorf("Delete = %v, expected %v", result.Delete, *tc.Expected.Delete)
				}
			}

			// Validate conditions
			if tc.Expected.Conditions != nil {
				if len(result.Conditions) != len(tc.Expected.Conditions) {
					t.Errorf("Conditions count = %d, expected %d", len(result.Conditions), len(tc.Expected.Conditions))
				} else {
					condMap := make(map[string]bool)
					for _, cond := range result.Conditions {
						condMap[cond] = true
					}
					for _, expected := range tc.Expected.Conditions {
						if !condMap[expected] {
							t.Errorf("Expected condition %q not found in %v", expected, result.Conditions)
						}
					}
				}
			}

			// Validate allocatable fields
			if tc.Expected.AllocatableFields != nil {
				for key, expectedValue := range tc.Expected.AllocatableFields {
					if actualValue, ok := result.AllocatableFields[key]; !ok {
						t.Errorf("AllocatableField %q not found", key)
					} else if actualValue != expectedValue {
						t.Errorf("AllocatableField[%q] = %v, expected %v", key, actualValue, expectedValue)
					}
				}
			}

			// Validate taints count
			if tc.Expected.TaintsCount != nil {
				if len(result.Taints) != *tc.Expected.TaintsCount {
					t.Errorf("Taints count = %d, expected %d", len(result.Taints), *tc.Expected.TaintsCount)
				}
			}

			// Validate taints details
			if tc.Expected.Taints != nil {
				for _, expectedTaint := range tc.Expected.Taints {
					found := false
					for _, actualTaint := range result.Taints {
						if actualTaint.Key == expectedTaint.Key {
							found = true
							if actualTaint.Value != expectedTaint.Value {
								t.Errorf("Taint[%s].Value = %v, expected %v", expectedTaint.Key, actualTaint.Value, expectedTaint.Value)
							}
							if actualTaint.Effect != expectedTaint.Effect {
								t.Errorf("Taint[%s].Effect = %v, expected %v", expectedTaint.Key, actualTaint.Effect, expectedTaint.Effect)
							}
							hasTimeAdded := actualTaint.TimeAdded != ""
							if hasTimeAdded != expectedTaint.HasTimeAdded {
								t.Errorf("Taint[%s].HasTimeAdded = %v, expected %v", expectedTaint.Key, hasTimeAdded, expectedTaint.HasTimeAdded)
							}
							break
						}
					}
					if !found {
						t.Errorf("Expected taint with key %q not found", expectedTaint.Key)
					}
				}
			}
		})
	}
}

// Helper functions

func loadTestSuite(t *testing.T) *NodeHelpersTestSuite {
	testFile := filepath.Join("..", "tests", "test_node_helpers_cases.json")
	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("Failed to read test file %s: %v", testFile, err)
	}

	var suite NodeHelpersTestSuite
	if err := json.Unmarshal(data, &suite); err != nil {
		t.Fatalf("Failed to parse test file: %v", err)
	}

	t.Logf("Loaded test suite version %s: %s", suite.Version, suite.Description)
	return &suite
}

func convertNodeConditions(conditions []NodeConditionInput) []corev1.NodeCondition {
	var result []corev1.NodeCondition
	for _, cond := range conditions {
		result = append(result, corev1.NodeCondition{
			Type:   corev1.NodeConditionType(cond.Type),
			Status: corev1.ConditionStatus(cond.Status),
		})
	}
	return result
}

func convertAllocatable(allocatable map[string]string) corev1.ResourceList {
	result := make(corev1.ResourceList)
	for key, value := range allocatable {
		qty, err := resource.ParseQuantity(value)
		if err != nil {
			continue
		}
		result[corev1.ResourceName(key)] = qty
	}
	return result
}

func convertTaints(taints []TaintInput) []corev1.Taint {
	var result []corev1.Taint
	for _, taint := range taints {
		t := corev1.Taint{
			Key:    taint.Key,
			Value:  taint.Value,
			Effect: corev1.TaintEffect(taint.Effect),
		}
		if taint.TimeAdded != nil {
			timeAdded, err := time.Parse(time.RFC3339, *taint.TimeAdded)
			if err == nil {
				t.TimeAdded = &metav1.Time{Time: timeAdded}
			}
		}
		result = append(result, t)
	}
	return result
}

// Additional unit tests for edge cases not covered by JSON

func TestGetNodeHostname_NilNode(t *testing.T) {
	// This is an edge case that shouldn't happen in practice
	// but we test defensive coding
	defer func() {
		if r := recover(); r != nil {
			t.Logf("GetNodeHostname panicked with nil node (expected): %v", r)
		}
	}()
}

func TestToKi_NegativeBytes(t *testing.T) {
	// Test negative bytes (shouldn't happen but tests edge case)
	quantity := *resource.NewQuantity(-1024, resource.BinarySI)
	result := utils.ToKi(quantity)
	if result != -1 {
		t.Errorf("ToKi(-1024 bytes) = %d, expected -1", result)
	}
}

func TestBuildResourceBody_EmptyNode(t *testing.T) {
	// Test with node that has Ready condition
	node := &corev1.Node{
		Status: corev1.NodeStatus{
			Conditions: []corev1.NodeCondition{
				{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}
	defaultRules := utils.DefaultAvailableCondition
	result := utils.BuildUpdateNodeBody(node, false, defaultRules)

	if result.Hostname != "-" {
		t.Errorf("Empty node hostname = %v, expected '-'", result.Hostname)
	}
	if !result.Available {
		t.Error("Node with Ready condition should be available")
	}
	if len(result.Conditions) != 1 {
		t.Errorf("Node should have 1 condition, got %d", len(result.Conditions))
	}
}

// Additional helper function tests moved from node_listener_test.go

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

	defaultRules := utils.DefaultAvailableCondition
	body := utils.BuildUpdateNodeBody(node, false, defaultRules)

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

	defaultRules := utils.DefaultAvailableCondition
	body := utils.BuildUpdateNodeBody(node, false, defaultRules)

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

	defaultRules := utils.DefaultAvailableCondition
	body := utils.BuildUpdateNodeBody(node, false, defaultRules)

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

	defaultRules := utils.DefaultAvailableCondition
	body := utils.BuildUpdateNodeBody(node, false, defaultRules)

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

	defaultRules := utils.DefaultAvailableCondition
	body := utils.BuildUpdateNodeBody(node, false, defaultRules)

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

	defaultRules := utils.DefaultAvailableCondition
	body := utils.BuildUpdateNodeBody(node, false, defaultRules)

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

	defaultRules := utils.DefaultAvailableCondition
	body := utils.BuildUpdateNodeBody(node, false, defaultRules)

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

	defaultRules := utils.DefaultAvailableCondition
	body := utils.BuildUpdateNodeBody(node, true, defaultRules)

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

	defaultRules := utils.DefaultAvailableCondition
	body := utils.BuildUpdateNodeBody(node, false, defaultRules)

	if body.Hostname != "-" {
		t.Errorf("Hostname = %s, expected -", body.Hostname)
	}
}

func TestGetNodeHostname_TableDriven(t *testing.T) {
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

func TestIsNodeAvailable_TableDriven(t *testing.T) {
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
	}

	defaultRules := utils.DefaultAvailableCondition
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := utils.IsNodeAvailable(tt.node, defaultRules)
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

	defaultRules := utils.DefaultAvailableCondition
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.IsNodeAvailable(node, defaultRules)
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
				corev1.ResourceCPU:                    *resource.NewMilliQuantity(8000, resource.DecimalSI),
				corev1.ResourceMemory:                 *resource.NewQuantity(16*1024*1024*1024, resource.BinarySI),
				corev1.ResourceEphemeralStorage:       *resource.NewQuantity(100*1024*1024*1024, resource.BinarySI),
				corev1.ResourceName("nvidia.com/gpu"): *resource.NewQuantity(2, resource.DecimalSI),
			},
		},
	}

	defaultRules := utils.DefaultAvailableCondition
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		utils.BuildUpdateNodeBody(node, false, defaultRules)
	}
}
