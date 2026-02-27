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
 * Next.js Proxy -- Security headers.
 *
 * Authentication is handled entirely by Envoy + OAuth2 Proxy in production.
 * In local dev, the _osmo_session cookie is forwarded to prod Envoy
 * via the Next.js API proxy route handler.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

function buildProductionCsp(): string {
  const apiHostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "localhost:8080";
  const sslEnabled = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false";
  const apiUrl = `${sslEnabled ? "https" : "http"}://${apiHostname}`;

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiUrl} ws: wss:`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(_request: NextRequest): NextResponse {
  const response = NextResponse.next();

  // CSP is only set in production where Envoy proxies everything through the
  // same origin. In local dev the backend runs on a different port/IP and
  // NEXT_PUBLIC_* env vars are not reliably available in the edge runtime,
  // so enforcing CSP would block legitimate direct browser → backend requests.
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Content-Security-Policy", buildProductionCsp());
  }

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", PERMISSIONS_POLICY);

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
