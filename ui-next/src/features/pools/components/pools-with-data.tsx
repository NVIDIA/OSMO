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

import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { prefetchPools } from "@/lib/api/server/pools";
import { prefetchProfile } from "@/lib/api/server/profile";
import { PoolsPageContent } from "@/features/pools/components/pools-page-content";
import { createServerQueryClient } from "@/lib/query-client";

export async function PoolsWithData() {
  // Create server-optimized QueryClient (no retries -- fail fast for SSR)
  const queryClient = createServerQueryClient();

  // This await causes the component to suspend
  // React streams the Suspense fallback, then streams this when ready
  try {
    // Prefetch pools and profile in parallel — profile is needed immediately for
    // the "My Pools" scope filter (accessiblePoolNames). Without this, the client
    // would fetch profile after hydration and show 0 pools briefly.
    await Promise.all([prefetchPools(queryClient), prefetchProfile(queryClient)]);
  } catch (error) {
    // Prefetch failed (e.g., auth unavailable during HMR, network error, backend down)
    // Page will still render - client will fetch on hydration if cache is empty
    console.debug(
      "[Server Prefetch] Could not prefetch pools:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }

  // Wrap in HydrationBoundary so client gets the cached data
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PoolsPageContent />
    </HydrationBoundary>
  );
}
