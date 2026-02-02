/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"go.corp.nvidia.com/osmo/operator/utils"
)

// Test case structures for JSON parsing
type NodeUsageTestSuite struct {
	Version     string              `json:"version"`
	Description string              `json:"description"`
	TestCases   []NodeUsageTestCase `json:"test_cases"`
}

type NodeUsageTestCase struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Input       NodeUsageInput    `json:"input"`
	Expected    NodeUsageExpected `json:"expected"`
}

type NodeUsageInput struct {
	WorkflowNamespace string           `json:"workflow_namespace"`
	Pods              []PodInput       `json:"pods,omitempty"`
	Operations        []OperationInput `json:"operations,omitempty"`
}

type PodInput struct {
	UID        string           `json:"uid"`
	Namespace  string           `json:"namespace"`
	NodeName   string           `json:"node_name"`
	Phase      string           `json:"phase"`
	Containers []ContainerInput `json:"containers"`
}

type ContainerInput struct {
	Name     string            `json:"name"`
	Requests map[string]string `json:"requests"`
}

type OperationInput struct {
	Action string   `json:"action"` // "add", "update", "delete"
	Pod    PodInput `json:"pod"`
}

type NodeUsageExpected struct {
	NodeTotals            map[string]ResourceTotals `json:"node_totals"`
	NodeNonWorkflowTotals map[string]ResourceTotals `json:"node_non_workflow_totals"`
}

type ResourceTotals struct {
	CPU     int64 `json:"cpu"`
	Memory  int64 `json:"memory"`
	Storage int64 `json:"storage"`
	GPU     int64 `json:"gpu"`
}

func TestNodeUsageAggregatorFromJSON(t *testing.T) {
	suite := loadNodeUsageTestSuite(t)

	for _, tc := range suite.TestCases {
		t.Run(tc.Name, func(t *testing.T) {
			// Create aggregator
			aggregator := utils.NewNodeUsageAggregator(tc.Input.WorkflowNamespace)

			// Process operations or pods
			if len(tc.Input.Operations) > 0 {
				// Sequential operations (add, update, delete)
				for _, op := range tc.Input.Operations {
					pod := convertPod(op.Pod)
					switch op.Action {
					case "add":
						aggregator.AddPod(pod)
					case "update":
						// For update, we need to delete old and add new
						// But since pod UID is same, we simulate by deleting then adding
						aggregator.DeletePod(pod)
						aggregator.AddPod(pod)
					case "delete":
						aggregator.DeletePod(pod)
					default:
						t.Fatalf("Unknown operation action: %s", op.Action)
					}
				}
			} else {
				// Simple pod list
				for _, podInput := range tc.Input.Pods {
					pod := convertPod(podInput)
					aggregator.AddPod(pod)
				}
			}

			// Verify expected totals
			verifyNodeTotals(t, aggregator, tc.Expected.NodeTotals, tc.Expected.NodeNonWorkflowTotals)
		})
	}
}

