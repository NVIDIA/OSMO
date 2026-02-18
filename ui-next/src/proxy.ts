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
 * Security headers proxy. Adds CSP, X-Frame-Options, etc. to all responses.
 *
 * @see https://nextjs.org/docs/app/building-your-application/routing/proxy
 */

import { NextResponse } from "next/server";

const apiHostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "localhost:8080";
const sslEnabled = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false";
const scheme = sslEnabled ? "https" : "http";
const apiUrl = `${scheme}://${apiHostname}`;

/** Build CSP with security headers. */
function buildCSP(): string {
  const cspDirectives = [
    "default-src 'self'",
    // unsafe-inline/eval required by Next.js
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
    ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ];

  return cspDirectives.join("; ");
}

const permissionsPolicy = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

export function proxy() {
  const response = NextResponse.next();

  response.headers.set("Content-Security-Policy", buildCSP());
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", permissionsPolicy);

  return response;
}

export const config = {
  matcher: [
    // Exclude: API routes, Next.js internals, static assets
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
