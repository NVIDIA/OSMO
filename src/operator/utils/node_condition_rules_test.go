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

package utils

import (
	"sync"
	"testing"
)

func TestNewNodeConditionRules(t *testing.T) {
	nc := NewNodeConditionRules()
	if nc == nil {
		t.Fatal("NewNodeConditionRules() returned nil")
	}

	rules := nc.GetRules()
	if len(rules) == 0 {
		t.Error("Expected default rules to be set")
	}

	// Check that default Ready rule is present
	if status, ok := rules["^Ready$"]; !ok {
		t.Error("Expected default Ready rule to be present")
	} else if status != "True" {
		t.Errorf("Expected Ready rule status to be 'True', got %s", status)
	}
}

func TestNodeConditionRules_SetRules_Empty(t *testing.T) {
	nc := NewNodeConditionRules()

	// Set empty rules
	nc.SetRules(map[string]string{})

	rules := nc.GetRules()
	// Should still have default Ready rule
	if status, ok := rules["^Ready$"]; !ok {
		t.Error("Expected default Ready rule to be present after setting empty rules")
	} else if status != "True" {
		t.Errorf("Expected Ready rule status to be 'True', got %s", status)
	}
}

func TestNodeConditionRules_SetRules_WithCustomRules(t *testing.T) {
	nc := NewNodeConditionRules()

	// Set custom rules
	customRules := map[string]string{
		"^MemoryPressure$": "False",
		"^DiskPressure$":   "False",
	}
	nc.SetRules(customRules)

	rules := nc.GetRules()

	// Check custom rules are present
	if status, ok := rules["^MemoryPressure$"]; !ok {
		t.Error("Expected MemoryPressure rule to be present")
	} else if status != "False" {
		t.Errorf("Expected MemoryPressure rule status to be 'False', got %s", status)
	}

	if status, ok := rules["^DiskPressure$"]; !ok {
		t.Error("Expected DiskPressure rule to be present")
	} else if status != "False" {
		t.Errorf("Expected DiskPressure rule status to be 'False', got %s", status)
	}

	// Check default Ready rule is still present (not overridden)
	if status, ok := rules["^Ready$"]; !ok {
		t.Error("Expected default Ready rule to be present")
	} else if status != "True" {
		t.Errorf("Expected Ready rule status to be 'True', got %s", status)
	}
}

func TestNodeConditionRules_SetRules_OverrideDefault(t *testing.T) {
	nc := NewNodeConditionRules()

	// Override Ready rule with a pattern that matches it
	nc.SetRules(map[string]string{
		"^Ready$": "True|False", // Override with pattern that allows both
	})

	rules := nc.GetRules()

	// Check that the override is present
	if status, ok := rules["^Ready$"]; !ok {
		t.Error("Expected Ready rule to be present")
	} else if status != "True|False" {
		t.Errorf("Expected Ready rule status to be 'True|False', got %s", status)
	}

	// Should only have one Ready rule (the override)
	count := 0
	for pattern := range rules {
		if pattern == "^Ready$" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("Expected exactly one Ready rule, found %d", count)
	}
}

func TestNodeConditionRules_SetRules_PatternMatching(t *testing.T) {
	nc := NewNodeConditionRules()

	// Use a pattern that matches Ready
	nc.SetRules(map[string]string{
		"Ready": "True", // Pattern without anchors
	})

	rules := nc.GetRules()

	// Check that the pattern is present
	if status, ok := rules["Ready"]; !ok {
		t.Error("Expected Ready pattern to be present")
	} else if status != "True" {
		t.Errorf("Expected Ready pattern status to be 'True', got %s", status)
	}

	// Default Ready rule should not be added since pattern matches
	if _, ok := rules["^Ready$"]; ok {
		t.Error("Expected default Ready rule to not be added when pattern matches")
	}
}

func TestNodeConditionRules_GetRules_ReturnsCopy(t *testing.T) {
	nc := NewNodeConditionRules()

	rules1 := nc.GetRules()
	rules2 := nc.GetRules()

	// Modify the returned map
	rules1["test"] = "value"

	// Second call should not see the modification
	if _, ok := rules2["test"]; ok {
		t.Error("GetRules() should return a copy, modifications should not affect subsequent calls")
	}

	// Original should not be affected
	rules3 := nc.GetRules()
	if _, ok := rules3["test"]; ok {
		t.Error("GetRules() should return a copy, modifications should not affect the original")
	}
}

