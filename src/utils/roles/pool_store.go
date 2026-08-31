/*
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
*/

package roles

import (
	"fmt"
	"os"
	"sort"

	"gopkg.in/yaml.v3"
)

// ConfigMapPoolStore is an immutable pool/backend view used by the hybrid
// release. Roles and assignments remain PostgreSQL-owned.
type ConfigMapPoolStore struct {
	poolNames    []string
	poolBackends map[string]string
	backends     map[string]struct{}
}

type poolFileEntry struct {
	Backend string `yaml:"backend"`
}

type poolFileConfig struct {
	Pools    map[string]poolFileEntry `yaml:"pools"`
	Backends map[string]yaml.Node     `yaml:"backends"`
}

// LoadConfigMapPoolStore loads one immutable ConfigMap snapshot.
func LoadConfigMapPoolStore(filePath string) (*ConfigMapPoolStore, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("read pool config file: %w", err)
	}
	var config poolFileConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("parse pool config file: %w", err)
	}
	if config.Pools == nil || config.Backends == nil {
		return nil, fmt.Errorf("config file must contain pools and backends sections")
	}
	store := &ConfigMapPoolStore{
		poolBackends: make(map[string]string, len(config.Pools)),
		backends:     make(map[string]struct{}, len(config.Backends)),
	}
	for backend := range config.Backends {
		store.backends[backend] = struct{}{}
	}
	for name, pool := range config.Pools {
		if pool.Backend == "" {
			return nil, fmt.Errorf("pool %q is missing its backend", name)
		}
		if _, ok := store.backends[pool.Backend]; !ok {
			return nil, fmt.Errorf("pool %q references missing backend %q", name, pool.Backend)
		}
		store.poolNames = append(store.poolNames, name)
		store.poolBackends[name] = pool.Backend
	}
	sort.Strings(store.poolNames)
	return store, nil
}

// GetPoolNames returns a copy of the immutable pool names.
func (s *ConfigMapPoolStore) GetPoolNames() []string {
	result := make([]string, len(s.poolNames))
	copy(result, s.poolNames)
	return result
}

// ValidateActiveWorkflowReference prevents a cutover snapshot from removing
// routing authority still used by a live workflow.
func (s *ConfigMapPoolStore) ValidateActiveWorkflowReference(
	workflowID, pool, backend string,
) error {
	configuredBackend, ok := s.poolBackends[pool]
	if !ok {
		return fmt.Errorf("active workflow %s references missing pool %s", workflowID, pool)
	}
	if _, ok := s.backends[backend]; !ok {
		return fmt.Errorf("active workflow %s references missing backend %s", workflowID, backend)
	}
	if configuredBackend != backend {
		return fmt.Errorf("active workflow %s pool %s no longer references backend %s",
			workflowID, pool, backend)
	}
	return nil
}
