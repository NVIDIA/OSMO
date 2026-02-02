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
 * Streaming Log Proxy Route Handler
 *
 * Proxies log requests to the backend and streams the response.
 *
 * @see https://nextjs.org/docs/app/building-your-application/routing/route-handlers
 */

import { NextRequest } from "next/server";
import { getServerApiBaseUrl } from "@/lib/api/server/config";

/**
 * GET /api/workflow/[name]/logs
 *
 * Proxies to backend and streams the response.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  const backendUrl = getServerApiBaseUrl();

  const url = new URL(`${backendUrl}/api/workflow/${encodeURIComponent(name)}/logs`);

  // Forward all query parameters
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  // Forward auth headers
  const headers = new Headers();
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    headers.set("Authorization", authHeader);
  }

  const cookie = request.headers.get("Cookie");
  if (cookie) {
    headers.set("Cookie", cookie);
  }

  headers.set("Accept", "text/plain");

  try {
    // Use native fetch for simple proxy
    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      return new Response(`Backend error: ${response.status} ${response.statusText}`, {
        status: response.status,
        headers: { "Content-Type": "text/plain" },
      });
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[Logs Proxy] Backend fetch failed:", error);
    return new Response(`Failed to connect to backend: ${error instanceof Error ? error.message : "Unknown error"}`, {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
  }
}
