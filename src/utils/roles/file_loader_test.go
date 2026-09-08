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
	"path/filepath"
	"strings"
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

func TestFileRoleStoreBuildsConfigMapOwnedSyncPlan(t *testing.T) {
	path := writeRoleConfig(t, `
roles:
  imported:
    description: imported
    policies: []
    external_roles: [idp-import]
  forced:
    description: forced
    policies: []
    external_roles: [idp-force]
    sync_mode: force
  manual:
    description: manual
    policies: []
    external_roles: [idp-manual]
    sync_mode: ignore
pools: {}
`)
	store := NewFileRoleStore(path, slog.Default())
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}

	plan := store.BuildSyncPlan([]string{"idp-force", "idp-manual"})
	if got := strings.Join(plan.MatchedRoles, ","); got != "forced" {
		t.Fatalf("matched roles = %q, want forced", got)
	}
	if got := strings.Join(plan.ForceRoles, ","); got != "forced" {
		t.Fatalf("force roles = %q, want forced", got)
	}
	if got := strings.Join(plan.DefinedRoles, ","); got != "forced,imported,manual" {
		t.Fatalf("defined roles = %q", got)
	}
	if got := strings.Join(plan.IDPEligibleRoles, ","); got != "forced,imported" {
		t.Fatalf("IDP-eligible roles = %q", got)
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
		"invalid sync mode": `
roles:
  role: {description: test, policies: [], sync_mode: invalid}
pools: {default: {}}
`,
		"misspelled sync mode": `
roles:
  role: {description: test, policies: [], sync_mdoe: force}
pools: {default: {}}
`,
		"misspelled deny effect": `
roles:
  role:
    description: test
    policies: [{effects: Deny, actions: ["workflow:Read"]}]
pools: {default: {}}
`,
		"semantic action mapping with ignored resource": `
roles:
  role:
    description: test
    policies:
    - effect: Allow
      actions: [{action: "workflow:Read", resources: ["pool/team-a"]}]
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

func TestFileRoleStoreEvaluatesSemanticActionEncodings(t *testing.T) {
	path := writeRoleConfig(t, `
roles:
  compatible-role:
    description: 6.3-compatible action encodings
    policies:
    - effect: Allow
      actions:
      - workflow:Create
      - action: workflow:Read
      resources: [pool/team-a]
    - effect: Deny
      actions: [{action: workflow:Create}]
      resources: [pool/team-a]
pools: {}
`)
	store := NewFileRoleStore(path, slog.Default())
	if err := store.Load(); err != nil {
		t.Fatalf("Load() rejected compatible action objects: %v", err)
	}
	role := store.GetRoles([]string{"compatible-role"})[0]
	if result := CheckActionOnResource(role, ActionWorkflowRead, "pool/team-a"); !result.Allowed {
		t.Fatalf("scoped Read denied: %+v", result)
	}
	if result := CheckActionOnResource(role, ActionWorkflowRead, "pool/team-b"); result.Allowed {
		t.Fatalf("unrelated pool authorized: %+v", result)
	}
	if result := CheckActionOnResource(role, ActionWorkflowCreate, "pool/team-a"); !result.Denied || result.Allowed {
		t.Fatalf("explicit Deny did not override Allow: %+v", result)
	}
}

func TestFileRoleStoreRejectsLegacyActionsAtomically(t *testing.T) {
	for _, action := range []string{
		`{base: http, path: /api/workflow/*, method: GET}`,
		`{path: "!/api/workflow/*", method: GET}`,
		`{path: /api/workflow/123, method: GET}`,
		`{method: GET}`,
		`{path: 123, method: GET}`,
	} {
		t.Run(action, func(t *testing.T) {
			path := writeRoleConfig(t, `
roles: {original: {description: original, policies: [], external_roles: [original-idp]}}
pools: {original: {}}
`)
			store := NewFileRoleStore(path, slog.Default())
			if err := store.Load(); err != nil {
				t.Fatal(err)
			}
			invalid := fmt.Sprintf(`
roles:
  a-valid: {description: valid, policies: []}
  bad-role:
    description: Must not silently discard Deny
    external_roles: [new-idp]
    policies:
    - effect: Allow
      actions: ["*:*"]
      resources: ["*"]
    - effect: Deny
      actions: [%s]
pools: {replacement: {}}
`, action)
			if err := os.WriteFile(path, []byte(invalid), 0o600); err != nil {
				t.Fatal(err)
			}
			for _, candidate := range []*FileRoleStore{store, NewFileRoleStore(path, slog.Default())} {
				err := candidate.Load()
				if err == nil || !strings.Contains(err.Error(), `invalid role "bad-role": policy 1 action 0: legacy path-based actions`) {
					t.Fatalf("expected actionable rejection, got %v", err)
				}
				if got := candidate.GetRoles([]string{"a-valid", "bad-role"}); len(got) != 0 {
					t.Fatalf("published partial role snapshot: %+v", got)
				}
				if got := candidate.ResolveExternalRoles([]string{"new-idp"}); len(got) != 0 {
					t.Fatalf("published partial mappings: %+v", got)
				}
			}
			if len(store.GetRoles([]string{"original"})) != 1 || strings.Join(store.GetPoolNames(), ",") != "original" {
				t.Fatal("failed load changed previous snapshot")
			}
		})
	}
}
