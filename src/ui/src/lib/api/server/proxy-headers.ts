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
 * Centralized proxy header handling for Next.js Route Handlers.
 *
 * Authentication flow:
 * - Production: Envoy injects Authorization header (via OAuth2 Proxy ext_authz)
 * - Local dev: _osmo_session cookie is forwarded to prod Envoy for validation
 *
 * Only these headers are forwarded to the backend:
 * - authorization: Bearer token from Envoy (production auth)
 * - cookie: Session cookies including _osmo_session (dev auth via prod Envoy)
 */

import type { NextRequest } from "next/server";

const HEADERS_TO_FORWARD = ["authorization", "cookie"] as const;

/**
 * Create Headers object with auth headers forwarded from the incoming request.
 */
export function forwardAuthHeaders(request: NextRequest, additionalHeaders?: HeadersInit): Headers {
  const headers = new Headers(additionalHeaders);

  for (const headerName of HEADERS_TO_FORWARD) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return headers;
}

/**
 * Check if a request has any auth headers present.
 */
export function hasAuthHeaders(request: NextRequest): boolean {
  return HEADERS_TO_FORWARD.some((headerName) => request.headers.has(headerName));
}
