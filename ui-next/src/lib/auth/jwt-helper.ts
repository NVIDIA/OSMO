/**
 * JWT Helper - Development Version
 *
 * Extends the production JWT helper with cookie fallback for mock mode.
 * In production builds, this file is replaced with jwt-helper.production.ts.
 */

import { jwtDecode } from "jwt-decode";

// Re-export types and utilities that don't depend on extractToken
export type { JwtClaims } from "./jwt-helper.production";
export { getUserRoles, hasRole, isTokenExpired } from "./jwt-helper.production";

/**
 * Extract JWT token from Authorization header or cookies.
 *
 * DEVELOPMENT: Supports cookie fallback for mock mode
 * PRODUCTION: This entire file is replaced with jwt-helper.production.ts
 *
 * @param request - The request object with headers
 * @returns The JWT token string or null if not found
 */
export function extractToken(request: Request): string | null {
  // Always check Authorization header first (production with Envoy)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7); // Remove "Bearer " prefix
  }

  // DEV ONLY: Check cookies for mock mode
  // This entire cookie parsing block will be removed in production builds
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").reduce(
      (acc, cookie) => {
        const [key, value] = cookie.trim().split("=");
        if (key) acc[key] = value;
        return acc;
      },
      {} as Record<string, string>,
    );

    // Check IdToken first (what Envoy sets), then BearerToken
    return cookies["IdToken"] || cookies["BearerToken"] || null;
  }

  return null;
}

/**
 * Decode and parse JWT claims using dev extractToken (with cookie fallback).
 */
export function getJwtClaims(request: Request): import("./jwt-helper.production").JwtClaims | null {
  const token = extractToken(request); // Uses dev version with cookie fallback
  if (!token) {
    return null;
  }

  try {
    return jwtDecode<import("./jwt-helper.production").JwtClaims>(token);
  } catch (error) {
    console.error("Failed to decode JWT:", error);
    return null;
  }
}

/**
 * Get the username from the JWT token (uses dev getJwtClaims).
 */
export function getUsername(request: Request): string | null {
  const claims = getJwtClaims(request);
  return claims?.preferred_username ?? null;
}
