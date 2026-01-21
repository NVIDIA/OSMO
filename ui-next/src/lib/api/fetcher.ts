/**
 * Custom fetcher for orval-generated API client.
 * Handles authentication, token refresh, and error responses.
 *
 * Uses relative URLs - next.config.ts rewrites proxy to the configured backend.
 */

import { getAuthToken, refreshToken, isTokenExpiringSoon } from "@/lib/auth";
import { TOKEN_REFRESH_THRESHOLD_SECONDS, getBasePathUrl } from "@/lib/config";
import { Headers as AuthHeaders } from "./headers";

interface RequestConfig {
  url: string;
  method: string;
  headers?: HeadersInit;
  data?: unknown;
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

// =============================================================================
// API Error - Plain object with type guard for tree-shaking
// =============================================================================

const API_ERROR_BRAND = Symbol("ApiError");

/**
 * API error with retry information.
 */
export interface ApiError extends Error {
  readonly [API_ERROR_BRAND]: true;
  readonly status?: number;
  readonly isRetryable: boolean;
}

/**
 * Creates an API error with retry information.
 */
export function createApiError(message: string, status?: number, isRetryable = true): ApiError {
  const error = new Error(message) as ApiError;
  error.name = "ApiError";
  (error as { [API_ERROR_BRAND]: true })[API_ERROR_BRAND] = true;
  (error as { status?: number }).status = status;
  (error as { isRetryable: boolean }).isRetryable = isRetryable;
  return error;
}

/**
 * Type guard to check if an error is an ApiError.
 */
export function isApiError(error: unknown): error is ApiError {
  return (
    error !== null &&
    typeof error === "object" &&
    API_ERROR_BRAND in error &&
    (error as { [API_ERROR_BRAND]: unknown })[API_ERROR_BRAND] === true
  );
}

// Shared refresh promise - all concurrent callers await the same promise
let refreshPromise: Promise<string | null> | null = null;

/**
 * Ensure we have a valid token, refreshing if needed.
 *
 * Uses a shared promise pattern to prevent race conditions:
 * - Multiple concurrent requests share the same refresh promise
 * - The promise is reset only after refresh completes (success or failure)
 * - No flags needed - the promise itself acts as the mutex
 */
async function ensureValidToken(): Promise<string> {
  let token = getAuthToken();

  // If token is missing or expiring soon, try to refresh
  if (!token || isTokenExpiringSoon(token, TOKEN_REFRESH_THRESHOLD_SECONDS)) {
    // Only create promise once - all concurrent callers share it
    if (!refreshPromise) {
      refreshPromise = refreshToken().finally(() => {
        // Reset after complete (success or failure) so future calls can refresh again
        refreshPromise = null;
      });
    }

    const newToken = await refreshPromise;
    if (newToken) {
      token = newToken;
    }
  }

  return token;
}

export const customFetch = async <T>(config: RequestConfig, options?: RequestInit): Promise<T> => {
  const { url, method, headers, data, params, signal } = config;

  // Build URL with query params (always relative - routing layer handles backend)
  // Prepend basePath to ensure basePath-aware URLs
  // Note: Next.js rewrites handle /api/* routes before basePath is applied,
  // but being explicit here makes the code more maintainable and basePath-agnostic
  let fullUrl = getBasePathUrl(url);
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((v) => searchParams.append(key, String(v)));
        } else {
          searchParams.append(key, String(value));
        }
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      fullUrl = `${fullUrl}?${queryString}`;
    }
  }

  // Get auth token, refreshing if needed
  const authToken = await ensureValidToken();

  let response: Response;

  try {
    response = await fetch(fullUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { [AuthHeaders.AUTH]: authToken } : {}),
        ...headers,
      },
      body: data ? JSON.stringify(data) : undefined,
      signal,
      credentials: "include",
      ...options,
    });
  } catch (error) {
    // Network error (CORS, offline, etc.) - NOT retryable
    const message = error instanceof Error ? error.message : "Network error";
    throw createApiError(`Network error: ${message}`, 0, false);
  }

  // Handle auth errors - try to refresh token once using shared promise pattern
  if (response.status === 401 || response.status === 403) {
    // Use the same shared promise pattern to prevent concurrent refresh attempts
    if (!refreshPromise) {
      refreshPromise = refreshToken().finally(() => {
        refreshPromise = null;
      });
    }

    const newToken = await refreshPromise;

    if (newToken) {
      // Retry the request with the new token
      const retryResponse = await fetch(fullUrl, {
        method,
        headers: {
          "Content-Type": "application/json",
          [AuthHeaders.AUTH]: newToken,
          ...headers,
        },
        body: data ? JSON.stringify(data) : undefined,
        signal,
        credentials: "include",
        ...options,
      });

      if (retryResponse.ok) {
        const text = await retryResponse.text();
        if (!text) return {} as T;
        return JSON.parse(text);
      }
    }

    throw createApiError(`Authentication required (${response.status})`, response.status, false);
  }

  // Helper to safely parse error response (may be HTML for 404s, etc.)
  const parseErrorResponse = async (response: Response): Promise<{ message?: string; detail?: string }> => {
    try {
      const text = await response.text();
      if (!text) {
        return { message: `HTTP ${response.status}: ${response.statusText}` };
      }

      // Try to parse as JSON, fallback to text if it's not valid JSON
      try {
        return JSON.parse(text);
      } catch {
        // Not JSON (likely HTML error page), return generic error
        return { message: `HTTP ${response.status}: ${response.statusText}` };
      }
    } catch {
      return { message: `HTTP ${response.status}: ${response.statusText}` };
    }
  };

  // Handle other client errors (4xx) - NOT retryable
  if (response.status >= 400 && response.status < 500) {
    const error = await parseErrorResponse(response);
    throw createApiError(error.message || error.detail || `HTTP ${response.status}`, response.status, false);
  }

  // Handle server errors (5xx) - retryable
  if (!response.ok) {
    const error = await parseErrorResponse(response);
    throw createApiError(error.message || error.detail || `HTTP ${response.status}`, response.status, true);
  }

  // Handle empty responses (204 No Content, etc.)
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text);
};
