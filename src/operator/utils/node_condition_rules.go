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
	"maps"
	"regexp"
	"sync"
)

// DefaultAvailableCondition defines the default node condition rules for availability checking.
var DefaultAvailableCondition = map[string]string{"Ready": "True"}

// NodeConditionRules manages node condition rules in a thread-safe manner.
// Rules format: map[regex]regex mapping condition.type regex to a status regex.
// The status regex must be a combination of: True|False|Unknown (OR-ed).
// The rules field stores effective rules (user rules + defaults).
type NodeConditionRules struct {
	rules map[string]string
	mu    sync.RWMutex
}

// NewNodeConditionRules creates a new NodeConditionRules instance with default rules.
func NewNodeConditionRules() *NodeConditionRules {
	nc := &NodeConditionRules{}
	nc.SetRules(map[string]string{})
	return nc
}

// GetRules returns a copy of the current rules (thread-safe).
func (nc *NodeConditionRules) GetRules() map[string]string {
	nc.mu.RLock()
	defer nc.mu.RUnlock()
	// Return a copy to prevent external mutation
	return maps.Clone(nc.rules)
}

// SetRules replaces the entire rule set with the provided mapping (thread-safe).
// It computes and stores effective rules (user rules + defaults).
func (nc *NodeConditionRules) SetRules(rules map[string]string) {
	effective := make(map[string]string, len(rules)+len(DefaultAvailableCondition))

	// First, include all user-provided rules
	for pattern, statusRegex := range rules {
		effective["^"+pattern] = statusRegex
	}

	// Then, add defaults for any default condition type not matched by provided patterns
	for condType, statusRegex := range DefaultAvailableCondition {
		if !hasMatchingPattern(effective, condType) {
			// Escape the condition type and anchor it
			escaped := regexp.QuoteMeta(condType)
			effective["^"+escaped+"$"] = statusRegex
		}
	}

	nc.mu.Lock()
	defer nc.mu.Unlock()
	nc.rules = effective
}

// hasMatchingPattern checks if any pattern in the rules matches the condition type.
func hasMatchingPattern(rules map[string]string, condType string) bool {
	for pattern := range rules {
		if matched, err := regexp.MatchString(pattern, condType); err == nil && matched {
			return true
		}
	}
	return false
}
