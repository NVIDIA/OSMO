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

package utils

import (
	"fmt"
	"math"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/types"

	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// NodeStateTracker tracks the last sent state for each node to avoid duplicate messages
type NodeStateTracker struct {
	mu     sync.RWMutex
	states map[string]nodeStateEntry
	ttl    time.Duration
}

type nodeStateEntry struct {
	body      *pb.UpdateNodeBody
	timestamp time.Time
}

// NewNodeStateTracker creates a new node state tracker
func NewNodeStateTracker(ttl time.Duration) *NodeStateTracker {
	return &NodeStateTracker{
		states: make(map[string]nodeStateEntry),
		ttl:    ttl,
	}
}

// HasChanged checks if the node's state has changed since last sent
func (nst *NodeStateTracker) HasChanged(hostname string, body *pb.UpdateNodeBody) bool {
	nst.mu.RLock()
	entry, exists := nst.states[hostname]
	nst.mu.RUnlock()

	if !exists {
		return true
	}

	// Check TTL (skip if ttl is 0, meaning TTL is disabled)
	if nst.ttl > 0 && time.Since(entry.timestamp) > nst.ttl {
		return true
	}

	// Compare resource bodies
	return !ResourceBodiesEqual(entry.body, body)
}

// Update updates the tracker with the new state
func (nst *NodeStateTracker) Update(hostname string, body *pb.UpdateNodeBody) {
	nst.mu.Lock()
	defer nst.mu.Unlock()
	nst.states[hostname] = nodeStateEntry{
		body:      body,
		timestamp: time.Now(),
	}
}

// Remove removes a node from the tracker
func (nst *NodeStateTracker) Remove(hostname string) {
	nst.mu.Lock()
	defer nst.mu.Unlock()
	delete(nst.states, hostname)
}

// ResourceBodiesEqual compares two UpdateNodeBody messages for equality
func ResourceBodiesEqual(a, b *pb.UpdateNodeBody) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.Hostname != b.Hostname || a.Available != b.Available || a.Delete != b.Delete {
		return false
	}
	if len(a.Conditions) != len(b.Conditions) {
		return false
	}
	// Simple comparison - could be more sophisticated
	for i, c := range a.Conditions {
		if i >= len(b.Conditions) || c != b.Conditions[i] {
			return false
		}
	}
	if !MapsEqual(a.AllocatableFields, b.AllocatableFields) {
		return false
	}
	if !MapsEqual(a.LabelFields, b.LabelFields) {
		return false
	}
	if len(a.Taints) != len(b.Taints) {
		return false
	}
	return true
}

// MapsEqual compares two string maps for equality
func MapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// ResourceUsageAggregator tracks per-node resource usage from pods
type ResourceUsageAggregator struct {
	mu sync.RWMutex

	// Workflow namespace for distinguishing workflow vs non-workflow pods
	workflowNamespace string

	// Pod contributions by UID
	podContributions map[types.UID]*PodContribution

	// Per-node totals
	nodeTotals map[string]*ResourceTotals

	// Per-node non-workflow totals
	nodeNonWorkflowTotals map[string]*ResourceTotals

	// Set of dirty nodes (modified since last flush)
	dirtyNodes map[string]struct{}

	// Last sent totals for deduplication
	lastSentTotals map[string]*ResourceTotals
}

// ResourceTotals holds resource counters (cpu, memory, storage, gpu)
type ResourceTotals struct {
	CPU     int64 // millicores
	Memory  int64 // Ki
	Storage int64 // Ki
	GPU     int64
}

// PodContribution tracks individual pod contributions
type PodContribution struct {
	ResourceTotals // embedded struct
	NodeName       string
	Namespace      string
}

