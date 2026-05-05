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
 * Dataset File Proxy — Production Implementation
 *
 * Server-side proxy for fetching dataset files from storage URLs.
 *
 * When bucket/name/storagePath params are present, routes through the backend
 * service's file-content endpoint (handles private buckets with credentials).
 * Falls back to direct fetch for legacy callers that only provide a url param.
 *
 * GET /proxy/dataset/file?bucket=...&name=...&storagePath=...  → service proxy
 * GET /proxy/dataset/file?url={encodedFileUrl}                 → direct fetch (legacy)
 * HEAD variants of the above                                   → headers only
 */

import type { NextRequest } from "next/server";
import { getServerApiBaseUrl } from "@/lib/api/server/config";
import { forwardAuthHeaders } from "@/lib/api/server/proxy-headers";

const FORWARDED_HEADERS = ["content-type", "content-length", "last-modified", "etag", "cache-control"] as const;

function forwardResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const header of FORWARDED_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  return headers;
}

interface ServiceParams {
  bucket: string;
  name: string;
  storagePath: string;
  /** Original filename used by the service for Content-Type guessing only.
   *  storage_path is hash-keyed (no extension), so without this every file
   *  comes back as application/octet-stream. */
  filename?: string;
}

interface LegacyParams {
  url: string;
}

function parseParams(request: Request): ServiceParams | LegacyParams | Response {
  const { searchParams } = new URL(request.url);

  const bucket = searchParams.get("bucket");
  const name = searchParams.get("name");
  const storagePath = searchParams.get("storagePath");
  const filename = searchParams.get("filename") ?? undefined;

  if (bucket && name && storagePath) {
    return { bucket, name, storagePath, filename };
  }

  // Legacy fallback: direct URL fetch (works for public buckets only)
  const url = searchParams.get("url");
  if (!url) {
    return Response.json({ error: "bucket/name/storagePath or url parameter is required" }, { status: 400 });
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return Response.json({ error: "Only http/https URLs are supported" }, { status: 400 });
  }
  return { url };
}

function isServiceParams(params: ServiceParams | LegacyParams): params is ServiceParams {
  return "storagePath" in params;
}

async function fetchUpstream(
  request: NextRequest,
  params: ServiceParams | LegacyParams,
  method: string,
): Promise<Response> {
  if (isServiceParams(params)) {
    const backendUrl = getServerApiBaseUrl();
    const query = new URLSearchParams({ storage_path: params.storagePath });
    if (params.filename) query.set("filename", params.filename);
    const serviceUrl = `${backendUrl}/api/bucket/${encodeURIComponent(params.bucket)}/dataset/${encodeURIComponent(params.name)}/file-content?${query}`;
    const headers = forwardAuthHeaders(request);
    return fetch(serviceUrl, { method, headers });
  }
  return fetch(params.url, { method });
}

export async function GET(request: NextRequest) {
  const result = parseParams(request);
  if (result instanceof Response) return result;

  const upstream = await fetchUpstream(request, result, "GET");
  const headers = forwardResponseHeaders(upstream);
  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function HEAD(request: NextRequest) {
  const result = parseParams(request);
  if (result instanceof Response) return result;

  const upstream = await fetchUpstream(request, result, "HEAD");
  const headers = forwardResponseHeaders(upstream);
  return new Response(null, { status: upstream.status, headers });
}
