/**
 * Custom fetcher for orval-generated API client.
 * Handles error responses and request formatting.
 *
 * In production, Envoy sidecar handles authentication:
 * - Envoy intercepts all requests and validates session
 * - Envoy adds Authorization header with valid JWT
 * - Envoy refreshes tokens automatically (transparent to app)
 * - App never manages tokens directly
 *
 * In local dev, tokens can be injected via cookies/localStorage (see lib/dev/inject-auth.ts)
 */

import { getBasePathUrl } from "@/lib/config";

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

/**
 * In production with Envoy, we don't manage tokens at all.
 * In local dev, check if a token is available in localStorage/cookies for testing.
 */
function getDevAuthToken(): string | null {
  if (typeof window === "undefined") return null;

  // Check localStorage (dev mode with injected tokens)
  const localStorageToken = localStorage.getItem("IdToken") || localStorage.getItem("BearerToken");
  if (localStorageToken) return localStorageToken;

  // Check cookies (might be set by dev helpers or copied from staging)
  const cookies = document.cookie.split(";").reduce(
    (acc, cookie) => {
      const [key, value] = cookie.trim().split("=");
      if (key) acc[key] = value;
      return acc;
    },
    {} as Record<string, string>,
  );

  return cookies["IdToken"] || cookies["BearerToken"] || null;
}

export const customFetch = async <T>(config: RequestConfig, options?: RequestInit): Promise<T> => {
  const { url, method, headers, data, params, signal } = config;

  // Build URL with query params
  // Server-side: Must use absolute URL (Node.js fetch requires full URL)
  // Client-side: Can use relative URL
  let fullUrl = getBasePathUrl(url);

  // On server, convert relative URLs to absolute URLs
  if (typeof window === "undefined" && fullUrl.startsWith("/")) {
    const { getServerApiBaseUrl } = await import("@/lib/api/server/config");
    const baseUrl = getServerApiBaseUrl();
    fullUrl = `${baseUrl}${fullUrl}`;
  }

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

  // In production, Envoy adds auth headers automatically
  // In local dev, check if we have a token to forward
  const devToken = getDevAuthToken();

  let response: Response;

  try {
    response = await fetch(fullUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        // Only add auth header in local dev if we have a token
        // In production, Envoy handles this
        ...(devToken ? { "x-osmo-auth": devToken } : {}),
        ...headers,
      },
      body: data ? JSON.stringify(data) : undefined,
      signal,
      credentials: "include", // Important: forwards cookies (Envoy session)
      ...options,
    });
  } catch (error) {
    // Check if this was an intentional abort
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    // Network error (CORS, offline, etc.) - NOT retryable
    const message = error instanceof Error ? error.message : "Network error";
    throw createApiError(`Network error: ${message}`, 0, false);
  }

  // Handle auth errors
  // In production with Envoy: Should rarely happen (Envoy blocks unauthenticated requests)
  // In local dev: Means the token is invalid or missing
  if (response.status === 401 || response.status === 403) {
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
