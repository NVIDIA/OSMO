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
import { QueryClient } from "@tanstack/react-query";
import type { Version } from "../adapter/types";

/**
 * Fetch OSMO version info from the server.
 *
 * CLEAN PATH: Uses generated client → customFetch (no MSW imports)
 *
 * @param options - Fetch options - DEPRECATED: Not used with adapter
 * @returns Version info or null if unavailable
 */
export const fetchVersion = cache(async (): Promise<Version | null> => {
  try {
    const { getVersionApiVersionGet } = await import("../generated");
    const { transformVersionResponse } = await import("../adapter/transforms");

    const rawData = await getVersionApiVersionGet();
    return transformVersionResponse(rawData);
  } catch {
    // Version endpoint may not be available
    return null;
  }
});

/**
 * Fetch raw version response for prefetching.
 * Returns the raw response that the generated hook expects.
 *
 * CLEAN PATH: Uses generated client → customFetch (no MSW imports)
 */
const fetchVersionRaw = cache(async (): Promise<unknown> => {
  try {
    const { getVersionApiVersionGet } = await import("../generated");
    return await getVersionApiVersionGet();
  } catch {
    return null;
  }
});

/**
 * Prefetch version for Dashboard using the generated hook's query key.
 *
 * @param queryClient - The QueryClient to prefetch into
 * @param options - Fetch options
 */
export async function prefetchVersion(queryClient: QueryClient): Promise<void> {
  // Query key matches generated: ["/api/version"]
  await queryClient.prefetchQuery({
    queryKey: ["/api/version"],
    queryFn: () => fetchVersionRaw(),
  });
}