// NewResourceUsageAggregator creates a new resource usage aggregator
func NewResourceUsageAggregator(workflowNamespace string) *ResourceUsageAggregator {
	return &ResourceUsageAggregator{
		workflowNamespace:     workflowNamespace,
		podContributions:      make(map[types.UID]*PodContribution),
		nodeTotals:            make(map[string]*ResourceTotals),
		nodeNonWorkflowTotals: make(map[string]*ResourceTotals),
		dirtyNodes:            make(map[string]struct{}),
		lastSentTotals:        make(map[string]*ResourceTotals),
	}
}

// Reset clears all aggregator state
func (rua *ResourceUsageAggregator) Reset() {
	rua.mu.Lock()
	defer rua.mu.Unlock()

	rua.podContributions = make(map[types.UID]*PodContribution)
	rua.nodeTotals = make(map[string]*ResourceTotals)
	rua.nodeNonWorkflowTotals = make(map[string]*ResourceTotals)
	rua.dirtyNodes = make(map[string]struct{})
}

// UpdatePod updates the aggregator with a pod's resource requests
func (rua *ResourceUsageAggregator) UpdatePod(pod *corev1.Pod) {
	rua.mu.Lock()
	defer rua.mu.Unlock()

	uid := pod.UID
	nodeName := pod.Spec.NodeName
	namespace := pod.Namespace

	// Calculate new contribution
	newContrib := CalculatePodContribution(pod)
	newContrib.NodeName = nodeName
	newContrib.Namespace = namespace

	// Get old contribution if exists
	oldContrib := rua.podContributions[uid]

	// If pod moved nodes, handle node migration
	if oldContrib != nil && oldContrib.NodeName != nodeName {
		// Subtract from old node
		rua.subtractContribution(oldContrib.NodeName, oldContrib)
		rua.dirtyNodes[oldContrib.NodeName] = struct{}{}
	}

	// Subtract old contribution from current node (if same node)
	if oldContrib != nil && oldContrib.NodeName == nodeName {
		rua.subtractContribution(nodeName, oldContrib)
	}

	// Add new contribution
	rua.addContribution(nodeName, newContrib)
	rua.dirtyNodes[nodeName] = struct{}{}

	// Update stored contribution
	rua.podContributions[uid] = newContrib
}

// DeletePod removes a pod's contribution from the aggregator
func (rua *ResourceUsageAggregator) DeletePod(pod *corev1.Pod) {
	rua.mu.Lock()
	defer rua.mu.Unlock()

	uid := pod.UID
	oldContrib := rua.podContributions[uid]
	if oldContrib == nil {
		return
	}

	// Subtract contribution
	rua.subtractContribution(oldContrib.NodeName, oldContrib)
	rua.dirtyNodes[oldContrib.NodeName] = struct{}{}

	// Remove from tracking
	delete(rua.podContributions, uid)
}

// MarkDirty marks a node as dirty for the next flush
func (rua *ResourceUsageAggregator) MarkDirty(hostname string) {
	rua.mu.Lock()
	defer rua.mu.Unlock()
	rua.dirtyNodes[hostname] = struct{}{}
}

// GetAndClearDirtyNodes returns and clears the set of dirty nodes
func (rua *ResourceUsageAggregator) GetAndClearDirtyNodes() []string {
	rua.mu.Lock()
	defer rua.mu.Unlock()

	nodes := make([]string, 0, len(rua.dirtyNodes))
	for node := range rua.dirtyNodes {
		nodes = append(nodes, node)
	}
	rua.dirtyNodes = make(map[string]struct{})
	return nodes
}

// GetNodeUsage returns the resource usage for a node
func (rua *ResourceUsageAggregator) GetNodeUsage(hostname string) (map[string]string, map[string]string) {
	rua.mu.RLock()
	defer rua.mu.RUnlock()

	totals := rua.nodeTotals[hostname]
	if totals == nil {
		totals = &ResourceTotals{}
	}

	nonWfTotals := rua.nodeNonWorkflowTotals[hostname]
	if nonWfTotals == nil {
		nonWfTotals = &ResourceTotals{}
	}

	usageFields := FormatResourceUsage(totals)
	nonWorkflowFields := FormatResourceUsage(nonWfTotals)

	return usageFields, nonWorkflowFields
}

