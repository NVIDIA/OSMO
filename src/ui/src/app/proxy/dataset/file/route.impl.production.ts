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
 * Server-side proxy for fetching dataset files. All requests route through
 * the backend service's authenticated /file-content endpoint, which signs
 * the upstream call against the bucket credential. The proxy itself does
 * not accept arbitrary URLs — that would be an SSRF vector
 * (cloud-metadata endpoints, RFC1918 ranges, loopback). Manifests since
 * #795 always carry storage_path, so callers no longer need a url= form.
 *
 * GET /proxy/dataset/file?bucket=...&name=...&storagePath=...  → service proxy
 * HEAD variant                                                 → headers only
 */

import type { NextRequest } from "next/server";
import { getServerApiBaseUrl } from "@/lib/api/server/config";
import { forwardAuthHeaders } from "@/lib/api/server/proxy-headers";

const FORWARDED_REQUEST_HEADERS = ["range"] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "last-modified",
  "etag",
  "cache-control",
  "accept-ranges",
  "content-range",
] as const;

function forwardRequestHeaders(request: NextRequest, base: HeadersInit = {}): HeadersInit {
  const headers = new Headers(base);
  for (const header of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(header);
    if (value) headers.set(header, value);
  }
  return headers;
}

function forwardResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const header of FORWARDED_RESPONSE_HEADERS) {
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

function parseParams(request: Request): ServiceParams | Response {
  const { searchParams } = new URL(request.url);

  const bucket = searchParams.get("bucket");
  const name = searchParams.get("name");
  const storagePath = searchParams.get("storagePath");
  const filename = searchParams.get("filename") ?? undefined;

  if (!bucket || !name || !storagePath) {
    return Response.json({ error: "bucket, name, and storagePath query params are required" }, { status: 400 });
  }

  return { bucket, name, storagePath, filename };
}

async function fetchUpstream(request: NextRequest, params: ServiceParams, method: string): Promise<Response> {
  const backendUrl = getServerApiBaseUrl();
  const query = new URLSearchParams({ storage_path: params.storagePath });
  if (params.filename) query.set("filename", params.filename);
  const serviceUrl = `${backendUrl}/api/bucket/${encodeURIComponent(params.bucket)}/dataset/${encodeURIComponent(params.name)}/file-content?${query}`;
  const headers = forwardRequestHeaders(request, forwardAuthHeaders(request));
  return fetch(serviceUrl, { method, headers });
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
