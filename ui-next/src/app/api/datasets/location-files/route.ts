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
 * Dataset Location Files Proxy
 *
 * Server-side proxy that fetches the flat file manifest from a dataset version's
 * `location` URL. Runs server-side to avoid CORS restrictions on the storage URL.
 *
 * GET /api/datasets/location-files?url={encodedLocationUrl}
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return Response.json({ error: "url parameter is required" }, { status: 400 });
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return Response.json({ error: "Only http/https URLs are supported" }, { status: 400 });
  }

  const response = await fetch(url);

  if (!response.ok) {
    return Response.json(
      { error: `Failed to fetch location: ${response.status} ${response.statusText}` },
      { status: response.status },
    );
  }

  const data: unknown = await response.json();
  return Response.json(data);
}
