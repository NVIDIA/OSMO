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
 * Shared mock mode route handler utility.
 * Routes requests through Node.js http.request to localhost:9999 where MSW intercepts them.
 * MSW intercepts http.request reliably; it does NOT intercept Next.js's undici-based globalThis.fetch.
 */

import type { NextRequest } from "next/server";
import http from "node:http";
import { forwardAuthHeaders } from "@/lib/api/server/proxy-headers";

export function handleMockModeRequest(
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
        if (value) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
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
        new Response(JSON.stringify({ error: "MSW interception failed", message: error.message, path: pathname }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    if (request.signal) {
      if (request.signal.aborted) {
        req.destroy();
        return;
      }
      request.signal.addEventListener("abort", () => req.destroy(), { once: true });
    }

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
