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
 *
 * Authentication is fully delegated to Envoy + OAuth2 Proxy:
 * - Production: Envoy validates session cookie and injects Authorization header
 * - Local dev: _osmo_session cookie is forwarded to prod Envoy via Next.js proxy
 * - On 401: page reload triggers Envoy -> OAuth2 Proxy -> IDP re-login
 */

import { toast } from "sonner";
import { getBasePathUrl } from "@/lib/config";
import { handleRedirectResponse } from "@/lib/api/handle-redirect";

interface RequestConfig {
  url: string;
  method: string;
  headers?: HeadersInit;
  data?: unknown;
  params?: Record<string, unknown>;
  signal?: AbortSignal;
}

// =============================================================================
// API Error
// =============================================================================

const API_ERROR_BRAND = Symbol("ApiError");

export interface ApiError extends Error {
  readonly [API_ERROR_BRAND]: true;
  readonly status?: number;
  readonly isRetryable: boolean;
}

export function createApiError(message: string, status?: number, isRetryable = true): ApiError {
  const error = new Error(message) as ApiError;
  error.name = "ApiError";
  (error as { [API_ERROR_BRAND]: true })[API_ERROR_BRAND] = true;
  (error as { status?: number }).status = status;
  (error as { isRetryable: boolean }).isRetryable = isRetryable;
  return error;
}

export function isApiError(error: unknown): error is ApiError {
  return (
    error !== null &&
    typeof error === "object" &&
    API_ERROR_BRAND in error &&
    (error as { [API_ERROR_BRAND]: unknown })[API_ERROR_BRAND] === true
  );
}

// =============================================================================
// Fetcher
// =============================================================================

export const customFetch = async <T>(config: RequestConfig, options?: RequestInit): Promise<T> => {
  const { url, method, headers, data, params, signal } = config;

  let fullUrl = url;

  let serverAuthHeaders: HeadersInit = {};
  if (typeof window === "undefined" && fullUrl.startsWith("/")) {
    const { getServerApiBaseUrl, getServerFetchHeaders } = await import("@/lib/api/server/config");
    const baseUrl = getServerApiBaseUrl();
    fullUrl = `${baseUrl}${fullUrl}`;
    serverAuthHeaders = await getServerFetchHeaders();
  } else {
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

  let response: Response;

  try {
    response = await fetch(fullUrl, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...serverAuthHeaders,
        ...headers,
      },
      body: data ? JSON.stringify(data) : undefined,
      signal,
      credentials: "include",
      ...options,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Network error";
    throw createApiError(`Network error: ${message}`, 0, false);
  }

  if (response.status === 401) {
    if (typeof window !== "undefined") {
      toast.error("Session expired", {
        description: "Please refresh to re-authenticate.",
        duration: Infinity,
        id: "session-expired",
        action: {
          label: "Refresh",
          onClick: () => window.location.reload(),
        },
      });
    }
    throw createApiError("Authentication required", 401, false);
  }

  if (response.status === 403) {
    throw createApiError("Access forbidden", 403, false);
  }

  try {
    handleRedirectResponse(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createApiError(message, response.status, false);
  }

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

  if (response.status >= 400 && response.status < 500) {
    const error = await parseErrorResponse(response);
    throw createApiError(error.message || error.detail || `HTTP ${response.status}`, response.status, false);
  }

  if (!response.ok) {
    const error = await parseErrorResponse(response);
    throw createApiError(error.message || error.detail || `HTTP ${response.status}`, response.status, true);
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  const contentType = response.headers.get("content-type");

  if (contentType?.includes("text/plain")) {
    return text as T;
  }

  return JSON.parse(text);
};
