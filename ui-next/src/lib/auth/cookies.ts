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
 * ALB Sticky Session Cookie Management
 *
 * AWS Application Load Balancer (ALB) uses sticky session cookies to ensure
 * WebSocket connections route to the same backend node that created the session.
 *
 * The exec/portforward API returns these cookies in the response, and they must
 * be set in the browser before creating the WebSocket connection.
 */

/**
 * Set ALB sticky session cookies from exec/portforward API response.
 *
 * The backend returns two comma-separated cookies:
 * - AWSALB: Primary ALB sticky cookie
 * - AWSALBCORS: CORS-compatible ALB sticky cookie
 *
 * These cookies ensure the WebSocket connects to the same ALB backend node
 * that holds the exec/portforward session. Without them, the connection may
 * route to a different node, causing a 60-second timeout.
 *
 * @param cookie - Comma-separated cookie strings from API response (e.g., "AWSALB=..., AWSALBCORS=...")
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
  // Cookie string format: "AWSALB=..., AWSALBCORS=..."
  const parts = cookie.split(", ");

  if (parts.length === 2 && typeof document !== "undefined") {
    // Set AWSALB cookie
    document.cookie = `${parts[0]}${domain ? `; domain=.${domain}` : ""}; max-age=10`;

    // Set AWSALBCORS cookie
    document.cookie = `${parts[1]}${domain ? `; domain=.${domain}` : ""}; max-age=10`;
  }
}