func TestNodeConditionRules_ThreadSafety(t *testing.T) {
	nc := NewNodeConditionRules()

	// Test concurrent reads and writes
	var wg sync.WaitGroup
	numGoroutines := 100

	// Concurrent writes
	wg.Add(numGoroutines)
	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			defer wg.Done()
			nc.SetRules(map[string]string{
				"^TestCondition$": "True",
			})
		}(i)
	}

	// Concurrent reads
	wg.Add(numGoroutines)
	for i := 0; i < numGoroutines; i++ {
		go func() {
			defer wg.Done()
			_ = nc.GetRules()
		}()
	}

	wg.Wait()

	// Final state should be valid
	rules := nc.GetRules()
	if len(rules) == 0 {
		t.Error("Expected rules to be present after concurrent operations")
	}
}

func TestNodeConditionRules_SetRules_Nil(t *testing.T) {
	nc := NewNodeConditionRules()

	// Set nil rules (should be treated as empty)
	nc.SetRules(nil)

	rules := nc.GetRules()
	// Should still have default Ready rule
	if status, ok := rules["^Ready$"]; !ok {
		t.Error("Expected default Ready rule to be present after setting nil rules")
	} else if status != "True" {
		t.Errorf("Expected Ready rule status to be 'True', got %s", status)
	}
}

func TestNodeConditionRules_MultipleDefaults(t *testing.T) {
	// Save original default
	originalDefault := DefaultAvailableCondition
	defer func() {
		DefaultAvailableCondition = originalDefault
	}()

	// Set multiple defaults
	DefaultAvailableCondition = map[string]string{
		"Ready":        "True",
		"MemoryPressure": "False",
	}

	nc := NewNodeConditionRules()
	nc.SetRules(map[string]string{})

	rules := nc.GetRules()

	// Check both defaults are present
	if status, ok := rules["^Ready$"]; !ok {
		t.Error("Expected Ready default to be present")
	} else if status != "True" {
		t.Errorf("Expected Ready default status to be 'True', got %s", status)
	}

	if status, ok := rules["^MemoryPressure$"]; !ok {
		t.Error("Expected MemoryPressure default to be present")
	} else if status != "False" {
		t.Errorf("Expected MemoryPressure default status to be 'False', got %s", status)
	}
}

func TestHasMatchingPattern(t *testing.T) {
	tests := []struct {
		name      string
		rules     map[string]string
		condType  string
		shouldMatch bool
	}{
		{
			name: "Exact match with anchor",
			rules: map[string]string{
				"^Ready$": "True",
			},
			condType:    "Ready",
			shouldMatch: true,
		},
		{
			name: "Pattern match without anchor",
			rules: map[string]string{
				"Ready": "True",
			},
			condType:    "Ready",
			shouldMatch: true,
		},
		{
			name: "No match",
			rules: map[string]string{
				"^MemoryPressure$": "False",
			},
			condType:    "Ready",
			shouldMatch: false,
		},
		{
			name: "Prefix match",
			rules: map[string]string{
				"^Ready.*": "True",
			},
			condType:    "Ready",
			shouldMatch: true,
		},
		{
			name: "Empty rules",
			rules: map[string]string{},
			condType:    "Ready",
			shouldMatch: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := hasMatchingPattern(tt.rules, tt.condType)
			if result != tt.shouldMatch {
				t.Errorf("hasMatchingPattern() = %v, expected %v", result, tt.shouldMatch)
			}
		})
	}
}

func TestMatchFromStart(t *testing.T) {
	tests := []struct {
		name    string
		pattern string
		text    string
		want    bool
		wantErr bool
	}{
		{
			name:    "Exact match with anchor",
			pattern: "^Ready$",
			text:    "Ready",
			want:    true,
			wantErr: false,
		},
		{
			name:    "Match without anchor",
			pattern: "Ready",
			text:    "Ready",
			want:    true,
			wantErr: false,
		},
		{
			name:    "No match",
			pattern: "^Ready$",
			text:    "NotReady",
			want:    false,
			wantErr: false,
		},
		{
			name:    "Prefix match",
			pattern: "^Ready",
			text:    "ReadyState",
			want:    true,
			wantErr: false,
		},
		{
			name:    "Invalid regex",
			pattern: "[",
			text:    "Ready",
			want:    false,
			wantErr: true,
		},
		{
			name:    "Empty pattern",
			pattern: "",
			text:    "Ready",
			want:    true, // Empty pattern matches everything
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := matchFromStart(tt.pattern, tt.text)
			if (err != nil) != tt.wantErr {
				t.Errorf("matchFromStart() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("matchFromStart() = %v, want %v", got, tt.want)
			}
		})
	}
}
