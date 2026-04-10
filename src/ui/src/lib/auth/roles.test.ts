// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { extractRolesFromClaims, hasAdminRole, Roles } from "@/lib/auth/roles";

// =============================================================================
// hasAdminRole Tests
//
// SECURITY: This function controls admin access.
// Any change to this logic should trigger test failures.
// =============================================================================

describe("hasAdminRole", () => {
  describe("returns true for admin roles", () => {
    it("returns true for osmo-admin role", () => {
      expect(hasAdminRole([Roles.OSMO_ADMIN])).toBe(true);
    });

    it("returns true for dashboard-admin role", () => {
      expect(hasAdminRole([Roles.DASHBOARD_ADMIN])).toBe(true);
    });

    it("returns true when admin is among other roles", () => {
      expect(hasAdminRole([Roles.OSMO_USER, Roles.OSMO_ADMIN])).toBe(true);
      expect(hasAdminRole([Roles.DASHBOARD_USER, Roles.DASHBOARD_ADMIN])).toBe(true);
    });

    it("returns true when both admin roles are present", () => {
      expect(hasAdminRole([Roles.OSMO_ADMIN, Roles.DASHBOARD_ADMIN])).toBe(true);
    });
  });

  describe("returns false for non-admin roles", () => {
    it("returns false for osmo-user role", () => {
      expect(hasAdminRole([Roles.OSMO_USER])).toBe(false);
    });

    it("returns false for dashboard-user role", () => {
      expect(hasAdminRole([Roles.DASHBOARD_USER])).toBe(false);
    });

    it("returns false for osmo-sre role", () => {
      expect(hasAdminRole([Roles.OSMO_SRE])).toBe(false);
    });

    it("returns false for grafana roles", () => {
      expect(hasAdminRole([Roles.GRAFANA_ADMIN])).toBe(false);
      expect(hasAdminRole([Roles.GRAFANA_USER])).toBe(false);
    });

    it("returns false for multiple non-admin roles", () => {
      expect(hasAdminRole([Roles.OSMO_USER, Roles.OSMO_SRE, Roles.GRAFANA_USER])).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("returns false for empty roles array", () => {
      expect(hasAdminRole([])).toBe(false);
    });

    it("returns false for unknown roles", () => {
      expect(hasAdminRole(["unknown-role"])).toBe(false);
      expect(hasAdminRole(["admin"])).toBe(false); // Not the exact role name
    });

    it("is case-sensitive (security: exact match required)", () => {
      expect(hasAdminRole(["OSMO-ADMIN"])).toBe(false);
      expect(hasAdminRole(["Osmo-Admin"])).toBe(false);
    });
  });
});

// =============================================================================
// Roles Constants Tests
//
// Documents the expected role values. If these change, consumers need updating.
// =============================================================================

// =============================================================================
// extractRolesFromClaims Tests
//
// JWT payloads may supply roles via top-level roles, realm_access.roles, or
// resource_access.osmo.roles — see roles.ts JSDoc.
// =============================================================================

describe("extractRolesFromClaims", () => {
  it("returns empty array when no role sources are present", () => {
    expect(extractRolesFromClaims({})).toEqual([]);
  });

  it("collects top-level claims.roles", () => {
    expect(extractRolesFromClaims({ roles: [Roles.OSMO_USER, Roles.OSMO_ADMIN] })).toEqual([
      Roles.OSMO_USER,
      Roles.OSMO_ADMIN,
    ]);
  });

  it("collects roles from claims.realm_access.roles", () => {
    expect(
      extractRolesFromClaims({
        realm_access: { roles: [Roles.DASHBOARD_USER, Roles.DASHBOARD_ADMIN] },
      }),
    ).toEqual([Roles.DASHBOARD_USER, Roles.DASHBOARD_ADMIN]);
  });

  it("collects roles from claims.resource_access.osmo.roles", () => {
    expect(
      extractRolesFromClaims({
        resource_access: { osmo: { roles: [Roles.OSMO_SRE] } },
      }),
    ).toEqual([Roles.OSMO_SRE]);
  });

  it("merges all sources and deduplicates", () => {
    expect(
      extractRolesFromClaims({
        roles: [Roles.OSMO_USER],
        realm_access: { roles: [Roles.OSMO_USER, Roles.OSMO_ADMIN] },
        resource_access: { osmo: { roles: [Roles.OSMO_ADMIN] } },
      }),
    ).toEqual([Roles.OSMO_USER, Roles.OSMO_ADMIN]);
  });

  it("ignores non-array role fields and other resource_access clients", () => {
    expect(
      extractRolesFromClaims({
        roles: "not-an-array" as unknown as string[],
        realm_access: { roles: undefined },
        resource_access: {
          other_client: { roles: [Roles.GRAFANA_ADMIN] },
          osmo: { roles: [Roles.OSMO_USER] },
        },
      }),
    ).toEqual([Roles.OSMO_USER]);
  });
});

describe("Roles constants", () => {
  it("has expected OSMO role values", () => {
    expect(Roles.OSMO_ADMIN).toBe("osmo-admin");
    expect(Roles.OSMO_USER).toBe("osmo-user");
    expect(Roles.OSMO_SRE).toBe("osmo-sre");
  });

  it("has expected dashboard role values", () => {
    expect(Roles.DASHBOARD_ADMIN).toBe("dashboard-admin");
    expect(Roles.DASHBOARD_USER).toBe("dashboard-user");
  });

  it("has expected grafana role values", () => {
    expect(Roles.GRAFANA_ADMIN).toBe("grafana-admin");
    expect(Roles.GRAFANA_USER).toBe("grafana-user");
  });
});
