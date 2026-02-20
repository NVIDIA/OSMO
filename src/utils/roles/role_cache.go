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

// CacheConfig holds cache configuration
type CacheConfig struct {
	MaxSize int
	TTL     time.Duration
}

// CacheFlagPointers holds pointers to flag values for cache configuration
type CacheFlagPointers struct {
	maxSize *int
	ttlSec  *int
}

// RegisterCacheFlags registers cache-related command-line flags.
// Returns a CacheFlagPointers that should be converted to CacheConfig
// after flag.Parse() is called.
func RegisterCacheFlags() *CacheFlagPointers {
	return &CacheFlagPointers{
		ttlSec: flag.Int("cache-ttl",
			utils.GetEnvInt("OSMO_CACHE_TTL", defaultCacheTTLSec),
			"Cache TTL in seconds"),
		maxSize: flag.Int("cache-max-size",
			utils.GetEnvInt("OSMO_CACHE_MAX_SIZE", defaultCacheMaxSize),
			"Cache max number of entries"),
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

// KeyedCache is a generic thread-safe LRU cache with per-entry TTL expiration.
// It serves as the base caching primitive for all domain-specific caches.
type KeyedCache[V any] struct {
	cache  *expirable.LRU[string, V]
	logger *slog.Logger
}

// NewKeyedCache creates a new keyed cache with the specified max size and TTL.
func NewKeyedCache[V any](maxSize int, ttl time.Duration, logger *slog.Logger) *KeyedCache[V] {
	return &KeyedCache[V]{
		cache:  expirable.NewLRU[string, V](maxSize, nil, ttl),
		logger: logger,
	}
}

// Get retrieves a single value by key. Returns the value and true on hit.
func (c *KeyedCache[V]) Get(key string) (V, bool) {
	return c.cache.Get(key)
}

// Set stores a value under the given key.
func (c *KeyedCache[V]) Set(key string, value V) {
	c.cache.Add(key, value)
}

// Size returns the number of entries in the cache.
func (c *KeyedCache[V]) Size() int {
	return c.cache.Len()
}

// ---------------------------------------------------------------------------
// RoleCache -- keyed cache for Role objects, looked up by role name.
// ---------------------------------------------------------------------------

// RoleCache provides batch Get/Set on top of KeyedCache for Role objects.
type RoleCache struct {
	cache *KeyedCache[*Role]
}

// NewRoleCache creates a new role cache with the specified max size and TTL.
func NewRoleCache(maxSize int, ttl time.Duration, logger *slog.Logger) *RoleCache {
	return &RoleCache{
		cache: NewKeyedCache[*Role](maxSize, ttl, logger),
	}
}

// Get retrieves roles by name from the cache.
// Returns:
//   - found: roles that exist in the cache
//   - missing: role names that were not found in the cache
func (c *RoleCache) Get(roleNames []string) (found []*Role, missing []string) {
	for _, name := range roleNames {
		if role, ok := c.cache.Get(name); ok {
			found = append(found, role)
		} else {
			missing = append(missing, name)
		}
	}
	return found, missing
}

// Set adds or updates roles in the cache.
func (c *RoleCache) Set(roles []*Role) {
	for _, role := range roles {
		c.cache.Set(role.Name, role)
	}

	c.cache.logger.Debug("roles cached",
		slog.Int("count", len(roles)),
	)
}

// Size returns the number of roles in the cache.
func (c *RoleCache) Size() int {
	return c.cache.Size()
}

// ---------------------------------------------------------------------------
// PoolNameCache -- single-value cache for the list of all pool names.
// Uses a KeyedCache with a single sentinel key so both caches share the
// same underlying implementation.
// ---------------------------------------------------------------------------

const poolNameCacheKey = "_all_pool_names"

// PoolNameCache caches the full list of pool names with TTL expiration.
// Pool names change infrequently, so caching avoids a DB query on every
// authorization check.
type PoolNameCache struct {
	cache *KeyedCache[[]string]
}

// NewPoolNameCache creates a new pool name cache with the specified TTL.
func NewPoolNameCache(ttl time.Duration, logger *slog.Logger) *PoolNameCache {
	return &PoolNameCache{
		cache: NewKeyedCache[[]string](1, ttl, logger),
	}
}

// Get returns the cached pool names if the cache is still valid.
// Returns the names and true on hit, or nil and false on miss/expiry.
func (c *PoolNameCache) Get() ([]string, bool) {
	return c.cache.Get(poolNameCacheKey)
}

// Set stores pool names in the cache with the configured TTL.
func (c *PoolNameCache) Set(names []string) {
	c.cache.Set(poolNameCacheKey, names)

	c.cache.logger.Debug("pool names cached",
		slog.Int("count", len(names)),
	)
}
