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

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"

	pb "go.corp.nvidia.com/osmo/proto/operator"
)

// GetNodeHostname extracts the hostname from a node
func GetNodeHostname(node *corev1.Node) string {
	if hostname, ok := node.Labels["kubernetes.io/hostname"]; ok {
		return hostname
	}
	return "-"
}

// BuildUpdateNodeBody creates an UpdateNodeBody from a node
func BuildUpdateNodeBody(node *corev1.Node, isDelete bool) *pb.UpdateNodeBody {
	hostname := GetNodeHostname(node)

	// Build conditions list (types with status True)
	var conditions []string
	for _, cond := range node.Status.Conditions {
		if cond.Status == corev1.ConditionTrue {
			conditions = append(conditions, string(cond.Type))
		}
	}

	// Calculate availability: Ready==True && !Unschedulable
	available := IsNodeAvailable(node)

	// Build allocatable fields
	allocatableFields := make(map[string]string)
	for name, qty := range node.Status.Allocatable {
		switch name {
		case corev1.ResourceCPU:
			// CPU in cores (rounded down from millicores)
			allocatableFields[string(name)] = fmt.Sprintf("%d", int(qty.MilliValue()/1000))
		case corev1.ResourceMemory, corev1.ResourceEphemeralStorage:
			// Memory/Storage in Ki
			allocatableFields[string(name)] = fmt.Sprintf("%dKi", ToKi(qty))
		default:
			allocatableFields[string(name)] = qty.String()
		}
	}

	// Build label fields
	labelFields := node.Labels

	// Build taints
	var taints []*pb.Taint
	for _, taint := range node.Spec.Taints {
		t := &pb.Taint{
			Key:    taint.Key,
			Value:  taint.Value,
			Effect: string(taint.Effect),
		}
		if taint.TimeAdded != nil {
			t.TimeAdded = taint.TimeAdded.UTC().Format("2006-01-02T15:04:05.999999")
		}
		taints = append(taints, t)
	}

	return &pb.UpdateNodeBody{
		Hostname:          hostname,
		Available:         available,
		Conditions:        conditions,
		AllocatableFields: allocatableFields,
		LabelFields:       labelFields,
		Taints:            taints,
		Delete:            isDelete,
	}
}

// IsNodeAvailable checks if a node is available (Ready==True && !Unschedulable)
func IsNodeAvailable(node *corev1.Node) bool {
	if node.Spec.Unschedulable {
		return false
	}

	for _, cond := range node.Status.Conditions {
		if cond.Type == corev1.NodeReady {
			return cond.Status == corev1.ConditionTrue
		}
	}

	return false
}

// ToKi converts a resource.Quantity to Ki (kibibytes)
func ToKi(q resource.Quantity) int64 {
	// Get value in bytes and convert to Ki
	bytes := q.Value()
	return int64(math.Ceil(float64(bytes) / 1024))
}
