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

import { getServerApiBaseUrl, getServerFetchHeaders } from "@/lib/api/server/config";

/**
 * Fetch a dataset manifest through the backend service.
 *
 * Runs server-side (via "use server") so the request originates from the
 * Next.js process. We forward the incoming request's authorization + cookie
 * headers via getServerFetchHeaders so the API gateway (oauth2-proxy) can
 * authenticate the SSR fetch as the same user — without this, oauth2-proxy
 * returns 401 because the SSR fetch carries no session cookie of its own.
 */
export async function fetchManifest(bucket: string, name: string, version: string): Promise<unknown[]> {
  const baseUrl = getServerApiBaseUrl();
  const params = new URLSearchParams({ version });
  const url = `${baseUrl}/api/bucket/${encodeURIComponent(bucket)}/dataset/${encodeURIComponent(name)}/manifest?${params}`;

  const headers = await getServerFetchHeaders();
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status}`);
  }

  return (await response.json()) as unknown[];
}
