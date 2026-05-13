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
 * Cookie Utilities
 *
 * Handles both reading cookies (for auth tokens) and writing cookies (for ALB sticky sessions).
 */

// =============================================================================
// Reading Cookies
// =============================================================================

/**
 * Get a cookie value by name. Handles values containing "=" (e.g., base64 JWTs).
 */
export function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;

  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    const separatorIndex = cookie.indexOf("=");
    if (separatorIndex === -1) continue;

    const cookieName = cookie.slice(0, separatorIndex);
    if (cookieName === name) {
      return cookie.slice(separatorIndex + 1);
    }
  }

  return null;
}

// =============================================================================
// Router Sticky Session Cookie Management
// =============================================================================

/**
 * The router gateway uses sticky session cookies to ensure
 * WebSocket connections route to the same backend node that created the session.
 *
 * The exec/portforward API returns these cookies in the response, and they must
 * be set in the browser before creating the WebSocket connection.
 */

/**
 * Set router sticky session cookies from exec/portforward API response.
 *
 * These cookies ensure the WebSocket connects to the same router replica that
 * holds the exec/portforward session. Without them, the connection may route
 * to a different replica, causing a 60-second timeout.
 *
 * @param cookie - Comma-separated cookie strings from API response
 * @param domain - Optional domain for cookie scope (e.g., ".example.com")
 *
 * @example
 * ```ts
 * const response = await execMutation.mutateAsync({ ... });
 * updateALBCookies(response.cookie); // Set cookies before WebSocket
 * const ws = new WebSocket(wsUrl);   // WebSocket now routes correctly
 * ```
 *
 * Cookie expiry is short (10 seconds) since they're only needed for the
 * initial WebSocket handshake. After that, the WebSocket connection is
 * established and sticky session is maintained by the connection itself.
 */
export function updateALBCookies(cookie: string, domain?: string): void {
  const parts = cookie
    .split(/,\s*(?=[^;,=\s]+=)/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (typeof document === "undefined") return;

  for (const part of parts) {
    document.cookie = `${part}${domain ? `; domain=.${domain}` : ""}; max-age=10`;
  }
}
