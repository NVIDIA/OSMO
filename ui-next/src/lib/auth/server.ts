//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Server-side authentication utilities.
 *
 * These functions read from Envoy-injected headers to determine user
 * authentication and authorization status in Next.js server components.
 */

import { headers } from "next/headers";
import { hasAdminRole } from "@/lib/auth/roles";

/**
 * Get user roles from Envoy-injected x-osmo-roles header.
 *
 * In production, Envoy injects the x-osmo-roles header with a
 * comma-separated or space-separated list of user roles.
 *
 * @returns Array of role strings
 *
 * @example
 * ```ts
 * const roles = await getServerUserRoles();
 * if (roles.includes("osmo-admin")) {
 *   // User is admin
 * }
 * ```
 */
export async function getServerUserRoles(): Promise<string[]> {
  const headersList = await headers();
  const rolesHeader = headersList.get("x-osmo-roles") || "";

  // Parse roles (comma-separated or space-separated)
  const roles = rolesHeader
    .split(/[,\s]+/)
    .map((role) => role.trim())
    .filter(Boolean);

  return roles;
}

/**
 * Check if the current user has admin role.
 *
 * Reads from Envoy-injected x-osmo-roles header and checks if
 * it contains any admin role (osmo-admin or dashboard-admin).
 *
 * @returns true if user has admin role
 *
 * @example
 * ```ts
 * const isAdmin = await hasServerAdminRole();
 * if (!isAdmin) {
 *   return <div>Unauthorized</div>;
 * }
 * ```
 */
export async function hasServerAdminRole(): Promise<boolean> {
  const roles = await getServerUserRoles();
  return hasAdminRole(roles);
}

/**
 * Get username from Envoy-injected x-osmo-user header.
 *
 * @returns Username or null if not authenticated
 *
 * @example
 * ```ts
 * const username = await getServerUsername();
 * if (!username) {
 *   return <div>Not authenticated</div>;
 * }
 * ```
 */
export async function getServerUsername(): Promise<string | null> {
  const headersList = await headers();
  return headersList.get("x-osmo-user");
}
