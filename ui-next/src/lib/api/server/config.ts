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
 * Server-Side API Configuration
 *
 * Configuration for server-side data fetching.
 * These values are used by all server fetch functions.
 */

// =============================================================================
// Environment Configuration
// =============================================================================

/**
 * Get the backend API base URL for server-side requests.
 *
 * On the server, we connect directly to the backend (no proxy needed).
 * This uses the same env vars as the client config.
 *
 * MOCK MODE: In mock mode + dev mode + no explicit hostname, returns localhost:PORT
 * to allow MSW server instrumentation to intercept requests. Otherwise uses configured hostname.
 */
export function getServerApiBaseUrl(): string {
  const hostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME;
  const mockMode = process.env.NEXT_PUBLIC_MOCK_API === "true";
  const devMode = process.env.NODE_ENV === "development";

  // Use localhost ONLY if: mock mode + dev mode + no explicit hostname
  if (mockMode && devMode && !hostname) {
    const port = process.env.PORT || "3000";
    return `http://localhost:${port}`;
  }

  // Otherwise use configured hostname (or default)
  const actualHostname = hostname || "localhost:8080";
  const sslEnabled = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false";

  // Default: disable SSL for localhost, enable for everything else
  const isLocalhost = actualHostname.startsWith("localhost") || actualHostname.startsWith("127.0.0.1");
  const useSSL = sslEnabled && !isLocalhost;

  const scheme = useSSL ? "https" : "http";
  return `${scheme}://${actualHostname}`;
}

// =============================================================================
// Auth Headers
// =============================================================================

const AUTH_HEADER = "x-osmo-auth";
const ID_TOKEN_KEY = "IdToken";
const BEARER_TOKEN_KEY = "BearerToken";

/**
 * Get auth token from cookies for server-side requests.
 *
 * This reads the auth token from the incoming request cookies
 * and forwards it to the backend API.
 */
export async function getServerAuthToken(): Promise<string | null> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  return cookieStore.get(ID_TOKEN_KEY)?.value || cookieStore.get(BEARER_TOKEN_KEY)?.value || null;
}

/**
 * Build headers for server-side API requests.
 *
 * Auth flow:
 * - Production: Envoy injects Authorization, x-osmo-user, x-osmo-roles headers
 * - Local dev: Uses cookies (IdToken/BearerToken) if available
 *
 * This function forwards ALL auth-related headers to match the proxy route handler behavior.
 * IMPORTANT: This must forward the same headers as forwardAuthHeaders() in proxy-headers.ts
 */
export async function getServerFetchHeaders(): Promise<HeadersInit> {
  const { headers: getHeaders } = await import("next/headers");
  const requestHeaders = await getHeaders();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Forward all Envoy-injected headers (production)
  const authHeader = requestHeaders.get("Authorization");
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  const osmoUser = requestHeaders.get("x-osmo-user");
  if (osmoUser) {
    headers["x-osmo-user"] = osmoUser;
  }

  const osmoRoles = requestHeaders.get("x-osmo-roles");
  if (osmoRoles) {
    headers["x-osmo-roles"] = osmoRoles;
  }

  // Forward cookie header (includes Envoy session)
  const cookieHeader = requestHeaders.get("cookie");
  if (cookieHeader) {
    headers["cookie"] = cookieHeader;
  }

  // Fallback: Check for auth in cookies (local dev without Envoy)
  if (!authHeader) {
    const token = await getServerAuthToken();
    if (token) {
      headers[AUTH_HEADER] = token;
    }
  }

  return headers;
}

// =============================================================================
// Fetch Options
// =============================================================================

/**
 * Options for server-side fetch functions.
 */
export interface ServerFetchOptions {
  /**
   * Revalidation time in seconds.
   * - 0: Always revalidate (dynamic)
   * - N: Cache for N seconds (ISR)
   * - false: Never revalidate (static)
   *
   * Default: 60 (1 minute)
   */
  revalidate?: number | false;

  /**
   * Cache tags for on-demand revalidation.
   * Use with `revalidateTag()` in Server Actions.
   */
  tags?: string[];
}

/**
 * Default revalidation time (1 minute).
 * This provides a good balance between freshness and performance.
 */
export const DEFAULT_REVALIDATE = 60;

/**
 * Revalidation time for expensive/slow queries (5 minutes).
 */
export const EXPENSIVE_REVALIDATE = 300;

// =============================================================================
// Error Handling
// =============================================================================

/**
 * Server-side API error.
 */
export class ServerApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public url: string,
  ) {
    super(message);
    this.name = "ServerApiError";
  }
}

/**
 * Handle API response, throwing on error.
 */
export async function handleResponse<T>(response: Response, url: string): Promise<T> {
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new ServerApiError(`API request failed: ${errorText}`, response.status, url);
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text);
}
