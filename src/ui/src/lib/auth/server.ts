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
 * Server-side authentication utilities.
 *
 * These functions read from Envoy-injected headers to determine user
 * authentication and authorization status in Next.js server components.
 */

import { headers } from "next/headers";
import { hasAdminRole } from "@/lib/auth/roles";
import type { User } from "@/lib/auth/user-context";

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
 * Get username from OAuth2 Proxy headers.
 *
 * Reads x-auth-request-preferred-username (human-readable username from
 * the preferred_username OIDC claim) with fallback to x-auth-request-user
 * (user ID, typically email).
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
  return headersList.get("x-auth-request-preferred-username") || headersList.get("x-auth-request-user") || null;
}

/**
 * Build a User object from OAuth2 Proxy and Envoy-injected headers.
 *
 * Reads x-auth-request-preferred-username, x-auth-request-email,
 * x-auth-request-name, and x-osmo-roles set by OAuth2 Proxy + Envoy
 * on every authenticated request.
 *
 * Returns null if no user headers are present (e.g., local dev without Envoy).
 */
export async function getServerUser(): Promise<User | null> {
  const headersList = await headers();

  const username = headersList.get("x-auth-request-preferred-username") || headersList.get("x-auth-request-user");

  if (!username) {
    if (process.env.NODE_ENV === "development") {
      return {
        id: "dev-user",
        name: process.env.DEV_USER_NAME || "Dev User",
        email: process.env.DEV_USER_EMAIL || "dev@localhost",
        username: process.env.DEV_USER_NAME || "dev-user",
        isAdmin: true,
        initials: "DU",
      };
    }
    return null;
  }

  const email = headersList.get("x-auth-request-email") || username;
  const name = headersList.get("x-auth-request-name") || deriveDisplayName(username);
  const roles = await getServerUserRoles();

  return {
    id: username,
    name,
    email,
    username,
    isAdmin: hasAdminRole(roles),
    initials: getInitials(name),
  };
}

function deriveDisplayName(username: string): string {
  const namePart = username.includes("@") ? username.split("@")[0] : username;
  if (!namePart) return "User";
  const parts = namePart.split(/[._-]+/).filter(Boolean);
  if (parts.length <= 1) return namePart;
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function getInitials(name: string): string {
  return name
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}