func verifyNodeTotals(t *testing.T, aggregator *utils.NodeUsageAggregator, expectedTotals, expectedNonWorkflowTotals map[string]ResourceTotals) {
	// Check all expected nodes
	for nodeName, expectedTotal := range expectedTotals {
		usageFields, nonWorkflowFields := aggregator.GetNodeUsage(nodeName)

		// Parse actual totals from formatted fields
		actualTotal := parseResourceFields(t, usageFields)
		expectedNonWorkflow := expectedNonWorkflowTotals[nodeName]
		actualNonWorkflow := parseResourceFields(t, nonWorkflowFields)

		// Convert expected CPU from millicores to cores (with ceiling) to match FormatResourceUsage
		expectedCPUCores := int64(math.Ceil(float64(expectedTotal.CPU) / 1000.0))
		expectedNonWorkflowCPUCores := int64(math.Ceil(float64(expectedNonWorkflow.CPU) / 1000.0))

		// Verify node_totals
		if actualTotal.CPU != expectedCPUCores {
			t.Errorf("Node %s: CPU = %d cores, expected %d cores (from %d millicores)", nodeName, actualTotal.CPU, expectedCPUCores, expectedTotal.CPU)
		}
		if actualTotal.Memory != expectedTotal.Memory {
			t.Errorf("Node %s: Memory = %d, expected %d", nodeName, actualTotal.Memory, expectedTotal.Memory)
		}
		if actualTotal.Storage != expectedTotal.Storage {
			t.Errorf("Node %s: Storage = %d, expected %d", nodeName, actualTotal.Storage, expectedTotal.Storage)
		}
		if actualTotal.GPU != expectedTotal.GPU {
			t.Errorf("Node %s: GPU = %d, expected %d", nodeName, actualTotal.GPU, expectedTotal.GPU)
		}

		// Verify node_non_workflow_totals
		if actualNonWorkflow.CPU != expectedNonWorkflowCPUCores {
			t.Errorf("Node %s non-workflow: CPU = %d cores, expected %d cores (from %d millicores)", nodeName, actualNonWorkflow.CPU, expectedNonWorkflowCPUCores, expectedNonWorkflow.CPU)
		}
		if actualNonWorkflow.Memory != expectedNonWorkflow.Memory {
			t.Errorf("Node %s non-workflow: Memory = %d, expected %d", nodeName, actualNonWorkflow.Memory, expectedNonWorkflow.Memory)
		}
		if actualNonWorkflow.Storage != expectedNonWorkflow.Storage {
			t.Errorf("Node %s non-workflow: Storage = %d, expected %d", nodeName, actualNonWorkflow.Storage, expectedNonWorkflow.Storage)
		}
		if actualNonWorkflow.GPU != expectedNonWorkflow.GPU {
			t.Errorf("Node %s non-workflow: GPU = %d, expected %d", nodeName, actualNonWorkflow.GPU, expectedNonWorkflow.GPU)
		}
	}
}

func parseResourceFields(t *testing.T, fields map[string]string) ResourceTotals {
	var totals ResourceTotals

	// Parse CPU (in cores, as string)
	if cpuStr, ok := fields["cpu"]; ok {
		var cpu int64
		_, err := fmt.Sscanf(cpuStr, "%d", &cpu)
		if err != nil {
			t.Errorf("Failed to parse CPU: %v", err)
		}
		totals.CPU = cpu
	}

	// Parse memory (format: "123456Ki")
	if memStr, ok := fields["memory"]; ok {
		var mem int64
		_, err := fmt.Sscanf(memStr, "%dKi", &mem)
		if err != nil {
			t.Errorf("Failed to parse memory: %v", err)
		}
		totals.Memory = mem
	}

	// Parse storage (format: "123456Ki")
	if storageStr, ok := fields["ephemeral-storage"]; ok {
		var storage int64
		_, err := fmt.Sscanf(storageStr, "%dKi", &storage)
		if err != nil {
			t.Errorf("Failed to parse storage: %v", err)
		}
		totals.Storage = storage
	}

	// Parse GPU (as string)
	if gpuStr, ok := fields["nvidia.com/gpu"]; ok {
		var gpu int64
		_, err := fmt.Sscanf(gpuStr, "%d", &gpu)
		if err != nil {
			t.Errorf("Failed to parse GPU: %v", err)
		}
		totals.GPU = gpu
	}

	return totals
}

func convertPod(input PodInput) *corev1.Pod {
	containers := make([]corev1.Container, 0, len(input.Containers))
	for _, containerInput := range input.Containers {
		container := corev1.Container{
			Name: containerInput.Name,
		}

		if len(containerInput.Requests) > 0 {
			requests := make(corev1.ResourceList)
			for resourceName, quantityStr := range containerInput.Requests {
				qty, err := resource.ParseQuantity(quantityStr)
				if err != nil {
					continue
				}
				requests[corev1.ResourceName(resourceName)] = qty
			}
			container.Resources.Requests = requests
		}

		containers = append(containers, container)
	}

	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       types.UID(input.UID),
			Namespace: input.Namespace,
		},
		Spec: corev1.PodSpec{
			NodeName:   input.NodeName,
			Containers: containers,
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodPhase(input.Phase),
		},
	}
}

func loadNodeUsageTestSuite(t *testing.T) *NodeUsageTestSuite {
	testFile := filepath.Join("..", "tests", "test_node_usage_cases.json")
	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("Failed to read test file %s: %v", testFile, err)
	}

	var suite NodeUsageTestSuite
	if err := json.Unmarshal(data, &suite); err != nil {
		t.Fatalf("Failed to parse test file: %v", err)
	}

	t.Logf("Loaded test suite version %s: %s", suite.Version, suite.Description)
	return &suite
}

