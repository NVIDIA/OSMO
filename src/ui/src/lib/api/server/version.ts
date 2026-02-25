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
 * Server-Side Version Prefetching
 *
 * Prefetch OSMO version info on the server for SSR/PPR.
 * Used by the Dashboard page to include version in the streamed response.
 */

import { cache } from "react";
import { QueryClient } from "@tanstack/react-query";

/**
 * Fetch raw version response for prefetching.
 * Returns the raw response that the generated hook expects.
 *
 * IMPORTANT: Errors propagate intentionally. prefetchQuery handles them
 * by storing error state (not success-with-null), which lets the client
 * retry via its own fetch instead of being stuck with cached null forever.
 *
 * CLEAN PATH: Uses generated client → customFetch (no MSW imports)
 */
const fetchVersionRaw = cache(async (): Promise<unknown> => {
  const { getVersionApiVersionGet } = await import("../generated");
  return await getVersionApiVersionGet();
});

/**
 * Prefetch version for Dashboard using the generated hook's query key.
 *
 * @param queryClient - The QueryClient to prefetch into
 */
export async function prefetchVersion(queryClient: QueryClient): Promise<void> {
  // Query key matches generated: ["/api/version"]
  await queryClient.prefetchQuery({
    queryKey: ["/api/version"],
    queryFn: () => fetchVersionRaw(),
  });
}
