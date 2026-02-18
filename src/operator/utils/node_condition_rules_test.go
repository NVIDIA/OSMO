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
	"regexp"
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

	// Verify that MemoryPressure rule matches correctly
	matched := false
	for pattern, status := range rules {
		if matched, _ = regexp.MatchString(pattern, "MemoryPressure"); matched {
			if status != "False" {
				t.Errorf("Expected MemoryPressure rule status to be 'False', got %s", status)
			}
			break
		}
	}
	if !matched {
		t.Error("Expected MemoryPressure rule to match 'MemoryPressure'")
	}

	// Verify that DiskPressure rule matches correctly
	matched = false
	for pattern, status := range rules {
		if matched, _ = regexp.MatchString(pattern, "DiskPressure"); matched {
			if status != "False" {
				t.Errorf("Expected DiskPressure rule status to be 'False', got %s", status)
			}
			break
		}
	}
	if !matched {
		t.Error("Expected DiskPressure rule to match 'DiskPressure'")
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

	// Verify that Ready rule matches and has the correct status
	matched := false
	matchCount := 0
	for pattern, status := range rules {
		if matched, _ = regexp.MatchString(pattern, "Ready"); matched {
			matchCount++
			if status != "True|False" {
				t.Errorf("Expected Ready rule status to be 'True|False', got %s", status)
			}
		}
	}
	if !matched {
		t.Error("Expected Ready rule to match 'Ready'")
	}
	if matchCount != 1 {
		t.Errorf("Expected exactly one Ready rule to match, found %d", matchCount)
	}
}

func TestNodeConditionRules_SetRules_PatternMatching(t *testing.T) {
	nc := NewNodeConditionRules()

	// Use a pattern that matches Ready (will be normalized to start with '^')
	nc.SetRules(map[string]string{
		"Ready": "True", // Pattern without anchors - will be normalized to "^Ready"
	})

	rules := nc.GetRules()

	// Check that the normalized pattern is present
	if status, ok := rules["^Ready"]; !ok {
		t.Error("Expected normalized Ready pattern (^Ready) to be present")
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
		"Ready":          "True",
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
		name        string
		rules       map[string]string
		condType    string
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
			name: "Pattern match with normalized anchor",
			rules: map[string]string{
				"^Ready": "True",
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
			name:        "Empty rules",
			rules:       map[string]string{},
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

func TestNormalizePattern(t *testing.T) {
	tests := []struct {
		name        string
		pattern     string
		text        string
		shouldMatch bool
	}{
		{
			name:        "Pattern with anchor matches exact",
			pattern:     "^Ready$",
			text:        "Ready",
			shouldMatch: true,
		},
		{
			name:        "Pattern with anchor doesn't match prefix",
			pattern:     "^Ready$",
			text:        "ReadyState",
			shouldMatch: false,
		},
		{
			name:        "Pattern without anchor matches from start",
			pattern:     "Ready",
			text:        "Ready",
			shouldMatch: true,
		},
		{
			name:        "Pattern without anchor matches prefix",
			pattern:     "Ready",
			text:        "ReadyState",
			shouldMatch: true,
		},
		{
			name:        "Empty pattern matches everything",
			pattern:     "",
			text:        "Ready",
			shouldMatch: true,
		},
		{
			name:        "Pattern with prefix anchor matches prefix",
			pattern:     "^Ready",
			text:        "ReadyState",
			shouldMatch: true,
		},
		{
			name:        "Complex pattern matches from start",
			pattern:     "Ready.*",
			text:        "ReadyState",
			shouldMatch: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Test normalizePattern indirectly through SetRules
			nc := NewNodeConditionRules()
			nc.SetRules(map[string]string{tt.pattern: "True"})
			rules := nc.GetRules()

			// Find the pattern that matches our text
			matched := false
			for pattern := range rules {
				if match, err := regexp.MatchString(pattern, tt.text); err == nil && match {
					matched = true
					break
				}
			}
			if matched != tt.shouldMatch {
				t.Errorf("Pattern %q normalized and matched against %q = %v, want %v",
					tt.pattern, tt.text, matched, tt.shouldMatch)
			}
		})
	}
}
