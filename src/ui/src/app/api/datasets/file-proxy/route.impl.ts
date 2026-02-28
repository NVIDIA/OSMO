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
 * Dataset File Proxy Route — Development Build
 *
 * In mock mode, routes requests through Node.js http.request to localhost:9999
 * so MSW can intercept them (MSW intercepts http.request, not Next.js's undici fetch).
 *
 * Production builds alias this to route.impl.production.ts (zero mock code).
 */

import { GET as prodGET, HEAD as prodHEAD } from "@/app/api/datasets/file-proxy/route.impl.production";
import type { NextRequest } from "next/server";
import { handleMockModeRequest } from "@/app/api/server-mock-utils";

export const GET = async (request: NextRequest): Promise<Response> => {
  if (process.env.NEXT_PUBLIC_MOCK_API === "true") {
    const { pathname, searchParams } = request.nextUrl;
    return handleMockModeRequest(request, "GET", pathname, searchParams);
  }
  return prodGET(request);
};

export const HEAD = async (request: NextRequest): Promise<Response> => {
  if (process.env.NEXT_PUBLIC_MOCK_API === "true") {
    const { pathname, searchParams } = request.nextUrl;
    return handleMockModeRequest(request, "HEAD", pathname, searchParams);
  }
  return prodHEAD(request);
};
