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

package roles

import (
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// FileRoleStore loads roles, external role mappings, and pool names from
// a ConfigMap-mounted YAML file. It replaces the PostgreSQL-backed role
// storage for the authz_sidecar in ConfigMap mode.
//
// The file is the same configs YAML mounted for the Python service:
//
//	roles:
//	  osmo-admin:
//	    policies: [...]
//	    external_roles: [admin-group]
//	pools:
//	  gpu-large: { ... }
type FileRoleStore struct {
	filePath string
	logger   *slog.Logger

	roles           map[string]*Role    // name -> Role
	externalRoleMap map[string][]string // externalRole -> []osmoRoleName
	poolNames       []string
}

var semanticActionPattern = regexp.MustCompile(`^(\*|[a-z]+):(\*|[A-Z][a-zA-Z]*)$`)

// fileConfig mirrors the flat YAML structure of the configs file.
type fileConfig struct {
	Roles map[string]fileRole  `yaml:"roles"`
	Pools map[string]yaml.Node `yaml:"pools"`
}

type fileRole struct {
	Description   string       `yaml:"description"`
	Policies      []filePolicy `yaml:"policies"`
	ExternalRoles *[]string    `yaml:"external_roles"`
	Immutable     bool         `yaml:"immutable"`
}

type filePolicy struct {
	Effect    string   `yaml:"effect"`
	Actions   []any    `yaml:"actions"`
	Resources []string `yaml:"resources"`
}

// NewFileRoleStore creates a store that reads from the given YAML file.
// Call Load() once during process startup. Workload rollouts triggered by the
// ConfigMap checksum are responsible for applying later changes.
func NewFileRoleStore(filePath string, logger *slog.Logger) *FileRoleStore {
	return &FileRoleStore{
		filePath:        filePath,
		logger:          logger,
		roles:           make(map[string]*Role),
		externalRoleMap: make(map[string][]string),
	}
}

// Load reads and parses the YAML file, populating the in-memory store.
// Returns an error if the file cannot be read or parsed.
func (s *FileRoleStore) Load() error {
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		return fmt.Errorf("read roles file: %w", err)
	}

	var config fileConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		return fmt.Errorf("parse roles file: %w", err)
	}

	roles := make(map[string]*Role, len(config.Roles))
	externalMap := make(map[string][]string)

	roleNames := make([]string, 0, len(config.Roles))
	for name := range config.Roles {
		roleNames = append(roleNames, name)
	}
	sort.Strings(roleNames)
	for _, name := range roleNames {
		fileRole := config.Roles[name]
		role, err := parseFileRole(name, fileRole)
		if err != nil {
			return fmt.Errorf("invalid role %q: %w", name, err)
		}
		roles[name] = role

		// Build reverse mapping: externalRole -> []osmoRoleName
		extRoles := []string{name}
		if fileRole.ExternalRoles != nil {
			extRoles = *fileRole.ExternalRoles
		}
		for _, extRole := range extRoles {
			if strings.TrimSpace(extRole) == "" {
				return fmt.Errorf("invalid role %q: external_roles must not contain an empty name", name)
			}
			externalMap[extRole] = append(externalMap[extRole], name)
		}
	}
	if len(roles) == 0 {
		return fmt.Errorf("roles section must contain at least one role")
	}
	if config.Pools == nil {
		return fmt.Errorf("pools section is required")
	}

	// Extract pool names
	poolNames := make([]string, 0, len(config.Pools))
	for name := range config.Pools {
		if strings.TrimSpace(name) == "" {
			return fmt.Errorf("pools must not contain an empty name")
		}
		poolNames = append(poolNames, name)
	}
	sort.Strings(poolNames)

	s.roles = roles
	s.externalRoleMap = externalMap
	s.poolNames = poolNames

	s.logger.Info("roles loaded from file",
		slog.Int("role_count", len(roles)),
		slog.Int("external_mappings", len(externalMap)),
		slog.Int("pool_count", len(poolNames)),
		slog.String("file", s.filePath))

	return nil
}

// GetRoles returns Role objects for the given names.
// Unknown names are skipped so stale assignment rows cannot grant authority.
func (s *FileRoleStore) GetRoles(names []string) []*Role {
	var result []*Role
	for _, name := range names {
		if role, ok := s.roles[name]; ok {
			result = append(result, role)
		}
	}
	return result
}

// ResolveExternalRoles maps external IDP roles (from JWT claims) to
// OSMO role names using the in-memory external_roles mappings.
// This replaces the SyncUserRoles SQL query.
func (s *FileRoleStore) ResolveExternalRoles(externalRoles []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, extRole := range externalRoles {
		for _, osmoRole := range s.externalRoleMap[extRole] {
			if !seen[osmoRole] {
				seen[osmoRole] = true
				result = append(result, osmoRole)
			}
		}
	}
	return result
}

// GetPoolNames returns all pool names from the ConfigMap.
func (s *FileRoleStore) GetPoolNames() []string {
	result := make([]string, len(s.poolNames))
	copy(result, s.poolNames)
	return result
}

// parseFileRole converts a fileRole (YAML) to a Role (Go struct).
func parseFileRole(name string, fr fileRole) (*Role, error) {
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("role name must not be empty")
	}
	role := &Role{
		Name:        name,
		Description: fr.Description,
		Immutable:   fr.Immutable,
	}

	role.Policies = make([]RolePolicy, 0, len(fr.Policies))
	for i, fp := range fr.Policies {
		policy := RolePolicy{
			Resources: fp.Resources,
		}
		if fp.Effect != "" {
			policy.Effect = PolicyEffect(fp.Effect)
		} else {
			policy.Effect = EffectAllow
		}
		if policy.Effect != EffectAllow && policy.Effect != EffectDeny {
			return nil, fmt.Errorf("policy %d: effect must be Allow or Deny", i)
		}
		if len(fp.Actions) == 0 {
			return nil, fmt.Errorf("policy %d: actions must not be empty", i)
		}
		if policy.Resources == nil {
			policy.Resources = []string{}
		}

		// Parse actions: each element is either a string (semantic)
		// or a map (legacy path-based).
		policy.Actions = make(RoleActions, 0, len(fp.Actions))
		for j, action := range fp.Actions {
			switch v := action.(type) {
			case string:
				if !semanticActionPattern.MatchString(v) {
					return nil, fmt.Errorf("policy %d action %d: invalid semantic action %q", i, j, v)
				}
				policy.Actions = append(policy.Actions, RoleAction{Action: v})
			case map[string]any:
				ra := RoleAction{}
				if s, ok := v["action"].(string); ok {
					ra.Action = s
				}
				if s, ok := v["base"].(string); ok {
					ra.Base = s
				}
				if s, ok := v["path"].(string); ok {
					ra.Path = s
				}
				if s, ok := v["method"].(string); ok {
					ra.Method = s
				}
				if ra.Action != "" {
					if !semanticActionPattern.MatchString(ra.Action) {
						return nil, fmt.Errorf("policy %d action %d: invalid semantic action %q", i, j, ra.Action)
					}
				} else if !ra.IsLegacyAction() {
					return nil, fmt.Errorf("policy %d action %d: action must not be empty", i, j)
				}
				policy.Actions = append(policy.Actions, ra)
			default:
				return nil, fmt.Errorf("policy %d action %d: unexpected type %T", i, j, action)
			}
		}

		role.Policies = append(role.Policies, policy)
	}

	return role, nil
}
