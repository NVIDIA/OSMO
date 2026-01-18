/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pools With Data (Async Server Component)
 *
 * This component suspends while prefetching data on the server.
 * When wrapped in Suspense, it enables streaming:
 * 1. Parent renders skeleton immediately
 * 2. This component awaits data fetch
 * 3. When ready, React streams the content to replace skeleton
 *
 * Benefits:
 * - Fast TTFB (skeleton streams immediately)
 * - No client-side fetch (data in hydrated cache)
 * - Seamless content swap (React handles it)
 */

import { dehydrate, QueryClient, HydrationBoundary } from "@tanstack/react-query";
import { prefetchPools } from "@/lib/api/server";
import { PoolsPageContent } from "./pools-page-content";

export async function PoolsWithData() {
  // Create QueryClient for this request
  const queryClient = new QueryClient();

  // This await causes the component to suspend
  // React streams the Suspense fallback, then streams this when ready
  await prefetchPools(queryClient);

  // Wrap in HydrationBoundary so client gets the cached data
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PoolsPageContent />
    </HydrationBoundary>
  );
}
