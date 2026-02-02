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
 * Dynamic API Proxy Route Handler
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

  // Forward headers from incoming request
  const headers = new Headers();

  // Copy important headers
  // In production: Envoy injects authorization, x-osmo-user, etc.
  // In local dev: Client may send x-osmo-auth or other headers
  const headersToForward = [
    "content-type",
    "authorization", // Envoy adds this with valid JWT
    "x-osmo-auth", // Used in local dev
    "x-osmo-user", // Envoy adds this (username)
    "x-osmo-roles", // If configured in Envoy
    "cookie", // Includes Envoy session cookie
  ];

  headersToForward.forEach((header) => {
    const value = request.headers.get(header);
    if (value) {
      headers.set(header, value);
    }
  });

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

    // Forward response headers
    const responseHeaders = new Headers();

    // Copy all headers from backend response
    response.headers.forEach((value, key) => {
      // Skip headers that cause issues
      if (!["transfer-encoding", "connection", "keep-alive"].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    // Add cache control headers to prevent caching
    responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
    responseHeaders.set("Pragma", "no-cache");
    responseHeaders.set("Expires", "0");

    // Forward response body
    const responseBody = await response.arrayBuffer();

    return new Response(responseBody, {
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
