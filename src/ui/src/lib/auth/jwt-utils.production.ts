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
 * JWT Utilities - Production Version
 *
 * Production-safe JWT utilities that ONLY trust Envoy's Authorization header.
 * This version is swapped in for production builds via next.config.ts resolveAlias.
 *
 * SECURITY: Never trusts cookies - only validated tokens from Envoy.
 */

import { jwtDecode } from "jwt-decode";
import { extractRolesFromClaims } from "@/lib/auth/roles";

// =============================================================================
// Constants
// =============================================================================

/**
 * FALLBACK token lifetime (5 minutes / 300 seconds).
 * Only used if JWT exp/iat claims are malformed or missing.
 * Primary path: Derive from JWT claims (exp - iat) to match provider configuration.
 */
export const FALLBACK_TOKEN_LIFETIME_SECONDS = 300;

// =============================================================================
// Types
// =============================================================================

/**
 * JWT claims structure from Keycloak/OAuth provider.
 */
export interface JwtClaims {
  /** Issuer */
  iss?: string;
  /** Subject (user ID) */
  sub?: string;
  /** Audience */
  aud?: string;
  /** Expiration time (Unix timestamp) */
  exp?: number;
  /** Issued at time (Unix timestamp) */
  iat?: number;
  /** JWT ID */
  jti?: string;
  /** Preferred username (used by Envoy as secondary user_claim) */
  preferred_username?: string;
  /** Unique name (used by Envoy as primary user_claim) */
  unique_name?: string;
  /** Email address */
  email?: string;
  /** Email verified flag */
  email_verified?: boolean;
  /** Given name */
  given_name?: string;
  /** Family name */
  family_name?: string;
  /** Full name */
  name?: string;
  /** User roles */
  roles?: string[];
  /** Groups */
  groups?: string[];
  /** Session state */
  session_state?: string;
  /** Authorized party */
  azp?: string;
  /** Realm access (Keycloak-specific) */
  realm_access?: {
    roles?: string[];
  };
  /** Resource access (Keycloak-specific) */
  resource_access?: Record<string, { roles?: string[] }>;
}

// =============================================================================
// Client-Side JWT Decoding (No Signature Verification)
// =============================================================================

/**
 * Decode JWT payload without signature verification.
 * Signature validation is Envoy's responsibility.
 *
 * @param token - JWT token string
 * @returns Decoded payload or null if invalid
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payloadB64 = parts[1];
    if (!payloadB64) return null;

    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/**
 * Extract a single claim from a JWT token.
 *
 * @param token - JWT token string
 * @param claim - Claim name to extract
 * @returns Claim value or null if not found
 */
export function getJwtClaim<T = unknown>(token: string, claim: string): T | null {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const value = payload[claim];
  return value !== undefined ? (value as T) : null;
}

// =============================================================================
// Server-Side JWT Extraction (Request-Based)
// =============================================================================

/**
 * Extract JWT token from Authorization header.
 *
 * PRODUCTION: ONLY trusts Authorization header from Envoy (secure)
 *
 * @param request - The request object with headers
 * @returns The JWT token string or null if not found
 */
export function extractToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7); // Remove "Bearer " prefix
}

/**
 * Decode and parse JWT claims from Authorization header.
 *
 * @param request - The request object with headers
 * @returns Parsed JWT claims or null if token is invalid/missing
 */
export function getJwtClaims(request: Request): JwtClaims | null {
  const token = extractToken(request);
  if (!token) {
    return null;
  }

  try {
    return jwtDecode<JwtClaims>(token);
  } catch (error) {
    console.error("Failed to decode JWT:", error);
    return null;
  }
}

/**
 * Get the username from the JWT token.
 *
 * @param request - The request object with headers
 * @returns Username or null if not found
 */
export function getUsername(request: Request): string | null {
  const claims = getJwtClaims(request);
  return claims?.preferred_username ?? null;
}

/**
 * Get user roles from the JWT token.
 *
 * @param request - The request object with headers
 * @returns Array of role names
 */
export function getUserRoles(request: Request): string[] {
  const claims = getJwtClaims(request);
  if (!claims) {
    return [];
  }

  return extractRolesFromClaims(claims);
}

/**
 * Check if the user has a specific role.
 *
 * @param request - The request object with headers
 * @param role - Role name to check
 * @returns True if user has the role
 */
export function hasRole(request: Request, role: string): boolean {
  const roles = getUserRoles(request);
  return roles.includes(role);
}

/**
 * Check if the token is expired.
 *
 * @param request - The request object with headers
 * @returns True if token is expired or invalid
 */
export function isTokenExpired(request: Request): boolean {
  const claims = getJwtClaims(request);
  if (!claims?.exp) {
    return true;
  }

  // exp is in seconds, Date.now() is in milliseconds
  const now = Math.floor(Date.now() / 1000);
  return claims.exp < now;
}
