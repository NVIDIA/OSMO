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
	"reflect"
	"testing"
)

func TestGetAllowedPools(t *testing.T) {
	allPools := []string{"default", "dev", "production", "staging", "restricted"}

	tests := []struct {
		name      string
		roles     []*Role
		allPools  []string
		wantPools []string
	}{
		{
			name: "wildcard action and resource allows all pools",
			roles: []*Role{
				{
					Name: "admin",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: "*:*"}},
							Resources: []string{"*"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: allPools,
		},
		{
			name: "specific pool resources via workflow:Create",
			roles: []*Role{
				{
					Name: "dev-user",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "dev", poolResourcePrefix + "staging"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: []string{"dev", "staging"},
		},
		{
			name: "pool wildcard resource",
			roles: []*Role{
				{
					Name: "pool-admin",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{string(ResourceTypePool) + "/*"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: allPools,
		},
		{
			name: "deny overrides allow within the same role",
			roles: []*Role{
				{
					Name: "restricted-user",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{string(ResourceTypePool) + "/*"},
						},
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "restricted", poolResourcePrefix + "production"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: []string{"default", "dev", "staging"},
		},
		{
			name: "deny in one role does NOT override allow from another role",
			roles: []*Role{
				{
					Name: "allow-role",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: "*:*"}},
							Resources: []string{"*"},
						},
					},
				},
				{
					Name: "deny-role",
					Policies: []RolePolicy{
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "restricted"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: allPools,
		},
		{
			name: "non-workflow actions do not grant pool access",
			roles: []*Role{
				{
					Name: "dataset-only",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionDatasetRead}},
							Resources: []string{"*"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: nil,
		},
		{
			name: "empty resources matches no pools — unscoped policy",
			roles: []*Role{
				{
					Name: "unscoped",
					Policies: []RolePolicy{
						{
							Effect:  EffectAllow,
							Actions: RoleActions{{Action: ActionWorkflowCreate}},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: nil,
		},
		{
			name: "nil resources matches no pools — same as empty",
			roles: []*Role{
				{
					Name: "nil-resources",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: nil,
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: nil,
		},
		{
			name: "explicit wildcard * is required to match all pools",
			roles: []*Role{
				{
					Name: "explicit-wildcard",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{"*"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: allPools,
		},
		{
			name:      "no roles yields no pools",
			roles:     []*Role{},
			allPools:  allPools,
			wantPools: nil,
		},
		{
			name: "multiple roles combine allow scopes independently",
			roles: []*Role{
				{
					Name: "dev-role",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "dev"},
						},
					},
				},
				{
					Name: "staging-role",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "staging"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: []string{"dev", "staging"},
		},
		{
			name: "wildcard action *:Create covers workflow:Create",
			roles: []*Role{
				{
					Name: "creator",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: "*:Create"}},
							Resources: []string{poolResourcePrefix + "dev"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: []string{"dev"},
		},
		{
			name: "pool:List does not grant pool access",
			roles: []*Role{
				{
					Name: "viewer",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionPoolList}},
							Resources: []string{poolResourcePrefix + "production"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: nil,
		},
		{
			name: "deny in role A, allow in role B — allow wins",
			roles: []*Role{
				{
					Name: "deny-restricted",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{string(ResourceTypePool) + "/*"},
						},
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "restricted"},
						},
					},
				},
				{
					Name: "allow-restricted",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "restricted"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: allPools,
		},
		{
			name: "deny-only role has no effect when another role allows",
			roles: []*Role{
				{
					Name: "full-access",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{"*"},
						},
					},
				},
				{
					Name: "deny-everything",
					Policies: []RolePolicy{
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: "*:*"}},
							Resources: []string{"*"},
						},
					},
				},
			},
			allPools:  allPools,
			wantPools: allPools,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetAllowedPools(tt.roles, tt.allPools)
			if !reflect.DeepEqual(got, tt.wantPools) {
				t.Errorf("GetAllowedPools() = %v, want %v", got, tt.wantPools)
			}
		})
	}
}

// TestWithinRoleDenySemantics verifies that within a single role, a Deny
// policy always overrides an Allow policy for the same pool, regardless of
// policy ordering or specificity.
func TestWithinRoleDenySemantics(t *testing.T) {
	allPools := []string{"alpha", "beta", "gamma"}

	tests := []struct {
		name      string
		role      *Role
		wantPools []string
	}{
		{
			name: "deny on specific pool blocks only that pool",
			role: &Role{
				Name: "partial-deny",
				Policies: []RolePolicy{
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{string(ResourceTypePool) + "/*"},
					},
					{
						Effect:    EffectDeny,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResourcePrefix + "beta"},
					},
				},
			},
			wantPools: []string{"alpha", "gamma"},
		},
		{
			name: "deny before allow — order does not matter, deny still wins",
			role: &Role{
				Name: "deny-first",
				Policies: []RolePolicy{
					{
						Effect:    EffectDeny,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResourcePrefix + "alpha"},
					},
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{string(ResourceTypePool) + "/*"},
					},
				},
			},
			wantPools: []string{"beta", "gamma"},
		},
		{
			name: "deny with wildcard *:* blocks allow with specific action",
			role: &Role{
				Name: "wildcard-deny",
				Policies: []RolePolicy{
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResourcePrefix + "alpha"},
					},
					{
						Effect:    EffectDeny,
						Actions:   RoleActions{{Action: "*:*"}},
						Resources: []string{poolResourcePrefix + "alpha"},
					},
				},
			},
			wantPools: nil,
		},
		{
			name: "deny on pool/* blocks all pools in the role",
			role: &Role{
				Name: "deny-all-pools",
				Policies: []RolePolicy{
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{"*"},
					},
					{
						Effect:    EffectDeny,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{string(ResourceTypePool) + "/*"},
					},
				},
			},
			wantPools: nil,
		},
		{
			name: "allow and deny on different pools — each takes effect independently",
			role: &Role{
				Name: "split",
				Policies: []RolePolicy{
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResourcePrefix + "alpha", poolResourcePrefix + "beta"},
					},
					{
						Effect:    EffectDeny,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResourcePrefix + "beta"},
					},
				},
			},
			wantPools: []string{"alpha"},
		},
		{
			name: "multiple deny policies accumulate",
			role: &Role{
				Name: "multi-deny",
				Policies: []RolePolicy{
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{string(ResourceTypePool) + "/*"},
					},
					{
						Effect:    EffectDeny,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResourcePrefix + "alpha"},
					},
					{
						Effect:    EffectDeny,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResourcePrefix + "gamma"},
					},
				},
			},
			wantPools: []string{"beta"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetAllowedPools([]*Role{tt.role}, allPools)
			if !reflect.DeepEqual(got, tt.wantPools) {
				t.Errorf("GetAllowedPools() = %v, want %v", got, tt.wantPools)
			}
		})
	}
}

