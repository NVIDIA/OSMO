/*
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
	"sync"
	"time"

	"go.corp.nvidia.com/osmo/service/utils_go"
)

// RoleCacheConfig holds configuration for the role cache
type RoleCacheConfig struct {
	Enabled bool
	TTL     time.Duration
	MaxSize int
}

// cachedRoles holds roles with expiration timestamp
type cachedRoles struct {
	roles     []*utils_go.Role
	expiresAt time.Time
}

// RoleCache provides thread-safe caching of role policies
type RoleCache struct {
	cache   map[string]*cachedRoles
	config  RoleCacheConfig
	mu      sync.RWMutex
	logger  *slog.Logger
	evicted int64
	hits    int64
	misses  int64
}

// NewRoleCache creates a new role cache
func NewRoleCache(config RoleCacheConfig, logger *slog.Logger) *RoleCache {
	cache := &RoleCache{
		cache:  make(map[string]*cachedRoles),
		config: config,
		logger: logger,
	}

	// Start background cleanup goroutine if caching is enabled
	if config.Enabled {
		go cache.cleanupExpired()
	}

	return cache
}

// Get retrieves roles from cache by role names
// Returns the roles and a boolean indicating if found and not expired
func (c *RoleCache) Get(roleNames []string) ([]*utils_go.Role, bool) {
	if !c.config.Enabled {
		return nil, false
	}

	c.mu.RLock()
	defer c.mu.RUnlock()

	key := c.cacheKey(roleNames)
	cached, found := c.cache[key]

	if !found {
		c.misses++
		c.logger.Debug("cache miss",
			slog.String("key", key),
			slog.Int64("total_misses", c.misses),
		)
		return nil, false
	}

	// Check if expired
	if time.Now().After(cached.expiresAt) {
		c.misses++
		c.logger.Debug("cache expired",
			slog.String("key", key),
			slog.Time("expired_at", cached.expiresAt),
		)
		return nil, false
	}

	c.hits++
	c.logger.Debug("cache hit",
		slog.String("key", key),
		slog.Int64("total_hits", c.hits),
	)

	return cached.roles, true
}

// Set stores roles in cache with the configured TTL
func (c *RoleCache) Set(roleNames []string, roles []*utils_go.Role) {
	if !c.config.Enabled {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Check if we need to evict entries (simple size-based LRU)
	if len(c.cache) >= c.config.MaxSize {
		c.evictOldest()
	}

	key := c.cacheKey(roleNames)
	cached := &cachedRoles{
		roles:     roles,
		expiresAt: time.Now().Add(c.config.TTL),
	}

	c.cache[key] = cached

	c.logger.Debug("cache set",
		slog.String("key", key),
		slog.Int("roles_count", len(roles)),
		slog.Time("expires_at", cached.expiresAt),
	)
}

// Clear removes all entries from the cache
func (c *RoleCache) Clear() {
	if !c.config.Enabled {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	c.cache = make(map[string]*cachedRoles)
	c.logger.Info("cache cleared")
}

// Stats returns cache statistics
func (c *RoleCache) Stats() map[string]interface{} {
	c.mu.RLock()
	defer c.mu.RUnlock()

	total := c.hits + c.misses
	hitRate := 0.0
	if total > 0 {
		hitRate = float64(c.hits) / float64(total) * 100
	}

	return map[string]interface{}{
		"enabled":   c.config.Enabled,
		"size":      len(c.cache),
		"max_size":  c.config.MaxSize,
		"hits":      c.hits,
		"misses":    c.misses,
		"evicted":   c.evicted,
		"hit_rate":  hitRate,
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

// evictOldest removes the entry that will expire soonest
func (c *RoleCache) evictOldest() {
	var oldestKey string
	var oldestTime time.Time

	first := true
	for key, cached := range c.cache {
		if first || cached.expiresAt.Before(oldestTime) {
			oldestKey = key
			oldestTime = cached.expiresAt
			first = false
		}
	}

	if oldestKey != "" {
		delete(c.cache, oldestKey)
		c.evicted++
		c.logger.Debug("cache entry evicted",
			slog.String("key", oldestKey),
			slog.Int64("total_evicted", c.evicted),
		)
	}
}

// cleanupExpired periodically removes expired entries
func (c *RoleCache) cleanupExpired() {
	ticker := time.NewTicker(c.config.TTL / 2) // Run cleanup at half the TTL interval
	defer ticker.Stop()

	for range ticker.C {
		c.mu.Lock()
		now := time.Now()
		removed := 0

		for key, cached := range c.cache {
			if now.After(cached.expiresAt) {
				delete(c.cache, key)
				removed++
			}
		}

		c.mu.Unlock()

		if removed > 0 {
			c.logger.Debug("expired entries cleaned up",
				slog.Int("removed", removed),
				slog.Int("remaining", len(c.cache)),
			)
		}
	}
}

