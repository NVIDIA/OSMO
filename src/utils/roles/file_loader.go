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
	"sync"
	"time"

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

	mu              sync.RWMutex
	roles           map[string]*Role   // name -> Role
	externalRoleMap map[string][]string // externalRole -> []osmoRoleName
	poolNames       []string
	lastModTime     time.Time
}

// fileConfig mirrors the flat YAML structure of the configs file.
type fileConfig struct {
	Roles map[string]fileRole   `yaml:"roles"`
	Pools map[string]yaml.Node  `yaml:"pools"`
}

type fileRole struct {
	Description   string           `yaml:"description"`
	Policies      []filePolicy     `yaml:"policies"`
	ExternalRoles []string         `yaml:"external_roles"`
	Immutable     bool             `yaml:"immutable"`
}

type filePolicy struct {
	Effect    string   `yaml:"effect"`
	Actions   []any    `yaml:"actions"`
	Resources []string `yaml:"resources"`
}

// NewFileRoleStore creates a store that reads from the given YAML file.
// Call Load() to populate, then Start() to begin watching for changes.
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

	for name, fileRole := range config.Roles {
		role, err := parseFileRole(name, fileRole)
		if err != nil {
			s.logger.Error("skipping invalid role",
				slog.String("role", name),
				slog.String("error", err.Error()))
			continue
		}
		roles[name] = role

		// Build reverse mapping: externalRole -> []osmoRoleName
		extRoles := fileRole.ExternalRoles
		if len(extRoles) == 0 {
			// Default: role name maps to itself
			extRoles = []string{name}
		}
		for _, extRole := range extRoles {
			externalMap[extRole] = append(externalMap[extRole], name)
		}
	}

	// Extract pool names
	poolNames := make([]string, 0, len(config.Pools))
	for name := range config.Pools {
		poolNames = append(poolNames, name)
	}

	// Atomic swap
	s.mu.Lock()
	s.roles = roles
	s.externalRoleMap = externalMap
	s.poolNames = poolNames
	s.mu.Unlock()

	info, _ := os.Stat(s.filePath)
	if info != nil {
		s.lastModTime = info.ModTime()
	}

	s.logger.Info("roles loaded from file",
		slog.Int("role_count", len(roles)),
		slog.Int("external_mappings", len(externalMap)),
		slog.Int("pool_count", len(poolNames)),
		slog.String("file", s.filePath))

	return nil
}

// Start begins a background goroutine that polls the file for changes.
func (s *FileRoleStore) Start(pollInterval time.Duration) {
	go func() {
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()
		for range ticker.C {
			info, err := os.Stat(s.filePath)
			if err != nil {
				continue
			}
			if info.ModTime().After(s.lastModTime) {
				s.logger.Info("roles file changed, reloading",
					slog.String("file", s.filePath))
				if err := s.Load(); err != nil {
					s.logger.Error("failed to reload roles file",
						slog.String("error", err.Error()))
				}
			}
		}
	}()
}

// GetRoles returns Role objects for the given names.
// Unknown names are silently skipped (same behavior as DB query).
func (s *FileRoleStore) GetRoles(names []string) []*Role {
	s.mu.RLock()
	defer s.mu.RUnlock()

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
	s.mu.RLock()
	defer s.mu.RUnlock()

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
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]string, len(s.poolNames))
	copy(result, s.poolNames)
	return result
}

// parseFileRole converts a fileRole (YAML) to a Role (Go struct).
func parseFileRole(name string, fr fileRole) (*Role, error) {
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
		if policy.Resources == nil {
			policy.Resources = []string{}
		}

		// Parse actions: each element is either a string (semantic)
		// or a map (legacy path-based).
		policy.Actions = make(RoleActions, 0, len(fp.Actions))
		for j, action := range fp.Actions {
			switch v := action.(type) {
			case string:
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
				policy.Actions = append(policy.Actions, ra)
			default:
				return nil, fmt.Errorf("policy %d action %d: unexpected type %T", i, j, action)
			}
		}

		role.Policies = append(role.Policies, policy)
	}

	return role, nil
}
