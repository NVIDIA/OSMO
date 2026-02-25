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
 * Server-Side API Configuration (Production Build)
 *
 * Authentication is handled by Envoy + OAuth2 Proxy. This module forwards
 * the Authorization header and cookies from the incoming request to the backend.
 */

// =============================================================================
// Environment Configuration
// =============================================================================

export function getServerApiBaseUrl(): string {
  const hostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME;

  const actualHostname = hostname || "localhost:8080";
  const sslEnabled = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false";

  const isLocalhost = actualHostname.startsWith("localhost") || actualHostname.startsWith("127.0.0.1");
  const useSSL = sslEnabled && !isLocalhost;

  const scheme = useSSL ? "https" : "http";
  return `${scheme}://${actualHostname}`;
}

// =============================================================================
// Auth Headers
// =============================================================================

/**
 * Build headers for server-side API requests.
 *
 * Forwards Authorization (from Envoy) and cookie (for dev session) headers
 * from the incoming request to the backend API.
 */
export async function getServerFetchHeaders(): Promise<HeadersInit> {
  const { headers: getHeaders } = await import("next/headers");
  const requestHeaders = await getHeaders();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const authHeader = requestHeaders.get("authorization");
  if (authHeader) {
    headers["authorization"] = authHeader;
  }

  const cookieHeader = requestHeaders.get("cookie");
  if (cookieHeader) {
    headers["cookie"] = cookieHeader;
  }

  return headers;
}

// =============================================================================
// Fetch Options
// =============================================================================

export interface ServerFetchOptions {
  revalidate?: number | false;
  tags?: string[];
}

export const DEFAULT_REVALIDATE = 60;

export const EXPENSIVE_REVALIDATE = 300;

// =============================================================================
// Error Handling
// =============================================================================

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
