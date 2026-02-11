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
 * Dynamic API Proxy Route Handler (Development Build)
 *
 * Development version with mock mode support.
 * In production builds, route.ts imports route.impl.production.ts instead (ZERO mock code).
 *
 * IMPORTANT: We use @/ absolute imports so Turbopack resolveAlias can work properly.
 */

// Re-export all production functionality
export * from "@/app/api/[...path]/route.impl.production";

// Import production implementation for composition
import {
  GET as prodGET,
  POST as prodPOST,
  PUT as prodPUT,
  PATCH as prodPATCH,
  DELETE as prodDELETE,
  HEAD as prodHEAD,
  OPTIONS as prodOPTIONS,
} from "@/app/api/[...path]/route.impl.production";

import { type NextRequest } from "next/server";
import { forwardAuthHeaders } from "@/lib/api/server/proxy-headers";
import http from "node:http";

/**
 * Mock Mode Handler (Development Only)
 *
 * MSW doesn't reliably intercept Next.js 15's undici-based globalThis.fetch,
 * but DOES intercept Node.js http.request reliably.
 *
 * See: https://github.com/mswjs/msw/issues/2165#issuecomment-2260578257
 * "MSW supports global fetch in Node.js" but Next.js's undici bypasses it.
 *
 * STREAMING SUPPORT:
 * Responses are streamed (not buffered) so that long-lived/infinite log
 * streams don't accumulate open connections on MSW's MockHttpSocket. Without
 * streaming, each request holds a `connect` listener until `res.end`, which
 * never fires for infinite streams, causing MaxListenersExceededWarning.
 */
function handleMockModeRequest(
  request: NextRequest,
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  return new Promise((resolve) => {
    const queryString = searchParams.toString();
    const path = queryString ? `${pathname}?${queryString}` : pathname;

    // Use Node.js http module on non-existent port
    // MSW intercepts http.request before connection attempt

    // Build headers object
    const headers: Record<string, string> = {};
    forwardAuthHeaders(request).forEach((value, key) => {
      headers[key] = value;
    });

    const options: http.RequestOptions = {
      hostname: "localhost",
      port: 9999,
      path,
      method,
      headers,
    };

    const req = http.request(options, (res) => {
      const responseHeaders = new Headers();

      // Copy response headers
      Object.entries(res.headers).forEach(([key, value]) => {
        if (value) {
          responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
      });

      // Stream the response body instead of buffering it.
      // This prevents long-lived streams from holding open connections
      // and accumulating event listeners on MockHttpSocket.
      const stream = new ReadableStream({
        start(controller) {
          res.on("data", (chunk: Buffer) => {
            try {
              controller.enqueue(new Uint8Array(chunk));
            } catch {
              // Controller closed (client disconnected), destroy the upstream
              res.destroy();
            }
          });
          res.on("end", () => {
            try {
              controller.close();
            } catch {
              // Already closed
            }
          });
          res.on("error", (err) => {
            try {
              controller.error(err);
            } catch {
              // Already closed
            }
          });
        },
        cancel() {
          // Client disconnected: tear down the upstream http response
          // so MSW's MockHttpSocket releases its listeners
          res.destroy();
          req.destroy();
        },
      });

      resolve(
        new Response(stream, {
          status: res.statusCode ?? 200,
          statusText: res.statusMessage,
          headers: responseHeaders,
        }),
      );
    });

    req.on("error", (error) => {
      // Suppress ECONNRESET from intentional abort teardown
      if ((error as NodeJS.ErrnoException).code === "ECONNRESET") return;

      // MSW didn't intercept
      console.error("[Mock Mode] MSW interception failed:", error.message);
      resolve(
        new Response(
          JSON.stringify({
            error: "MSW interception failed",
            message: `MSW did not intercept http.request. Error: ${error.message}`,
            path: pathname,
            hint: "Ensure instrumentation.ts started MSW server successfully",
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    });

    // Propagate client abort to the upstream request so MSW can clean up.
    // Without this, navigating away leaves orphaned connections on MockHttpSocket.
    if (request.signal) {
      if (request.signal.aborted) {
        req.destroy();
        return;
      }
      request.signal.addEventListener(
        "abort",
        () => {
          req.destroy();
        },
        { once: true },
      );
    }

    // Send request body for POST/PUT/PATCH
    if (method !== "GET" && method !== "HEAD") {
      request
        .text()
        .then((body) => {
          if (body) req.write(body);
          req.end();
        })
        .catch(() => req.end());
    } else {
      req.end();
    }
  });
}

/**
 * Wrap production handler with mock mode check
 */
function withMockMode(prodHandler: (request: NextRequest) => Promise<Response>, method: string) {
  return async (request: NextRequest) => {
    // Check if mock mode is active
    const mockMode = process.env.NEXT_PUBLIC_MOCK_API === "true";

    if (mockMode) {
      const { pathname, searchParams } = request.nextUrl;
      return handleMockModeRequest(request, method, pathname, searchParams);
    }

    // Normal mode: delegate to production handler
    return prodHandler(request);
  };
}

// Override exports with mock-aware handlers
export const GET = withMockMode(prodGET, "GET");
export const POST = withMockMode(prodPOST, "POST");
export const PUT = withMockMode(prodPUT, "PUT");
export const PATCH = withMockMode(prodPATCH, "PATCH");
export const DELETE = withMockMode(prodDELETE, "DELETE");
export const HEAD = withMockMode(prodHEAD, "HEAD");
export const OPTIONS = prodOPTIONS; // CORS doesn't need mock handling