// Additional unit tests for edge cases

func TestNodeUsageAggregator_EmptyPod(t *testing.T) {
	aggregator := utils.NewNodeUsageAggregator("osmo")

	// Empty pod with no containers
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       types.UID("empty-pod"),
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName:   "node-1",
			Containers: []corev1.Container{},
		},
	}

	aggregator.AddPod(pod)
	usageFields, _ := aggregator.GetNodeUsage("node-1")

	totals := parseResourceFields(t, usageFields)
	if totals.CPU != 0 || totals.Memory != 0 || totals.Storage != 0 || totals.GPU != 0 {
		t.Errorf("Empty pod should contribute 0 resources, got %+v", totals)
	}
}

func TestNodeUsageAggregator_DuplicateAdd(t *testing.T) {
	aggregator := utils.NewNodeUsageAggregator("osmo")

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       types.UID("pod-1"),
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

	// Add pod twice - should only count once
	aggregator.AddPod(pod)
	aggregator.AddPod(pod)

	usageFields, _ := aggregator.GetNodeUsage("node-1")
	totals := parseResourceFields(t, usageFields)

	// Should only have 1 core, not 2
	if totals.CPU != 1 {
		t.Errorf("Duplicate add should not double-count, CPU = %d, expected 1", totals.CPU)
	}
}

func TestNodeUsageAggregator_DeleteNonExistent(t *testing.T) {
	aggregator := utils.NewNodeUsageAggregator("osmo")

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       types.UID("pod-1"),
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
		},
	}

	// Delete pod that was never added - should not panic
	aggregator.DeletePod(pod)

	usageFields, _ := aggregator.GetNodeUsage("node-1")
	totals := parseResourceFields(t, usageFields)

	if totals.CPU != 0 || totals.Memory != 0 {
		t.Errorf("Delete of non-existent pod should result in 0 resources, got %+v", totals)
	}
}

func TestNodeUsageAggregator_Reset(t *testing.T) {
	aggregator := utils.NewNodeUsageAggregator("osmo")

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       types.UID("pod-1"),
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

	aggregator.AddPod(pod)
	aggregator.Reset()

	usageFields, _ := aggregator.GetNodeUsage("node-1")
	totals := parseResourceFields(t, usageFields)

	if totals.CPU != 0 || totals.Memory != 0 {
		t.Errorf("After reset, should have 0 resources, got %+v", totals)
	}
}

func TestNodeUsageAggregator_DirtyNodes(t *testing.T) {
	aggregator := utils.NewNodeUsageAggregator("osmo")

	pod1 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       types.UID("pod-1"),
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

	pod2 := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			UID:       types.UID("pod-2"),
			Namespace: "osmo",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-2",
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

	aggregator.AddPod(pod1)
	aggregator.AddPod(pod2)

	dirtyNodes := aggregator.GetAndClearDirtyNodes()
	if len(dirtyNodes) != 2 {
		t.Errorf("Expected 2 dirty nodes, got %d", len(dirtyNodes))
	}

	// Check that dirty nodes were cleared
	dirtyNodes = aggregator.GetAndClearDirtyNodes()
	if len(dirtyNodes) != 0 {
		t.Errorf("After clear, expected 0 dirty nodes, got %d", len(dirtyNodes))
	}
}

// Benchmark tests

func BenchmarkNodeUsageAggregator_AddPod(b *testing.B) {
	aggregator := utils.NewNodeUsageAggregator("osmo")

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
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
		pod.UID = types.UID(fmt.Sprintf("pod-%d", i))
		aggregator.AddPod(pod)
	}
}

func BenchmarkNodeUsageAggregator_GetNodeUsage(b *testing.B) {
	aggregator := utils.NewNodeUsageAggregator("osmo")

	// Add 100 pods to node-1
	for i := 0; i < 100; i++ {
		pod := &corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{
				UID:       types.UID(fmt.Sprintf("pod-%d", i)),
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
		aggregator.AddPod(pod)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		aggregator.GetNodeUsage("node-1")
	}
}
