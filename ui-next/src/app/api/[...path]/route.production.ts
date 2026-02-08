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
 * - /api/workflow/[name]/logs - Handled by app/api/workflow/[name]/logs/route.ts
 *
 * Route Handlers have higher priority than catch-all routes, so they work correctly.
 */

import { type NextRequest } from "next/server";
import { getServerApiBaseUrl } from "@/lib/api/server/config";
import { forwardAuthHeaders } from "@/lib/api/server/proxy-headers";

// Force dynamic rendering - this is a proxy route, never static
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Proxy all API requests to backend.
 * Supports: GET, POST, PUT, PATCH, DELETE
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
    // Proxy request to backend
    const response = await fetch(fullUrl, {
      method,
      headers,
      body,
      // Don't follow redirects - let client handle them
      redirect: "manual",
    });

    // Forward response headers from backend as-is (transparent proxy)
    const responseHeaders = new Headers();

    // Copy all headers from backend response
    response.headers.forEach((value, key) => {
      // Skip headers that cause issues with streaming
      if (!["transfer-encoding", "connection", "keep-alive"].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    // Stream response body directly (zero-copy proxying)
    // This reduces latency and memory usage by not buffering the entire response
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
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
