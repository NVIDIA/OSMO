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

/**
 * User Roles
 *
 * Known user roles in the system.
 * These are embedded in JWT tokens and control access.
 *
 * Note: Roles are dynamic and fetched from backend via /api/configs/role.
 * These constants are the well-known roles for quick checks.
 */

export const Roles = {
  // Core OSMO roles
  OSMO_ADMIN: "osmo-admin",
  OSMO_USER: "osmo-user",
  OSMO_SRE: "osmo-sre",

  // Dashboard-specific roles
  DASHBOARD_ADMIN: "dashboard-admin",
  DASHBOARD_USER: "dashboard-user",

  // Monitoring roles
  GRAFANA_ADMIN: "grafana-admin",
  GRAFANA_USER: "grafana-user",
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

/**
 * Extract roles from JWT claims structure.
 *
 * Checks multiple sources (union of all providers):
 * - claims.roles (top-level)
 * - claims.realm_access.roles (Keycloak realm)
 * - claims.resource_access.osmo.roles (Keycloak resource)
 */
export function extractRolesFromClaims(claims: {
  roles?: string[];
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}): string[] {
  const roles = new Set<string>();

  if (Array.isArray(claims.roles)) {
    claims.roles.forEach((role) => roles.add(role));
  }

  if (Array.isArray(claims.realm_access?.roles)) {
    claims.realm_access.roles.forEach((role) => roles.add(role));
  }

  const osmoRoles = claims.resource_access?.osmo?.roles;
  if (Array.isArray(osmoRoles)) {
    osmoRoles.forEach((role) => roles.add(role));
  }

  return Array.from(roles);
}

/**
 * Check if roles array contains any admin role.
 */
export function hasAdminRole(roles: string[]): boolean {
  return roles.includes(Roles.OSMO_ADMIN) || roles.includes(Roles.DASHBOARD_ADMIN);
}
