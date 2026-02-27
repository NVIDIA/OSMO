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
 * Dataset Location Files Route — Development Build
 *
 * In mock mode, routes requests through Node.js http.request to localhost:9999
 * so MSW can intercept them (MSW intercepts http.request, not Next.js's undici fetch).
 *
 * Production builds alias this to route.impl.production.ts (zero mock code).
 */

import { GET as prodGET } from "@/app/api/datasets/location-files/route.impl.production";
import type { NextRequest } from "next/server";
import http from "node:http";
import { forwardAuthHeaders } from "@/lib/api/server/proxy-headers";

function handleMockModeRequest(
  request: NextRequest,
  method: string,
  pathname: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  return new Promise((resolve) => {
    const queryString = searchParams.toString();
    const path = queryString ? `${pathname}?${queryString}` : pathname;

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

      Object.entries(res.headers).forEach(([key, value]) => {
        if (value) {
          responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
        }
      });

      const stream = new ReadableStream({
        start(controller) {
          res.on("data", (chunk: Buffer) => {
            try {
              controller.enqueue(new Uint8Array(chunk));
            } catch {
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
      if ((error as NodeJS.ErrnoException).code === "ECONNRESET") return;
      console.error("[Mock Mode] MSW interception failed:", error.message);
      resolve(
        new Response(
          JSON.stringify({
            error: "MSW interception failed",
            message: `MSW did not intercept http.request. Error: ${error.message}`,
            path: pathname,
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    });

    if (request.signal) {
      if (request.signal.aborted) {
        req.destroy();
        return;
      }
      request.signal.addEventListener("abort", () => req.destroy(), { once: true });
    }

    req.end();
  });
}

export const GET = async (request: NextRequest): Promise<Response> => {
  if (process.env.NEXT_PUBLIC_MOCK_API === "true") {
    const { pathname, searchParams } = request.nextUrl;
    return handleMockModeRequest(request, "GET", pathname, searchParams);
  }
  return prodGET(request);
};
