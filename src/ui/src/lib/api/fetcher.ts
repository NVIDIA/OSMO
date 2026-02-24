// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Custom fetcher for orval-generated API client.
 * Handles error responses, request formatting, and reactive token refresh.
 *
 * Authentication Architecture:
 * - Production: Envoy sidecar validates session and adds JWT headers
 * - Local dev: Tokens injected via cookies/localStorage (see lib/dev/inject-auth.ts)
 * - Reactive refresh: On 401 response, triggers server-side token refresh via
 *   /api/auth/refresh, then transparently retries the failed request with fresh token
 */

import { toast } from "sonner";
import { getBasePathUrl } from "@/lib/config";
import { handleRedirectResponse } from "@/lib/api/handle-redirect";
import { getClientToken } from "@/lib/auth/decode-user";
import { TOKEN_REFRESHED_EVENT } from "@/lib/auth/user-context";

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

// =============================================================================
// Server-Side Token Refresh
// =============================================================================

let refreshPromise: Promise<void> | null = null;
let lastRefreshFailureTime = 0;
const REFRESH_COOLDOWN_MS = 30_000;

/**
 * Performs server-side token refresh using RefreshToken cookie.
 * Multiple concurrent calls share the same refresh Promise to avoid race conditions.
 *
 * Includes a cooldown circuit breaker: if the last refresh failed within
 * REFRESH_COOLDOWN_MS, immediately throws instead of hitting the server again.
 * This prevents infinite loops when the session is fully expired and the
 * RefreshToken cookie is gone.
 */
async function performTokenRefresh(): Promise<void> {
  if (Date.now() - lastRefreshFailureTime < REFRESH_COOLDOWN_MS) {
    throw new Error("Token refresh recently failed — cooldown active");
  }

  // If already refreshing, wait for that refresh to complete
  if (refreshPromise) {
    return refreshPromise;
  }

  // Start new refresh
  refreshPromise = (async () => {
    try {
      const response = await fetch(getBasePathUrl("/api/auth/refresh"), {
        method: "POST",
        credentials: "include", // Send cookies (RefreshToken)
      });

      if (!response.ok) {
        lastRefreshFailureTime = Date.now();
        const error = await response.json().catch(() => ({ error: "Token refresh failed" }));
        throw new Error(error.error || `HTTP ${response.status}`);
      }

      // Notify UserProvider to re-read user from refreshed token
      window.dispatchEvent(new CustomEvent(TOKEN_REFRESHED_EVENT));
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export const customFetch = async <T>(config: RequestConfig, options?: RequestInit): Promise<T> => {
  const { url, method, headers, data, params, signal } = config;

  // Build URL with query params
  // Server-side: Must use absolute URL (Node.js fetch requires full URL)
  // Client-side: Can use relative URL with basePath prepended
  let fullUrl = url;

  // On server, we need both absolute URL and auth headers from incoming request
  let serverAuthHeaders: HeadersInit = {};
  if (typeof window === "undefined" && fullUrl.startsWith("/")) {
    // Server-side: Direct backend request (no basePath needed)
    const { getServerApiBaseUrl, getServerFetchHeaders } = await import("@/lib/api/server/config");
    const baseUrl = getServerApiBaseUrl();
    fullUrl = `${baseUrl}${fullUrl}`;
    // Get auth headers from incoming request cookies
    // This forwards the user's auth token to backend API
    serverAuthHeaders = await getServerFetchHeaders();
  } else {
    // Client-side: Add basePath for Next.js routing
    fullUrl = getBasePathUrl(url);
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

  // In production, Envoy adds auth headers automatically (client-side).
  // In local dev, getClientToken reads from localStorage/cookies.
  // In server-side renders, auth is handled via serverAuthHeaders above.
  const devToken = getClientToken();

  let response: Response;

  try {
    response = await fetch(fullUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        // Server-side: forward auth from incoming request cookies
        ...serverAuthHeaders,
        // Client-side local dev: use localStorage token if available
        // Client-side production: Envoy handles this automatically
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

  // Handle 401/403 with reactive server-side refresh
  // 403 can be transient during JWT provider fallback ("Audiences in Jwt are not allowed")
  if (response.status === 401 || response.status === 403) {
    // Check if this is a retry attempt (prevent infinite loop)
    // Note: We check config.headers because that's where we set the retry marker
    const isRetry = headers && typeof headers === "object" && "x-retry-after-refresh" in headers;

    if (!isRetry && typeof window !== "undefined") {
      try {
        // Trigger server-side refresh (transparent to user)
        await performTokenRefresh();

        // Get fresh token after refresh
        const freshToken = getClientToken();

        // Retry the original request with new token
        return customFetch<T>(
          {
            ...config,
            headers: {
              ...headers,
              ...(freshToken ? { "x-osmo-auth": freshToken } : {}),
              "x-retry-after-refresh": "true", // Prevent infinite loop
            },
          },
          options,
        );
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError);
        toast.error("Session expired", {
          description: "Please refresh the page to log in again.",
          duration: Infinity,
          id: "session-expired",
          action: {
            label: "Refresh",
            onClick: () => window.location.reload(),
          },
        });
        throw createApiError(
          "Session expired. Please refresh the page to log in again.",
          response.status,
          false,
        );
      }
    }

    // If retry failed or server-side, throw error
    const errorMessage = response.status === 401 ? "Authentication required" : "Access forbidden";
    throw createApiError(errorMessage, response.status, false);
  }

  // Handle redirect responses (3xx) - API endpoints should not redirect
  // Wraps error in createApiError for consistent error handling
  try {
    handleRedirectResponse(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createApiError(message, response.status, false);
  }

  // Helper to safely parse error response (may be HTML for 404s, etc.)
  const parseErrorResponse = async (res: Response): Promise<{ message?: string; detail?: string }> => {
    const fallback = { message: `HTTP ${res.status}: ${res.statusText}` };
    try {
      const text = await res.text();
      if (!text) return fallback;
      return JSON.parse(text);
    } catch {
      return fallback;
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

  // Check Content-Type to determine how to parse the response
  const contentType = response.headers.get("content-type");

  // If Content-Type is text/plain, return the text directly
  if (contentType?.includes("text/plain")) {
    return text as T;
  }

  // Otherwise, parse as JSON (default behavior)
  return JSON.parse(text);
};
