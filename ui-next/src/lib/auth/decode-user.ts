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

import { jwtDecode } from "jwt-decode";
import type { JwtClaims } from "@/lib/auth/jwt-utils.production";
import { hasAdminRole } from "@/lib/auth/roles";
import type { User } from "@/lib/auth/user-context";
import { getCookie } from "@/lib/auth/cookies";

/**
 * Get JWT token from client-side storage (localStorage or cookies).
 *
 * CLIENT-SIDE ONLY: This function requires window/localStorage.
 *
 * Checks:
 * 1. localStorage (dev mode with injected tokens)
 * 2. Cookies (set by Envoy in production, or dev helpers)
 *
 * @returns JWT token string or null if not found
 */
export function getClientToken(): string | null {
  if (typeof window === "undefined") return null;

  // Check localStorage first (dev mode)
  const localStorageToken = localStorage.getItem("IdToken") || localStorage.getItem("BearerToken");
  if (localStorageToken) {
    return localStorageToken;
  }

  // Check cookies (production with Envoy, or dev mode)
  return getCookie("IdToken") || getCookie("BearerToken") || null;
}

/**
 * Get initials from a name string.
 *
 * @param name - User's full name or email
 * @returns Two-letter initials (e.g., "John Doe" → "JD")
 */
function getInitials(name: string): string {
  return name
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

/**
 * Extract user roles from JWT claims.
 *
 * Checks multiple sources:
 * - claims.roles (top-level)
 * - claims.realm_access.roles (Keycloak)
 * - claims.resource_access.osmo.roles (Keycloak resource)
 *
 * @param claims - Decoded JWT claims
 * @returns Array of role strings
 */
function extractRoles(claims: JwtClaims): string[] {
  const roles = new Set<string>();

  // Top-level roles array
  if (Array.isArray(claims.roles)) {
    claims.roles.forEach((role) => roles.add(role));
  }

  // Keycloak realm_access.roles
  if (Array.isArray(claims.realm_access?.roles)) {
    claims.realm_access.roles.forEach((role) => roles.add(role));
  }

  // Keycloak resource_access (check "osmo" resource)
  const osmoRoles = claims.resource_access?.osmo?.roles;
  if (Array.isArray(osmoRoles)) {
    osmoRoles.forEach((role) => roles.add(role));
  }

  return Array.from(roles);
}

/**
 * Decode user information from JWT token.
 *
 * SHARED LOGIC: Used by both client (UserProvider) and server (/api/me).
 *
 * Transforms JWT claims into User object:
 * - id: claims.sub
 * - name: claims.name || claims.email (first part) - for display
 * - username: claims.unique_name || claims.preferred_username - matches Envoy's x-osmo-user header
 * - email: claims.email || claims.preferred_username
 * - isAdmin: hasAdminRole(roles)
 * - initials: Two letters from name
 *
 * @param token - JWT token string
 * @returns User object or null if token is invalid
 */
export function decodeUserFromToken(token: string | null): User | null {
  if (!token) {
    return null;
  }

  try {
    const claims = jwtDecode<JwtClaims>(token);

    // Extract roles from multiple possible locations
    const roles = extractRoles(claims);

    // Extract email from multiple possible sources
    // Some auth providers use 'email', others use 'preferred_username'
    const email = claims.email || claims.preferred_username || "";

    // Extract username that matches Envoy's x-osmo-user header
    // Envoy uses unique_name (primary) or preferred_username (secondary)
    const username = claims.unique_name || claims.preferred_username || email.split("@")[0] || "user";

    // Build User object
    return {
      id: claims.sub || "",
      name: claims.name || email.split("@")[0] || "User",
      username,
      email,
      isAdmin: hasAdminRole(roles),
      initials: getInitials(claims.name || email || "U"),
    };
  } catch (error) {
    console.error("Failed to decode JWT:", error);
    return null;
  }
}
