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
	"log/slog"

	lru "github.com/hashicorp/golang-lru/v2"
)

// RoleCache provides thread-safe caching for roles using LRU eviction.
// Acts as a cache with DB fallback - caller should fetch missing roles from DB.
type RoleCache struct {
	cache  *lru.Cache[string, *Role]
	logger *slog.Logger
}

// NewRoleCache creates a new role cache with the specified max size
func NewRoleCache(maxSize int, logger *slog.Logger) *RoleCache {
	cache, _ := lru.New[string, *Role](maxSize)
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
