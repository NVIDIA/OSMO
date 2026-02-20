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
 * Dataset File Proxy
 *
 * Server-side proxy for fetching dataset files from storage URLs.
 * Routes requests through the server to avoid CSP restrictions.
 *
 * GET /api/datasets/file-proxy?url={encodedFileUrl}  → streams file content
 * HEAD /api/datasets/file-proxy?url={encodedFileUrl} → returns headers only
 */

const FORWARDED_HEADERS = ["content-type", "content-length", "last-modified", "etag", "cache-control"] as const;

function parseAndValidateUrl(request: Request): { url: string } | Response {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return Response.json({ error: "url parameter is required" }, { status: 400 });
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return Response.json({ error: "Only http/https URLs are supported" }, { status: 400 });
  }

  return { url };
}

export async function GET(request: Request) {
  const result = parseAndValidateUrl(request);
  if (result instanceof Response) return result;

  const upstream = await fetch(result.url);

  const headers = new Headers();
  for (const header of FORWARDED_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function HEAD(request: Request) {
  const result = parseAndValidateUrl(request);
  if (result instanceof Response) return result;

  const upstream = await fetch(result.url, { method: "HEAD" });

  const headers = new Headers();
  for (const header of FORWARDED_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new Response(null, { status: upstream.status, headers });
}
