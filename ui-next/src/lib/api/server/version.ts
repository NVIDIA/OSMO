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
 * Server-Side Version Fetching
 *
 * Fetch OSMO version info on the server for SSR/RSC.
 */

import { cache } from "react";
import { getServerApiBaseUrl, getServerFetchHeaders, handleResponse, type ServerFetchOptions } from "./config";
import { transformVersionResponse } from "../adapter/transforms";
import type { Version } from "../adapter/types";

// Version rarely changes, cache for 10 minutes
const VERSION_REVALIDATE = 600;

/**
 * Fetch OSMO version info from the server.
 *
 * @param options - Fetch options
 * @returns Version info or null if unavailable
 */
export const fetchVersion = cache(async (options: ServerFetchOptions = {}): Promise<Version | null> => {
  const { revalidate = VERSION_REVALIDATE, tags = ["version"] } = options;

  const baseUrl = getServerApiBaseUrl();
  const headers = await getServerFetchHeaders();
  const url = `${baseUrl}/api/version`;

  try {
    const response = await fetch(url, {
      headers,
      next: {
        revalidate,
        tags,
      },
    });

    if (!response.ok) {
      return null;
    }

    const rawData = await handleResponse<unknown>(response, url);
    return transformVersionResponse(rawData);
  } catch {
    // Version endpoint may not be available
    return null;
  }
});
