// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed on the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"context"
	"testing"

	"go.corp.nvidia.com/osmo/operator/utils"
)

func TestNewNodeConditionRuleListener(t *testing.T) {
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

	nodeConditionRules := utils.NewNodeConditionRules()
	listener := NewNodeConditionRuleListener(args, nodeConditionRules, utils.NewNoopInstruments())

	if listener == nil {
		t.Fatal("NewNodeConditionRuleListener() returned nil")
	}

	if listener.args.ServiceURL != args.ServiceURL {
		t.Errorf("Expected ServiceURL %s, got %s", args.ServiceURL, listener.args.ServiceURL)
	}

	if listener.args.Backend != args.Backend {
		t.Errorf("Expected Backend %s, got %s", args.Backend, listener.args.Backend)
	}

	if listener.nodeConditionRules == nil {
		t.Error("Expected nodeConditionRules to be set")
	}
}

func TestNewNodeConditionRuleListener_WithNilRules(t *testing.T) {
	args := utils.ListenerArgs{
		ServiceURL: "http://localhost:8000",
		Backend:    "test-backend",
	}

	// This should not panic
	listener := NewNodeConditionRuleListener(args, nil, utils.NewNoopInstruments())

	if listener == nil {
		t.Fatal("NewNodeConditionRuleListener() returned nil")
	}

	if listener.nodeConditionRules != nil {
		t.Error("Expected nodeConditionRules to be nil when passed nil")
	}
}

func TestNodeConditionRuleListener_Run_InvalidURL(t *testing.T) {
	args := utils.ListenerArgs{
		ServiceURL: "invalid-url",
		Backend:    "test-backend",
	}

	nodeConditionRules := utils.NewNodeConditionRules()
	listener := NewNodeConditionRuleListener(args, nodeConditionRules, utils.NewNoopInstruments())

	ctx := context.Background()
	err := listener.Run(ctx)

	if err == nil {
		t.Error("Expected error for invalid URL, got nil")
	}

	// Check that error message contains expected text
	if err.Error() == "" {
		t.Error("Expected non-empty error message")
	}
}

func TestNodeConditionRuleListener_Run_ContextCancellation(t *testing.T) {
	args := utils.ListenerArgs{
		ServiceURL: "http://localhost:9999", // Non-existent server
		Backend:    "test-backend",
	}

	nodeConditionRules := utils.NewNodeConditionRules()
	listener := NewNodeConditionRuleListener(args, nodeConditionRules, utils.NewNoopInstruments())

	// Create a context that will be cancelled
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// This should fail quickly due to context cancellation or connection error
	err := listener.Run(ctx)

	// We expect either a context cancellation error or a connection error
	if err == nil {
		t.Error("Expected error for cancelled context or connection failure, got nil")
	}
}

func TestNodeConditionRuleListener_Integration_WithRules(t *testing.T) {
	// This test verifies that the listener structure is correct
	// Full integration testing would require a mock gRPC server
	args := utils.ListenerArgs{
		ServiceURL: "http://localhost:8000",
		Backend:    "test-backend",
	}

	nodeConditionRules := utils.NewNodeConditionRules()
	listener := NewNodeConditionRuleListener(args, nodeConditionRules, utils.NewNoopInstruments())

	// Verify initial state
	initialRules := nodeConditionRules.GetRules()
	if len(initialRules) == 0 {
		t.Error("Expected initial rules to contain defaults")
	}

	// Verify that the listener has the correct structure
	if listener.args.Backend != "test-backend" {
		t.Errorf("Expected backend 'test-backend', got %s", listener.args.Backend)
	}

	if listener.nodeConditionRules != nodeConditionRules {
		t.Error("Expected nodeConditionRules to be the same instance")
	}
}
