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
	"os"
	"testing"
	"time"

	"go.corp.nvidia.com/osmo/service/utils_go"
)

func TestRoleCache_GetSet(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	config := RoleCacheConfig{
		Enabled: true,
		TTL:     1 * time.Hour,
		MaxSize: 10,
	}
	cache := NewRoleCache(config, logger)

	roleNames := []string{"osmo-user", "osmo-default"}
	roles := []*utils_go.Role{
		{Name: "osmo-user"},
		{Name: "osmo-default"},
	}

	// Test cache miss
	_, found := cache.Get(roleNames)
	if found {
		t.Error("expected cache miss, got hit")
	}

	// Set cache
	cache.Set(roleNames, roles)

	// Test cache hit
	cached, found := cache.Get(roleNames)
	if !found {
		t.Error("expected cache hit, got miss")
	}

	if len(cached) != len(roles) {
		t.Errorf("expected %d roles, got %d", len(roles), len(cached))
	}

	for i, role := range cached {
		if role.Name != roles[i].Name {
			t.Errorf("expected role %s, got %s", roles[i].Name, role.Name)
		}
	}
}

func TestRoleCache_CacheKeyOrdering(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	config := RoleCacheConfig{
		Enabled: true,
		TTL:     1 * time.Hour,
		MaxSize: 10,
	}
	cache := NewRoleCache(config, logger)

	roles := []*utils_go.Role{
		{Name: "role1"},
		{Name: "role2"},
	}

	// Set with one order
	cache.Set([]string{"role2", "role1"}, roles)

	// Get with different order - should still hit cache
	cached, found := cache.Get([]string{"role1", "role2"})
	if !found {
		t.Error("expected cache hit with different role order")
	}

	if len(cached) != len(roles) {
		t.Errorf("expected %d roles, got %d", len(roles), len(cached))
	}
}

func TestRoleCache_Expiration(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	config := RoleCacheConfig{
		Enabled: true,
		TTL:     100 * time.Millisecond, // Very short TTL for testing
		MaxSize: 10,
	}
	cache := NewRoleCache(config, logger)

	roleNames := []string{"osmo-user"}
	roles := []*utils_go.Role{{Name: "osmo-user"}}

	// Set cache
	cache.Set(roleNames, roles)

	// Should hit immediately
	_, found := cache.Get(roleNames)
	if !found {
		t.Error("expected cache hit immediately after set")
	}

	// Wait for expiration
	time.Sleep(150 * time.Millisecond)

	// Should miss after expiration
	_, found = cache.Get(roleNames)
	if found {
		t.Error("expected cache miss after expiration")
	}
}

func TestRoleCache_Disabled(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	config := RoleCacheConfig{
		Enabled: false,
		TTL:     1 * time.Hour,
		MaxSize: 10,
	}
	cache := NewRoleCache(config, logger)

	roleNames := []string{"osmo-user"}
	roles := []*utils_go.Role{{Name: "osmo-user"}}

	// Set cache (should do nothing)
	cache.Set(roleNames, roles)

	// Should always miss when disabled
	_, found := cache.Get(roleNames)
	if found {
		t.Error("expected cache miss when cache is disabled")
	}
}

func TestRoleCache_MaxSize(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	config := RoleCacheConfig{
		Enabled: true,
		TTL:     1 * time.Hour,
		MaxSize: 3,
	}
	cache := NewRoleCache(config, logger)

	// Add 4 entries (exceeds max size of 3)
	for i := 0; i < 4; i++ {
		roleNames := []string{string(rune('a' + i))}
		roles := []*utils_go.Role{{Name: string(rune('a' + i))}}
		cache.Set(roleNames, roles)
		time.Sleep(10 * time.Millisecond) // Ensure different timestamps
	}

	// Cache size should not exceed max
	stats := cache.Stats()
	size := stats["size"].(int)
	if size > config.MaxSize {
		t.Errorf("cache size %d exceeds max size %d", size, config.MaxSize)
	}

	// Should have evicted at least one entry
	evicted := stats["evicted"].(int64)
	if evicted < 1 {
		t.Errorf("expected at least 1 eviction, got %d", evicted)
	}
}

func TestRoleCache_Stats(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	config := RoleCacheConfig{
		Enabled: true,
		TTL:     1 * time.Hour,
		MaxSize: 10,
	}
	cache := NewRoleCache(config, logger)

	roleNames := []string{"osmo-user"}
	roles := []*utils_go.Role{{Name: "osmo-user"}}

	// Cause a miss
	cache.Get(roleNames)

	// Set and cause a hit
	cache.Set(roleNames, roles)
	cache.Get(roleNames)

	stats := cache.Stats()

	if stats["enabled"].(bool) != true {
		t.Error("expected cache to be enabled")
	}

	if stats["hits"].(int64) != 1 {
		t.Errorf("expected 1 hit, got %d", stats["hits"])
	}

	if stats["misses"].(int64) != 1 {
		t.Errorf("expected 1 miss, got %d", stats["misses"])
	}

	hitRate := stats["hit_rate"].(float64)
	expectedHitRate := 50.0 // 1 hit out of 2 total
	if hitRate != expectedHitRate {
		t.Errorf("expected hit rate %f, got %f", expectedHitRate, hitRate)
	}
}

func TestRoleCache_Clear(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	config := RoleCacheConfig{
		Enabled: true,
		TTL:     1 * time.Hour,
		MaxSize: 10,
	}
	cache := NewRoleCache(config, logger)

	roleNames := []string{"osmo-user"}
	roles := []*utils_go.Role{{Name: "osmo-user"}}

	// Set cache
	cache.Set(roleNames, roles)

	// Should hit
	_, found := cache.Get(roleNames)
	if !found {
		t.Error("expected cache hit before clear")
	}

	// Clear cache
	cache.Clear()

	// Should miss after clear
	_, found = cache.Get(roleNames)
	if found {
		t.Error("expected cache miss after clear")
	}

	// Stats should show size 0
	stats := cache.Stats()
	if stats["size"].(int) != 0 {
		t.Errorf("expected cache size 0 after clear, got %d", stats["size"])
	}
}

