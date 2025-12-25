/**
 * Token Storage
 *
 * Abstracts token persistence. The storage mechanism is determined
 * by the environment configuration.
 */

import { isLocalDev } from "@/lib/config";
import { StorageKeys } from "@/lib/constants/storage";
import { getAuthBackend } from "./auth-backend";

const ID_TOKEN_KEY = StorageKeys.ID_TOKEN;
const REFRESH_TOKEN_KEY = StorageKeys.REFRESH_TOKEN;
const AUTH_SKIPPED_KEY = "osmo_auth_skipped";
const RETURN_URL_KEY = "osmo_return_url";

/**
 * Get the stored IdToken.
 */
export function getStoredIdToken(): string {
  if (typeof window === "undefined") return "";

  return isLocalDev()
    ? (localStorage.getItem(ID_TOKEN_KEY) ?? "")
    : getCookieValue(ID_TOKEN_KEY) || getCookieValue(StorageKeys.BEARER_TOKEN) || "";
}

/**
 * Get the stored RefreshToken.
 */
export function getStoredRefreshToken(): string {
  if (typeof window === "undefined") return "";

  return isLocalDev() ? (localStorage.getItem(REFRESH_TOKEN_KEY) ?? "") : getCookieValue(REFRESH_TOKEN_KEY) || "";
}

/**
 * Check if a refresh token is stored.
 */
export function hasStoredRefreshToken(): boolean {
  return Boolean(getStoredRefreshToken());
}

/**
 * Store tokens.
 */
export function storeTokens(idToken: string, refreshToken?: string): void {
  if (typeof window === "undefined") return;

  if (isLocalDev()) {
    localStorage.setItem(ID_TOKEN_KEY, idToken);
    if (refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    }
  } else {
    setCookie(ID_TOKEN_KEY, idToken, 30);
    if (refreshToken) {
      setCookie(REFRESH_TOKEN_KEY, refreshToken, 30);
    }
  }
}

/**
 * Clear all stored tokens.
 */
export function clearStoredTokens(): void {
  if (typeof window === "undefined") return;

  if (isLocalDev()) {
    localStorage.removeItem(ID_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } else {
    setCookie(ID_TOKEN_KEY, "", -1);
    setCookie(REFRESH_TOKEN_KEY, "", -1);
  }
}

/**
 * Refresh the token using the auth backend.
 * Returns new id_token on success, null on failure.
 *
 * Only clears tokens if the refresh token is definitively invalid
 * (not on network errors which might be temporary).
 */
export async function refreshStoredToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  const backend = getAuthBackend();
  const result = await backend.refreshToken(refreshToken);

  if (!result.success) {
    // Only clear tokens if this is a definitive auth failure
    // (token invalid/expired), not a network error
    if (result.isAuthError) {
      clearStoredTokens();
    }
    return null;
  }

  if (result.idToken) {
    storeTokens(result.idToken, result.refreshToken);
  }

  return result.idToken || null;
}

// =============================================================================
// Session Storage (auth flow state)
// =============================================================================

/**
 * Check if auth was skipped (user chose "Continue without login").
 */
export function isAuthSkipped(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(AUTH_SKIPPED_KEY) === "true";
}

/**
 * Mark auth as skipped.
 */
export function setAuthSkipped(skipped: boolean): void {
  if (typeof window === "undefined") return;
  if (skipped) {
    sessionStorage.setItem(AUTH_SKIPPED_KEY, "true");
  } else {
    sessionStorage.removeItem(AUTH_SKIPPED_KEY);
  }
}

/**
 * Store the URL to return to after login.
 */
export function setReturnUrl(url: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(RETURN_URL_KEY, url);
}

/**
 * Get and clear the return URL (one-time use).
 */
export function consumeReturnUrl(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const url = sessionStorage.getItem(RETURN_URL_KEY) || fallback;
  sessionStorage.removeItem(RETURN_URL_KEY);
  return url;
}

/**
 * Clear all auth session state (used on logout).
 */
export function clearAuthSessionState(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(AUTH_SKIPPED_KEY);
  sessionStorage.removeItem(RETURN_URL_KEY);
}

// =============================================================================
// Internal helpers
// =============================================================================

function getCookieValue(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.trim().split("=");
    if (key === name) {
      return valueParts.join("=");
    }
  }
  return undefined;
}

function setCookie(name: string, value: string, days: number): void {
  if (typeof document === "undefined") return;

  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = `expires=${date.toUTCString()}`;
  const secure = window.location.protocol === "https:" ? ";Secure" : "";
  const sameSite = ";SameSite=Lax";

  document.cookie = `${name}=${value};${expires};path=/${secure}${sameSite}`;
}
