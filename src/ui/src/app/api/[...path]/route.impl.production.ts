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
 * Dynamic API Proxy Route Handler (Production Build)
 *
 * PRODUCTION VERSION - ZERO MOCK CODE
 *
 * Proxies ALL /api/* requests to the backend API at RUNTIME.
 * This replaces the build-time rewrite in next.config.ts.
 *
 * Benefits:
 * - Backend hostname configurable at RUNTIME (not build time)
 * - Single Docker image works for all environments
 * - Perfect for open source - users set hostname via env var
 *
 * Authentication Flow:
 * - In production: Envoy injects Authorization and x-osmo-user headers
 * - In local dev: Forwards any auth headers from client
 * - This proxy simply forwards headers to backend
 *
 * This catches all /api/* routes EXCEPT:
 * - /api/health - Handled by app/api/health/route.ts
 *
 * Route Handlers have higher priority than catch-all routes, so they work correctly.
 */

import { type NextRequest } from "next/server";
import { getServerApiBaseUrl } from "@/lib/api/server/config";
import { forwardAuthHeaders } from "@/lib/api/server/proxy-headers";

// Force dynamic rendering - this is a proxy route, never static
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Hop-by-hop headers that MUST NOT be forwarded (RFC 9110 §7.6.1, HTTP/2 §8.1)
// ---------------------------------------------------------------------------
const HOP_BY_HOP_HEADERS = new Set([
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "proxy-connection",
  "te",
]);

// ---------------------------------------------------------------------------
// Client request headers worth forwarding for content-negotiation & streaming
// ---------------------------------------------------------------------------
const FORWARDED_REQUEST_HEADERS = ["accept", "accept-encoding", "accept-language"] as const;

/**
 * Proxy all API requests to backend.
 * Supports: GET, POST, PUT, PATCH, DELETE
 *
 * Streaming-aware: propagates the client abort signal to the upstream fetch
 * so that long-lived streams (logs, events) are torn down promptly when the
 * browser disconnects. This prevents orphaned connections from accumulating
 * on the backend and exhausting HTTP/2 stream limits at the ALB.
 */
async function proxyRequest(request: NextRequest, method: string) {
  const { pathname, searchParams } = request.nextUrl;

  // Build backend URL
  // pathname is like: /api/workflow
  // We forward as-is to backend: http://backend/api/workflow
  const backendUrl = getServerApiBaseUrl();
  const backendPath = pathname; // Already has /api prefix
  const queryString = searchParams.toString();
  const fullUrl = queryString ? `${backendUrl}${backendPath}?${queryString}` : `${backendUrl}${backendPath}`;

  // Forward auth headers using centralized utility
  const headers = forwardAuthHeaders(request);

  // Forward content-negotiation headers so backend can respond appropriately
  // (e.g., Accept: text/plain for streaming log/event endpoints)
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  // Also forward content-type for POST/PUT/PATCH requests
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }

  // Forward request body for POST/PUT/PATCH
  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await request.text();
    } catch {
      // No body or already consumed
    }
  }

  try {
    // Proxy request to backend.
    // CRITICAL: propagate the client's abort signal so that when the browser
    // disconnects (tab close, navigation, component unmount), the upstream
    // connection is torn down immediately. Without this, orphaned upstream
    // connections accumulate and can exhaust HTTP/2 stream limits at the
    // ALB, causing GOAWAY frames that kill unrelated long-lived streams.
    const response = await fetch(fullUrl, {
      method,
      headers,
      body,
      signal: request.signal,
      // Don't follow redirects - let client handle them
      redirect: "manual",
    });

    // Forward response headers from backend as-is (transparent proxy)
    const responseHeaders = new Headers();

    // Copy all headers from backend response, skipping hop-by-hop headers
    response.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    // Disable buffering in upstream proxies (Nginx, Envoy, ALB).
    // Without this, intermediaries may buffer the entire response before
    // forwarding, which breaks streaming for log/event endpoints.
    responseHeaders.set("X-Accel-Buffering", "no");

    // Prevent caching of proxied API responses by CDNs or shared caches.
    // Individual endpoints can override via their own Cache-Control header
    // (already copied above), but this ensures a safe default.
    if (!responseHeaders.has("cache-control")) {
      responseHeaders.set("Cache-Control", "no-store");
    }

    // Stream response body directly (zero-copy proxying)
    // This reduces latency and memory usage by not buffering the entire response
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    // Suppress AbortError when client disconnected — this is expected
    if (error instanceof Error && error.name === "AbortError") {
      return new Response(null, { status: 499 }); // nginx-style "client closed request"
    }

    console.error("API proxy error:", error);
    return new Response(
      JSON.stringify({
        error: "Backend API unreachable",
        message: error instanceof Error ? error.message : "Unknown error",
        backend: backendUrl,
      }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      },
    );
  }
}

// HTTP method handlers
export async function GET(request: NextRequest) {
  return proxyRequest(request, "GET");
}

export async function POST(request: NextRequest) {
  return proxyRequest(request, "POST");
}

export async function PUT(request: NextRequest) {
  return proxyRequest(request, "PUT");
}

export async function PATCH(request: NextRequest) {
  return proxyRequest(request, "PATCH");
}

export async function DELETE(request: NextRequest) {
  return proxyRequest(request, "DELETE");
}

export async function HEAD(request: NextRequest) {
  return proxyRequest(request, "HEAD");
}

export async function OPTIONS(_request: NextRequest) {
  // Handle CORS preflight
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-osmo-auth, x-osmo-user",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
