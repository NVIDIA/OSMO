/**
 * Auth Backend
 *
 * Defines the interface for authentication providers.
 * Implement AuthBackend to integrate with different identity providers.
 */

import { logError } from "@/lib/logger";

/**
 * Auth configuration.
 */
export interface AuthConfig {
  auth_enabled: boolean;
}

/**
 * Token refresh result.
 */
export interface TokenRefreshResult {
  success: boolean;
  idToken?: string;
  refreshToken?: string;
  error?: string;
  /** True if the error is a definitive auth failure (token invalid/expired) */
  isAuthError?: boolean;
}

/**
 * Auth backend interface.
 */
export interface AuthBackend {
  /** Get auth configuration. */
  getConfig(): Promise<AuthConfig>;

  /** Get the login redirect URL. Returns null if handled differently. */
  getLoginUrl(returnUrl: string): Promise<string | null>;

  /** Get the logout redirect URL. Returns null if no redirect needed. */
  getLogoutUrl(): Promise<string | null>;

  /** Refresh the access token. */
  refreshToken(refreshToken: string): Promise<TokenRefreshResult>;

  /** Validate a token (optional). */
  validateToken?(idToken: string): Promise<boolean>;
}

/**
 * Creates the default auth backend implementation.
 * Uses Next.js API routes that proxy to the identity provider.
 */
function createDefaultAuthBackend(): AuthBackend {
  return {
    async getConfig(): Promise<AuthConfig> {
      try {
        const res = await fetch("/auth/login_info", { cache: "no-store" });
        const data = await res.json();
        return { auth_enabled: data.auth_enabled ?? false };
      } catch (error) {
        logError("Failed to fetch auth config:", error);
        return { auth_enabled: false };
      }
    },

    async getLoginUrl(returnUrl: string): Promise<string | null> {
      return `/auth/initiate?return_url=${encodeURIComponent(returnUrl)}`;
    },

    async getLogoutUrl(): Promise<string | null> {
      try {
        const res = await fetch("/auth/logout", { cache: "no-store" });
        const data = await res.json();
        return data.redirectTo || null;
      } catch {
        return null;
      }
    },

    async refreshToken(refreshTokenValue: string): Promise<TokenRefreshResult> {
      try {
        const res = await fetch("/auth/refresh_token", {
          headers: { "x-refresh-token": refreshTokenValue },
        });
        const data = await res.json();

        if (data.isFailure) {
          // 4xx errors indicate the refresh token is invalid (auth error)
          // 5xx errors or network issues are temporary
          const isAuthError = res.status >= 400 && res.status < 500;
          return {
            success: false,
            error: data.error || "Token refresh failed",
            isAuthError,
          };
        }

        return {
          success: true,
          idToken: data.id_token,
          refreshToken: data.refresh_token,
        };
      } catch (error) {
        // Network errors are not auth errors - don't clear tokens
        logError("Failed to refresh token (network):", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          isAuthError: false,
        };
      }
    },
  };
}

let authBackend: AuthBackend | null = null;

/**
 * Get the auth backend instance.
 */
export function getAuthBackend(): AuthBackend {
  if (!authBackend) {
    authBackend = createDefaultAuthBackend();
  }
  return authBackend;
}

/**
 * Set a custom auth backend.
 */
export function setAuthBackend(backend: AuthBackend): void {
  authBackend = backend;
}