// TestCrossRoleDenySemantics verifies that roles are evaluated independently:
// a Deny in one role never blocks an Allow from a different role.
func TestCrossRoleDenySemantics(t *testing.T) {
	allPools := []string{"alpha", "beta", "gamma"}

	tests := []struct {
		name      string
		roles     []*Role
		wantPools []string
	}{
		{
			name: "role A allows alpha, role B denies alpha — alpha still accessible via role A",
			roles: []*Role{
				{
					Name: "allow-alpha",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "alpha"},
						},
					},
				},
				{
					Name: "deny-alpha",
					Policies: []RolePolicy{
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "alpha"},
						},
					},
				},
			},
			wantPools: []string{"alpha"},
		},
		{
			name: "role A denies everything, role B allows specific pool — pool accessible via role B",
			roles: []*Role{
				{
					Name: "deny-all",
					Policies: []RolePolicy{
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: "*:*"}},
							Resources: []string{"*"},
						},
					},
				},
				{
					Name: "allow-beta",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "beta"},
						},
					},
				},
			},
			wantPools: []string{"beta"},
		},
		{
			name: "role A allows and denies beta, role B allows beta — beta accessible via role B",
			roles: []*Role{
				{
					Name: "conflicted",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{string(ResourceTypePool) + "/*"},
						},
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "beta"},
						},
					},
				},
				{
					Name: "rescue-beta",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "beta"},
						},
					},
				},
			},
			wantPools: allPools,
		},
		{
			name: "both roles deny same pool, no role allows it — pool not accessible",
			roles: []*Role{
				{
					Name: "deny-gamma-1",
					Policies: []RolePolicy{
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "gamma"},
						},
					},
				},
				{
					Name: "deny-gamma-2",
					Policies: []RolePolicy{
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "gamma"},
						},
					},
				},
			},
			wantPools: nil,
		},
		{
			name: "both roles internally deny same pool — pool not accessible",
			roles: []*Role{
				{
					Name: "role-a",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{string(ResourceTypePool) + "/*"},
						},
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "gamma"},
						},
					},
				},
				{
					Name: "role-b",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{string(ResourceTypePool) + "/*"},
						},
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "gamma"},
						},
					},
				},
			},
			wantPools: []string{"alpha", "beta"},
		},
		{
			name: "three roles: allow all, deny some, re-allow denied — all accessible",
			roles: []*Role{
				{
					Name: "broad-access",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{string(ResourceTypePool) + "/*"},
						},
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "gamma"},
						},
					},
				},
				{
					Name: "deny-more",
					Policies: []RolePolicy{
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: "*:*"}},
							Resources: []string{poolResourcePrefix + "alpha", poolResourcePrefix + "gamma"},
						},
					},
				},
				{
					Name: "re-allow",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "gamma"},
						},
					},
				},
			},
			wantPools: allPools,
		},
		{
			name: "disjoint allows across roles produce union",
			roles: []*Role{
				{
					Name: "alpha-only",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "alpha"},
						},
					},
				},
				{
					Name: "beta-only",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "beta"},
						},
					},
				},
				{
					Name: "gamma-only",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "gamma"},
						},
					},
				},
			},
			wantPools: allPools,
		},
		{
			name: "role A allows alpha denies beta, role B allows beta — both accessible",
			roles: []*Role{
				{
					Name: "role-a",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "alpha", poolResourcePrefix + "beta"},
						},
						{
							Effect:    EffectDeny,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "beta"},
						},
					},
				},
				{
					Name: "role-b",
					Policies: []RolePolicy{
						{
							Effect:    EffectAllow,
							Actions:   RoleActions{{Action: ActionWorkflowCreate}},
							Resources: []string{poolResourcePrefix + "beta"},
						},
					},
				},
			},
			wantPools: []string{"alpha", "beta"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetAllowedPools(tt.roles, allPools)
			if !reflect.DeepEqual(got, tt.wantPools) {
				t.Errorf("GetAllowedPools() = %v, want %v", got, tt.wantPools)
			}
		})
	}
}

