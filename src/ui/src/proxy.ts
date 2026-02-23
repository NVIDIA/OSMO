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
 * Next.js Proxy -- Security headers + auth header injection.
 *
 * In production, Envoy injects x-osmo-user / x-osmo-roles before the request
 * reaches Next.js. In local dev (no Envoy), this proxy reads the JWT from
 * IdToken/BearerToken cookies and injects the same headers so server components
 * behave identically.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const apiHostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "localhost:8080";
const scheme = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false" ? "https" : "http";
const apiUrl = `${scheme}://${apiHostname}`;

const csp = [
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
  ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
].join("; ");

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

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractRoles(claims: Record<string, unknown>): string[] {
  if (Array.isArray(claims.roles)) {
    return claims.roles.filter((r): r is string => typeof r === "string");
  }
  const realmAccess = claims.realm_access;
  if (realmAccess && typeof realmAccess === "object" && "roles" in realmAccess) {
    const roles = (realmAccess as { roles?: unknown }).roles;
    if (Array.isArray(roles)) {
      return roles.filter((r): r is string => typeof r === "string");
    }
  }
  return [];
}

/**
 * Inject x-osmo-user / x-osmo-roles from JWT cookie when Envoy headers are absent.
 * Returns modified headers, or null if no injection needed.
 */
function injectAuthHeaders(request: NextRequest): Headers | null {
  if (request.headers.get("x-osmo-user")) return null;

  const token = request.cookies.get("IdToken")?.value ?? request.cookies.get("BearerToken")?.value;
  if (!token) return null;

  const claims = decodeJwtPayload(token);
  if (!claims) return null;

  const username = typeof claims.preferred_username === "string" ? claims.preferred_username : null;
  if (!username) return null;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-osmo-user", username);

  const roles = extractRoles(claims);
  if (roles.length > 0) {
    requestHeaders.set("x-osmo-roles", roles.join(","));
  }

  return requestHeaders;
}

export function proxy(request: NextRequest): NextResponse {
  const injectedHeaders = injectAuthHeaders(request);

  const response = injectedHeaders ? NextResponse.next({ request: { headers: injectedHeaders } }) : NextResponse.next();

  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", permissionsPolicy);

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