func (rua *ResourceUsageAggregator) addContribution(nodeName string, contrib *PodContribution) {
	// Initialize totals if needed
	if rua.nodeTotals[nodeName] == nil {
		rua.nodeTotals[nodeName] = &ResourceTotals{}
	}
	if rua.nodeNonWorkflowTotals[nodeName] == nil {
		rua.nodeNonWorkflowTotals[nodeName] = &ResourceTotals{}
	}

	// Add to totals
	rua.nodeTotals[nodeName].CPU += contrib.CPU
	rua.nodeTotals[nodeName].Memory += contrib.Memory
	rua.nodeTotals[nodeName].Storage += contrib.Storage
	rua.nodeTotals[nodeName].GPU += contrib.GPU

	// Add to non-workflow totals if not in workflow namespace
	if contrib.Namespace != rua.workflowNamespace {
		rua.nodeNonWorkflowTotals[nodeName].CPU += contrib.CPU
		rua.nodeNonWorkflowTotals[nodeName].Memory += contrib.Memory
		rua.nodeNonWorkflowTotals[nodeName].Storage += contrib.Storage
		rua.nodeNonWorkflowTotals[nodeName].GPU += contrib.GPU
	}
}

func (rua *ResourceUsageAggregator) subtractContribution(nodeName string, contrib *PodContribution) {
	if rua.nodeTotals[nodeName] == nil {
		return
	}

	// Subtract from totals
	rua.nodeTotals[nodeName].CPU -= contrib.CPU
	rua.nodeTotals[nodeName].Memory -= contrib.Memory
	rua.nodeTotals[nodeName].Storage -= contrib.Storage
	rua.nodeTotals[nodeName].GPU -= contrib.GPU

	// Subtract from non-workflow totals if not in workflow namespace
	if contrib.Namespace != rua.workflowNamespace && rua.nodeNonWorkflowTotals[nodeName] != nil {
		rua.nodeNonWorkflowTotals[nodeName].CPU -= contrib.CPU
		rua.nodeNonWorkflowTotals[nodeName].Memory -= contrib.Memory
		rua.nodeNonWorkflowTotals[nodeName].Storage -= contrib.Storage
		rua.nodeNonWorkflowTotals[nodeName].GPU -= contrib.GPU
	}
}

// CalculatePodContribution calculates resource requests for a pod
func CalculatePodContribution(pod *corev1.Pod) *PodContribution {
	contrib := &PodContribution{}

	for _, container := range pod.Spec.Containers {
		if container.Resources.Requests == nil {
			continue
		}

		requests := container.Resources.Requests

		// CPU in millicores
		if cpu, ok := requests[corev1.ResourceCPU]; ok {
			contrib.CPU += cpu.MilliValue()
		}

		// Memory in Ki
		if mem, ok := requests[corev1.ResourceMemory]; ok {
			contrib.Memory += ToKi(mem)
		}

		// Ephemeral storage in Ki
		if storage, ok := requests[corev1.ResourceEphemeralStorage]; ok {
			contrib.Storage += ToKi(storage)
		}

		// GPU
		gpuResource := corev1.ResourceName("nvidia.com/gpu")
		if gpu, ok := requests[gpuResource]; ok {
			contrib.GPU += gpu.Value()
		}
	}

	return contrib
}

// FormatResourceUsage formats resource totals as a map for the proto message
func FormatResourceUsage(totals *ResourceTotals) map[string]string {
	return map[string]string{
		"cpu":               fmt.Sprintf("%d", int64(math.Ceil(float64(totals.CPU)))),
		"memory":            fmt.Sprintf("%dKi", int64(math.Ceil(float64(totals.Memory)))),
		"ephemeral-storage": fmt.Sprintf("%dKi", int64(math.Ceil(float64(totals.Storage)))),
		"nvidia.com/gpu":    fmt.Sprintf("%d", totals.GPU),
	}
}
