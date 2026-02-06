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
 * When wrapped in Suspense, it enables streaming:
 * 1. Parent renders skeleton immediately
 * 2. This component awaits parallel data fetches
 * 3. When ready, React streams the content to replace skeleton
 *
 * Parallel Fetching:
 * - Pools, workflows, and version are fetched simultaneously
 * - Total wait time = slowest API, not sum of all APIs
 */

import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { prefetchPoolsForDashboard } from "@/lib/api/server/pools";
import { prefetchWorkflowsList } from "@/lib/api/server/workflows";
import { DashboardContent } from "./dashboard-content";
import { createQueryClient } from "@/lib/query-client";

export async function DashboardWithData() {
  // Create QueryClient for this request using shared factory
  const queryClient = createQueryClient();

  // This await causes the component to suspend
  // Parallel prefetch - all APIs called simultaneously for fastest loading
  // Note: Version is NOT prefetched - it's static metadata fetched client-side only
  try {
    await Promise.all([prefetchPoolsForDashboard(queryClient), prefetchWorkflowsList(queryClient)]);
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
