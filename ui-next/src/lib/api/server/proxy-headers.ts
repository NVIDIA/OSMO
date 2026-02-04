//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Centralized proxy header handling for Next.js Route Handlers.
 *
 * This module provides utilities for forwarding authentication and other
 * headers from incoming requests to backend API calls.
 *
 * Authentication Flow:
 * - Production: Envoy injects Authorization header with Bearer token
 * - Local dev: Uses x-osmo-auth header with token from cookies/localStorage
 * - All proxy routes should use these utilities for consistent auth handling
 */

import type { NextRequest } from "next/server";

/**
 * Headers that should be forwarded from client to backend.
 *
 * These headers are critical for authentication and request context:
 * - authorization: Envoy-injected Bearer token (production)
 * - x-osmo-auth: Local dev auth token
 * - x-osmo-user: Envoy-injected username
 * - x-osmo-roles: Envoy-injected user roles
 * - cookie: Session cookies (includes Envoy session)
 */
const AUTH_HEADERS_TO_FORWARD = ["authorization", "x-osmo-auth", "x-osmo-user", "x-osmo-roles", "cookie"] as const;

/**
 * Create Headers object with all auth headers forwarded from the incoming request.
 *
 * This centralizes the logic for forwarding authentication headers,
 * ensuring consistency across all proxy route handlers.
 *
 * @param request - The incoming Next.js request
 * @param additionalHeaders - Optional additional headers to include
 * @returns Headers object ready for backend fetch
 *
 * @example
 * ```ts
 * const headers = forwardAuthHeaders(request, { Accept: "text/plain" });
 * const response = await fetch(backendUrl, { headers });
 * ```
 */
export function forwardAuthHeaders(request: NextRequest, additionalHeaders?: HeadersInit): Headers {
  const headers = new Headers(additionalHeaders);

  // Forward all auth-related headers
  for (const headerName of AUTH_HEADERS_TO_FORWARD) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return headers;
}

/**
 * Check if a request appears to be authenticated.
 *
 * This is a best-effort check based on the presence of auth headers.
 * It doesn't validate tokens, just checks if auth info is present.
 *
 * @param request - The incoming Next.js request
 * @returns true if any auth header is present
 */
export function hasAuthHeaders(request: NextRequest): boolean {
  return AUTH_HEADERS_TO_FORWARD.some((headerName) => request.headers.has(headerName));
}
