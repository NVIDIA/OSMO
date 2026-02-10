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
	"os"
	"testing"
)

func TestRoleCache_SetAndGet(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	cache := NewRoleCache(100, logger)

	testRoles := []*Role{
		{Name: "osmo-user"},
		{Name: "osmo-default"},
		{Name: "osmo-admin"},
	}

	// Set roles in cache
	cache.Set(testRoles)

	// Test size
	if cache.Size() != 3 {
		t.Errorf("expected size 3, got %d", cache.Size())
	}

	// Test getting existing roles
	roleNames := []string{"osmo-user", "osmo-default"}
	found, missing := cache.Get(roleNames)

	if len(found) != 2 {
		t.Errorf("expected 2 found roles, got %d", len(found))
	}

	if len(missing) != 0 {
		t.Errorf("expected 0 missing roles, got %d", len(missing))
	}

	// Verify role names
	foundUser := false
	foundDefault := false
	for _, role := range found {
		if role.Name == "osmo-user" {
			foundUser = true
		}
		if role.Name == "osmo-default" {
			foundDefault = true
		}
	}

	if !foundUser || !foundDefault {
		t.Error("expected to find osmo-user and osmo-default roles")
	}
}

func TestRoleCache_GetWithMissing(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	cache := NewRoleCache(100, logger)

	testRoles := []*Role{
		{Name: "osmo-user"},
	}

	cache.Set(testRoles)

	// Request a mix of existing and non-existing roles
	roleNames := []string{"osmo-user", "non-existent-role", "another-missing"}
	found, missing := cache.Get(roleNames)

	// Should find 1 and miss 2
	if len(found) != 1 {
		t.Errorf("expected 1 found role, got %d", len(found))
	}

	if len(missing) != 2 {
		t.Errorf("expected 2 missing roles, got %d", len(missing))
	}

	if found[0].Name != "osmo-user" {
		t.Errorf("expected osmo-user, got %s", found[0].Name)
	}

	// Verify missing contains the right names
	expectedMissing := map[string]bool{"non-existent-role": true, "another-missing": true}
	for _, name := range missing {
		if !expectedMissing[name] {
			t.Errorf("unexpected missing role: %s", name)
		}
	}
}

func TestRoleCache_EmptyGet(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	cache := NewRoleCache(100, logger)

	testRoles := []*Role{
		{Name: "osmo-user"},
	}

	cache.Set(testRoles)

	// Request with empty list
	found, missing := cache.Get([]string{})

	if len(found) != 0 {
		t.Errorf("expected 0 found roles for empty request, got %d", len(found))
	}

	if len(missing) != 0 {
		t.Errorf("expected 0 missing roles for empty request, got %d", len(missing))
	}
}

func TestRoleCache_EmptyCache(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	cache := NewRoleCache(100, logger)

	// Don't set any roles

	if cache.Size() != 0 {
		t.Errorf("expected size 0, got %d", cache.Size())
	}

	// Request roles from empty cache
	found, missing := cache.Get([]string{"osmo-user", "osmo-admin"})

	if len(found) != 0 {
		t.Errorf("expected 0 found roles from empty cache, got %d", len(found))
	}

	if len(missing) != 2 {
		t.Errorf("expected 2 missing roles from empty cache, got %d", len(missing))
	}
}

func TestRoleCache_SetOverwrite(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelError}))
	cache := NewRoleCache(100, logger)

	// Set initial roles
	cache.Set([]*Role{
		{Name: "osmo-user", Description: "original"},
	})

	// Set again with updated role
	cache.Set([]*Role{
		{Name: "osmo-user", Description: "updated"},
	})

	// Should have the updated version
	found, _ := cache.Get([]string{"osmo-user"})
	if len(found) != 1 {
		t.Fatalf("expected 1 role, got %d", len(found))
	}

	if found[0].Description != "updated" {
		t.Errorf("expected description 'updated', got '%s'", found[0].Description)
	}
}
