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
 * Next.js Proxy for Security Headers
 *
 * Adds Content Security Policy (CSP) and other security headers to all responses.
 * This runs in the Node.js runtime.
 *
 * Security headers implemented:
 * - Content-Security-Policy: Prevents XSS and injection attacks
 * - X-Content-Type-Options: Prevents MIME-type sniffing
 * - X-Frame-Options: Prevents clickjacking
 * - Referrer-Policy: Controls referrer information
 * - Permissions-Policy: Restricts browser features
 *
 * @see https://nextjs.org/docs/app/building-your-application/routing/proxy
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// =============================================================================
// Auth Token Validation
// =============================================================================

const ID_TOKEN_KEY = "IdToken";
const BEARER_TOKEN_KEY = "BearerToken";
const AUTH_SKIPPED_KEY = "osmo_auth_skipped";

/**
 * Lightweight JWT expiry check (no crypto validation - that's for the backend).
 * We just check if the token exists and isn't expired.
 */
function isTokenExpired(token: string): boolean {
  try {
    const [, payloadB64] = token.split(".");
    if (!payloadB64) return true;

    // Handle URL-safe base64
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64));

    if (!payload.exp) return false; // No expiry = never expires

    // Add 30 second buffer for clock skew
    return payload.exp * 1000 < Date.now() - 30000;
  } catch {
    return true; // Invalid token format = treat as expired
  }
}

/**
 * Get token from cookies (checks both IdToken and BearerToken).
 */
function getTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(ID_TOKEN_KEY)?.value || request.cookies.get(BEARER_TOKEN_KEY)?.value || null;
}

/**
 * Check if auth was skipped via cookie (for development/demo mode).
 */
function isAuthSkipped(request: NextRequest): boolean {
  return request.cookies.get(AUTH_SKIPPED_KEY)?.value === "true";
}

// =============================================================================
// CSP Configuration
// =============================================================================

// API hostname for connect-src directive
const apiHostname = process.env.NEXT_PUBLIC_OSMO_API_HOSTNAME || "localhost:8080";
const sslEnabled = process.env.NEXT_PUBLIC_OSMO_SSL_ENABLED !== "false";
const scheme = sslEnabled ? "https" : "http";
const apiUrl = `${scheme}://${apiHostname}`;

// Build CSP directives
// Note: 'unsafe-inline' and 'unsafe-eval' are required for Next.js
// In production, consider using nonces for stricter CSP
const cspDirectives = [
  // Default fallback for unspecified directives
  "default-src 'self'",

  // JavaScript sources
  // 'unsafe-inline' required for Next.js inline scripts
  // 'unsafe-eval' required for Next.js development and some production features
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",

  // CSS sources
  // 'unsafe-inline' required for styled-components, emotion, and Tailwind
  "style-src 'self' 'unsafe-inline'",

  // Image sources
  // data: for inline images, blob: for canvas exports
  "img-src 'self' data: blob:",

  // Font sources
  "font-src 'self'",

  // API connections
  // Allow connections to self (same origin) and the configured API backend
  `connect-src 'self' ${apiUrl} ws: wss:`,

  // Web workers
  "worker-src 'self' blob:",

  // Child frames (iframes)
  "frame-src 'self'",

  // Form submissions
  "form-action 'self'",

  // Base URI for relative URLs
  "base-uri 'self'",

  // Object/embed/applet sources (disable for security)
  "object-src 'none'",

  // Upgrade insecure requests in production
  ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
];

const csp = cspDirectives.join("; ");

// Permissions Policy (formerly Feature Policy)
// Restricts access to browser features
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

export function proxy(request: NextRequest) {
  // ==========================================================================
  // Auth Validation (lightweight - full validation done by backend)
  // ==========================================================================

  const { pathname } = request.nextUrl;

  // Skip auth for static assets and auth routes
  const skipAuth =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/auth") ||
    pathname.includes(".");

  if (!skipAuth) {
    const token = getTokenFromRequest(request);
    const authSkipped = isAuthSkipped(request);

    // If token exists and is expired, client-side will attempt refresh
    // We just proceed - AuthProvider handles the actual auth flow
    if (token && isTokenExpired(token)) {
      // Token expired - let client handle refresh
      // Could add X-Token-Expired header for client hint
    }

    // If no token and not skipped, could redirect to login
    // For now, we let AuthProvider handle this client-side
    if (!token && !authSkipped) {
      // Future: Could redirect to /auth/login here for faster auth redirects
    }
  }

  // ==========================================================================
  // Security Headers
  // ==========================================================================

  const response = NextResponse.next();

  // Content Security Policy
  response.headers.set("Content-Security-Policy", csp);

  // Prevent MIME-type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY");

  // Control referrer information
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Restrict browser features
  response.headers.set("Permissions-Policy", permissionsPolicy);

  return response;
}

// Configure which routes the proxy applies to
// Exclude static files, API routes (handled by rewrites), and Next.js internals
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes - handled by proxy/rewrites)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, robots.txt, sitemap.xml (static assets)
     * - public folder files (matched by file extension)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
