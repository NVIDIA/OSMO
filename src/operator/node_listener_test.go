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
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

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

	defaultRules := utils.DefaultAvailableCondition
	body := utils.BuildUpdateNodeBody(node, false, defaultRules)

	if !tracker.HasChanged("test-node", body) {
		t.Error("Expected first check to indicate change")
	}

	tracker.Update("test-node", body)

	if tracker.HasChanged("test-node", body) {
		t.Error("Expected no change for identical body")
	}

	node.Spec.Unschedulable = true
	body2 := utils.BuildUpdateNodeBody(node, false, defaultRules)

	if !tracker.HasChanged("test-node", body2) {
		t.Error("Expected change after modifying node")
	}
}

func TestNewNodeListener(t *testing.T) {
	args := utils.ListenerArgs{
		ServiceURL:           "http://localhost:8000",
		Backend:              "test-backend",
		Namespace:            "osmo",
		NodeUpdateChanSize:   100,
		StateCacheTTLMin:     15,
		MaxUnackedMessages:   100,
		NodeConditionPrefix:  "osmo.nvidia.com/",
		ProgressDir:          "/tmp/osmo/operator/",
		ProgressFrequencySec: 15,
	}

	nodeConditionRules := utils.NewNodeConditionRules()
	listener := NewNodeListener(args, nodeConditionRules)

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