func TestCheckActionOnResource(t *testing.T) {
	poolResource := poolResourcePrefix + "production"

	tests := []struct {
		name string
		role *Role
		want bool
	}{
		{
			name: "allow workflow:Create on matching pool",
			role: &Role{
				Name: "allow",
				Policies: []RolePolicy{
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResource},
					},
				},
			},
			want: true,
		},
		{
			name: "deny overrides allow in same role",
			role: &Role{
				Name: "mixed",
				Policies: []RolePolicy{
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{string(ResourceTypePool) + "/*"},
					},
					{
						Effect:    EffectDeny,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResource},
					},
				},
			},
			want: false,
		},
		{
			name: "unrelated action does not grant access",
			role: &Role{
				Name: "wrong-action",
				Policies: []RolePolicy{
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: ActionDatasetRead}},
						Resources: []string{"*"},
					},
				},
			},
			want: false,
		},
		{
			name: "no matching resource",
			role: &Role{
				Name: "wrong-resource",
				Policies: []RolePolicy{
					{
						Effect:    EffectAllow,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResourcePrefix + "dev"},
					},
				},
			},
			want: false,
		},
		{
			name: "deny only — no opinion, not allowed",
			role: &Role{
				Name: "deny-only",
				Policies: []RolePolicy{
					{
						Effect:    EffectDeny,
						Actions:   RoleActions{{Action: ActionWorkflowCreate}},
						Resources: []string{poolResource},
					},
				},
			},
			want: false,
		},
		{
			name: "empty policies — no opinion",
			role: &Role{
				Name:     "empty",
				Policies: []RolePolicy{},
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := CheckActionOnResource(tt.role, ActionWorkflowCreate, poolResource)
			if result.Allowed != tt.want {
				t.Errorf("CheckActionOnResource().Allowed = %v, want %v", result.Allowed, tt.want)
			}
		})
	}
}

func TestPolicyMatchesActionOnResource(t *testing.T) {
	poolResource := poolResourcePrefix + "dev"

	tests := []struct {
		name   string
		policy RolePolicy
		want   bool
	}{
		{
			name: "exact action and resource",
			policy: RolePolicy{
				Actions:   RoleActions{{Action: ActionWorkflowCreate}},
				Resources: []string{poolResource},
			},
			want: true,
		},
		{
			name: "wildcard action *:* matches",
			policy: RolePolicy{
				Actions:   RoleActions{{Action: "*:*"}},
				Resources: []string{"*"},
			},
			want: true,
		},
		{
			name: "wildcard *:Create matches",
			policy: RolePolicy{
				Actions:   RoleActions{{Action: "*:Create"}},
				Resources: []string{poolResource},
			},
			want: true,
		},
		{
			name: "workflow:* matches",
			policy: RolePolicy{
				Actions:   RoleActions{{Action: "workflow:*"}},
				Resources: []string{poolResource},
			},
			want: true,
		},
		{
			name: "wrong action does not match",
			policy: RolePolicy{
				Actions:   RoleActions{{Action: ActionWorkflowRead}},
				Resources: []string{poolResource},
			},
			want: false,
		},
		{
			name: "wrong resource does not match",
			policy: RolePolicy{
				Actions:   RoleActions{{Action: ActionWorkflowCreate}},
				Resources: []string{poolResourcePrefix + "production"},
			},
			want: false,
		},
		{
			name: "legacy action is ignored",
			policy: RolePolicy{
				Actions:   RoleActions{{Base: "http", Path: "/api/pool/*/workflow", Method: "POST"}},
				Resources: []string{"*"},
			},
			want: false,
		},
		{
			name: "empty resources matches nothing",
			policy: RolePolicy{
				Actions: RoleActions{{Action: ActionWorkflowCreate}},
			},
			want: false,
		},
		{
			name: "nil resources matches nothing",
			policy: RolePolicy{
				Actions:   RoleActions{{Action: ActionWorkflowCreate}},
				Resources: nil,
			},
			want: false,
		},
		{
			name: "explicit wildcard * matches any pool",
			policy: RolePolicy{
				Actions:   RoleActions{{Action: ActionWorkflowCreate}},
				Resources: []string{"*"},
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := policyMatchesActionOnResource(tt.policy, ActionWorkflowCreate, poolResource)
			if got != tt.want {
				t.Errorf("policyMatchesActionOnResource() = %v, want %v", got, tt.want)
			}
		})
	}
}
