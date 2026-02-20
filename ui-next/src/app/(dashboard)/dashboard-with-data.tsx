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
 * Dashboard With Data (Async Server Component)
 *
 * This component suspends while prefetching all dashboard data in parallel.
 * When wrapped in Suspense, it enables streaming / PPR:
 * 1. Page shell + DashboardSkeleton render instantly (static shell)
 * 2. This component awaits parallel data fetches on the server
 * 3. When APIs respond, React streams content to replace skeleton
 * 4. Client hydrates with data already in cache (zero client fetches)
 *
 * Parallel Fetching:
 * - Pools, workflows, and version are all fetched simultaneously
 * - Total wait time = slowest API, not sum of all APIs
 * - Version is included here (not globally) because only the dashboard
 *   displays it directly; the header dropdown lazy-fetches it on open
 */

import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { prefetchPoolsForDashboard } from "@/lib/api/server/pools";
import { prefetchWorkflowsList } from "@/lib/api/server/workflows";
import { prefetchVersion } from "@/lib/api/server/version";
import { prefetchProfile } from "@/lib/api/server/profile";
import { DashboardContent } from "@/app/(dashboard)/dashboard-content";
import { createServerQueryClient } from "@/lib/query-client";

export async function DashboardWithData() {
  // Create server-optimized QueryClient (no retries -- fail fast for SSR)
  const queryClient = createServerQueryClient();

  // This await causes the component to suspend (PPR: streams after static shell)
  // Parallel prefetch - all APIs called simultaneously for fastest loading
  // Version is included: it's tiny, fetched in parallel, and avoids a client fetch
  try {
    await Promise.all([
      prefetchPoolsForDashboard(queryClient),
      prefetchWorkflowsList(queryClient),
      prefetchVersion(queryClient),
      prefetchProfile(queryClient),
    ]);
  } catch (error) {
    // Prefetch failed (e.g., auth unavailable during HMR, network error, backend down)
    // Page will still render - client will fetch on hydration if cache is empty
    console.debug(
      "[Server Prefetch] Could not prefetch dashboard data:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }

  // Wrap in HydrationBoundary so client gets the cached data
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DashboardContent />
    </HydrationBoundary>
  );
}
