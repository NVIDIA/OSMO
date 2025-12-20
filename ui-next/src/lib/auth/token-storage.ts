/**
 * Token Storage
 * 
 * Abstracts token persistence. The storage mechanism is determined
 * by the environment configuration.
 */

import { isLocalDev } from "@/lib/config";
import { getAuthBackend } from "./auth-backend";

const ID_TOKEN_KEY = "IdToken";
const REFRESH_TOKEN_KEY = "RefreshToken";

/**
 * Get the stored IdToken.
 */
export function getStoredIdToken(): string {
  if (typeof window === "undefined") return "";

  return isLocalDev()
    ? localStorage.getItem(ID_TOKEN_KEY) ?? ""
    : getCookieValue(ID_TOKEN_KEY) || getCookieValue("BearerToken") || "";
}

/**
 * Get the stored RefreshToken.
 */
export function getStoredRefreshToken(): string {
  if (typeof window === "undefined") return "";

  return isLocalDev()
    ? localStorage.getItem(REFRESH_TOKEN_KEY) ?? ""
    : getCookieValue(REFRESH_TOKEN_KEY) || "";
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
 */
export async function refreshStoredToken(): Promise<string | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return null;

  const backend = getAuthBackend();
  const result = await backend.refreshToken(refreshToken);

  if (!result.success) {
    clearStoredTokens();
    return null;
  }

  if (result.idToken) {
    storeTokens(result.idToken, result.refreshToken);
  }

  return result.idToken || null;
}

// Internal helpers

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
