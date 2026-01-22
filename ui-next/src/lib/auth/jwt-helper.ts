/**
 * JWT Helper
 *
 * Utilities for working with JWT tokens from Envoy's Authorization header.
 * Envoy forwards the Bearer token with forwardBearerToken: true
 */

import { jwtDecode } from "jwt-decode";

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
  /** Preferred username */
  preferred_username?: string;
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

/**
 * Extract JWT token from Authorization header.
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
 * Checks both the top-level roles array and Keycloak's realm_access.roles.
 *
 * @param request - The request object with headers
 * @returns Array of role names
 */
export function getUserRoles(request: Request): string[] {
  const claims = getJwtClaims(request);
  if (!claims) {
    return [];
  }

  // Combine roles from multiple sources
  const roles = new Set<string>();

  // Top-level roles array
  if (Array.isArray(claims.roles)) {
    claims.roles.forEach((role) => roles.add(role));
  }

  // Keycloak realm_access.roles
  if (Array.isArray(claims.realm_access?.roles)) {
    claims.realm_access.roles.forEach((role) => roles.add(role));
  }

  return Array.from(roles);
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
