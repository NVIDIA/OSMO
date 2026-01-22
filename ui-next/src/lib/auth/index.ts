/**
 * Authentication Module (Envoy-Managed)
 *
 * In production, Envoy sidecar handles all authentication.
 * This module provides minimal client-side utilities:
 * - User context (fetched from API)
 * - Role checking
 * - Server-side JWT helpers (for API routes)
 */

// User context
export { UserProvider, useUser, useIsAdmin, type User } from "./user-context";

// Role checking
export { hasAdminRole } from "./roles";

// Server-side JWT utilities (for API routes only)
export { getJwtClaims, getUserRoles, extractToken, hasRole } from "./jwt-helper";
export type { JwtClaims } from "./jwt-helper";
