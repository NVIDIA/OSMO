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
	"flag"
	"log/slog"
	"time"

	"github.com/hashicorp/golang-lru/v2/expirable"

	"go.corp.nvidia.com/osmo/utils"
)

const (
	defaultCacheMaxSize = 1000
	defaultCacheTTLSec  = 300
)

// CacheConfig holds role cache configuration
type CacheConfig struct {
	MaxSize int
	TTL     time.Duration
}

// CacheFlagPointers holds pointers to flag values for role cache configuration
type CacheFlagPointers struct {
	maxSize *int
	ttlSec  *int
}

// RegisterCacheFlags registers role-cache-related command-line flags.
// Returns a CacheFlagPointers that should be converted to CacheConfig
// after flag.Parse() is called.
func RegisterCacheFlags() *CacheFlagPointers {
	return &CacheFlagPointers{
		ttlSec: flag.Int("cache-ttl",
			utils.GetEnvInt("OSMO_CACHE_TTL", defaultCacheTTLSec),
			"Role cache TTL in seconds"),
		maxSize: flag.Int("cache-max-size",
			utils.GetEnvInt("OSMO_CACHE_MAX_SIZE", defaultCacheMaxSize),
			"Role cache max number of entries"),
	}
}

// ToCacheConfig converts flag pointers to CacheConfig.
// This should be called after flag.Parse().
func (p *CacheFlagPointers) ToCacheConfig() CacheConfig {
	return CacheConfig{
		MaxSize: *p.maxSize,
		TTL:     time.Duration(*p.ttlSec) * time.Second,
	}
}

// RoleCache provides thread-safe caching for roles using LRU eviction with TTL expiration.
// Acts as a cache with DB fallback - caller should fetch missing roles from DB.
type RoleCache struct {
	cache  *expirable.LRU[string, *Role]
	logger *slog.Logger
}

// NewRoleCache creates a new role cache with the specified max size and TTL.
func NewRoleCache(maxSize int, ttl time.Duration, logger *slog.Logger) *RoleCache {
	cache := expirable.NewLRU[string, *Role](maxSize, nil, ttl)
	return &RoleCache{
		cache:  cache,
		logger: logger,
	}
}

// Get retrieves roles by name from the cache.
// Returns:
//   - found: roles that exist in the cache
//   - missing: role names that were not found in the cache
func (c *RoleCache) Get(roleNames []string) (found []*Role, missing []string) {
	for _, name := range roleNames {
		if role, exists := c.cache.Get(name); exists {
			found = append(found, role)
		} else {
			missing = append(missing, name)
		}
	}
	return found, missing
}

// Set adds or updates roles in the cache
func (c *RoleCache) Set(roles []*Role) {
	for _, role := range roles {
		c.cache.Add(role.Name, role)
	}

	c.logger.Debug("roles cached",
		slog.Int("count", len(roles)),
	)
}

// Size returns the number of roles in the cache
func (c *RoleCache) Size() int {
	return c.cache.Len()
}
