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

"use server";

import http from "node:http";
import { fetchManifest as prodFetchManifest } from "@/lib/api/server/dataset-actions.production";

/**
 * In mock mode, routes through Node.js http.request to localhost:9999
 * where MSW intercepts it. MSW intercepts http.request but NOT Next.js's
 * undici-based fetch, so we must use the Node.js HTTP client.
 */
function mockFetchManifest(url: string): Promise<unknown[]> {
  const params = new URLSearchParams({ url });
  const path = `/api/datasets/location-files?${params.toString()}`;

  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: "localhost", port: 9999, path, method: "GET" }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        if ((response.statusCode ?? 0) >= 400) {
          reject(new Error(`Mock request failed: ${response.statusCode ?? "unknown"}`));
          return;
        }
        try {
          resolve(JSON.parse(body) as unknown[]);
        } catch {
          reject(new Error("Mock request returned invalid JSON"));
        }
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

export async function fetchManifest(url: string): Promise<unknown[]> {
  if (process.env.NEXT_PUBLIC_MOCK_API === "true") {
    return mockFetchManifest(url);
  }
  return prodFetchManifest(url);
}
