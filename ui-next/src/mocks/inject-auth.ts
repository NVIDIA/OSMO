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
 * Mock Auth Injection
 *
 * Part of the mock system for local development testing.
 * Utilities for injecting auth cookies/tokens when testing against real or mock backends.
 * In production, Envoy handles all authentication automatically.
 *
 * NOTE: This module is automatically replaced with a no-op stub in production builds
 * via Turbopack's resolveAlias configuration. See next.config.ts.
 *
 * Usage in browser console:
 * ```
 * devAuth.testUsers.admin()  // Inject admin user
 * devAuth.skip()             // Skip auth entirely
 * devAuth.status()           // Check current auth
 * ```
 */

/**
 * Generate a mock JWT token for local development.
 *
 * WARNING: This is NOT cryptographically signed. Only use for local dev!
 * Real production tokens are signed by Keycloak.
 */
export function generateMockJWT(username: string, roles: string[] = [], expiresInHours = 8): string {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iss: "https://auth-staging.osmo.nvidia.com/realms/osmo",
    sub: `mock-${username}`,
    aud: "osmo-browser-flow",
    exp: now + expiresInHours * 3600,
    iat: now,
    preferred_username: username,
    email: `${username}@nvidia.com`,
    name: username
      .split(".")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" "),
    roles: roles,
    realm_access: {
      roles: roles,
    },
  };

  // Base64url encode (note: not cryptographically signed!)
  const b64Header = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const b64Payload = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  // Mock signature (not real!)
  const mockSignature = "mock-signature-not-validated-locally";

  return `${b64Header}.${b64Payload}.${mockSignature}`;
}

/**
 * Inject mock auth into cookies for local development.
 * Simulates what Envoy would do in production.
 */
export function injectMockAuth(
  username: string,
  roles: string[] = [],
  options: {
    expiresInHours?: number;
    useBearer?: boolean;
  } = {},
): void {
  const { expiresInHours = 8, useBearer = false } = options;

  const token = generateMockJWT(username, roles, expiresInHours);
  const cookieName = useBearer ? "BearerToken" : "IdToken";
  const maxAge = expiresInHours * 3600;

  // Set the token cookie
  document.cookie = `${cookieName}=${token}; path=/; max-age=${maxAge}`;

  console.log(`✅ Mock auth injected for: ${username}`);
  console.log(`   Roles: ${roles.join(", ") || "none"}`);
  console.log(`   Expires in: ${expiresInHours} hours`);
  console.log(`   Token stored in: ${cookieName} cookie`);
  console.log(`\nTo clear: clearAuth()`);
}

/**
 * Inject common test users.
 */
export const injectTestUsers = {
  admin: () => injectMockAuth("admin", ["admin", "user"]),
  user: () => injectMockAuth("john.doe", ["user"]),
  powerUser: () => injectMockAuth("jane.admin", ["admin", "user", "power-user"]),
  viewer: () => injectMockAuth("viewer", ["viewer"]),
};

/**
 * Skip auth entirely (no token validation).
 * Useful for UI-only testing without backend.
 */
export function skipAuth(): void {
  document.cookie = "osmo_auth_skipped=true; path=/; max-age=86400";
  console.log("✅ Auth skipped - no token required");
  console.log("To re-enable: clearAuth()");
}

/**
 * Clear all auth cookies.
 */
export function clearAuth(): void {
  const cookies = ["IdToken", "BearerToken", "osmo_auth_skipped"];
  cookies.forEach((name) => {
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC`;
  });
  console.log("✅ Auth cookies cleared");
}

/**
 * Get the current auth status from cookies.
 */
export function getAuthStatus(): {
  hasToken: boolean;
  authSkipped: boolean;
  username: string | null;
  roles: string[];
  expiresAt: Date | null;
} {
  const cookies = document.cookie.split(";").reduce(
    (acc, cookie) => {
      const [key, value] = cookie.trim().split("=");
      if (key) acc[key] = value;
      return acc;
    },
    {} as Record<string, string>,
  );

  const token = cookies["IdToken"] || cookies["BearerToken"];
  const authSkipped = cookies["osmo_auth_skipped"] === "true";

  if (!token) {
    return {
      hasToken: false,
      authSkipped,
      username: null,
      roles: [],
      expiresAt: null,
    };
  }

  try {
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));

    return {
      hasToken: true,
      authSkipped,
      username: payload.preferred_username || null,
      roles: payload.roles || payload.realm_access?.roles || [],
      expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
    };
  } catch {
    return {
      hasToken: true,
      authSkipped,
      username: null,
      roles: [],
      expiresAt: null,
    };
  }
}

/**
 * Print current auth status to console.
 */
export function printAuthStatus(): void {
  const status = getAuthStatus();

  console.log("🔐 Auth Status:");
  console.log(`   Has token: ${status.hasToken}`);
  console.log(`   Auth skipped: ${status.authSkipped}`);
  console.log(`   Username: ${status.username || "N/A"}`);
  console.log(`   Roles: ${status.roles.join(", ") || "none"}`);
  console.log(`   Expires: ${status.expiresAt ? status.expiresAt.toLocaleString() : "N/A"}`);
}

// Expose to window for easy console access
declare global {
  interface Window {
    devAuth?: {
      inject: typeof injectMockAuth;
      testUsers: typeof injectTestUsers;
      skip: typeof skipAuth;
      clear: typeof clearAuth;
      status: typeof printAuthStatus;
    };
  }
}

if (typeof window !== "undefined") {
  window.devAuth = {
    inject: injectMockAuth,
    testUsers: injectTestUsers,
    skip: skipAuth,
    clear: clearAuth,
    status: printAuthStatus,
  };

  console.log("💡 Dev auth helpers loaded. Try:");
  console.log("   devAuth.testUsers.admin()  - Inject admin user");
  console.log("   devAuth.testUsers.user()   - Inject regular user");
  console.log("   devAuth.skip()             - Skip auth entirely");
  console.log("   devAuth.status()           - Check current auth");
  console.log("   devAuth.clear()            - Clear auth cookies");
}
