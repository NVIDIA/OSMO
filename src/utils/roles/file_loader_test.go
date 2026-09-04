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
	"path/filepath"
	"testing"
)

func writeRoleConfig(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestFileRoleStoreUsesOnlyFileRolesMappingsAndPools(t *testing.T) {
	path := writeRoleConfig(t, `
roles:
  admin:
    description: Administrator
    policies:
    - effect: Allow
      actions: ["*:*"]
      resources: ["*"]
    external_roles: [idp-admin]
  no-external-mapping:
    description: Explicitly unmapped
    policies: []
    external_roles: []
  implicit-mapping:
    description: Maps by name when omitted
    policies: []
pools:
  z-pool: {}
  a-pool: {}
`)
	store := NewFileRoleStore(path, slog.Default())
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}

	if got := store.ResolveExternalRoles([]string{"idp-admin"}); len(got) != 1 || got[0] != "admin" {
		t.Fatalf("idp mapping = %v, want [admin]", got)
	}
	if got := store.ResolveExternalRoles([]string{"no-external-mapping"}); len(got) != 0 {
		t.Fatalf("explicit empty mapping unexpectedly resolved: %v", got)
	}
	if got := store.ResolveExternalRoles([]string{"implicit-mapping"}); len(got) != 1 || got[0] != "implicit-mapping" {
		t.Fatalf("implicit mapping = %v, want [implicit-mapping]", got)
	}
	if got := store.GetPoolNames(); len(got) != 2 || got[0] != "a-pool" || got[1] != "z-pool" {
		t.Fatalf("pool names = %v, want [a-pool z-pool]", got)
	}
}

func TestFileRoleStoreRejectsIncompleteOrInvalidAuthority(t *testing.T) {
	tests := map[string]string{
		"missing roles": `pools: {default: {}}`,
		"missing pools": `roles: {role: {description: test, policies: []}}`,
		"invalid effect": `
roles:
  role:
    description: test
    policies: [{effect: Maybe, actions: ["system:Health"]}]
pools: {default: {}}
`,
		"invalid action": `
roles:
  role:
    description: test
    policies: [{effect: Allow, actions: ["not-an-action"]}]
pools: {default: {}}
`,
	}
	for name, config := range tests {
		t.Run(name, func(t *testing.T) {
			store := NewFileRoleStore(writeRoleConfig(t, config), slog.Default())
			if err := store.Load(); err == nil {
				t.Fatal("Load() succeeded for invalid role authority")
			}
		})
	}
}

func TestFileRoleStoreDoesNotReloadWithoutPodRestart(t *testing.T) {
	path := writeRoleConfig(t, `
roles: {first: {description: first, policies: []}}
pools: {default: {}}
`)
	store := NewFileRoleStore(path, slog.Default())
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`
roles: {second: {description: second, policies: []}}
pools: {default: {}}
`), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := store.GetRoles([]string{"first", "second"}); len(got) != 1 || got[0].Name != "first" {
		t.Fatalf("immutable snapshot roles = %v, want only first", got)
	}
}

func TestFileRoleStoreAllowsAnEmptyPoolSet(t *testing.T) {
	path := writeRoleConfig(t, `
roles: {role: {description: test, policies: []}}
pools: {}
`)
	store := NewFileRoleStore(path, slog.Default())
	if err := store.Load(); err != nil {
		t.Fatalf("Load() rejected an explicit empty pool set: %v", err)
	}
	if got := store.GetPoolNames(); len(got) != 0 {
		t.Fatalf("pool names = %v, want none", got)
	}
}

func TestFileRoleStoreAcceptsCompatibleActionObjects(t *testing.T) {
	path := writeRoleConfig(t, `
roles:
  compatible-role:
    description: 6.3-compatible action encodings
    policies:
    - actions:
      - action: workflow:Read
      - base: http
        path: /api/workflow/*
        method: GET
pools: {}
`)
	store := NewFileRoleStore(path, slog.Default())
	if err := store.Load(); err != nil {
		t.Fatalf("Load() rejected compatible action objects: %v", err)
	}
}
