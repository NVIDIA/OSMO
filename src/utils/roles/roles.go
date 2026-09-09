/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

// Package roles provides types and utilities for role-based access control.
package roles

import (
	"encoding/json"
	"fmt"
)

// RoleAction represents a semantic action or a legacy path-based action.
type RoleAction struct {
	Action string `json:"action,omitempty"`
	Base   string `json:"base,omitempty"`
	Path   string `json:"path,omitempty"`
	Method string `json:"method,omitempty"`
}

// IsSemanticAction reports whether this action uses the semantic format.
func (ra *RoleAction) IsSemanticAction() bool {
	return ra.Action != ""
}

// IsLegacyAction reports whether this action uses the legacy path format.
func (ra *RoleAction) IsLegacyAction() bool {
	return ra.Action == "" && (ra.Base != "" || ra.Path != "" || ra.Method != "")
}

// PolicyEffect is the effect of a policy statement.
type PolicyEffect string

const (
	// EffectAllow grants access when a policy matches.
	EffectAllow PolicyEffect = "Allow"
	// EffectDeny denies access when a policy matches.
	EffectDeny PolicyEffect = "Deny"
)

// RoleActions accepts semantic action strings and legacy action objects.
type RoleActions []RoleAction

// UnmarshalJSON accepts a string semantic action or an action object.
func (ra *RoleActions) UnmarshalJSON(data []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	result := make(RoleActions, 0, len(raw))
	for _, elem := range raw {
		if len(elem) == 0 {
			result = append(result, RoleAction{})
			continue
		}
		switch elem[0] {
		case '"':
			var action string
			if err := json.Unmarshal(elem, &action); err != nil {
				return err
			}
			result = append(result, RoleAction{Action: action})
		case '{':
			var action RoleAction
			if err := json.Unmarshal(elem, &action); err != nil {
				return err
			}
			result = append(result, action)
		default:
			return fmt.Errorf(
				"invalid action element: expected string or object, got %s", elem)
		}
	}
	*ra = result
	return nil
}

// MarshalJSON emits semantic actions as strings and legacy actions as objects.
func (ra RoleActions) MarshalJSON() ([]byte, error) {
	out := make([]json.RawMessage, 0, len(ra))
	for _, action := range ra {
		var (
			encoded []byte
			err     error
		)
		if action.IsSemanticAction() {
			encoded, err = json.Marshal(action.Action)
		} else {
			encoded, err = json.Marshal(action)
		}
		if err != nil {
			return nil, err
		}
		out = append(out, encoded)
	}
	return json.Marshal(out)
}

// RolePolicy contains the actions and resources governed by one effect.
type RolePolicy struct {
	Effect    PolicyEffect `json:"effect,omitempty"`
	Actions   RoleActions  `json:"actions"`
	Resources []string     `json:"resources,omitempty"`
}

// Role is one complete ConfigMap-owned role definition.
type Role struct {
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Policies    []RolePolicy `json:"policies"`
	Immutable   bool         `json:"immutable"`
}
