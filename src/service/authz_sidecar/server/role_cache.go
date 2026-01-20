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

package server

import (
	"log/slog"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/hashicorp/golang-lru/v2/expirable"
	"go.corp.nvidia.com/osmo/utils/postgres"
)

// RoleCacheConfig holds configuration for the role cache
type RoleCacheConfig struct {
	Enabled bool
	TTL     time.Duration
	MaxSize int
}

// RoleCache provides thread-safe caching of role policies
type RoleCache struct {
	cache  *expirable.LRU[string, []*postgres.Role]
	config RoleCacheConfig
	logger *slog.Logger
	hits   atomic.Int64
	misses atomic.Int64
}

// NewRoleCache creates a new role cache
func NewRoleCache(config RoleCacheConfig, logger *slog.Logger) *RoleCache {
	var cache *expirable.LRU[string, []*postgres.Role]
	if config.Enabled {
		cache = expirable.NewLRU[string, []*postgres.Role](config.MaxSize, nil, config.TTL)
	}

	return &RoleCache{
		cache:  cache,
		config: config,
		logger: logger,
	}
}

// Get retrieves roles from cache by role names
// Returns the roles and a boolean indicating if found and not expired
func (c *RoleCache) Get(roleNames []string) ([]*postgres.Role, bool) {
	if !c.config.Enabled || c.cache == nil {
		return nil, false
	}

	key := c.cacheKey(roleNames)
	roles, found := c.cache.Get(key)

	if !found {
		misses := c.misses.Add(1)
		c.logger.Debug("cache miss",
			slog.String("key", key),
			slog.Int64("total_misses", misses),
		)
		return nil, false
	}

	hits := c.hits.Add(1)
	c.logger.Debug("cache hit",
		slog.String("key", key),
		slog.Int64("total_hits", hits),
	)

	return roles, true
}

// Set stores roles in cache with the configured TTL
func (c *RoleCache) Set(roleNames []string, roles []*postgres.Role) {
	if !c.config.Enabled || c.cache == nil {
		return
	}

	key := c.cacheKey(roleNames)
	c.cache.Add(key, roles)

	c.logger.Debug("cache set",
		slog.String("key", key),
		slog.Int("roles_count", len(roles)),
	)
}

// Clear removes all entries from the cache
func (c *RoleCache) Clear() {
	if !c.config.Enabled || c.cache == nil {
		return
	}

	c.cache.Purge()
	c.logger.Info("cache cleared")
}

// Stats returns cache statistics
func (c *RoleCache) Stats() map[string]interface{} {
	hits := c.hits.Load()
	misses := c.misses.Load()
	total := hits + misses
	hitRate := 0.0
	if total > 0 {
		hitRate = float64(hits) / float64(total) * 100
	}

	size := 0
	if c.cache != nil {
		size = c.cache.Len()
	}

	return map[string]interface{}{
		"enabled":     c.config.Enabled,
		"size":        size,
		"max_size":    c.config.MaxSize,
		"hits":        hits,
		"misses":      misses,
		"hit_rate":    hitRate,
		"ttl_seconds": c.config.TTL.Seconds(),
	}
}

// cacheKey generates a cache key from sorted role names
func (c *RoleCache) cacheKey(roleNames []string) string {
	// Create a copy to avoid modifying the input
	sorted := make([]string, len(roleNames))
	copy(sorted, roleNames)
	sort.Strings(sorted)
	return strings.Join(sorted, ",")
}
