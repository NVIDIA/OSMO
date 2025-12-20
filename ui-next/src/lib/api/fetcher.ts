/**
 * Custom fetcher for orval-generated API client.
 * Handles authentication, token refresh, and error responses.
 */

import { getAuthToken, refreshToken, isTokenExpiringSoon } from "@/lib/auth";
import { TOKEN_REFRESH_THRESHOLD_SECONDS } from "@/lib/config";

interface RequestConfig {
  url: string;
  method: string;
  headers?: HeadersInit;
  data?: unknown;
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

/**
 * API error with retry information.
 */
export class ApiError extends Error {
  status?: number;
  isRetryable: boolean;

  constructor(message: string, status?: number, isRetryable = true) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.isRetryable = isRetryable;
  }
}

// Prevent concurrent refresh attempts
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

/**
 * Ensure we have a valid token, refreshing if needed.
 */
async function ensureValidToken(): Promise<string> {
  let token = getAuthToken();
  
  // If token is missing or expiring soon, try to refresh
  if (!token || isTokenExpiringSoon(token, TOKEN_REFRESH_THRESHOLD_SECONDS)) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = refreshToken();
    }
    
    if (refreshPromise) {
      const newToken = await refreshPromise;
      isRefreshing = false;
      refreshPromise = null;
      
      if (newToken) {
        token = newToken;
      }
    }
  }
  
  return token;
}

export const customFetch = async <T>(
  config: RequestConfig,
  options?: RequestInit
): Promise<T> => {
  const { url, method, headers, data, params, signal } = config;

  // Build URL with query params
  let fullUrl = url;
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
      fullUrl = `${url}?${queryString}`;
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
        ...(authToken ? { "x-osmo-auth": authToken } : {}),
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
    throw new ApiError(`Network error: ${message}`, 0, false);
  }

  // Handle auth errors - try to refresh token once
  if (response.status === 401 || response.status === 403) {
    // Only attempt refresh if we're not already refreshing
    if (!isRefreshing) {
      isRefreshing = true;
      const newToken = await refreshToken();
      isRefreshing = false;

      if (newToken) {
        // Retry the request with the new token
        const retryResponse = await fetch(fullUrl, {
          method,
          headers: {
            "Content-Type": "application/json",
            "x-osmo-auth": newToken,
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
    }

    throw new ApiError(
      `Authentication required (${response.status})`,
      response.status,
      false
    );
  }

  // Handle other client errors (4xx) - NOT retryable
  if (response.status >= 400 && response.status < 500) {
    const error = await response.json().catch(() => ({ message: "Request failed" }));
    throw new ApiError(
      error.message || error.detail || `HTTP ${response.status}`,
      response.status,
      false
    );
  }

  // Handle server errors (5xx) - retryable
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Server error" }));
    throw new ApiError(
      error.message || error.detail || `HTTP ${response.status}`,
      response.status,
      true
    );
  }

  // Handle empty responses (204 No Content, etc.)
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text);
};
