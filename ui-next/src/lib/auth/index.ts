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
 *
 * To integrate a different identity provider:
 * 1. Implement the AuthBackend interface
 * 2. Call setAuthBackend() with your implementation
 */

// Main exports
export { AuthProvider, useAuth, getAuthToken, refreshToken } from "./auth-provider";

// Backend abstraction
export { getAuthBackend, setAuthBackend } from "./auth-backend";
export type { AuthBackend, AuthConfig, TokenRefreshResult } from "./auth-backend";

// Types
export type { AuthClaims } from "./token-utils";
