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
	"math"
	"math/rand"
	"strconv"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/types"

	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// NodeStateTracker tracks the last sent state for each node to avoid duplicate messages
type NodeStateTracker struct {
	mu        sync.RWMutex
	states    map[string]nodeStateEntry
	ttl       time.Duration
	ttlJitter time.Duration
}

type nodeStateEntry struct {
	body      *pb.UpdateNodeBody
	timestamp time.Time
}

// NewNodeStateTracker creates a new node state tracker
func NewNodeStateTracker(ttl time.Duration) *NodeStateTracker {
	return &NodeStateTracker{
		states:    make(map[string]nodeStateEntry),
		ttl:       ttl,
		ttlJitter: ttl / 5, // 20% jitter
	}
}

// HasChanged checks if the node's state has changed since last sent
func (nst *NodeStateTracker) HasChanged(hostname string, body *pb.UpdateNodeBody) bool {
	nst.mu.RLock()
	defer nst.mu.RUnlock()

	entry, exists := nst.states[hostname]
	if !exists {
		return true
	}

	// Check TTL with jitter (skip if ttl is 0, meaning TTL is disabled)
	if nst.ttl > 0 {
		jitter := time.Duration(rand.Int63n(int64(nst.ttlJitter)))
		effectiveTTL := nst.ttl + jitter
		if time.Since(entry.timestamp) > effectiveTTL {
			return true
		}
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

// ResourceBodiesEqual compares two UpdateNodeBody messages for equality.
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

// NodeUsageAggregator tracks per-node usage from pods
type NodeUsageAggregator struct {
	mu sync.RWMutex

	// Workflow namespace for distinguishing workflow vs non-workflow pods
	workflowNamespace string

	// Pod contributions by UID
	podContributions map[types.UID]*PodContribution

	// Per-node totals
	nodeTotals map[string]*NodeUsageTotals

	// Per-node non-workflow totals
	nodeNonWorkflowTotals map[string]*NodeUsageTotals

	// Set of dirty nodes (modified since last flush)
	dirtyNodes map[string]struct{}
}

// NodeUsageTotals holds resource counters (cpu, memory, storage, gpu)
type NodeUsageTotals struct {
	CPU     int64 // millicores
	Memory  int64 // Ki
	Storage int64 // Ki
	GPU     int64
}

// PodContribution tracks individual pod contributions
type PodContribution struct {
	NodeUsageTotals // embedded struct
	NodeName        string
	Namespace       string
}

// NewNodeUsageAggregator creates a new node usage aggregator
func NewNodeUsageAggregator(workflowNamespace string) *NodeUsageAggregator {
	return &NodeUsageAggregator{
		workflowNamespace:     workflowNamespace,
		podContributions:      make(map[types.UID]*PodContribution),
		nodeTotals:            make(map[string]*NodeUsageTotals),
		nodeNonWorkflowTotals: make(map[string]*NodeUsageTotals),
		dirtyNodes:            make(map[string]struct{}),
	}
}

// Reset clears all aggregator state
func (rua *NodeUsageAggregator) Reset() {
	rua.mu.Lock()
	defer rua.mu.Unlock()

	rua.podContributions = make(map[types.UID]*PodContribution)
	rua.nodeTotals = make(map[string]*NodeUsageTotals)
	rua.nodeNonWorkflowTotals = make(map[string]*NodeUsageTotals)
	rua.dirtyNodes = make(map[string]struct{})
}

// AddPod adds a pod's resource requests to the aggregator.
// Note: Pod resources and node assignment are immutable in Kubernetes.
// Once a pod is scheduled, its spec.nodeName and resource requests cannot change.
// Therefore, if we've already seen this pod UID, we can skip processing.
func (rua *NodeUsageAggregator) AddPod(pod *corev1.Pod) {
	uid := pod.UID

	// Fast path: check if already exists with RLock
	rua.mu.RLock()
	_, exists := rua.podContributions[uid]
	rua.mu.RUnlock()

	if exists {
		return // Most common case - pod already tracked
	}

	// Slow path: actually add the pod
	nodeName := pod.Spec.NodeName
	namespace := pod.Namespace

	// Calculate contribution outside the lock to minimize lock hold time
	newContrib := CalculatePodContribution(pod)
	newContrib.NodeName = nodeName
	newContrib.Namespace = namespace

	rua.mu.Lock()
	defer rua.mu.Unlock()

	// Double-check under write lock (another goroutine may have added it)
	if _, exists := rua.podContributions[uid]; exists {
		return
	}

	// Add new pod contribution
	rua.addContribution(nodeName, newContrib)
	rua.dirtyNodes[nodeName] = struct{}{}
	rua.podContributions[uid] = newContrib
}

// DeletePod removes a pod's contribution from the aggregator
func (rua *NodeUsageAggregator) DeletePod(pod *corev1.Pod) {
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
func (rua *NodeUsageAggregator) MarkDirty(hostname string) {
	rua.mu.Lock()
	defer rua.mu.Unlock()
	rua.dirtyNodes[hostname] = struct{}{}
}

// GetAndClearDirtyNodes returns and clears the set of dirty nodes
func (rua *NodeUsageAggregator) GetAndClearDirtyNodes() []string {
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
func (rua *NodeUsageAggregator) GetNodeUsage(hostname string) (map[string]string, map[string]string) {
	rua.mu.RLock()
	defer rua.mu.RUnlock()

	totals := rua.nodeTotals[hostname]
	if totals == nil {
		totals = &NodeUsageTotals{}
	}

	nonWfTotals := rua.nodeNonWorkflowTotals[hostname]
	if nonWfTotals == nil {
		nonWfTotals = &NodeUsageTotals{}
	}

	usageFields := FormatResourceUsage(totals)
	nonWorkflowFields := FormatResourceUsage(nonWfTotals)

	return usageFields, nonWorkflowFields
}

func (rua *NodeUsageAggregator) addContribution(nodeName string, contrib *PodContribution) {
	// Initialize totals if needed
	if rua.nodeTotals[nodeName] == nil {
		rua.nodeTotals[nodeName] = &NodeUsageTotals{}
	}
	if rua.nodeNonWorkflowTotals[nodeName] == nil {
		rua.nodeNonWorkflowTotals[nodeName] = &NodeUsageTotals{}
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

func (rua *NodeUsageAggregator) subtractContribution(nodeName string, contrib *PodContribution) {
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
func FormatResourceUsage(totals *NodeUsageTotals) map[string]string {
	// Convert CPU from millicores to cores and round up
	cpuCores := int64(math.Ceil(float64(totals.CPU) / 1000.0))

	return map[string]string{
		"cpu":               strconv.FormatInt(cpuCores, 10),
		"memory":            strconv.FormatInt(totals.Memory, 10) + "Ki",
		"ephemeral-storage": strconv.FormatInt(totals.Storage, 10) + "Ki",
		"nvidia.com/gpu":    strconv.FormatInt(totals.GPU, 10),
	}
}
