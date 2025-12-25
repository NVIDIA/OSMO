/**
 * Authentication Module
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      auth-provider.tsx                          │
 * │              AuthProvider, useAuth, public API                  │
 * └─────────────────────────────────────────────────────────────────┘
 *                              ↓
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      auth-backend.ts                            │
 * │         Backend abstraction (implements AuthBackend)            │
 * └─────────────────────────────────────────────────────────────────┘
 *                              ↓
 * ┌───────────────────────┬────────────────────────────────────────┐
 * │     token-utils.ts    │           token-storage.ts             │
 * │   JWT parsing/validation │     Token persistence              │
 * └───────────────────────┴────────────────────────────────────────┘
 */

// Provider and hooks
export { AuthProvider, useAuth, getAuthToken, refreshToken } from "./auth-provider";

// Backend abstraction
export { getAuthBackend, setAuthBackend } from "./auth-backend";
export type { AuthBackend, AuthConfig, TokenRefreshResult } from "./auth-backend";

// Token utilities (for use by fetcher, etc.)
export { parseJwtClaims, isTokenExpired, isTokenExpiringSoon } from "./token-utils";
export type { AuthClaims } from "./token-utils";
